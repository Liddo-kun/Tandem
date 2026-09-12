import { describe, expect, test } from "bun:test"
import { crc32, deflateSync } from "node:zlib"
import { decodePNG, PageError } from "../src/page"

function png(width: number, height: number, scanlines = Buffer.alloc((width * 4 + 1) * height)) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  function chunk(type: string, data: Buffer) {
    const result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length)
    result.write(type, 4)
    data.copy(result, 8)
    result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4)
    return result
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]).toString("base64")
}

describe("capture PNG integrity (no browser)", () => {
  test("returns measured dimensions and original compressed bytes", () => {
    const data = png(160, 120)
    expect(decodePNG(data)).toEqual({ bytes: Buffer.from(data, "base64"), width: 160, height: 120 })
  })

  test("rejects malformed, truncated, corrupt and oversized data", () => {
    const oversized = Buffer.from(png(1, 1), "base64")
    oversized.writeUInt32BE(100000, 16)
    oversized.writeUInt32BE(100000, 20)
    const corrupt = Buffer.from(png(1, 1), "base64")
    corrupt[corrupt.length - 1]! ^= 1
    for (const data of [
      "not base64",
      Buffer.from("not PNG").toString("base64"),
      png(1, 1).slice(0, -8),
      oversized.toString("base64"),
      corrupt.toString("base64"),
      png(1, 1, Buffer.alloc(10000)),
      png(1, 1, Buffer.alloc(4)),
      png(1, 1, Buffer.from([5, 0, 0, 0, 0])),
    ])
      expect(() => decodePNG(data)).toThrow(PageError)
    expect(() => decodePNG("A".repeat(Math.ceil((8 * 1024 * 1024) / 3) * 4 + 4))).toThrow(
      "Screenshot exceeds encoded byte limit",
    )
  })
})
