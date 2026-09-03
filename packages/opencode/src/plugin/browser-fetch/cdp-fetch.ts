#!/usr/bin/env bun
/**
 * cdp-fetch — fetch a URL through a real browser via Chrome DevTools Protocol.
 *
 * Tier 1 (default): headed Linux Chromium on the Termux:X11 display (:0),
 *   launched via ~/.local/bin/chromium-x, CDP on 127.0.0.1:9223, Jon's profile.
 * Tier 2 (android): stock Android Chrome over `adb forward` on 127.0.0.1:9222.
 *
 * No dependencies — raw CDP over Bun's built-in WebSocket. `fetchPage()` is the
 * in-process engine used by the webfetch plugin; the same file doubles as the
 * `cdp-fetch` command-line tool when run directly.
 *
 * Usage: cdp-fetch [options] <url>
 *   --html             output raw outerHTML instead of readable text
 *   --links            append a de-duplicated list of links on the page
 *   --screenshot [f]   save a PNG screenshot (default /tmp/tandem/cdp-<ts>.png)
 *   --android          drive Android Chrome instead of Linux Chromium
 *   --endpoint h:p     explicit CDP endpoint (overrides tier selection)
 *   --timeout N        overall hard timeout, seconds (default 60)
 *   --settle N         extra settle time after load, seconds (default 1.5)
 *   --keep-tab         leave the tab open after extraction
 *   --json             emit {title,url,text,links?,pageState} as JSON
 *
 * Exit codes: 0 ok, 1 error, 2 usage, 3 hard timeout, 4 only ever saw a placeholder page,
 * 5 the site is refusing this network (rate limit / "unusual traffic").
 */

const LINUX_EP = "127.0.0.1:9223"
const ANDROID_EP = "127.0.0.1:9222"
// Placeholder text shown while a site is still handing over the real page.
const PENDING_RE =
  /just a moment|checking your browser|attention required|verify you are human|enable javascript and cookies|you are being redirected|automatic(?:ally)? redirect|redirecting (?:you|to|in)/i
// The site is refusing this network for now; polling or a second browser on the
// same IP will not change that, so report it instead of hammering.
const BLOCKED_RE = /unusual traffic from your computer network|\/sorry\/index|too many requests|rate limit(?:ed)?/i
const DOWNLOAD_DIR = "/tmp/tandem/webfetch"

export type PageState = "ready" | "ready-after-wait" | "never-ready" | "blocked"

export interface FetchOptions {
  url: string
  html?: boolean
  links?: boolean
  android?: boolean
  endpoint?: string
  /** overall hard timeout, seconds */
  timeout?: number
  /** extra settle time after load, seconds */
  settle?: number
  keepTab?: boolean
  screenshot?: string
  signal?: AbortSignal
}

export interface FetchResult {
  title: string
  url: string
  text: string
  links: { text: string; href: string }[] | null
  pageState: PageState
  /** HTTP status of the main document, when the browser reported one */
  status?: number
  /** set when the URL was a document download (PDF etc.) rather than a page: where the bytes went */
  file?: string
  mime?: string
}

