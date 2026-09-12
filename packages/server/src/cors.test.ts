import { afterAll, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { corsMiddleware } from "./cors"

const server = HttpRouter.toWebHandler(
  HttpRouter.add(
    "GET",
    "/private",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      return HttpServerResponse.empty({ status: request.headers.authorization === "Basic fixture" ? 200 : 401 })
    }),
  ).pipe(Layer.provide(corsMiddleware)),
  { disableLogger: true },
)
afterAll(() => server.dispose())

for (const origin of ["http://tauri.localhost", "http://127.0.0.1:4097"]) {
  test(`preflight permits authentication from ${origin}`, async () => {
    const response = await server.handler(
      new Request("http://localhost/private", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
      }),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe(origin)
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization")
    const denied = await server.handler(new Request("http://localhost/private", { headers: { origin } }))
    expect(denied.status).toBe(401)
    expect(denied.headers.get("access-control-allow-origin")).toBe(origin)
    const allowed = await server.handler(
      new Request("http://localhost/private", { headers: { origin, authorization: "Basic fixture" } }),
    )
    expect(allowed.status).toBe(200)
  })
}

test("untrusted origins receive no CORS permission", async () => {
  const response = await server.handler(
    new Request("http://localhost/private", {
      method: "OPTIONS",
      headers: {
        origin: "https://untrusted.example",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    }),
  )
  expect(response.headers.get("access-control-allow-origin")).toBeNull()
})
