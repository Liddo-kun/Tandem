// UPSTREAM-DIVERGENCE: the enclosing API supplies authentication; the store checks session ownership.
import { BrowserMedia } from "@opencode-ai/core/browser-media"
import { BrowserMediaUnavailable } from "@opencode-ai/protocol/groups/browser-media"
import { Effect } from "effect"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"

export const BrowserMediaHandler = HttpApiBuilder.group(Api, "server.browserMedia", (handlers) =>
  Effect.gen(function* () {
    const media = yield* BrowserMedia.Service
    return handlers.handleRaw("browserMedia.read", (ctx) =>
      Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          media.read(ctx.params.sessionID, `${BrowserMedia.PREFIX}${ctx.params.id}`),
        )
        if (!result.ok) return yield* new BrowserMediaUnavailable({ message: "Browser screenshot unavailable" })
        return HttpServerResponse.uint8Array(Buffer.from(result.data.slice(result.data.indexOf(",") + 1), "base64"), {
          contentType: "image/png",
          headers: {
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            expires: new Date(result.expiresAt).toUTCString(),
          },
        })
      }),
    )
  }),
)