/** `code` mirrors the CLI exit codes: 1 error, 3 hard timeout. */
export class FetchError extends Error {
  constructor(
    message: string,
    readonly code: 1 | 3,
  ) {
    super(message)
    this.name = "FetchError"
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- endpoint bring-up ----------
async function alive(ep: string): Promise<any | null> {
  try {
    const r = await fetch(`http://${ep}/json/version`, { signal: AbortSignal.timeout(3000) })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

async function run(cmd: string[], timeoutMs = 15000): Promise<{ ok: boolean; out: string }> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
    const t = setTimeout(() => p.kill(), timeoutMs)
    const out = await new Response(p.stdout).text()
    await p.exited
    clearTimeout(t)
    return { ok: p.exitCode === 0, out: out.trim() }
  } catch {
    return { ok: false, out: "" }
  }
}

async function ensureLinux(ep: string, timeLeft: () => number) {
  if (await alive(ep)) return
  const { existsSync } = await import("node:fs")
  if (!existsSync("/tmp/.X11-unix/X0"))
    throw new FetchError("X display :0 is not up — start the desktop (ubuntu-desktop widget), then retry", 1)
  // Detached launch; chromium-x already carries --remote-debugging-port=9223.
  Bun.spawn(["bash", "-c", "nohup ~/.local/bin/chromium-x >>/tmp/tandem/chromium-x.log 2>&1 &"], {
    stdout: "ignore",
    stderr: "ignore",
  })
  for (let i = 0; i < 40 && timeLeft() > 2000; i++) {
    await sleep(500)
    if (await alive(ep)) return
  }
  throw new FetchError(
    "launched chromium-x but CDP on :9223 never came up (running instance without the flag? see /tmp/tandem/chromium-x.log)",
    1,
  )
}

async function ensureAndroid(ep: string, timeLeft: () => number) {
  if (await alive(ep)) return
  const tgt = (await run(["bash", "-lc", "adb-reconnect"], 20000)).out.split("\n").pop()?.trim()
  if (!tgt) throw new FetchError("adb-reconnect could not find a device", 1)
  await run(["adb", "-s", tgt, "forward", "tcp:9222", "localabstract:chrome_devtools_remote"])
  if (await alive(ep)) return
  // Socket only exists while Chrome is alive — poke it awake.
  await run(["adb", "-s", tgt, "shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main"])
  for (let i = 0; i < 20 && timeLeft() > 2000; i++) {
    await sleep(500)
    if (await alive(ep)) return
  }
  throw new FetchError("could not reach Android Chrome CDP on :9222", 1)
}

// ---------- CDP client ----------
class Cdp {
  ws!: WebSocket
  id = 0
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  events: ((m: any) => void)[] = []

  static async connect(url: string, timeLeft: () => number): Promise<Cdp> {
    const c = new Cdp()
    c.timeLeft = timeLeft
    c.ws = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      c.ws.onopen = () => resolve()
      c.ws.onerror = () => reject(new FetchError(`websocket error connecting to ${url}`, 1))
    })
    c.ws.onmessage = (ev: MessageEvent) => {
      const m = JSON.parse(String(ev.data))
      if (m.id !== undefined && c.pending.has(m.id)) {
        const p = c.pending.get(m.id)!
        c.pending.delete(m.id)
        m.error ? p.reject(new FetchError(m.error.message, 1)) : p.resolve(m.result)
      } else if (m.method) c.events.forEach((f) => f(m))
    }
    return c
  }

  timeLeft: () => number = () => 15000

  send(method: string, params: any = {}, timeoutMs = 15000): Promise<any> {
    const id = ++this.id
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(
        () => {
          if (this.pending.has(id)) {
            this.pending.delete(id)
            reject(new FetchError(`${method} timed out`, 1))
          }
        },
        Math.min(timeoutMs, Math.max(this.timeLeft(), 1)),
      )
    })
  }

  onEvent(f: (m: any) => void) {
    this.events.push(f)
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

// A placeholder page reloads itself mid-flight, which destroys the JS execution
// context and strands any in-flight Runtime.evaluate. Retry rather than die:
// that reload is the real content arriving, i.e. exactly the case we care about.
async function evalJson(cdp: Cdp, expr: string, tries = 3): Promise<any> {
  for (let i = 0; ; i++) {
    try {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, 8000)
      if (r.exceptionDetails)
        throw new FetchError("page eval failed: " + (r.exceptionDetails.exception?.description ?? "?"), 1)
      return r.result?.value
    } catch (e) {
      if (i >= tries - 1 || cdp.timeLeft() < 3000) throw e
      await sleep(1000) // let the navigation land, then re-evaluate
    }
  }
}

