// Tandem-owned (not in upstream): idle compaction's check that its request continues the last main request as sent.
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { ClaudeHeld } from "../src/plugin/tandem/claude/held.js"

const long = "x".repeat(450_000)
const marker = { type: "ephemeral", ttl: "1h" }

const body = (input: { billing: string; system?: string; maxTokens?: number; messages: unknown[] }) =>
  HttpClientRequest.post("https://api.anthropic.com/v1/messages").pipe(
    HttpClientRequest.bodyText(
      JSON.stringify({
        model: "claude-fable-5-2",
        system: [
          { type: "text", text: `x-anthropic-billing-header: ${input.billing}` },
          { type: "text", text: input.system ?? "You are Claude Code.", cache_control: marker },
        ],
        messages: input.messages,
        tools: [],
        stream: true,
        max_tokens: input.maxTokens ?? 64_000,
        thinking: { type: "adaptive" },
      }),
      "application/json",
    ),
  )

const history = [
  { role: "user", content: [{ type: "text", text: long }] },
  { role: "assistant", content: [{ type: "text", text: "First answer" }] },
  { role: "user", content: [{ type: "text", text: "Second question", cache_control: marker }] },
]
// The summary request moves the cache marker to its prompt; its billing line and output limit differ.
const summary = (messages = history) => [
  ...messages.map((message) => ({ ...message, content: message.content.map(({ cache_control: _, ...part }: any) => part) })),
  { role: "user", content: [{ type: "text", text: "Summarize.", cache_control: marker }] },
]

const main = (sessionID: string) =>
  ClaudeHeld.sending({ sessionID, kind: "primary" }, body({ billing: "cch=1; cc_prompt_id=a;", messages: history }))

const idle = (sessionID: string, request: HttpClientRequest.HttpClientRequest) => {
  const guard = new ClaudeHeld.Guard()
  return ClaudeHeld.sending({ sessionID, kind: "compaction" }, request).pipe(
    Effect.provideService(ClaudeHeld.Idle, guard),
    Effect.map((stopped) => ({ stopped, reason: guard.stopped })),
  )
}

describe("idle compaction request check", () => {
  test("sends a request that continues the last main request", async () => {
    const result = await Effect.runPromise(main("ses_a").pipe(
      Effect.andThen(idle("ses_a", body({ billing: "cch=2;", maxTokens: 32_000, messages: summary() }))),
    ))
    expect(result).toEqual({ stopped: undefined, reason: undefined })
  })

  test("stops a request whose system prompt changed", async () => {
    const result = await Effect.runPromise(main("ses_b").pipe(
      Effect.andThen(idle("ses_b", body({ billing: "cch=2;", system: "You are Claude Code, updated.", messages: summary() }))),
    ))
    expect(result.reason).toBe("its model, settings, tools or system prompt differ from the last main request's")
    expect(result.stopped?.status).toBe(400)
  })

  test("stops a request whose earlier message changed", async () => {
    const changed = [history[0], { role: "assistant", content: [{ type: "text", text: "Other answer" }] }, history[2]]
    const result = await Effect.runPromise(main("ses_c").pipe(
      Effect.andThen(idle("ses_c", body({ billing: "cch=2;", messages: summary(changed) }))),
    ))
    expect(result.reason).toBe("its message 2 differs from the last main request's")
  })

  test("sends a request that adds its prompt to the last message", async () => {
    const [first, answer, question] = history
    const merged = [first, answer, { role: "user", content: [{ type: "text", text: "Second question" }, { type: "text", text: "Summarize.", cache_control: marker }] }]
    const result = await Effect.runPromise(main("ses_f").pipe(
      Effect.andThen(idle("ses_f", body({ billing: "cch=2;", messages: merged }))),
    ))
    expect(question.content).toHaveLength(1)
    expect(result.reason).toBeUndefined()
  })

  test("stops a request whose last message lost a block", async () => {
    const [first, answer] = history
    const replaced = [first, answer, { role: "user", content: [{ type: "text", text: "Summarize." }] }]
    const result = await Effect.runPromise(main("ses_g").pipe(
      Effect.andThen(idle("ses_g", body({ billing: "cch=2;", messages: replaced }))),
    ))
    expect(result.reason).toBe("its message 3 differs from the last main request's")
  })

  test("stops a request when no main request was seen", async () => {
    const result = await Effect.runPromise(idle("ses_d", body({ billing: "cch=2;", messages: summary() })))
    expect(result.reason).toBe("no main request of this session has been sent since the server started")
  })

  test("leaves other compaction requests alone", async () => {
    const stopped = await Effect.runPromise(
      ClaudeHeld.sending({ sessionID: "ses_e", kind: "compaction" }, body({ billing: "cch=2;", messages: summary() })),
    )
    expect(stopped).toBeUndefined()
  })
})
