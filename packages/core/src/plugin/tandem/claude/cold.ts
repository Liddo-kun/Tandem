export * as ClaudeCold from "./cold.js"

import { ai, type LLMRequest, Message, ReasoningEfforts, SystemPart } from "@opencode/ai/effect"
import { DateTime } from "effect"
import { resolve } from "path"
import type { SessionContext } from "../../../session/context.js"
import { TandemPrune } from "../prune.js"
import { ClaudeHeld } from "./held.js"
import { ClaudeInstructions } from "./instructions.js"

/**
 * Compaction on a cold prompt cache. The usual summary request is the main request unchanged, so that it reads the
 * prompt cache. With the cache expired there is nothing to read: the same request would send every token again at
 * full price. This request is built to be small instead: the conversation as one text message with long tool inputs
 * and outputs shortened by `TandemPrune`'s fixed rules, no tool definitions, a few lines of system prompt, no cache
 * breakpoints, sent to a cheaper model. A transcript that model rejects as too long goes out as the usual request.
 */

/** The summary model when the compaction agent names none: this model on the session model's provider. */
export const MODEL = "claude-sonnet-5-5"

/** Prompt caches expire this long after their last use unless the model sets `cache.ttl`. */
const CACHE_LIFETIME = 5 * 60_000
const DURATION_UNITS: Readonly<Record<string, number>> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** Milliseconds a prompt cache entry lives, from a `cache.ttl` such as "5m" or "1h". */
export const cacheLifetime = (ttl: string | undefined) => {
  const match = ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  const scale = match ? DURATION_UNITS[match[2] ?? ""] : undefined
  return match && scale !== undefined ? Number(match[1]) * scale : CACHE_LIFETIME
}

/** The latest response the provider measured: its request is the newest prefix the prompt cache can hold. */
export const lastRequest = (context: Pick<SessionContext.Loaded, "messages">) => {
  const message = context.messages.findLast((message) =>
    message.type === "assistant" && !message.error && message.tokens !== undefined &&
    message.tokens.input + message.tokens.cache.read + message.tokens.cache.write > 0)
  return message?.type === "assistant" ? message : undefined
}

const EFFORTS = new Set<string>(ReasoningEfforts)
const effortVariant = (variant: string | undefined) => variant === undefined || variant === "default" || EFFORTS.has(variant)

/**
 * Whether switching between these variants of the session's model keeps the prompt cache. Core sends a switch between
 * effort variants as a per-turn effort message where the route accepts one (Claude Opus 5 and later, Claude 5.1 and
 * later), leaving the cached prefix as it was; elsewhere the request-wide effort changes, and with it the cache.
 */
const keepsCache = (context: Pick<SessionContext.Loaded, "model">, from: string | undefined) => {
  if (!effortVariant(from) || !effortVariant(context.model.ref.variant)) return false
  const model = context.model.model
  const probe = ai.request({ model, messages: [], providerOptions: model.options?.providerOptions })
  return model.route.supportsEffortUpdates?.(probe) ?? false
}

/**
 * Whether the prompt cache no longer holds this conversation: its last request is older than the cache lifetime, or
 * went to another model, or to another variant whose switch changes the cached prefix (see `keepsCache`). A request
 * made shortly before expiry (see `ClaudeHeld`) read the cache again, so the lifetime then counts from it. A
 * conversation with no measured request has nothing that says how long ago it was sent, so it counts as warm.
 */
export const expired = (context: Pick<SessionContext.Loaded, "messages" | "model" | "session">, now: number) => {
  const last = lastRequest(context)
  if (!last) return false
  const model = context.model.ref
  if (last.model.providerID !== model.providerID || last.model.id !== model.id) return true
  if (last.model.variant !== model.variant && !keepsCache(context, last.model.variant)) return true
  const mark = ClaudeHeld.read(context.session.metadata)
  const read = Math.max(DateTime.toEpochMillis(last.time.created), mark?.assistantID === last.id ? mark.at : 0)
  return now - read > cacheLifetime(context.model.cache?.ttl)
}

export const SYSTEM = [
  "You are an AI coding assistant partway through a session with a user.",
  "The session so far is given to you as a written transcript instead of live messages. In it, `[User]` lines are what the user typed, `[Assistant]` lines are your own earlier replies, and `[Assistant tool call]`, `[Tool result]` and `[Tool error]` lines are the tools you ran and what they returned.",
].join(" ")

