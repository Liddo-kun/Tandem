import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import { Effect, Layer, Option } from "effect"
import { NodeHttpServer, NodeServices } from "@effect/platform-node"
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http"
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi"
import { BrowserMedia } from "@opencode-ai/core/browser-media"
import { BrowserMediaGroup } from "@opencode-ai/protocol/groups/browser-media"
import { Authorization } from "@opencode-ai/protocol/middleware/authorization"
import { BrowserMediaHandler } from "@opencode-ai/server/handlers/browser-media"
import { authorizationLayer } from "@opencode-ai/server/middleware/authorization"
import { ServerAuth } from "@opencode-ai/server/auth"
import { schemaErrorLayer } from "@opencode-ai/server/middleware/schema-error"
import { SchemaErrorMiddleware } from "@opencode-ai/protocol/middleware/schema-error"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const api = HttpApi.make("server").add(BrowserMediaGroup).middleware(Authorization).middleware(SchemaErrorMiddleware)
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
)

describe("browser media HTTP", () => {
  it.live("requires authentication and ownership, returns exact PNG without public path access", () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp("/tmp/tandem/browser-media-http-")),
        (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
      )
      let now = Date.now()
      const media = BrowserMedia.make({ directory, now: () => now, retentionMs: 1000 })
      const capture = yield* Effect.promise(() => media.store("ses_owner", png))
      const id = capture.uri.slice(BrowserMedia.PREFIX.length)
      const context = yield* Layer.build(
        HttpRouter.serve(
          HttpApiBuilder.layer(api).pipe(
            Layer.provide(BrowserMediaHandler),
            Layer.provide(authorizationLayer),
            Layer.provide(schemaErrorLayer),
            Layer.provide(ServerAuth.Config.configLayer({ username: "opencode", password: Option.some("fixture") })),
            Layer.provide(Layer.succeed(BrowserMedia.Service, media)),
          ),
          { disableListenLog: true, disableLogger: true },
        ).pipe(Layer.provideMerge(NodeHttpServer.layerTest), Layer.provideMerge(NodeServices.layer)),
      )
      const request = (sessionID: string, authorized = true, imageID = id) =>
        HttpClientRequest.get(`/api/browser-media/${sessionID}/${imageID}`).pipe(
          HttpClientRequest.setHeaders(
            authorized ? { authorization: `Basic ${Buffer.from("opencode:fixture").toString("base64")}` } : {},
          ),
          HttpClient.execute,
          Effect.provide(context),
        )
      expect((yield* request("ses_owner", false)).status).toBe(401)
      expect((yield* request("ses_foreign")).status).toBe(404)
      const image = yield* request("ses_owner")
      expect(image.status).toBe(200)
      expect(image.headers["content-type"]).toContain("image/png")
      expect(image.headers["cache-control"]).toBe("no-store")
      expect(Date.parse(image.headers.expires!)).toBeLessThanOrEqual(now + 1000)
      expect(Date.parse(image.headers.expires!)).toBeGreaterThan(now)
      expect(Buffer.from(yield* image.arrayBuffer)).toEqual(png)
      expect((yield* request("ses_owner", true, "not-a-path")).status).not.toBe(200)
      now += 1000
      expect((yield* request("ses_owner")).status).toBe(404)
      expect(yield* Effect.promise(() => fs.readdir(directory))).toEqual([])
    }),
  )
})
