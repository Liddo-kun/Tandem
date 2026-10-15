import { expect, test } from "bun:test"
import { LanguageModel, LLMRequest, Message } from "@opencode/ai"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Schema } from "effect"
import { ClaudeCompaction } from "../src/plugin/tandem/claude/compaction.js"
import { restoredFile } from "../src/plugin/tandem/claude/restore.js"
import { renderTranscript } from "../src/plugin/tandem/claude/transcript.js"
import { SessionMessage } from "../src/session/message.js"

const message = (type: "user" | "assistant", text: string) => Schema.decodeUnknownSync(SessionMessage.Info)({
  id: SessionMessage.ID.create(), type, text, time: { created: Date.now() },
  ...(type === "assistant" ? {
    agent: "build", model: { providerID: "test", id: "claude-test" },
    content: [{ type: "text", text }], time: { created: Date.now() },
  } : {}),
})

test("Claude compaction groups by assistant response, keeping intervening user messages with it", () => {
  const messages = [message("user", "first"), message("assistant", "one"), message("user", "second"), message("assistant", "two")]
  expect(ClaudeCompaction.groups(messages)).toEqual([[messages[0]], messages.slice(1, 3), [messages[3]]])
  expect(ClaudeCompaction.groups([messages[0]])).toHaveLength(1)
})

test("summary prompt stays before trailing system messages and remains a separate text block", () => {
  const model = LanguageModel.make({ id: "claude-test", provider: "test", route: OpenAIChat.route })
  const request = new LLMRequest({ model, system: [], tools: [], messages: [Message.user("typed"), Message.system("date")] })
  const prompted = ClaudeCompaction.appendPrompt(request, "prompt")
  expect(prompted.messages.map((message) => message.role)).toEqual(["user", "system"])
  expect(prompted.messages[0].content).toEqual([{ type: "text", text: "typed\n" }, { type: "text", text: "prompt" }])
  expect(request.messages[0].content).toEqual([{ type: "text", text: "typed" }])
  const toolRequest = LLMRequest.update(request, { messages: [Message.tool({ id: "call", name: "read", result: "output" }), Message.system("date")] })
  const toolPrompted = ClaudeCompaction.appendPrompt(toolRequest, "prompt")
  expect(toolPrompted.messages.map((message) => message.role)).toEqual(["tool", "user", "system"])
  expect(toolPrompted.messages[1].content).toEqual([{ type: "text", text: "prompt" }])
})

test("CC reply parser removes only the first analysis and summary tags and collapses blank lines", () => {
  expect(ClaudeCompaction.parseReply("<analysis>private</analysis>\n\n<summary>  task\n\n\nnext  </summary>\n\n\nend"))
    .toBe("Summary:\ntask\n\nnext\n\nend")
  expect(ClaudeCompaction.parseReply("<analysis>private</analysis> ")).toBe("")
  const summary = ClaudeCompaction.summaryMessage("Summary:\ntask")
  expect(summary.match(/Summary:/g)).toHaveLength(1)
  expect(summary).not.toContain("full transcript at:")
  expect(summary).toContain("kept verbatim")
})

test("restore token cap produces CC's reference note, not a chopped file", () => {
  expect(restoredFile("/work/large", "x".repeat(20_004)))
    .toBe("Note: /work/large was read before the last conversation was summarized, but the contents are too large to include. Use Read tool if you need to access it.")
  expect(restoredFile("/work/small", "one\ntwo\n")).toContain("1: one\n2: two")
})

test("transcript records user and assistant text without reasoning or synthetic context", () => {
  const user = message("user", "literal user request")
  const assistant = message("assistant", "visible reply")
  const synthetic = Schema.decodeUnknownSync(SessionMessage.Info)({
    id: SessionMessage.ID.create(), type: "synthetic", text: "injected instructions", time: { created: Date.now() },
  })
  const withReasoning = assistant.type === "assistant" ? {
    ...assistant, content: [...assistant.content, { type: "reasoning" as const, text: "private reasoning", time: assistant.time }],
  } : assistant
  expect(renderTranscript([user, synthetic, withReasoning], "/work")).toBe("User:\nliteral user request\n\nAssistant:\nvisible reply\n")
})
