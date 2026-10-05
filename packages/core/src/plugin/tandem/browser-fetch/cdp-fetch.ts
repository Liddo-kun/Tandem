import { Schema } from "effect"
import { mkdir, readdir, stat, unlink, readlink, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { setTimeout } from "node:timers/promises"

// Owned tabs only: never change the default browser context, profile, cookies or download preferences.
const Empty = Schema.Struct({})
const Version = Schema.Struct({ webSocketDebuggerUrl: Schema.String })
const Envelope = Schema.Struct({
  id: Schema.optionalKey(Schema.Number),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
})
const ResponseInfo = Schema.Struct({
  url: Schema.String,
  status: Schema.Number,
  mimeType: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
})
type ResponseInfo = typeof ResponseInfo.Type
const Pending = /just a moment|checking your browser|verify you are human|enable javascript and cookies|you are being redirected|redirecting (?:you|to|in)/i
const Blocked = /unusual traffic from your computer network|\/sorry\/index|too many requests|rate limit(?:ed)?/i
const MAX_DOCUMENT = 50 * 1024 * 1024
const MAX_TEXT = 2 * 1024 * 1024
const MAX_SHOT = 12 * 1024 * 1024

export type ArtifactBudget = { bytes: number; limit: number }
export async function save(file: string, bytes: Uint8Array, budget: ArtifactBudget) {
  if (budget.bytes + bytes.byteLength > budget.limit) throw new FetchError("Webfetch call exceeds its 128 MiB saved-artifact budget")
  budget.bytes += bytes.byteLength
  await Bun.write(file, bytes)
}

export class FetchError extends Error {
  constructor(message: string, readonly code: "timeout" | "unavailable" | "blocked" | "failed" = "failed", readonly site?: string) {
    super(message)
  }
}

export interface Page {
  title: string
  url: string
  text: string
  status?: number
  pageState: "ready" | "ready-after-wait" | "never-ready" | "blocked"
  via: string
  file?: string
  mime?: string
  screenshots: string[]
  screenshotCut?: number
  textCut?: boolean
}

// Process-wide serialization also covers bootstrap and cleanup. A cancelled queue entry never opens a tab.
let queue = Promise.resolve()
async function serialized<A>(signal: AbortSignal, work: () => Promise<A>): Promise<A> {
  const previous = queue
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  queue = previous.then(() => gate)
  let abort = () => {}
  try {
    await Promise.race([previous, new Promise<never>((_, reject) => {
      abort = () => reject(new FetchError("Browser queue cancelled"))
      signal.addEventListener("abort", abort, { once: true })
      if (signal.aborted) abort()
    })])
    signal.throwIfAborted()
    return await work()
  } finally {
    signal.removeEventListener("abort", abort)
    release()
  }
}

async function run(command: string[], signal: AbortSignal, limit = 15000) {
  signal.throwIfAborted()
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "ignore" })
  const abort = () => process.kill()
  signal.addEventListener("abort", abort, { once: true })
  const timer = globalThis.setTimeout(abort, limit)
  try {
    // Only small bootstrap output; document extraction uses a backing file below.
    const output = await new Response(process.stdout).text()
    await process.exited
    signal.throwIfAborted()
    if (process.exitCode !== 0) throw new FetchError(`Prerequisite failed: ${command[0]}`, "unavailable")
    return output.trim()
  } finally {
    globalThis.clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}

async function version(endpoint: string, signal: AbortSignal) {
  return fetch(`http://${endpoint}/json/version`, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) })
    .then(async (response) => response.ok ? Schema.decodeUnknownSync(Version)(await response.json()) : undefined)
    .catch(() => undefined)
}

