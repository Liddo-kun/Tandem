import { describe, expect, test } from "bun:test"
import { Chroma } from "../../src/plugin/openai/imagegen/chroma"
import { loadPhoton } from "../../src/plugin/openai/imagegen/photon"
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

// Build a PNG with a solid #00ff00 chroma-key background and an opaque red square in the middle,
// using the same Photon codec the chroma remover uses (so the test never re-implements encoding).
async function chromaFixture(width: number, height: number): Promise<Buffer> {
  const photon = await loadPhoton()
  const data = new Uint8Array(width * height * 4)
  const inset = Math.floor(Math.min(width, height) / 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const subject = x >= inset && x < width - inset && y >= inset && y < height - inset
      data[o] = subject ? 255 : 0 // R
      data[o + 1] = subject ? 0 : 255 // G (key channel)
      data[o + 2] = 0 // B
      data[o + 3] = 255 // opaque
    }
  }
  const image = new photon.PhotonImage(data, width, height)
  try {
    return Buffer.from(image.get_bytes())
  } finally {
    image.free()
  }
}

// Like chromaFixture but paints a 2px near-white "sticker outline" rim between the key color and the
// red subject, reproducing the light halo the image models add around cutout subjects.
async function chromaFixtureWithRim(size: number): Promise<Buffer> {
  const photon = await loadPhoton()
  const data = new Uint8Array(size * size * 4)
  const inset = Math.floor(size / 4)
  const rim = 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      const inSubject = x >= inset && x < size - inset && y >= inset && y < size - inset
      const inCore = x >= inset + rim && x < size - inset - rim && y >= inset + rim && y < size - inset - rim
      const [r, g, b] = inCore ? [255, 0, 0] : inSubject ? [250, 250, 250] : [0, 255, 0]
      data[o] = r
      data[o + 1] = g
      data[o + 2] = b
      data[o + 3] = 255
    }
  }
  const image = new photon.PhotonImage(data, size, size)
  try {
    return Buffer.from(image.get_bytes())
  } finally {
    image.free()
  }
}

async function decode(png: Buffer): Promise<{ width: number; height: number; data: Uint8Array }> {
  const photon = await loadPhoton()
  const image = photon.PhotonImage.new_from_byteslice(png)
  try {
    return { width: image.get_width(), height: image.get_height(), data: image.get_raw_pixels() }
  } finally {
    image.free()
  }
}

describe("plugin.imagegen chroma-key removal", () => {
  test("keys out the flat background and keeps the subject opaque", async () => {
    const png = await chromaFixture(32, 32)
    const out = await Chroma.removeChromaKey(png)
    // Still a valid PNG.
    expect(out[0]).toBe(0x89)
    expect(pngDimensions(out)).toBe("32x32")

    const { width, data } = await decode(out)
    const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3]
    // Corners (background) become fully transparent.
    expect(alphaAt(0, 0)).toBe(0)
    expect(alphaAt(31, 0)).toBe(0)
    expect(alphaAt(0, 31)).toBe(0)
    expect(alphaAt(31, 31)).toBe(0)
    // Center (subject) stays fully opaque and red.
    const c = (16 * width + 16) * 4
    expect(data[c + 3]).toBe(255)
    expect(data[c]).toBeGreaterThan(200) // R preserved
    expect(data[c + 1]).toBeLessThan(60) // G stays low (no green fringe)
  })

  test("defringe erodes the bright sticker-outline rim but keeps the colored subject", async () => {
    const png = await chromaFixtureWithRim(40)
    const { width, data } = await decode(await Chroma.removeChromaKey(png))
    const alphaAt = (x: number, y: number) => data[(y * width + x) * 4 + 3]
    // The white rim sat just inside the key border (inset 10, rim 2) — it must not survive opaque.
    expect(alphaAt(11, 20)).toBe(0)
    // The saturated red core (well inside) stays fully opaque and red.
    const c = (20 * width + 20) * 4
    expect(data[c + 3]).toBe(255)
    expect(data[c]).toBeGreaterThan(200)
  })

  test("defringe can be disabled", async () => {
    const png = await chromaFixtureWithRim(40)
    const { width, data } = await decode(await Chroma.removeChromaKey(png, { defringe: false }))
    // With defringe off, the opaque white rim survives (this is the halo we strip by default).
    expect(data[(20 * width + 11) * 4 + 3]).toBe(255)
  })

  test("an explicit key color removes that color", async () => {
    const png = await chromaFixture(24, 24)
    const out = await Chroma.removeChromaKey(png, { keyColor: [0, 255, 0] })
    const { width, data } = await decode(out)
    expect(data[3]).toBe(0) // top-left background transparent
    expect(data[(12 * width + 12) * 4 + 3]).toBe(255) // center opaque
  })
})