// A navigation that turned out to be a document (PDF etc.): the browser would
// either show a viewer with no useful innerText or save it to Downloads, so pull
// the bytes ourselves — with the browser's cookies, so logged-in documents work —
// and turn PDFs into text with pdftotext.
async function downloadDocument(
  cdp: Cdp,
  r: { status: number; mimeType: string; url: string; headers: Record<string, string> },
  timeLeft: () => number,
): Promise<FetchResult> {
  const { cookies } = await cdp.send("Network.getCookies", { urls: [r.url] }).catch(() => ({ cookies: [] }))
  const ua = await cdp
    .send("Runtime.evaluate", { expression: "navigator.userAgent", returnByValue: true })
    .then((x) => x.result?.value as string)
    .catch(() => undefined)
  const headers: Record<string, string> = {}
  if (cookies?.length) headers.cookie = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ")
  if (ua) headers["user-agent"] = ua
  const res = await fetch(r.url, { headers, signal: AbortSignal.timeout(Math.max(timeLeft() - 2000, 5000)) })
  if (!res.ok) throw new FetchError(`download failed: HTTP ${res.status}`, 1)
  const bytes = new Uint8Array(await res.arrayBuffer())

  const { mkdirSync } = await import("node:fs")
  mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const disp = Object.entries(r.headers).find(([k]) => k.toLowerCase() === "content-disposition")?.[1] ?? ""
  const fromDisp = /filename\*?=(?:UTF-8'')?"?([^";]+)/i.exec(disp)?.[1]
  const fromUrl = decodeURIComponent(new URL(r.url).pathname.split("/").pop() || "")
  const isPdf = /pdf/i.test(r.mimeType) || /\.pdf$/i.test(fromUrl)
  const name = (fromDisp || fromUrl || "download").replace(/[^\w.-]+/g, "_").slice(-80) || "download"
  const file = `${DOWNLOAD_DIR}/${Date.now()}-${name}${isPdf && !/\.pdf$/i.test(name) ? ".pdf" : ""}`
  await Bun.write(file, bytes)

  let text = `(binary document, ${Math.round(bytes.length / 1024)} KB, saved to ${file})`
  if (isPdf) {
    const p = Bun.spawn(["pdftotext", "-layout", file, "-"], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(p.stdout).text()
    await p.exited
    text =
      p.exitCode === 0 && out.trim()
        ? out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n")
        : `(PDF saved to ${file}; pdftotext ${p.exitCode === 0 ? "found no text layer" : "is unavailable or failed"} — use the read tool on the file)`
  }
  return { title: name, url: r.url, text, links: null, pageState: "ready", status: r.status, file, mime: r.mimeType }
}

