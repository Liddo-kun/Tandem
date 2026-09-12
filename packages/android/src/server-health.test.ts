import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test"
import { checkHealth } from "./server-health"

const fetch = spyOn(globalThis, "fetch")
afterEach(() => fetch.mockReset())
afterAll(() => fetch.mockRestore())

describe("Android onboarding health", () => {
  test("authenticates to a V2-only server and validates its health object", async () => {
    fetch.mockResolvedValue(Response.json({ healthy: true, pid: 123 }))
    expect(await checkHealth("http://fixture///", "jon", "secret")).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe("http://fixture/api/health")
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: `Basic ${btoa("jon:secret")}` })
  })

  test.each(["/global/health", "/health"])("retains legacy %s", async (endpoint) => {
    fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    if (endpoint === "/health") fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    fetch.mockResolvedValueOnce(Response.json({ healthy: true, version: "1.2.6" }))
    expect(await checkHealth("http://fixture", undefined, "secret")).toBe(true)
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(
      endpoint === "/health" ? ["/api/health", "/global/health", "/health"] : ["/api/health", "/global/health"],
    )
    for (const [, init] of fetch.mock.calls)
      expect(init?.headers).toEqual({ Authorization: `Basic ${btoa("opencode:secret")}` })
  })

  test.each([401, 403, 500, 503])("HTTP %s is terminal, even if a later endpoint would be public", async (status) => {
    fetch.mockResolvedValueOnce(new Response(null, { status })).mockResolvedValue(Response.json({ healthy: true }))
    expect(await checkHealth("http://fixture", "wrong", "wrong")).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test.each([new TypeError("Network failed"), new DOMException("Timeout", "TimeoutError")])(
    "transport failure is terminal: %s",
    async (error) => {
      fetch.mockRejectedValueOnce(error).mockResolvedValue(Response.json({ healthy: true }))
      expect(await checkHealth("http://fixture")).toBe(false)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  test.each(["<html>Not an API</html>", "{}", "null", '{"healthy":"true"}', '{"healthy":false}'])(
    "does not accept arbitrary HTTP 200: %s",
    async (body) => {
      for (let i = 0; i < 3; i++) fetch.mockResolvedValueOnce(new Response(body))
      expect(await checkHealth("http://fixture")).toBe(false)
    },
  )

  test("legacy SPA fallback is not itself treated as healthy", async () => {
    fetch
      .mockResolvedValueOnce(new Response("<html>SPA</html>"))
      .mockResolvedValueOnce(Response.json({ healthy: true }))
    expect(await checkHealth("http://fixture")).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test("a response-body network failure is terminal", async () => {
    fetch
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("Connection reset"))
            },
          }),
        ),
      )
      .mockResolvedValue(Response.json({ healthy: true }))
    expect(await checkHealth("http://fixture")).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  test("405 can fall back but an explicitly unhealthy API cannot", async () => {
    fetch
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(Response.json({ healthy: false }))
    expect(await checkHealth("http://fixture")).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
