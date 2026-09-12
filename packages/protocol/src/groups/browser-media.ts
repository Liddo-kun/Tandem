// UPSTREAM-DIVERGENCE: authenticated opaque browser capture retrieval, shared by legacy and V2 clients.
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/unstable/httpapi"

export class BrowserMediaUnavailable extends Schema.TaggedErrorClass<BrowserMediaUnavailable>()(
  "BrowserMediaUnavailable",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export const BrowserMediaGroup = HttpApiGroup.make("server.browserMedia").add(
  HttpApiEndpoint.get("browserMedia.read", "/api/browser-media/:sessionID/:id", {
    params: {
      sessionID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
      id: Schema.String.check(Schema.isPattern(/^[a-f0-9]{48}$/)),
    },
    success: Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array({ contentType: "image/png" })),
    error: BrowserMediaUnavailable,
  }),
)
