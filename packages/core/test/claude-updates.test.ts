// Tandem-owned (not in upstream): the reminder after long silent tool runs in Claude sessions.
import { describe, expect, test } from "bun:test"
import { Message, type Message as LLMMessage } from "@opencode/ai/effect"
import { ClaudeUpdates } from "../src/plugin/tandem/claude/updates.js"

/** A signature with the readable header Anthropic puts before the encrypted thinking. */
const signature = (kind: string) => {
  const name = Buffer.from(kind)
  const header = Buffer.from([0x08, 0x13, 0x18, 0x02, 0x38, 0x01, 0x42, name.length, ...name])
  const inner = Buffer.from([0x0a, header.length, ...header, 0x12, 0x03, 1, 2, 3])
  return Buffer.from([0x08, 0x04, 0x12, inner.length, ...inner]).toString("base64")
}
const reasoning = (kind: string, text = "Checked the config; editing it next.") =>
  ({ type: "reasoning" as const, text, providerMetadata: { anthropic: { signature: signature(kind) } } })

let calls = 0
const step = (id: string, extra: Extract<Parameters<typeof Message.assistant>[0], ReadonlyArray<unknown>> = []): LLMMessage[] => {
  const call = `call_${calls++}`
  return [
    Message.make({ id, role: "assistant", content: [...extra, { type: "tool-call", id: call, name: "shell", input: {} }] }),
    Message.tool({ id: call, name: "shell", result: { type: "text", value: "ok" } }),
  ]
}
const run = (prefix: string, count: number, extra?: Parameters<typeof step>[1]) =>
  Array.from({ length: count }, (_, index) => step(`${prefix}${index}`, extra)).flat()
const user = Message.make({ id: "u", role: "user", content: [Message.text("Fix it")] })

describe("ClaudeUpdates", () => {
  test("reads the block kind from a signature", () => {
    expect(ClaudeUpdates.blockKind(signature("narration"))).toBe("narration")
    expect(ClaudeUpdates.blockKind(signature("thinking"))).toBe("thinking")
    expect(ClaudeUpdates.blockKind("not a signature")).toBeUndefined()
  })

  test("is due after enough silent steps, counting reasoning summaries as silent", () => {
    expect(ClaudeUpdates.due([user, ...run("a", ClaudeUpdates.THRESHOLD - 1)], new Set())).toBeUndefined()
    expect(ClaudeUpdates.due([user, ...run("a", ClaudeUpdates.THRESHOLD, [reasoning("thinking")])], new Set())).toBe(`a${ClaudeUpdates.THRESHOLD - 1}`)
  })

  test("a progress update or text ends the run", () => {
    for (const visible of [reasoning("narration"), Message.text("Editing the config.")]) {
      const messages = [user, ...run("a", 5), ...step("b", [visible]), ...run("c", ClaudeUpdates.THRESHOLD - 1)]
      expect(ClaudeUpdates.due(messages, new Set())).toBeUndefined()
    }
    // An empty progress update gives the user nothing to read.
    expect(ClaudeUpdates.due([user, ...run("a", ClaudeUpdates.THRESHOLD, [reasoning("narration", "")])], new Set())).toBeDefined()
  })

  test("waits for tool results, and counts again after a reminder", () => {
    expect(ClaudeUpdates.due([...run("a", ClaudeUpdates.THRESHOLD), user], new Set())).toBeUndefined()
    const messages = [user, ...run("a", ClaudeUpdates.THRESHOLD + 3)]
    expect(ClaudeUpdates.due(messages, new Set([`a${ClaudeUpdates.THRESHOLD - 1}`]))).toBeUndefined()
  })

  test("places each recorded reminder after its step's tool results and any system messages", () => {
    const messages = [user, ...step("a"), Message.system("update"), ...step("b"), ...step("c")]
    ClaudeUpdates.place(messages, new Set(["a", "c"]))
    expect(messages.map((message) => message.role === "system" ? message.content.map((part) => part.type === "text" ? part.text : "").join("") : message.role)).toEqual([
      "user", "assistant", "tool", "update", ClaudeUpdates.REMINDER, "assistant", "tool", "assistant", "tool", ClaudeUpdates.REMINDER,
    ])
  })

  test("is on for Opus, Fable and Mythos models with native system messages", () => {
    expect(ClaudeUpdates.applies({ family: "opus" }, true)).toBe(true)
    expect(ClaudeUpdates.applies({ family: "mythos" }, true)).toBe(true)
    expect(ClaudeUpdates.applies({ family: "sonnet" }, true)).toBe(false)
    expect(ClaudeUpdates.applies({ family: "fable" }, false)).toBe(false)
  })
})
