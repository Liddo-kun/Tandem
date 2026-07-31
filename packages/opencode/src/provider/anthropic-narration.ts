// UPSTREAM-DIVERGENCE(tandem): fork-owned module. Anthropic's adaptive-thinking
// API streams "narration" blocks — user-addressed mid-turn status updates the
// model believes are visible messages — typed as ordinary `thinking` content
// blocks on the wire (thinking_delta + signature_delta; verified via live SSE
// capture). The only distinguisher is the block type recorded inside the
// opaque signature: base64 protobuf, outer field 2 (signed envelope) → field 1
// (header) → field 8 (block type string: "thinking" | "narration"). This
// module decodes that so the session processor can tag narration reasoning
// parts for visible rendering without touching the signature round-trip.

function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } | undefined {
  let value = 0
  let shift = 0
  while (pos < buf.length) {
    const byte = buf[pos++]
    // Cap at 32 bits; header fields never need more and this keeps the math exact.
    if (shift < 32) value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos }
    shift += 7
    if (shift > 63) return undefined
  }
  return undefined
}

/** First length-delimited occurrence of `field` in a protobuf message, or undefined if malformed/absent. */
function lengthDelimited(buf: Uint8Array, field: number): Uint8Array | undefined {
  let pos = 0
  while (pos < buf.length) {
    const tag = readVarint(buf, pos)
    if (!tag) return undefined
    pos = tag.next
    const fieldNumber = tag.value >>> 3
    const wireType = tag.value & 7
    if (wireType === 0) {
      const skipped = readVarint(buf, pos)
      if (!skipped) return undefined
      pos = skipped.next
      continue
    }
    if (wireType === 1) {
      pos += 8
      continue
    }
    if (wireType === 5) {
      pos += 4
      continue
    }
    if (wireType !== 2) return undefined
    const len = readVarint(buf, pos)
    if (!len) return undefined
    pos = len.next
    const end = pos + len.value
    if (end > buf.length) return undefined
    if (fieldNumber === field) return buf.subarray(pos, end)
    pos = end
  }
  return undefined
}

/** Block type recorded inside an Anthropic thinking-block signature ("thinking", "narration", ...). */
export function signatureBlockType(signature: string): string | undefined {
  const bytes = Buffer.from(signature, "base64")
  if (bytes.length === 0) return undefined
  const envelope = lengthDelimited(bytes, 2)
  if (!envelope) return undefined
  const header = lengthDelimited(envelope, 1)
  if (!header) return undefined
  const type = lengthDelimited(header, 8)
  if (!type || type.length === 0 || type.length > 32) return undefined
  const text = new TextDecoder().decode(type)
  return /^[a-z_]+$/.test(text) ? text : undefined
}

/** True when a reasoning part's provider metadata carries a narration-block signature. */
export function isNarration(metadata: Record<string, any> | undefined): boolean {
  const signature = metadata?.anthropic?.signature
  if (typeof signature !== "string" || signature.length === 0) return false
  return signatureBlockType(signature) === "narration"
}

export * as AnthropicNarration from "./anthropic-narration"
