// Tandem-owned (not in upstream): show Claude narration as assistant text.
//
// With adaptive thinking, Anthropic streams narration (the model's user-addressed status updates
// between tool calls) as ordinary signed `thinking` blocks. Only the block type inside the opaque
// signature tells them apart: base64 protobuf, field 2 (signed envelope) → field 1 (header) →
// field 8 ("thinking" | "narration"). The model believes the user saw these messages, so the
// timeline shows them as text. Display only: stored parts and provider round-trips are unchanged.
import type { SessionMessageInfo } from "@opencode/client/promise"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Content = Assistant["content"][number]
type Text = Extract<Content, { type: "text" }>
type Reasoning = Extract<Content, { type: "reasoning" }>

function varint(bytes: Uint8Array, start: number) {
  let value = 0
  let shift = 0
  let pos = start
  while (pos < bytes.length) {
    const byte = bytes[pos++]!
    // Header fields fit in 32 bits; larger values only need to be skipped correctly.
    if (shift < 32) value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos }
    shift += 7
    if (shift > 63) return undefined
  }
  return undefined
}

// First length-delimited occurrence of `field`, or undefined when absent or malformed.
function field(bytes: Uint8Array, wanted: number) {
  let pos = 0
  while (pos < bytes.length) {
    const tag = varint(bytes, pos)
    if (!tag) return undefined
    pos = tag.next
    const wire = tag.value & 7
    if (wire === 0) {
      const skipped = varint(bytes, pos)
      if (!skipped) return undefined
      pos = skipped.next
      continue
    }
    if (wire === 1) {
      pos += 8
      continue
    }
    if (wire === 5) {
      pos += 4
      continue
    }
    if (wire !== 2) return undefined
    const length = varint(bytes, pos)
    if (!length) return undefined
    const end = length.next + length.value
    if (end > bytes.length) return undefined
    if (tag.value >>> 3 === wanted) return bytes.subarray(length.next, end)
    pos = end
  }
  return undefined
}

function blockType(signature: string) {
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(signature), (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
  const envelope = field(bytes, 2)
  const header = envelope && field(envelope, 1)
  const type = header && field(header, 8)
  if (!type || type.length === 0 || type.length > 32) return undefined
  return new TextDecoder().decode(type)
}

const decoded = new Map<string, boolean>()

function isNarration(content: Content): content is Reasoning {
  if (content.type !== "reasoning") return false
  const signature = content.state?.signature
  if (typeof signature !== "string" || signature.length === 0) return false
  let result = decoded.get(signature)
  if (result === undefined) {
    result = blockType(signature) === "narration"
    if (decoded.size >= 2000) decoded.clear()
    decoded.set(signature, result)
  }
  return result
}

// Converted parts keep their identity so rows and memos keyed by content stay stable.
const texts = new WeakMap<Content, Text>()
const narrations = new WeakSet<Content>()

/** True for a text part converted from Claude narration, so renderers can mark it. */
export function isNarrationText(content: Content) {
  return narrations.has(content)
}

function asText(content: Content): Content {
  if (!isNarration(content)) return content
  let text = texts.get(content)
  if (!text) {
    text = { type: "text", text: content.text, state: content.state }
    texts.set(content, text)
    narrations.add(text)
  }
  return text
}

/** Returns messages with Claude narration parts shown as text; other messages keep their identity. */
export function narrationAsText(messages: SessionMessageInfo[]): SessionMessageInfo[] {
  return messages.map((message) =>
    message.type === "assistant" && message.content.some(isNarration)
      ? { ...message, content: message.content.map(asText) }
      : message,
  )
}