// ---------- engine ----------
export async function fetchPage(opt: FetchOptions): Promise<FetchResult> {
  const url = /^[a-z]+:\/\//i.test(opt.url) ? opt.url : "https://" + opt.url
  const timeout = opt.timeout ?? 60
  const settle = opt.settle ?? 1.5

  // Hard overall deadline — Termux:X11 can freeze when backgrounded and hang X
  // clients mid-fetch; this turns that into a clean error instead.
  const deadline = Date.now() + timeout * 1000
  const timeLeft = () => deadline - Date.now()

  // Reassigned once a tab exists. Every abnormal exit routes through here, or a
  // failure strands a half-loaded tab in Jon's visible browser window.
  let closeTab: () => Promise<void> = async () => {}
  let browser: Cdp | undefined
  let cdp: Cdp | undefined

  let onAbort: (() => void) | undefined
  const work = (async () => {
    const ep = opt.endpoint ?? (opt.android ? ANDROID_EP : LINUX_EP)
    if (!opt.endpoint) await (opt.android ? ensureAndroid(ep, timeLeft) : ensureLinux(ep, timeLeft))
    else if (!(await alive(ep))) throw new FetchError(`no CDP endpoint at ${ep}`, 1)

    // New tab via the browser-level websocket: HTTP /json/new is refused by
    // Android Chrome ("Could not create new page"), but Target.createTarget works
    // on both Android and Linux, so use it uniformly.
    const version = await alive(ep)
    if (!version?.webSocketDebuggerUrl) throw new FetchError("endpoint has no browser websocket", 1)
    browser = await Cdp.connect(version.webSocketDebuggerUrl, timeLeft)
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" })
    let tabClosed = false
    closeTab = async () => {
      if (tabClosed || opt.keepTab) return
      tabClosed = true
      await browser!.send("Target.closeTarget", { targetId }, 5000).catch(() => {})
    }

    cdp = await Cdp.connect(`ws://${ep}/devtools/page/${targetId}`, timeLeft)

    // Navigation tracking. `loading` flips on every main-frame navigation, so a
    // redirect that starts *after* the first load (meta refresh, JS
    // `location=`, "please wait while we forward you") is waited out instead
    // of captured as the page. Scheduled navigations carry their delay.
    let mainFrame = ""
    let loading = true
    let lastLoad = 0
    let scheduledNav: number | undefined
    let mainResponse: { status: number; mimeType: string; url: string; headers: Record<string, string> } | undefined
    const isMain = (m: any) => !mainFrame || m.params?.frameId === mainFrame
    cdp.onEvent((m) => {
      if (m.method === "Page.frameStartedLoading" && isMain(m)) {
        loading = true
        scheduledNav = undefined
      } else if (m.method === "Page.loadEventFired" || (m.method === "Page.frameStoppedLoading" && isMain(m))) {
        loading = false
        lastLoad = Date.now()
      } else if (m.method === "Page.frameScheduledNavigation" && isMain(m)) {
        const delay = Number(m.params.delay ?? 0)
        if (delay <= 15) scheduledNav = Date.now() + delay * 1000
      } else if (m.method === "Page.frameClearedScheduledNavigation" && isMain(m)) {
        scheduledNav = undefined
      } else if (m.method === "Network.responseReceived" && m.params.type === "Document" && isMain(m)) {
        const r = m.params.response
        mainResponse = { status: r.status, mimeType: r.mimeType ?? "", url: r.url, headers: r.headers ?? {} }
      }
    })
    await cdp.send("Page.enable")
    await cdp.send("Runtime.enable")
    await cdp.send("Network.enable")
    // Downloads are fetched by us (below) rather than saved by the browser. The
    // browser-level call ignores the default context, so set it per page too.
    await browser.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {})
    await cdp.send("Page.setDownloadBehavior", { behavior: "deny" }).catch(() => {})
    // Slow first byte is the common way a page is slow; give navigate a real share of the budget.
    const nav = await cdp.send("Page.navigate", { url }, Math.max(timeLeft() * 0.6, 15000))
    mainFrame = nav.frameId ?? ""

    const isDownload = () => {
      const r = mainResponse
      if (!r) return false
      const disp = Object.entries(r.headers).find(([k]) => k.toLowerCase() === "content-disposition")?.[1] ?? ""
      return /pdf|octet-stream|zip/i.test(r.mimeType) || /attachment/i.test(disp)
    }

    // A navigation that turns into a download is reported as ERR_ABORTED; the
    // document response that tells us so can land a beat after navigate returns.
    if (nav.errorText === "net::ERR_ABORTED") {
      for (let i = 0; i < 15 && !mainResponse; i++) await sleep(200)
      if (!isDownload()) throw new FetchError("navigation was aborted by the browser", 1)
    } else if (nav.errorText) throw new FetchError(`navigation failed: ${nav.errorText}`, 1)

    // Wait until the main frame has loaded and stayed put for `settle` seconds
    // (or give up at ~60% of remaining budget and take what we have).
    const loadBudget = Date.now() + Math.max(timeLeft() * 0.6, 5000)
    while (Date.now() < loadBudget) {
      if (isDownload()) break
      if (loading) {
        await sleep(200)
        continue
      }
      if (scheduledNav !== undefined && Date.now() < scheduledNav + 2000) {
        await sleep(200)
        continue
      }
      if (Date.now() - lastLoad < settle * 1000) {
        await sleep(200)
        continue
      }
      break
    }

    if (isDownload()) return await downloadDocument(cdp, mainResponse!, timeLeft)

    // Some sites serve a short-lived placeholder page and swap in the real content a
    // moment later. Poll until the placeholder text is gone; each pass re-fires load
    // on whatever replaced it.
    const probe = `JSON.stringify({t: document.title, h: (document.body?.innerText ?? "").slice(0, 2000), u: location.href})`
    let pageState: PageState = "ready"
    for (let i = 0; i < 30 && timeLeft() > 3000; i++) {
      let t = ""
      let h = ""
      let u = ""
      try {
        ;({ t, h, u } = JSON.parse(await evalJson(cdp, probe)))
      } catch {
        await sleep(1000) // context torn down by a reload; look again
        continue
      }
      if (BLOCKED_RE.test(u) || BLOCKED_RE.test(t) || BLOCKED_RE.test(h)) {
        pageState = "blocked"
        break
      }
      const hit = PENDING_RE.test(t) || PENDING_RE.test(h)
      if (!hit) {
        if (pageState === "never-ready") pageState = "ready-after-wait"
        break
      }
      pageState = "never-ready"
      await sleep(1000)
    }
    if (pageState === "ready-after-wait") await sleep(settle * 1000) // let the real page settle

    // Extraction runs in-page; innerText already skips script/style/hidden nodes.
    const page = JSON.parse(
      await evalJson(
        cdp,
        `JSON.stringify({
  title: document.title,
  url: location.href,
  text: ${opt.html ? "document.documentElement.outerHTML" : `(document.body?.innerText ?? "").replace(/\\n{3,}/g, "\\n\\n")`},
  links: ${
    opt.links
      ? `[...new Map([...document.querySelectorAll("a[href]")]
    .filter(a => /^https?:/.test(a.href))
    .map(a => [a.href, (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\\s+/g, " ").slice(0, 120)])
  ).entries()].slice(0, 200).map(([href, text]) => ({ text, href }))`
      : "null"
  }
})`,
      ),
    )

    if (opt.screenshot) {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png" })
      await Bun.write(opt.screenshot, Buffer.from(shot.data, "base64"))
    }

    return { ...page, pageState, status: mainResponse?.status } as FetchResult
  })()

  const hardTimeout = new Promise<never>((_, reject) => {
    const t = setTimeout(() => reject(new FetchError("hard timeout exceeded", 3)), timeout * 1000)
    work.then(
      () => clearTimeout(t),
      () => clearTimeout(t),
    )
  })
  const aborted = new Promise<never>((_, reject) => {
    if (!opt.signal) return
    onAbort = () => reject(new FetchError("aborted", 1))
    if (opt.signal.aborted) onAbort()
    else opt.signal.addEventListener("abort", onAbort, { once: true })
  })

  try {
    return await Promise.race([work, hardTimeout, aborted])
  } finally {
    // Whichever way we leave, the tab must not outlive the fetch.
    work.catch(() => {})
    await closeTab().catch(() => {})
    cdp?.close()
    browser?.close()
    if (onAbort) opt.signal?.removeEventListener("abort", onAbort)
  }
}

