import { describe, expect, test } from "bun:test"
import { readBrowserImage } from "./browser-media"

describe("browser capture fetch", () => {
  test("uses authenticated platform fetch, disables caching and redirects, rejects arbitrary paths", async () => {
    const requests: Request[] = []
    const options: (RequestInit | undefined)[] = []
    const fetcher = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(request)
        options.push(init)
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "content-type": "image/png", expires: new Date(Date.now() + 60_000).toUTCString() },
        })
      },
      { preconnect: globalThis.fetch.preconnect },
    )
    const base = {
      server: { url: "http://localhost:4096", password: "secret" },
      fetch: fetcher,
      sessionID: "ses_owner",
      signal: new AbortController().signal,
    }
    const image = await readBrowserImage({ ...base, uri: `tandem-browser-image:${"a".repeat(48)}` })
    expect(image?.blob.type).toBe("image/png")
    expect(image?.expiresAt).toBeGreaterThan(Date.now())
    expect(requests[0]?.headers.get("authorization")).toBe(`Basic ${btoa("opencode:secret")}`)
    expect(requests[0]?.url).toBe(`http://localhost:4096/api/browser-media/ses_owner/${"a".repeat(48)}`)
    expect(options[0]?.cache).toBe("no-store")
    expect(options[0]?.redirect).toBe("error")
    expect(await readBrowserImage({ ...base, uri: "file:///etc/passwd" })).toBeUndefined()
    expect(await readBrowserImage({ ...base, uri: "tandem-browser-image:../../secret" })).toBeUndefined()
    expect(requests.length).toBe(1)
  })

  test("missing, unauthorized, and non-image responses produce no image src", async () => {
    for (const response of [
      new Response(null, { status: 404 }),
      new Response(null, { status: 401 }),
      Response.json({ error: "missing" }),
    ]) {
      const fetcher = Object.assign(async () => response, { preconnect: globalThis.fetch.preconnect })
      const result = await readBrowserImage({
        server: { url: "http://localhost" },
        fetch: fetcher,
        sessionID: "ses_owner",
        uri: `tandem-browser-image:${"b".repeat(48)}`,
        signal: new AbortController().signal,
      })
      expect(result).toBeUndefined()
    }
  })

  test("rejects expired/missing expiry and cancels an oversized streamed response before allocating a blob", async () => {
    let cancelled = false
    let chunks = 0
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          chunks++
          controller.enqueue(new Uint8Array(1024 * 1024))
        },
        cancel() {
          cancelled = true
        },
      }),
      { headers: { "content-type": "image/png", expires: new Date(Date.now() + 60_000).toUTCString() } },
    )
    const base = {
      server: { url: "http://localhost" },
      sessionID: "ses_owner",
      uri: `tandem-browser-image:${"a".repeat(48)}`,
      signal: new AbortController().signal,
    }
    expect(
      await readBrowserImage({
        ...base,
        fetch: Object.assign(async () => response, { preconnect: globalThis.fetch.preconnect }),
      }),
    ).toBeUndefined()
    expect(cancelled).toBe(true)
    expect(chunks).toBeLessThanOrEqual(10)
    for (const expires of [undefined, new Date(0).toUTCString()]) {
      const response = new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png", ...(expires ? { expires } : {}) },
      })
      expect(
        await readBrowserImage({
          ...base,
          fetch: Object.assign(async () => response, { preconnect: globalThis.fetch.preconnect }),
        }),
      ).toBeUndefined()
    }
  })
})
