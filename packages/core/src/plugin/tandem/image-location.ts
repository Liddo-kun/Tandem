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

const extensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
}

export const Plugin = define({
  id: "tandem.image-location",
  effect: Effect.fn("ImageLocationPlugin")(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service

    const save = Effect.fn("ImageLocationPlugin.save")(function* (data: string, extension: string) {
      const bytes = Buffer.from(data, "base64")
      const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12)
      const target = path.join(global.tmp, "attachments", `${hash}.${extension}`)
      // The conversation retains the bytes; recreate scratch files if they have been cleared.
      if (!(yield* fs.exists(target))) yield* fs.writeWithDirs(target, bytes, 0o600)
      return target
    })

    const hook = Effect.fn("ImageLocationPlugin.context")(function* (event: SessionRequest) {
      event.messages = yield* Effect.forEach(event.messages, (message) =>
        Effect.gen(function* () {
          if (message.role !== "user") return message
          const content: ContentPart[] = []
          for (const [index, part] of message.content.entries()) {
            content.push(part)
            if (part.type !== "media") continue
            const inline = part.media.inline()
            const extension = inline && extensions[inline.mime]
            if (!inline || !extension) continue
            const target = yield* save(inline.base64, extension).pipe(
              Effect.catch((error) =>
                Effect.logWarning("Unable to save image attachment", error).pipe(Effect.as(undefined)),
              ),
            )
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
