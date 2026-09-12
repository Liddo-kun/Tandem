import { crc32, inflateSync } from "node:zlib"

export class PageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "PageError"
  }
}

export type Viewport = {
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale: number
  deviceScale: number
  browserZoom: number
  scrollX: number
  scrollY: number
  transform: string
}
export type PageFrame = {
  id: string
  documentId: string
  parentId?: string
  url: string
  origin: string
  supported: boolean
}
export type PageMetadata = {
  url: string
  origin: string
  documentId: string
  revision: number
  frameId: string
  topFrameId: string
  frames: PageFrame[]
  viewport: Viewport
  viewToken: string
}
export type PageElement = {
  ref: string
  nodeId?: string
  tag: string
  role: string
  label: string
  type: string
  disabled: boolean
  checked: boolean
  bounds?: { x: number; y: number; width: number; height: number }
}
export type PageInspection = PageMetadata & { title: string; text: string; elements: PageElement[]; truncated: boolean }
export type PageScreenshot = {
  bytes: Uint8Array
  mime: "image/png"
  width: number
  height: number
  viewport: Viewport
  viewToken: string
  viewValid: boolean
  mapping: { scaleX: number; scaleY: number; offsetX: number; offsetY: number }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_DECODED_BYTES = 64 * 1024 * 1024

export function decodePNG(data: string) {
  if (typeof data !== "string" || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
    throw new PageError("result_too_large", "Screenshot exceeds encoded byte limit")
  if (data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new PageError("protocol_error", "Invalid screenshot encoding")
  const bytes = Buffer.from(data, "base64")
  if (bytes.toString("base64") !== data) throw new PageError("protocol_error", "Noncanonical screenshot encoding")
  if (bytes.length > MAX_IMAGE_BYTES) throw new PageError("result_too_large", "Screenshot exceeds encoded byte limit")
  if (
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(8) !== 13
  )
    throw new PageError("protocol_error", "Screenshot is not a PNG")
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20)
  if (!width || !height || width * height * 4 > MAX_DECODED_BYTES)
    throw new PageError("result_too_large", "PNG dimensions exceed decoded byte limit")
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[bytes[25]!]
  if (bytes[24] !== 8 || !channels || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0)
    throw new PageError("unsupported", "Unsupported PNG encoding")
  const chunks: Buffer[] = []
  let ended = false
  let count = 0
  for (let offset = 8; offset < bytes.length; ) {
    if (++count > 4096) throw new PageError("result_too_large", "Too many PNG chunks")
    if (offset + 12 > bytes.length) throw new PageError("protocol_error", "Truncated PNG")
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8)
    if (offset + length + 12 > bytes.length) throw new PageError("protocol_error", "Truncated PNG chunk")
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length))
      throw new PageError("protocol_error", "Invalid PNG checksum")
    if (type === "IDAT") chunks.push(bytes.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
    if (type === "IEND") {
      ended = length === 0 && offset === bytes.length
      break
    }
  }
  if (!ended || !chunks.length) throw new PageError("protocol_error", "Incomplete PNG")
  const size = (width * channels + 1) * height
  if (size > MAX_DECODED_BYTES) throw new PageError("result_too_large", "PNG scanlines exceed decoded byte limit")
  try {
    const decoded = inflateSync(Buffer.concat(chunks), { maxOutputLength: size })
    if (decoded.length !== size) throw new Error("size")
    for (let y = 0; y < height; y++) if (decoded[y * (width * channels + 1)]! > 4) throw new Error("filter")
  } catch {
    throw new PageError("protocol_error", "Invalid PNG image data")
  }
  return { bytes, width, height }
}
