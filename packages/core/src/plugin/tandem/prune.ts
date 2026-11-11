// Tandem-owned (not in upstream): fixed rules for shortening long tool text, shared by cold-cache compaction and trimming.
export * as TandemPrune from "./prune.js"

import { AssistantMessage, type ContentPart, type Message, ToolMessage } from "@opencode/ai/effect"

type ToolResult = Extract<ContentPart, { type: "tool-result" }>

/**
 * The rules, in characters. They apply the same way to every conversation: nothing is cut to reach a size.
 *
 * - A tool output of up to `whole` characters is kept whole. A longer one keeps `side` characters from its start and
 *   from its end, each cut back to a line break, with a note between them saying how much was left out.
 * - A file read longer than `whole` keeps only its first `side` characters: the file is still on disk.
 * - The newest outputs, `NEWEST` characters of them counted back from the end, get the larger allowance.
 */
const OLDER = { whole: 3_000, side: 1_500 }
const NEWER = { whole: 20_000, side: 10_000 }
const NEWEST = 60_000
/** A tool input longer than twice this keeps its first characters: what it wrote or changed is on disk. */
const INPUT = 1_000

const HIGH_SURROGATE = /[\uD800-\uDBFF]$/
const LOW_SURROGATE = /^[\uDC00-\uDFFF]/
const count = (characters: number) => `${characters.toLocaleString("en-US")} characters`

/** At most `limit` characters from the start of `text`, ending at a line break when one is in the second half. */
const start = (text: string, limit: number) => {
  const cut = text.slice(0, limit).replace(HIGH_SURROGATE, "")
  const line = cut.lastIndexOf("\n")
  return line >= limit / 2 ? cut.slice(0, line) : cut
}

/** At most `limit` characters from the end of `text`, starting after a line break when one is in the first half. */
const end = (text: string, limit: number) => {
  const cut = text.slice(-limit).replace(LOW_SURROGATE, "")
  const line = cut.indexOf("\n")
  return line >= 0 && line < limit / 2 ? cut.slice(line + 1) : cut
}

/** A tool output under the rules above. `reason` is added to the note, such as how to get the rest back. */
export const output = (text: string, options: { newest: boolean; read: boolean; reason?: string }) => {
  const rule = options.newest ? NEWER : OLDER
  if (text.length <= rule.whole) return text
  const head = start(text, rule.side)
  if (options.read) return `${head}\n[… the remaining ${count(text.length - head.length)} of this read omitted${options.reason ?? ""} …]`
  const tail = end(text, rule.side)
  return `${head}\n[… ${count(text.length - head.length - tail.length)} omitted${options.reason ?? ""} …]\n${tail}`
}

/** A tool input as JSON text under the rules above. */
export const input = (value: unknown) => {
  const text = JSON.stringify(value) ?? ""
  if (text.length <= INPUT * 2) return text
  const head = text.slice(0, INPUT).replace(HIGH_SURROGATE, "")
  return `${head}[… ${count(text.length - head.length)} omitted …]`
}

/** A tool result as the text a transcript shows. */
export const resultText = (part: ToolResult) => {
  const result = part.result
  if (result.type === "content")
    return result.value.map((item) => item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`).join("\n")
  return typeof result.value === "string" ? result.value : (JSON.stringify(result.value) ?? "")
}

/** The IDs of the newest tool results in `messages`: `NEWEST` characters of output, counted back from the end. */
export const newest = (messages: ReadonlyArray<Message>) => {
  const ids = new Set<string>()
  let seen = 0
  for (const message of messages.toReversed()) {
    for (const part of message.content.toReversed()) {
      if (part.type !== "tool-result" || seen >= NEWEST) continue
      seen += resultText(part).length
      ids.add(part.id)
    }
  }
  return ids
}

/** The read tool under its own name or the one Claude is shown. */
export const isRead = (name: string) => name.toLowerCase() === "read"

const REASON = " to save context; run the tool again if you need it"

const shorten = (part: ToolResult, recent: boolean): ToolResult => {
  const options = { newest: recent, read: isRead(part.name), reason: REASON }
  const result = part.result
  if (result.type === "content") {
    const value = result.value.map((item) => {
      if (item.type === "text") {
        const text = output(item.text, options)
        return text === item.text ? item : { ...item, text }
      }
      // The newest attachments, such as a screenshot just taken, may be what the next prompt is about.
      return recent ? item : { type: "text" as const, text: `[${item.mime}${item.name === undefined ? "" : ` ${item.name}`} removed to save context]` }
    })
    return value.every((item, index) => item === result.value[index]) ? part : { ...part, result: { ...result, value } }
  }
  const text = typeof result.value === "string" ? result.value : (JSON.stringify(result.value) ?? "")
  const cut = output(text, options)
  if (cut === text) return part
  return { ...part, result: result.type === "error" ? { ...result, value: cut } : { type: "text", value: cut } }
}

/**
 * `messages` with the tool results before index `before` shortened in place, for a conversation that carries on.
 * Tool inputs, replies and reasoning are left alone. The same messages always give the same result, so the
 * shortened prefix is cached like any other. Unchanged messages keep their identity.
 */
export const trim = (messages: ReadonlyArray<Message>, before: number): Message[] => {
  const recent = newest(messages.slice(0, before))
  return messages.map((message, index) => {
    if (index >= before) return message
    if (message.role === "tool") {
      const content = message.content.map((part) => shorten(part, recent.has(part.id)))
      return content.every((part, index) => part === message.content[index]) ? message : new ToolMessage({ ...message, content })
    }
    if (message.role !== "assistant") return message
    const content = message.content.map((part) => part.type === "tool-result" ? shorten(part, recent.has(part.id)) : part)
    return content.every((part, index) => part === message.content[index]) ? message : new AssistantMessage({ ...message, content })
  })
}