async function bootstrap(android: boolean, signal: AbortSignal) {
  const override = android ? process.env.TANDEM_BROWSER_FETCH_ANDROID_ENDPOINT : process.env.TANDEM_BROWSER_FETCH_ENDPOINT
  const endpoint = override ?? (android ? "127.0.0.1:9222" : "127.0.0.1:9223")
  const existing = await version(endpoint, signal)
  if (existing) return { endpoint, version: existing }
  signal.throwIfAborted()
  if (override) throw new FetchError(`No browser CDP endpoint at ${endpoint}`, "unavailable")
  if (android) {
    const target = (await run(["bash", "-lc", "adb-reconnect"], signal, 20000)).split("\n").at(-1)
    if (!target) throw new FetchError("adb-reconnect did not find Android Chrome", "unavailable")
    await run(["adb", "-s", target, "forward", "tcp:9222", "localabstract:chrome_devtools_remote"], signal)
    await run(["adb", "-s", target, "shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main"], signal)
  } else {
    if (process.platform !== "linux") throw new FetchError("Start regular Chrome with CDP and set TANDEM_BROWSER_FETCH_ENDPOINT=host:port", "unavailable")
    await stat("/tmp/.X11-unix/X0").catch(() => { throw new FetchError("X display :0 is unavailable; start the desktop or set TANDEM_BROWSER_FETCH_ENDPOINT", "unavailable") })
    const lock = await readlink(path.join(homedir(), ".config/chromium/SingletonLock")).catch(() => "")
    const pid = Number(lock.split("-").at(-1))
    const owner = pid && (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).includes("chromium")
    if (!owner) {
      const launcher = process.env.TANDEM_BROWSER_FETCH_LAUNCHER ?? path.join(homedir(), ".local/bin/chromium-x")
      await stat(launcher).catch(() => { throw new FetchError(`Browser launcher unavailable: ${launcher}`, "unavailable") })
      Bun.spawn([launcher], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref()
    }
  }
  for (let i = 0; i < 40; i++) {
    await setTimeout(500, undefined, { signal })
    const ready = await version(endpoint, signal)
    if (ready) return { endpoint, version: ready }
  }
  throw new FetchError(`Regular ${android ? "Android Chrome" : "Chromium"} CDP at ${endpoint} is unavailable; an existing non-CDP profile owner must be closed manually`, "unavailable")
}

class Cdp {
  private id = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  event: (method: string, params: unknown) => void = () => {}
  private constructor(private socket: WebSocket) {}

  static async connect(url: string, signal: AbortSignal) {
    const socket = new WebSocket(url)
    const client = new Cdp(socket)
    await new Promise<void>((resolve, reject) => {
      const abort = () => { finish(); socket.close(); reject(new FetchError("Browser connection cancelled")) }
      const timer = globalThis.setTimeout(abort, 5000)
      signal.addEventListener("abort", abort, { once: true })
      const finish = () => { globalThis.clearTimeout(timer); signal.removeEventListener("abort", abort) }
      socket.onopen = () => { finish(); resolve() }
      socket.onerror = () => { finish(); reject(new FetchError("Browser websocket connection failed")) }
      if (signal.aborted) { finish(); abort() }
    })
    socket.onmessage = (event) => {
      try {
        const message = Schema.decodeUnknownSync(Schema.fromJsonString(Envelope))(String(event.data))
        if (message.id !== undefined) {
          const pending = client.pending.get(message.id)
          client.pending.delete(message.id)
          if (message.error) pending?.reject(new FetchError(message.error.message))
          else pending?.resolve(message.result)
        } else if (message.method) client.event(message.method, message.params)
      } catch (error) {
        client.fail(error instanceof Error ? error : new FetchError("Invalid CDP response"))
      }
    }
    socket.onclose = () => client.fail(new FetchError("Browser websocket closed"))
    return client
  }

  private fail(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }

  async send<A>(method: string, schema: Schema.Codec<A>, params: Record<string, unknown> = {}, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const id = ++this.id
    const result = await new Promise<unknown>((resolve, reject) => {
      const abort = () => { finish(); this.pending.delete(id); reject(new FetchError(`${method} cancelled`)) }
      const timer = globalThis.setTimeout(() => { finish(); this.pending.delete(id); reject(new FetchError(`${method} timed out`, "timeout")) }, 15000)
      const finish = () => { globalThis.clearTimeout(timer); signal?.removeEventListener("abort", abort) }
      this.pending.set(id, { resolve: (value) => { finish(); resolve(value) }, reject: (error) => { finish(); reject(error) } })
      signal?.addEventListener("abort", abort, { once: true })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
    return Schema.decodeUnknownSync(schema)(result)
  }

  async evaluate<A>(expression: string, schema: Schema.Codec<A>, signal: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      try {
        const value = await this.send("Runtime.evaluate", Schema.Struct({ result: Schema.Struct({ value: Schema.optionalKey(Schema.Unknown) }), exceptionDetails: Schema.optionalKey(Schema.Unknown) }), { expression, returnByValue: true }, signal)
        if (value.exceptionDetails) throw new FetchError("Page evaluation failed")
        return Schema.decodeUnknownSync(schema)(value.result.value)
      } catch (error) {
        signal.throwIfAborted()
        if (attempt >= 2) throw error
        await setTimeout(500, undefined, { signal })
      }
    }
  }

  close() { this.fail(new FetchError("CDP disposed")); this.socket.close() }
}

async function download(cdp: Cdp, response: ResponseInfo, base: string, signal: AbortSignal, artifacts: ArtifactBudget) {
  // Recompute cookies on each redirect; never forward one origin's Cookie header to another.
  let url = response.url
  for (let redirects = 0; redirects <= 5; redirects++) {
    const parsed = new URL(url)
    if (!["http:", "https:"].includes(parsed.protocol)) throw new FetchError("Unsupported document redirect")
    const cookies = await cdp.send("Network.getCookies", Schema.Struct({ cookies: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })) }), { urls: [url] }, signal)
    const ua = await cdp.evaluate("navigator.userAgent", Schema.String, signal)
    const result = await fetch(url, { headers: { cookie: cookies.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "), "user-agent": ua }, redirect: "manual", signal })
    const location = result.headers.get("location")
    if (result.status >= 300 && result.status < 400 && location) {
      await result.body?.cancel()
      url = new URL(location, url).href
      continue
    }
    if (!result.ok) { await result.body?.cancel(); throw new FetchError(`Document download HTTP ${result.status}`) }
    if (Number(result.headers.get("content-length")) > MAX_DOCUMENT) { await result.body?.cancel(); throw new FetchError("Document exceeds 50 MiB download budget") }
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = result.body?.getReader()
    if (!reader) throw new FetchError("Document response has no body")
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > MAX_DOCUMENT) throw new FetchError("Document exceeds 50 MiB download budget")
        chunks.push(part.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    const name = decodeURIComponent(new URL(url).pathname.split("/").at(-1) || "document").replace(/[^\w.-]/g, "_").slice(-80)
    const pdf = /pdf/i.test(response.mimeType) || /\.pdf$/i.test(name)
    const file = `${base}-${name}${pdf && !/\.pdf$/i.test(name) ? ".pdf" : ""}`
    signal.throwIfAborted()
    await save(file, Buffer.concat(chunks), artifacts)
    if (!pdf) return { file, text: `Binary document (${size} bytes), saved to ${file}`, url }
    if (!Bun.which("pdftotext")) return { file, text: `PDF saved to ${file}; pdftotext is unavailable. Install poppler-utils to extract its text.`, url }
    const process = Bun.spawn(["pdftotext", "-layout", file, "-"], { stdout: "pipe", stderr: "ignore" })
    const abort = () => process.kill()
    signal.addEventListener("abort", abort, { once: true })
    const timer = globalThis.setTimeout(abort, 15000)
    const textChunks: Uint8Array[] = []
    let textBytes = 0
    let textCut = false
    try {
      for await (const chunk of process.stdout) {
        const remaining = MAX_TEXT - textBytes
        textChunks.push(chunk.subarray(0, remaining))
        textBytes += Math.min(remaining, chunk.byteLength)
        if (chunk.byteLength > remaining) { textCut = true; process.kill(); break }
      }
      await process.exited
      signal.throwIfAborted()
      if (process.exitCode !== 0 && !textCut) throw new FetchError(`PDF saved to ${file}, but pdftotext failed or exceeded 15 seconds`)
    } finally {
      globalThis.clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      process.kill()
    }
    const text = new TextDecoder().decode(Buffer.concat(textChunks), { stream: textCut })
    return { file, text: text.trim() || "PDF has no extractable text layer; read the saved PDF explicitly.", textCut, url }
  }
  throw new FetchError("Document redirect budget exceeded")
}

async function attempt(input: { url: string; html: boolean; timeout: number; base: string; android: boolean; signal: AbortSignal; artifacts: ArtifactBudget }): Promise<Page> {
  const deadline = AbortSignal.timeout(input.timeout * 1000)
  const signal = AbortSignal.any([input.signal, deadline])
  let browser: Cdp | undefined
  let cdp: Cdp | undefined
  let target: string | undefined
  try {
    const ready = await bootstrap(input.android, signal)
    browser = await Cdp.connect(ready.version.webSocketDebuggerUrl, signal)
    // Acquisition is intentionally not aborted mid-command: receive the ID then close it on cancellation.
    target = (await browser.send("Target.createTarget", Schema.Struct({ targetId: Schema.String }), { url: "about:blank" })).targetId
    signal.throwIfAborted()
    cdp = await Cdp.connect(`ws://${ready.endpoint}/devtools/page/${target}`, signal)
    const page = cdp
    let mainFrame = ""
    let loading = true
    let lastLoad = Date.now()
    let scheduled = 0
    let response: ResponseInfo | undefined
    let document: ResponseInfo | undefined
    let interceptionError: Error | undefined
    const interceptions = new Set<Promise<void>>()
    page.event = (method, raw) => {
      if (method === "Fetch.requestPaused") {
        const paused = Schema.decodeUnknownSync(Schema.Struct({ requestId: Schema.String, frameId: Schema.String, request: Schema.Struct({ url: Schema.String }), responseStatusCode: Schema.optionalKey(Schema.Number), responseHeaders: Schema.optionalKey(Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String }))) }))(raw)
        const headers = Object.fromEntries((paused.responseHeaders ?? []).map((header) => [header.name.toLowerCase(), header.value]))
        const mime = headers["content-type"] ?? ""
        const binary = /pdf|octet-stream|zip|officedocument|msword/i.test(mime) || /attachment/i.test(headers["content-disposition"] ?? "")
        if (binary && paused.frameId === mainFrame) document = { url: paused.request.url, status: paused.responseStatusCode ?? 200, mimeType: mime, headers }
        // Replace only this owned tab's download response with an inert notice. No browser-wide download policy.
        const work = (binary
          ? page.send("Fetch.fulfillRequest", Empty, { requestId: paused.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html" }], body: Buffer.from("<title>Document download</title><p>Document captured for extraction.</p>").toString("base64") }, signal)
          : page.send("Fetch.continueRequest", Empty, { requestId: paused.requestId }, signal))
          .then(() => {}).catch((error) => { interceptionError = error instanceof Error ? error : new FetchError("Response interception failed") })
        interceptions.add(work)
        void work.finally(() => interceptions.delete(work))
        return
      }
      if (method === "Network.responseReceived") {
        const event = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String, frameId: Schema.optionalKey(Schema.String), response: ResponseInfo }))(raw)
        if (event.type === "Document" && (!mainFrame || event.frameId === mainFrame)) response = event.response
        return
      }
      if (method === "Page.loadEventFired") { loading = false; lastLoad = Date.now(); return }
      if (!["Page.frameStartedLoading", "Page.frameStoppedLoading", "Page.frameScheduledNavigation", "Page.frameClearedScheduledNavigation"].includes(method)) return
      const event = Schema.decodeUnknownSync(Schema.Struct({ frameId: Schema.String, delay: Schema.optionalKey(Schema.Number) }))(raw)
      if (mainFrame && event.frameId !== mainFrame) return
      if (method === "Page.frameStartedLoading") { loading = true; scheduled = 0 }
      if (method === "Page.frameStoppedLoading") { loading = false; lastLoad = Date.now() }
      if (method === "Page.frameScheduledNavigation" && (event.delay ?? 0) <= 15) scheduled = Date.now() + (event.delay ?? 0) * 1000
      if (method === "Page.frameClearedScheduledNavigation") scheduled = 0
    }
    await page.send("Page.enable", Empty, {}, signal)
    await page.send("Runtime.enable", Empty, {}, signal)
    await page.send("Network.enable", Empty, {}, signal)
    mainFrame = (await page.send("Page.getFrameTree", Schema.Struct({ frameTree: Schema.Struct({ frame: Schema.Struct({ id: Schema.String }) }) }), {}, signal)).frameTree.frame.id
    await page.send("Fetch.enable", Empty, { patterns: [{ resourceType: "Document", requestStage: "Response" }] }, signal)
    const nav = await page.send("Page.navigate", Schema.Struct({ frameId: Schema.String, errorText: Schema.optionalKey(Schema.String) }), { url: input.url }, signal)
    mainFrame = nav.frameId
    if (nav.errorText) throw new FetchError(`Navigation failed: ${nav.errorText}`)
    const loadUntil = Date.now() + input.timeout * 600
    while (Date.now() < loadUntil && (loading || Date.now() - lastLoad < 1500 || (scheduled && Date.now() < scheduled + 2000))) {
      if (interceptionError) throw interceptionError
      await setTimeout(200, undefined, { signal })
    }
    await Promise.all(interceptions)
    if (interceptionError) throw interceptionError
    const Probe = Schema.Struct({ title: Schema.String, url: Schema.String, text: Schema.String })
    let state: Page["pageState"] = "ready"
    for (let i = 0; i < 30; i++) {
      const probe = await page.evaluate('({ title: document.title, url: location.href, text: (document.body?.innerText ?? "").slice(0,2000) })', Probe, signal)
      if (response?.status === 429 || Blocked.test(`${probe.title}\n${probe.url}\n${probe.text}`)) { state = "blocked"; break }
      if (!Pending.test(`${probe.title}\n${probe.text}`)) { if (state === "never-ready") state = "ready-after-wait"; break }
      state = "never-ready"
      await setTimeout(1000, undefined, { signal })
    }
    const extracted = await page.evaluate(`({title:document.title,url:location.href,text:(${input.html ? "document.documentElement.outerHTML" : '(document.body?.innerText ?? "")'}).slice(0,${MAX_TEXT}),textCut:(${input.html ? "document.documentElement.outerHTML" : '(document.body?.innerText ?? "")'}).length>${MAX_TEXT}})`, Schema.Struct({ ...Probe.fields, textCut: Schema.Boolean }), signal)
    const metrics = await page.send("Page.getLayoutMetrics", Schema.Struct({ cssContentSize: Schema.Struct({ width: Schema.Number, height: Schema.Number }), cssLayoutViewport: Schema.Struct({ clientWidth: Schema.Number }) }), {}, signal)
    const height = Math.max(1, Math.ceil(metrics.cssContentSize.height))
    const width = Math.max(1, Math.min(2560, Math.ceil(metrics.cssLayoutViewport.clientWidth)))
    const count = Math.min(4, Math.ceil(height / 1600))
    const dpr = Math.max(1, await page.evaluate("window.devicePixelRatio", Schema.Number, signal))
    const screenshots: string[] = []
    for (let i = 0; i < count; i++) {
      const shot = await page.send("Page.captureScreenshot", Schema.Struct({ data: Schema.String }), { format: "png", captureBeyondViewport: true, clip: { x: 0, y: i * 1600, width, height: Math.min(1600, height - i * 1600), scale: 1 / dpr } }, signal)
      if (shot.data.length > MAX_SHOT * 4 / 3 + 4) throw new FetchError("Screenshot exceeds 12 MiB slice budget")
      const file = `${input.base}-${i + 1}.png`
      signal.throwIfAborted()
      await save(file, Buffer.from(shot.data, "base64"), input.artifacts)
      screenshots.push(file)
    }
    const downloaded = document ? await download(page, document, input.base, signal, input.artifacts) : undefined
    return { ...extracted, ...downloaded, title: document ? "Document download" : extracted.title, mime: document?.mimeType, status: document?.status ?? response?.status, pageState: state, via: input.android ? "Android Chrome" : "regular Chromium", screenshots, screenshotCut: Math.max(0, height - count * 1600) }
  } catch (error) {
    input.signal.throwIfAborted()
    if (deadline.aborted) throw new FetchError(`Browser capture timed out after ${input.timeout}s`, "timeout")
    throw error
  } finally {
    cdp?.close()
    if (target && browser) await browser.send("Target.closeTarget", Empty, { targetId: target }).catch((error) => { console.warn("webfetch owned-tab cleanup failed", error instanceof Error ? error.message : "unknown error") })
    browser?.close()
  }
}

