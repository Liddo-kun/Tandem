// UPSTREAM-DIVERGENCE: never put credentials or local paths in image src URLs.
import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials } from "./server"

export async function readBrowserImage(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
  sessionID: string
  uri: string
  signal: AbortSignal
}): Promise<{ blob: Blob; expiresAt: number } | undefined> {
  const match = /^tandem-browser-image:([a-f0-9]{48})$/.exec(input.uri)
  if (!match || !input.sessionID || input.signal.aborted) return
  const url = `${input.server.url.replace(/\/$/, "")}/api/browser-media/${encodeURIComponent(input.sessionID)}/${match[1]}`
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    signal: input.signal,
    cache: "no-store",
    redirect: "error",
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({ username: input.server.username, password: input.server.password })}`,
        }
      : undefined,
  }).catch(() => undefined)
  if (!response?.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png") {
    await response?.body?.cancel().catch(() => {})
    return
  }
  const expiresAt = Date.parse(response.headers.get("expires") ?? "")
  const limit = 8 * 1024 * 1024
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now() ||
    Number(response.headers.get("content-length")) > limit
  ) {
    await response.body?.cancel().catch(() => {})
    return
  }
  const reader = response.body?.getReader()
  if (!reader) return
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  input.signal.addEventListener("abort", abort, { once: true })
  try {
    while (!input.signal.aborted) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) return
      chunks.push(Uint8Array.from(next.value))
    }
    if (!size || input.signal.aborted || expiresAt <= Date.now()) return
    return { blob: new Blob(chunks, { type: "image/png" }), expiresAt }
  } catch {
    return
  } finally {
    input.signal.removeEventListener("abort", abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