// ---------- CLI ----------
function usage() {
  console.error(
    "usage: cdp-fetch [--html] [--links] [--screenshot [file]] [--android] [--endpoint h:p] [--timeout N] [--settle N] [--keep-tab] [--json] <url>",
  )
}

async function main() {
  const args = process.argv.slice(2)
  const opt: FetchOptions & { json: boolean } = { url: "", json: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--html") opt.html = true
    else if (a === "--links") opt.links = true
    else if (a === "--android") opt.android = true
    else if (a === "--keep-tab") opt.keepTab = true
    else if (a === "--json") opt.json = true
    else if (a === "--screenshot") {
      opt.screenshot =
        args[i + 1] && !args[i + 1].startsWith("--") && !/^https?:/.test(args[i + 1])
          ? args[++i]
          : `/tmp/tandem/cdp-${Date.now()}.png`
    } else if (a === "--endpoint") opt.endpoint = args[++i]
    else if (a === "--timeout") opt.timeout = parseFloat(args[++i])
    else if (a === "--settle") opt.settle = parseFloat(args[++i])
    else if (a === "--help" || a === "-h") {
      usage()
      process.exit(0)
    } else if (!a.startsWith("--")) opt.url = a
    else {
      console.error(`cdp-fetch: unknown option ${a}`)
      process.exit(1)
    }
  }
  if (!opt.url) {
    usage()
    process.exit(2)
  }

  let page: FetchResult
  try {
    page = await fetchPage(opt)
  } catch (e) {
    console.error(`cdp-fetch: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(e instanceof FetchError ? e.code : 1)
  }

  const stateNote =
    page.pageState === "ready-after-wait"
      ? "   (real content arrived after a placeholder page)"
      : page.pageState === "never-ready"
        ? "   (WARNING: page never delivered real content — text below is the placeholder)"
        : page.pageState === "blocked"
          ? "   (BLOCKED: the site is refusing this network right now)"
          : ""
  if (opt.json) {
    console.log(JSON.stringify(page, null, 2))
  } else {
    console.log(`# ${page.title}`)
    console.log(`URL: ${page.url}${stateNote}`)
    if (page.status && page.status >= 400) console.log(`HTTP ${page.status}`)
    if (page.file) console.log(`Saved: ${page.file} (${page.mime})`)
    if (opt.screenshot) console.log(`Screenshot: ${opt.screenshot}`)
    console.log("")
    console.log(page.text)
    if (page.links) {
      console.log("\n## Links")
      for (const l of page.links) console.log(`- [${l.text || "(no text)"}](${l.href})`)
    }
  }
  // Exit 4 when only the placeholder was ever seen, so wrappers can retry via --android.
  process.exit(page.pageState === "never-ready" ? 4 : page.pageState === "blocked" ? 5 : 0)
}

if (import.meta.main) main()