export async function fetchPage(input: { url: string; html: boolean; timeout: number; base: string; signal: AbortSignal; artifacts: ArtifactBudget }): Promise<Page> {
  const url = new URL(input.url)
  if (!["http:", "https:"].includes(url.protocol)) throw new FetchError("URL must use HTTP or HTTPS")
  return serialized(input.signal, async () => {
    await mkdir(path.dirname(input.base), { recursive: true })
    const first = await attempt({ ...input, base: `${input.base}-desktop`, android: false }).catch(async (error) => {
      input.signal.throwIfAborted()
      if (error instanceof FetchError && error.code === "timeout" && input.timeout < 120) return attempt({ ...input, base: `${input.base}-desktop-retry`, android: false, timeout: 120 })
      if (error instanceof FetchError && error.code === "unavailable" && process.platform === "linux" && !process.env.TANDEM_BROWSER_FETCH_ENDPOINT) return attempt({ ...input, base: `${input.base}-android`, android: true })
      throw error
    })
    if (first.pageState === "blocked") throw new FetchError("Site is refusing this network (rate limit / unusual traffic); do not retry this site", "blocked", new URL(first.url).hostname)
    const result = first.pageState === "never-ready" && first.via !== "Android Chrome" && !process.env.TANDEM_BROWSER_FETCH_ENDPOINT
      ? await attempt({ ...input, base: `${input.base}-android`, android: true }) : first
    if (result.pageState === "blocked") throw new FetchError("Site is refusing this network; do not retry this site", "blocked", new URL(result.url).hostname)
    if (result.pageState === "never-ready") throw new FetchError("Site never delivered real content; only a placeholder was available")
    return result
  })
}

// Retention is shared across Location plugins; active calls pin all their initial/follow-up artifacts.
const active = new Set<string>()
export function pin(prefix: string) { active.add(prefix); return () => active.delete(prefix) }
export async function prune(directory: string) {
  await mkdir(directory, { recursive: true })
  const files = (await Promise.all((await readdir(directory)).filter((name) => name.startsWith("bf-")).map(async (name) => {
    const info = await stat(path.join(directory, name)).catch(() => undefined)
    return info ? { name, info } : undefined
  }))).filter((file) => file !== undefined)
  let bytes = 0
  let count = 0
  for (const file of files.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)) {
    if (!file.info.isFile()) continue
    bytes += file.info.size
    count++
    if ([...active].some((prefix) => path.join(directory, file.name).startsWith(prefix))) continue
    if (count > 300 || bytes > 512 * 1024 * 1024 || Date.now() - file.info.mtimeMs > 7 * 86400000) await unlink(path.join(directory, file.name)).catch(() => {})
  }
}