/** Added to the compaction prompt: why the conversation looks cut, and what to do about a cut that matters. */
export const NOTE = "The conversation above is given as a transcript to save space. In it, long tool inputs and outputs are shortened, each cut marked where it was made (for example `[… 4,212 characters omitted …]`), the contents of files that are read again from disk for the next window are left out, and your reasoning, images and the system prompt are not included. A cut is not part of what the tool returned, so do not report it as output. Where a detail that matters was cut, name the file, command or tool call that brings it back instead of guessing at it."

const REMINDER = "<system-reminder>"

/** The path a read was given, under the tool's own input name or the one Claude is shown. */
const readPath = (input: unknown, directory: string) => {
  if (!input || typeof input !== "object") return undefined
  const path = "file_path" in input ? input.file_path : "path" in input ? input.path : undefined
  return typeof path === "string" ? resolve(directory, path) : undefined
}

type Options = {
  /** Tool results with the larger allowance. */
  readonly newest: ReadonlySet<string>
  /** Tool calls that read a file whose contents the next window gets from disk, by call ID. */
  readonly restored: ReadonlyMap<string, string>
}

/** One request message as transcript lines. Empty for a message with nothing the transcript shows. */
const flatten = (message: Message, options: Options) => {
  if (message.role === "system") return ""
  return message.content.flatMap((part) => {
    if (part.type === "text") {
      // Instruction files are sent once, ahead of the transcript; other reminders are harness context.
      if (!part.text || part.text.startsWith(REMINDER)) return []
      return [`[${message.role === "user" ? "User" : "Assistant"}]: ${part.text}`]
    }
    if (part.type === "media") return [`[${part.media.mediaType} omitted]`]
    if (part.type === "tool-call") return [`[Assistant tool call]: ${part.name}(${TandemPrune.input(part.input)})`]
    if (part.type !== "tool-result") return []
    const label = part.result.type === "error" ? "Tool error" : "Tool result"
    const path = part.result.type === "error" ? undefined : options.restored.get(part.id)
    if (path !== undefined) return [`[${label}]: [contents of ${path} left out: the file is read again from disk for the next window]`]
    return [`[${label}]: ${TandemPrune.output(TandemPrune.resultText(part), { newest: options.newest.has(part.id), read: TandemPrune.isRead(part.name) })}`]
  }).join("\n")
}

/** The instruction-file reminder the Claude layout puts on a user message, if the request has one. */
const instructions = (messages: ReadonlyArray<Message>) => {
  for (const message of messages) {
    if (message.role !== "user") continue
    for (const part of message.content)
      if (part.type === "text" && part.text.startsWith(`${REMINDER}\n${ClaudeInstructions.FILES}`)) return part.text
  }
  return undefined
}

/**
 * `prepared`, the summary request as the main model would get it, rebuilt for a cold cache:
 * `[system: SYSTEM] [user: instruction files, transcript, prompt]`, no tools and no cache breakpoints. `restored`
 * holds the absolute paths of the files whose contents the next window gets from disk; reads of them become a
 * one-line note. Nothing is cut to reach a size. Undefined when there is nothing to show.
 */
export const request = (prepared: LLMRequest, input: { prompt: string; directory: string; restored: ReadonlySet<string> }) => {
  const files = instructions(prepared.messages)
  const restored = new Map<string, string>()
  for (const message of prepared.messages) {
    for (const part of message.content) {
      if (part.type !== "tool-call" || !TandemPrune.isRead(part.name)) continue
      const path = readPath(part.input, input.directory)
      if (path !== undefined && input.restored.has(path)) restored.set(part.id, path)
    }
  }
  const options = { newest: TandemPrune.newest(prepared.messages), restored }
  // A blank line before each user message, so exchanges read apart.
  const text = prepared.messages
    .map((message) => ({ role: message.role, text: flatten(message, options) }))
    .filter((entry) => entry.text)
    .map((entry, index) => `${index > 0 && entry.role === "user" ? "\n" : ""}${entry.text}`)
    .join("\n")
  if (!text) return undefined
  return {
    ...prepared,
    system: [SystemPart.make(SYSTEM)],
    tools: [],
    toolChoice: undefined,
    cache: "none" as const,
    messages: [Message.user([
      ...(files === undefined ? [] : [Message.text(files)]),
      Message.text(`<transcript>\n${text}\n</transcript>`),
      Message.text(input.prompt),
    ])],
  }
}
