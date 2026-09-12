import { describe, expect, test } from "bun:test"
import { detectServerProtocol } from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect })

describe("detectServerProtocol", () => {
  test("prefers the legacy health endpoint when both API generations exist", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the transitional V1 API health response", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("recognizes current V2 without a process identifier using its session envelope", async () => {
    const fetcher = mockFetch((input) => {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.pathname === "/global/health") return Promise.resolve(json({}, 404))
      if (url.pathname === "/api/session") {
        expect(url.searchParams.get("limit")).toBe("1")
        return Promise.resolve(json({ data: [], cursor: {} }))
      }
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test.each([401, 403, 429, 500, 503])("does not downgrade V2 after a session probe HTTP %s", async (status) => {
    const fetcher = mockFetch(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return json({}, 404)
      if (path === "/api/session") return json({}, status)
      return json({ healthy: true })
    })
    await expect(detectServerProtocol(server, fetcher)).rejects.toThrow(`HTTP ${status}`)
  })

  test("does not downgrade V2 after a session probe network failure", async () => {
    const fetcher = mockFetch(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return json({}, 404)
      if (path === "/api/session") throw new TypeError("Network unavailable")
      return json({ healthy: true })
    })
    await expect(detectServerProtocol(server, fetcher)).rejects.toThrow("Network unavailable")
  })

  test.each([404, 405])("preserves transitional legacy detection for an absent session probe (%s)", async (status) => {
    const fetcher = mockFetch(async (input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return json({}, 404)
      if (path === "/api/session") return json({}, status)
      return json({ healthy: true })
    })
    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })
})
