// Tandem-owned (not in upstream): make user images available to filesystem-based tools.
export * as ImageLocationPlugin from "./image-location.js"

import { Message, type ContentPart } from "@opencode/ai/effect"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionRequest } from "@opencode/plugin/effect/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Mime } from "../../mime.js"
import { TandemMessageMetadata } from "./message-metadata.js"

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
}

// Matches the prompt attachment limit; larger files are rejected before they reach the model.
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024

type Saved = { path: string; width?: number; height?: number }

// Stored pixel size from the file header, without decoding the image.
function dimensions(bytes: Buffer): { width: number; height: number } | undefined {
  const mime = Mime.detect(bytes)
  if (mime === "image/png" && bytes.length >= 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (mime === "image/gif" && bytes.length >= 10)
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (mime === "image/webp" && bytes.length >= 30) {
    const chunk = bytes.toString("ascii", 12, 16)
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 }
  }
  if (mime === "image/jpeg") {
    let offset = 2
    while (offset + 9 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!
      // Start-of-frame markers carry the size; DHT, JPG and DAC share the range but do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) }
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
  return undefined
}

export const Plugin = define({
  id: "tandem.image-location",
  effect: Effect.fn("ImageLocationPlugin")(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const save = Effect.fn("ImageLocationPlugin.save")(function* (bytes: Buffer, extension: string) {
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12)
      const target = path.join(global.tmp, "attachments", `${hash}.${extension}`)
      // The conversation retains the bytes; recreate scratch files if they have been cleared.
      // Default (umask) mode, so copies into Android shared storage stay readable by other apps.
      if (!(yield* fs.exists(target))) yield* fs.writeWithDirs(target, bytes)
      return { path: target, ...dimensions(bytes) } satisfies Saved
    })

    // Attachment bytes as sent, before OpenCode resizes and re-encodes images for the model.
    const original = Effect.fn("ImageLocationPlugin.original")(function* (uri: string) {
      if (uri.startsWith("data:")) {
        const comma = uri.indexOf(",")
        if (comma === -1 || !uri.slice(5, comma).split(";").includes("base64")) return undefined
        return Buffer.from(uri.slice(comma + 1), "base64")
      }
      if (!uri.startsWith("file:")) return undefined
      const url = new URL(uri)
      url.search = ""
      url.hash = ""
      const target = fileURLToPath(url)
      const info = yield* fs.stat(target)
      if (info.type !== "File" || Number(info.size) > MAX_ORIGINAL_BYTES) return undefined
      return Buffer.from(yield* fs.readFile(target))
    })

    // Saves originals in image order; the request hooks pair them with the normalized images.
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const locations: Saved[] = []
        for (const file of event.prompt.files ?? []) {
          const bytes = yield* original(file.uri).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const extension = bytes && extensions[Mime.detect(bytes)]
          if (!bytes || !extension) continue
          locations.push(yield* save(bytes, extension))
        }
        if (locations.length > 0) event.metadata = { ...event.metadata, tandemImageLocations: locations }
      }).pipe(Effect.catch((error) => Effect.logWarning("Unable to save original image attachments", error))),
    )

    const isImage = (part: ContentPart) => {
      const inline = part.type === "media" ? part.media.inline() : undefined
      return inline !== undefined && extensions[inline.mime] !== undefined
    }
    const messageMetadata = TandemMessageMetadata.make(ctx)

    const originals = Effect.fn("ImageLocationPlugin.originals")(function* (message: Message, metadata: Record<string, unknown> | undefined) {
      const value = metadata?.tandemImageLocations
      if (!Array.isArray(value) || !value.every((item) => typeof (item as Partial<Saved> | null)?.path === "string")) return []
      const images = message.content.filter(isImage)
      // Deduplicated or converted attachments break the pairing; fall back to the normalized images.
      if (images.length !== value.length) return []
      return yield* Effect.forEach(value as Saved[], (saved) =>
        fs.existsSafe(saved.path).pipe(Effect.map((exists) => (exists ? saved : undefined))),
      )
    })

    const hook = Effect.fn("ImageLocationPlugin.context")(function* (event: SessionRequest) {
      const metadata = yield* messageMetadata(
        event.sessionID,
        event.messages,
        (message) => message.role === "user" && message.content.some(isImage),
      )
      event.messages = yield* Effect.forEach(event.messages, (message) =>
        Effect.gen(function* () {
          if (message.role !== "user") return message
          const saved = yield* originals(message, metadata(message))
          let image = 0
          const content: ContentPart[] = []
          for (const [index, part] of message.content.entries()) {
            content.push(part)
            if (part.type !== "media") continue
            const inline = part.media.inline()
            const extension = inline && extensions[inline.mime]
            if (!inline || !extension) continue
            const file =
              saved[image++] ??
              (yield* save(Buffer.from(inline.base64, "base64"), extension).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Unable to save image attachment", error).pipe(Effect.as(undefined)),
                ),
              ))
            if (!file) continue
            const size = file.width && file.height ? ` (${file.width}x${file.height})` : ""
            const text = `Copy of original image${size}: ${file.path}`
            const next = message.content[index + 1]
            if (next?.type !== "text" || next.text !== text) content.push(Message.text(text))
          }
          return { ...message, content }
        }),
      )
    })

    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
