import { describe, expect, test } from "bun:test"
import { pngDimensions } from "../../src/plugin/openai/imagegen/imagegen"

// Build a buffer with a valid 8-byte PNG signature followed by an IHDR chunk carrying
// the given width/height (the two big-endian uint32s pngDimensions reads at offsets
// 16 and 20). Only the header is needed; pngDimensions never looks at pixel data.
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24)
  buf.writeUInt32BE(0x89504e47, 0) // \x89PNG signature (first 4 bytes)
  buf.write("\r\n\x1a\n", 4, "binary") // rest of the signature
  buf.writeUInt32BE(13, 8) // IHDR length
  buf.write("IHDR", 12, "ascii")
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

describe("plugin.imagegen pngDimensions", () => {
  test("reads square dimensions", () => {
    expect(pngDimensions(pngHeader(1024, 1024))).toBe("1024x1024")
  })

  test("reads landscape dimensions the OAuth backend actually returns", () => {
    // Real-world bug: requested 1024x1024 over OAuth, backend returned 1536x1024.
    expect(pngDimensions(pngHeader(1536, 1024))).toBe("1536x1024")
  })

  test("reads non-standard auto-sized dimensions", () => {
    expect(pngDimensions(pngHeader(1254, 1254))).toBe("1254x1254")
  })

  test("returns undefined for a buffer that is too short", () => {
    expect(pngDimensions(Buffer.alloc(10))).toBeUndefined()
  })

  test("returns undefined when the PNG signature is missing", () => {
    const notPng = pngHeader(1024, 1024)
    notPng.writeUInt32BE(0x00000000, 0)
    expect(pngDimensions(notPng)).toBeUndefined()
  })

  test("returns undefined for zero-sized dimensions", () => {
    expect(pngDimensions(pngHeader(0, 0))).toBeUndefined()
  })
})
