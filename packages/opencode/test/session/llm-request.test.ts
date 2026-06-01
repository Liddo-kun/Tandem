import { describe, expect, test } from "bun:test"
import { LLMRequestPrep } from "@/session/llm/request"
import { Effect } from "effect"

const passthroughPlugin = {
  trigger: (_name: string, _input: unknown, output: unknown) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
}

describe("LLMRequestPrep.prepare - Claude Code system shaping", () => {
  test("prepends CCH billing before the Anthropic base prompt", async () => {
    const prepared = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: { id: "msg_user", model: {}, tools: {} },
        sessionID: "ses_test",
        model: {
          id: "anthropic/claude-3-5-sonnet",
          providerID: "anthropic",
          api: {
            id: "claude-3-5-sonnet-20241022",
            url: "https://api.anthropic.com",
            npm: "@ai-sdk/anthropic",
          },
          name: "Claude 3.5 Sonnet",
          capabilities: { temperature: false, reasoning: false, input: {}, output: {}, toolcall: true, attachment: false },
          cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
          limit: { context: 200000, output: 8192 },
          status: "active",
          options: {},
          variants: {},
          headers: {},
        },
        agent: { name: "build", permission: [], options: {} },
        system: ["Environment context you are running in:"],
        messages: [{ role: "user", content: [{ type: "text", text: "hello world test message" }] }],
        tools: {},
        provider: { id: "anthropic", options: {}, key: "" },
        auth: undefined,
        plugin: passthroughPlugin,
        flags: { client: "test" },
        isWorkflow: false,
      } as any),
    )

    expect(prepared.system[0]).toBe(
      "x-anthropic-billing-header: cc_version=2.1.159.a3f; cc_entrypoint=cli; cch=4ffc3;",
    )
    expect(prepared.system[1]).toStartWith("You are Claude Code, Anthropic's official CLI for Claude.")
    expect(prepared.system[1]).toContain("Environment context you are running in:")
  })
})

describe("LLMRequestPrep.prepare - context_management gating", () => {
  const claudeModel = (variants: Record<string, any>) => ({
    id: "anthropic/claude-opus-4-8",
    providerID: "anthropic",
    api: { id: "claude-opus-4-8", url: "https://api.anthropic.com", npm: "@ai-sdk/anthropic" },
    name: "Claude Opus 4.8",
    capabilities: { temperature: true, reasoning: true, input: {}, output: {}, toolcall: true, attachment: false },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 200000, output: 64000 },
    status: "active",
    options: {},
    variants,
    headers: {},
  })

  const prepare = (userModel: Record<string, any>) =>
    Effect.runPromise(
      LLMRequestPrep.prepare({
        user: { id: "msg_user", model: userModel, tools: {} },
        sessionID: "ses_test",
        model: claudeModel({ medium: { thinking: { type: "adaptive" }, effort: "medium" } }),
        agent: { name: "build", permission: [], options: {} },
        system: ["Environment context you are running in:"],
        messages: [{ role: "user", content: [{ type: "text", text: "hello world test message" }] }],
        tools: {},
        provider: { id: "anthropic", options: {}, key: "" },
        auth: undefined,
        plugin: passthroughPlugin,
        flags: { client: "test" },
        isWorkflow: false,
      } as any),
    )

  test("attaches clear_thinking keep:all when a thinking variant is selected", async () => {
    const prepared = await prepare({ variant: "medium" })
    expect(prepared.params.options.thinking?.type).toBe("adaptive")
    expect(prepared.params.options.contextManagement).toEqual({
      edits: [{ type: "clear_thinking_20251015", keep: "all" }],
    })
  })

  test("omits clear_thinking when no thinking variant is selected (e.g. subagent)", async () => {
    const prepared = await prepare({})
    expect(prepared.params.options.thinking).toBeUndefined()
    expect(prepared.params.options.contextManagement).toBeUndefined()
  })
})
