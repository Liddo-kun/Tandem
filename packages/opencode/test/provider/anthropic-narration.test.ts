// UPSTREAM-DIVERGENCE(tandem): fork-owned test for provider/anthropic-narration.ts.
import { describe, expect, test } from "bun:test"
import { AnthropicNarration } from "@/provider/anthropic-narration"
import { NARRATION_SIGNATURE, THINKING_SIGNATURE } from "../fixture/anthropic-signatures"

describe("AnthropicNarration.signatureBlockType", () => {
  test("decodes thinking block type", () => {
    expect(AnthropicNarration.signatureBlockType(THINKING_SIGNATURE)).toBe("thinking")
  })

  test("decodes narration block type", () => {
    expect(AnthropicNarration.signatureBlockType(NARRATION_SIGNATURE)).toBe("narration")
  })

  test("returns undefined for malformed input", () => {
    expect(AnthropicNarration.signatureBlockType("")).toBeUndefined()
    expect(AnthropicNarration.signatureBlockType("not base64!!")).toBeUndefined()
    expect(AnthropicNarration.signatureBlockType(Buffer.from("random plain data").toString("base64"))).toBeUndefined()
    // Truncated real signature: length-delimited fields run past the buffer.
    expect(AnthropicNarration.signatureBlockType(NARRATION_SIGNATURE.slice(0, 40))).toBeUndefined()
  })
})

describe("AnthropicNarration.isNarration", () => {
  test("true only for narration-signed reasoning metadata", () => {
    expect(AnthropicNarration.isNarration({ anthropic: { signature: NARRATION_SIGNATURE } })).toBe(true)
    expect(AnthropicNarration.isNarration({ anthropic: { signature: THINKING_SIGNATURE } })).toBe(false)
    expect(AnthropicNarration.isNarration({ anthropic: { redactedData: "abc" } })).toBe(false)
    expect(AnthropicNarration.isNarration({ anthropic: {} })).toBe(false)
    expect(AnthropicNarration.isNarration({})).toBe(false)
    expect(AnthropicNarration.isNarration(undefined)).toBe(false)
  })
})
