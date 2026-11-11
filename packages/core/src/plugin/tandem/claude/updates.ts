export * as ClaudeUpdates from "./updates.js"

import { Message, type ReasoningPart } from "@opencode/ai/effect"

/**
 * Anthropic's reminder for long silent tool runs ("Keep users informed during long turns", Prompting Claude Fable 5.2):
 * after several tool-calling steps in a row that give the user nothing to read, a system message after the latest
 * tool results asks for a short update.
 */
export const REMINDER = "The user hasn't heard from you in a while: say in a few words what you're doing, then continue."
/** Silent tool-calling steps in a row before a reminder. */
export const THRESHOLD = 8
/**
 * Session metadata: the assistant message IDs whose tool results a reminder followed. Each is sent again at the same
 * place on every later request, because an earlier turn that changed invalidates the thinking blocks after it.
 */
export const KEY = "tandemUpdateReminders"

const varint = (bytes: Uint8Array, start: number): [number, number] | undefined => {
  let value = 0
  let shift = 0
  for (let index = start; index < bytes.length && shift < 49; index++) {
    value += (bytes[index] & 0x7f) * 2 ** shift
    shift += 7
    if (bytes[index] < 0x80) return [value, index + 1]
  }
  return undefined
}

/** The bytes of a protobuf message's first length-delimited field `wanted`. */
const field = (bytes: Uint8Array, wanted: number) => {
  let index = 0
  while (index < bytes.length) {
    const key = varint(bytes, index)
    if (!key) return undefined
    index = key[1]
    const kind = key[0] & 7
    if (kind === 0) {
      const value = varint(bytes, index)
      if (!value) return undefined
      index = value[1]
    } else if (kind === 1) index += 8
    else if (kind === 5) index += 4
    else if (kind === 2) {
      const length = varint(bytes, index)
      if (!length || length[1] + length[0] > bytes.length) return undefined
      if (Math.floor(key[0] / 8) === wanted) return bytes.subarray(length[1], length[1] + length[0])
      index = length[1] + length[0]
    } else return undefined
  }
  return undefined
}

/**
 * The block kind in a thinking signature's readable header: `thinking` for reasoning, `narration` for a progress
 * update. Under `display: "summarized"` both carry text and are otherwise indistinguishable.
 */
export const blockKind = (signature: string) => {
  try {
    const kind = [2, 1, 8].reduce<Uint8Array | undefined>((bytes, wanted) => bytes && field(bytes, wanted), Buffer.from(signature, "base64"))
    return kind ? Buffer.from(kind).toString("utf8") : undefined
  } catch {
    return undefined
  }
}

const signature = (part: ReasoningPart) => part.encrypted ?? Object.values(part.providerMetadata ?? {})
  .map((metadata) => metadata?.signature)
  .find((value): value is string => typeof value === "string")

/** A progress-update thinking block the user can read. */
const progressUpdate = (part: ReasoningPart) => {
  const value = signature(part)
  return part.text.trim().length > 0 && value !== undefined && blockKind(value) === "narration"
}

/** A tool-calling step with no text and no progress update. */
const silent = (message: Message) =>
  message.role === "assistant" &&
  message.content.some((part) => part.type === "tool-call") &&
  !message.content.some((part) => (part.type === "text" && part.text.trim().length > 0) || (part.type === "reasoning" && progressUpdate(part)))

/** The models it is on for: Opus, Fable and Mythos models that take mid-conversation system messages. */
export const applies = (version: { readonly family: string } | undefined, native: boolean) =>
  native && version !== undefined && ["opus", "fable", "mythos"].includes(version.family)

/** Where the reminder after `assistant`'s tool results goes: after them and any system messages that follow. */
const after = (messages: ReadonlyArray<Message>, assistant: number) => {
  let index = assistant + 1
  while (messages[index]?.role === "tool" || messages[index]?.role === "system") index++
  return index
}

/** The assistant message ID a new reminder should follow, when the request continues a long silent run. */
export const due = (messages: ReadonlyArray<Message>, recorded: ReadonlySet<string>) => {
  if (messages.findLast((message) => message.role !== "system")?.role !== "tool") return undefined
  let count = 0
  let latest: string | undefined
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role === "tool" || message.role === "system") continue
    // The run ends at the user, a step the user could read, or the step a reminder already followed.
    if (message.role !== "assistant" || !silent(message) || (message.id !== undefined && recorded.has(message.id))) break
    latest ??= message.id
    count++
  }
  return count >= THRESHOLD ? latest : undefined
}

/** Places a reminder after the tool results of each recorded assistant message. */
export const place = (messages: Message[], recorded: ReadonlySet<string>) => {
  for (let index = messages.length - 1; index >= 0; index--) {
    const id = messages[index].id
    if (messages[index].role === "assistant" && id !== undefined && recorded.has(id))
      messages.splice(after(messages, index), 0, Message.system(REMINDER))
  }
}

/** The recorded IDs in a session's metadata. */
export const recorded = (metadata: Readonly<Record<string, unknown>> | undefined) => {
  const value = metadata?.[KEY]
  return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [])
}
