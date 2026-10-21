// Tandem-owned (not in upstream): make user images available to filesystem-based tools.
export * as ImageLocationPlugin from "./image-location.js"

import { Message, type ContentPart } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import type { SessionRequest } from "@opencode/plugin/effect/session"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Mime } from "../../mime.js"

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
}

// Matches the prompt attachment limit; larger files are rejected before they reach the model.
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024

export const Plugin = define({
  id: "tandem.image-location",
  effect: Effect.fn("ImageLocationPlugin")(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const save = Effect.fn("ImageLocationPlugin.save")(function* (bytes: Uint8Array, extension: string) {
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12)
      const target = path.join(global.tmp, "attachments", `${hash}.${extension}`)
      // The conversation retains the bytes; recreate scratch files if they have been cleared.
      if (!(yield* fs.exists(target))) yield* fs.writeWithDirs(target, bytes, 0o600)
      return target
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
      return yield* fs.readFile(target)
    })

    // Saves originals in image order; the request hooks pair them with the normalized images.
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        const locations: string[] = []
        for (const file of event.prompt.files ?? []) {
          const bytes = yield* original(file.uri).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const extension = bytes && extensions[Mime.detect(bytes)]
          if (!bytes || !extension) continue
          locations.push(yield* save(bytes, extension))
        }
        if (locations.length > 0) event.metadata = { ...event.metadata, tandemImageLocations: locations }
      }).pipe(Effect.catch((error) => Effect.logWarning("Unable to save original image attachments", error))),
    )

    const originals = Effect.fn("ImageLocationPlugin.originals")(function* (message: Message) {
      const value = message.metadata?.tandemImageLocations
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return []
      const images = message.content.filter((part) => {
        const inline = part.type === "media" ? part.media.inline() : undefined
        return inline !== undefined && extensions[inline.mime] !== undefined
      })
      // Deduplicated or converted attachments break the pairing; fall back to the normalized images.
      if (images.length !== value.length) return []
      return yield* Effect.forEach(value, (target) =>
        fs.existsSafe(target).pipe(Effect.map((exists) => (exists ? target : undefined))),
      )
    })

    const hook = Effect.fn("ImageLocationPlugin.context")(function* (event: SessionRequest) {
      event.messages = yield* Effect.forEach(event.messages, (message) =>
        Effect.gen(function* () {
          if (message.role !== "user") return message
          const saved = yield* originals(message)
          let image = 0
          const content: ContentPart[] = []
          for (const [index, part] of message.content.entries()) {
            content.push(part)
            if (part.type !== "media") continue
            const inline = part.media.inline()
            const extension = inline && extensions[inline.mime]
            if (!inline || !extension) continue
            const target =
              saved[image++] ??
              (yield* save(Buffer.from(inline.base64, "base64"), extension).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Unable to save image attachment", error).pipe(Effect.as(undefined)),
                ),
              ))
            if (!target) continue
            const text = `Image location: ${target}`
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
