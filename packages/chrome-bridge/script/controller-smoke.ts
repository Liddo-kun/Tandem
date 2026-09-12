import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { openSync, closeSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { BrowserController, BrowserError, type BrowserTurn, type TabHandle } from "../src/controller"
import { connect } from "../src/client"

const { values } = parseArgs({
  args: process.argv.slice(2).filter((x) => x !== "--"),
  options: {
    "run-dir": { type: "string" },
    "second-run-dir": { type: "string" },
    launch: { type: "boolean" },
    "claim-fixtures": { type: "boolean" },
  },
})
if (!values["run-dir"])
  throw new Error("Usage: controller-smoke.ts --run-dir <fresh prepared run> [--second-run-dir <fresh prepared run>]")
process.umask(0o077)
const runDir = resolve(values["run-dir"])
const preparation = JSON.parse(await readFile(join(runDir, "preparation.json"), "utf8"))
if (preparation.runDir !== runDir || !preparation.observer?.port || !preparation.observer.token || !preparation.trace)
  throw new Error("Requires fresh traced --observer preparation")
const token = preparation.observer.token
const startedAt = new Date().toISOString()
const assertions: {
  name: string
  passed: boolean
  detail?: unknown
  startedAt?: number
  endedAt?: number
  selected?: number[]
}[] = []
const metadata: Record<string, unknown> = {
  token,
  preparation,
  capabilities: {
    contenteditable: "not verified",
    crossOriginFrames: "unsupported",
    closedShadow: "unsupported",
    faults: "not run in ordinary suite",
    largeDOM: "not verified",
    contentPermissionsAndRedirects: "not verified live",
    frameworkControlledInput: "not verified",
    viewportResizeAndOversizeCapture: "not verified",
    overlayObstructionAndFrameRemoval: "not verified",
    workerRestart: "not verified",
  },
}
const states = new Map<string, any>()
const observations: any[] = []
const html = await readFile(new URL("../test/fixtures/controller.html", import.meta.url))
const frame = await readFile(new URL("../test/fixtures/frame.html", import.meta.url))
// Use the workspace's real UI framework only in this local fixture, not in the controller runtime.
const appRequire = createRequire(new URL("../../app/package.json", import.meta.url))
const solid = dirname(appRequire.resolve("solid-js/package.json"))
const bundle = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../test/fixtures/controlled.js", import.meta.url))],
  target: "browser",
  plugins: [
    {
      name: "fixture-framework",
      setup(build) {
        build.onResolve({ filter: /^solid-js(?:\/web)?$/ }, ({ path }) => ({
          path: join(solid, path === "solid-js" ? "dist/solid.js" : "web/dist/web.js"),
        }))
      },
    },
  ],
})
if (!bundle.success) throw new Error("Could not build the local controlled-input fixture")
const controlledJS = await bundle.outputs[0]!.text()
const alternate = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () =>
    new Response("<!doctype html><title>Denied origin</title><p>Private fixture content</p>", {
      headers: { "content-type": "text/html" },
    }),
})
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: preparation.observer.port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.searchParams.get("token") !== token) return new Response("Forbidden", { status: 403 })
    if (url.pathname === "/controlled.js")
      return new Response(controlledJS, { headers: { "content-type": "application/javascript" } })
    if (url.pathname === "/never-ready")
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode("<!doctype html><title>Loading fixture</title><body>Still loading"),
            )
          },
        }),
        { headers: { "content-type": "text/html" } },
      )
    if (url.pathname === "/redirect") return Response.redirect(`http://127.0.0.1:${alternate.port}/`, 302)
    if (url.pathname === "/navigation-failure") return Response.redirect("http://127.0.0.1:1/", 302)
    if (url.pathname === "/large")
      return new Response(
        `<!doctype html><title>Bounded</title><input type="password" value="PASSWORD_SECRET"><input type="hidden" value="HIDDEN_SECRET"><div hidden>HIDDEN_TEXT</div>${"<button>Bounded item</button><p>Visible fixture text</p>".repeat(3000)}`,
        { headers: { "content-type": "text/html" } },
      )
    if (url.pathname === "/error")
      return new Response("<!doctype html><title>HTTP error fixture</title><h1>HTTP error fixture</h1>", {
        status: 503,
        headers: { "content-type": "text/html" },
      })
    if (url.pathname === "/cross")
      return new Response(
        `<!doctype html><title>Cross-origin frame fixture</title><iframe src="http://127.0.0.1:${alternate.port}/"></iframe>`,
        { headers: { "content-type": "text/html" } },
      )
    if (request.method === "POST" && ["/state", "/observer"].includes(url.pathname)) {
      const value: any = await request.json()
      if (url.pathname === "/state") {
        if (!states.has(value.name) || states.get(value.name).sequence < value.sequence) states.set(value.name, value)
      } else {
        if (!Array.isArray(value.tabs)) {
          const diagnostics = (metadata.observerDiagnostics ??= []) as unknown[]
          if (diagnostics.length < 20) diagnostics.push(value)
          return new Response("ok")
        }
        observations.push(value)
        if (observations.length > 10000) observations.shift()
      }
      return new Response("ok")
    }
    return new Response(url.pathname === "/frame" ? frame : html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    })
  },
})
const origin = `http://127.0.0.1:${server.port}`
const fixture = (name: string) => `${origin}/?token=${token}&name=${name}`
if (values["claim-fixtures"] && !values.launch)
  throw new Error("--claim-fixtures requires --launch to establish independent user fixture tabs")
if (values.launch) {
  const fd = openSync(join(runDir, "browser.log"), "a", 0o600)
  const child = spawn(
    "/usr/bin/timeout",
    [
      "--kill-after=5s",
      "240s",
      preparation.launcher,
      ...(values["claim-fixtures"] ? [fixture("one"), fixture("two"), "about:blank"] : []),
    ],
    { detached: true, stdio: ["ignore", fd, fd] },
  )
  child.unref()
  closeSync(fd)
  metadata.launcherPID = child.pid
  await Bun.sleep(2000)
}
let controller: BrowserController | undefined
let identityClient: Awaited<ReturnType<typeof connect>> | undefined
async function check(name: string, action: () => unknown | Promise<unknown>) {
  const startedAt = Date.now()
  try {
    const detail = await action()
    assertions.push({
      name,
      passed: true,
      detail,
      startedAt,
      endedAt: Date.now(),
      selected: observations
        .at(-1)
        ?.tabs.filter((x: any) => x.active)
        .map((x: any) => x.id),
    })
    console.log(`PASS ${name}`)
    return detail
  } catch (error) {
    const detail =
      error instanceof BrowserError
        ? { code: error.code, outcome: error.outcome, operationId: error.operationId }
        : String(error)
    assertions.push({ name, passed: false, detail })
    console.error(`FAIL ${name}`, detail)
    throw error
  }
}
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}
async function wait(test: () => boolean | Promise<boolean>, label: string, timeout = 10000) {
  const until = Date.now() + timeout
  while (!(await test())) {
    if (Date.now() > until) throw new Error(`Timed out: ${label}`)
    await Bun.sleep(50)
  }
}
async function inspect(turn: BrowserTurn, tab: TabHandle, label: string) {
  const page = await turn.inspect(tab)
  const element = page.elements.find((x) => x.label === label)
  assert(element, `Missing element ${label}; labels: ${page.elements.map((x) => x.label).join(",")}`)
  return { page, element }
}
async function rejected(action: () => Promise<unknown>, codes: string[]) {
  try {
    await action()
  } catch (error) {
    assert(error instanceof BrowserError && codes.includes(error.code), `Unexpected error ${String(error)}`)
    return { code: error.code, outcome: error.outcome }
  }
  throw new Error("Expected rejection")
}
try {
  await check("production registration and unmodified extension hashes", async () => {
    for (const [path, hash] of [
      [preparation.productionManifest.path, preparation.productionManifest.sha256],
      [join(preparation.extension.path, "background.js"), preparation.extension.backgroundSha256],
      [join(preparation.extension.path, "manifest.json"), preparation.extension.manifestSha256],
    ])
      assert(
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex") === hash,
        "Hash mismatch",
      )
  })
  // Raw transport is used only for identity/provenance observation, never for fixture actions.
  let raw: Awaited<ReturnType<typeof connect>> | undefined
  const connectionDeadline = Date.now() + 20000
  while (!raw) {
    try {
      raw = await connect(runDir)
    } catch (error) {
      if (!(error instanceof BrowserError) || error.code !== "browser_unavailable" || Date.now() >= connectionDeadline)
        throw error
      await Bun.sleep(150)
    }
  }
  metadata.discovery = raw.discovery
  identityClient = raw
  await check("exact prepared host executable profile and environment provenance", async () => {
    assert(raw!.discovery.executable === preparation.hostExecutable, "Unexpected host executable")
    const args = (await readFile(`/proc/${raw!.discovery.parentPid}/cmdline`, "utf8")).split("\0")
    assert(args.includes(`--user-data-dir=${preparation.userData}`), "Unexpected browser profile")
    const environment = (await readFile(`/proc/${raw!.discovery.pid}/environ`, "utf8")).split("\0")
    assert(
      environment.includes(`HOME=${preparation.home}`) && !environment.some((x) => x.startsWith("CODEX_CLI_PATH=")),
      "Unexpected host environment",
    )
    assert(
      createHash("sha256")
        .update(await readFile(preparation.hostExecutable))
        .digest("hex") === preparation.hostSha256,
      "Compiled host changed",
    )
  })
  metadata.extensionInfo = await raw.call("getInfo")
  raw.close()
  await Bun.sleep(300)
  controller = await BrowserController.create({
    connections: [
      { id: "first", label: "Isolated first", directory: runDir },
      ...(values["second-run-dir"]
        ? [{ id: "second", label: "Isolated second", directory: resolve(values["second-run-dir"]) }]
        : []),
    ],
    authorize: (request) =>
      request.destination && !request.destination.startsWith(origin + "/")
        ? "deny"
        : request.documentOrigin &&
            request.documentOrigin !== origin &&
            !(request.tabOrigin === "agent" && request.documentOrigin === "about:blank")
          ? "deny"
          : "allow",
  })
  metadata.status = await controller.status()
  await check("explicit browser identity and unverified profile metadata", () => {
    assert(
      controller!.browsers().every((x) => x.profileIdentity === "unverified"),
      "Invented identity",
    )
    return controller!.browsers()
  })
  await check("busy host rejects second controller", () =>
    rejected(
      () =>
        BrowserController.create({
          connections: [{ id: "busy", label: "busy", directory: runDir }],
          authorize: () => "allow",
        }),
      ["controller_busy"],
    ),
  )
  const a = await controller.openSession({ browserId: "first", callerSessionId: `a-${token}` })
  const b = await controller.openSession({ browserId: "first", callerSessionId: `b-${token}` })
  const ta = await a.beginTurn({ callerTurnId: "a" }),
    tb = await b.beginTurn({ callerTurnId: "b" })
  const [one, two] = values["claim-fixtures"]
    ? ((await check("two sessions claim independent startup user fixtures", async () => {
        await wait(
          () => states.has("one") && states.has("two") && observations.length > 2,
          "startup fixture observer ready",
        )
        metadata.createTabAcceptance = "not tested in user-claim mode"
        const pages = await ta.discoverTabs()
        const x = pages.tabs.find((x) => x.url === fixture("one")),
          y = pages.tabs.find((x) => x.url === fixture("two"))
        assert(x && y, "Startup fixture tabs not discovered")
        const other = await tb.discoverTabs()
        const by = other.tabs.find((x) => x.url === fixture("two"))!
        return Promise.all([ta.claimTab(x.handle), tb.claimTab(by.handle)])
      })) as [TabHandle, TabHandle])
    : ((await check("two sessions create background fixture tabs concurrently", () =>
        Promise.all([ta.createTab({ url: fixture("one") }), tb.createTab({ url: fixture("two") })]),
      )) as [TabHandle, TabHandle])
  await wait(
    () =>
      states.get("one")?.controlled === "original framework" &&
      states.get("two")?.controlled === "original framework" &&
      observations.length > 2,
    "independent fixture and observer ready",
  )
  const baseline = observations.at(-1)
  const selected = baseline.tabs
    .filter((x: any) => x.active)
    .map((x: any) => x.id)
    .sort()
  const activationCount = baseline.activations.length
  metadata.physicalBaseline = baseline
  await check("physical selected tab is unrelated user tab", () => {
    assert(
      selected.length > 0 && baseline.tabs.filter((x: any) => x.active).every((x: any) => !x.url?.includes(token)),
      "Fixture stole selection during creation",
    )
  })
  await check("foreign session handle rejected", () => rejected(() => tb.inspect(one), ["stale_handle"]))
  let initialClicks = 0
  if (values["claim-fixtures"]) {
    await check("background click establishes target-local focus without prior typing", async () => {
      const x = await inspect(ta, one, "Submit once")
      await ta.click(one, { target: x.element.ref })
      await wait(() => states.get("one").clicks === 1, "click without prior typing")
      initialClicks = 1
    })
  }
  await check("overlapping target-local replacement input", async () => {
    const [x, y] = await Promise.all([inspect(ta, one, "Name"), inspect(tb, two, "Name")])
    await Promise.all([
      ta.type(one, { target: x.element.ref, text: "Alpha \u03a9", mode: "replace" }),
      tb.type(two, { target: y.element.ref, text: "Beta \u4e2d", mode: "replace" }),
    ])
    await wait(
      () => states.get("one").input === "Alpha \u03a9" && states.get("two").input === "Beta \u4e2d",
      "exact replacement",
    )
  })
  await check("append inserts text once with trusted input", async () => {
    const x = await inspect(ta, one, "Name")
    await ta.type(one, { target: x.element.ref, text: " appended", mode: "append" })
    await wait(() => states.get("one").input === "Alpha \u03a9 appended", "append")
    assert(
      states.get("one").events.filter((e: any) => e.type === "input").length === 2 &&
        states.get("one").events.every((e: any) => e.trusted),
      "Unexpected input count/trust",
    )
  })
  await check("textarea replace and allowed key are trusted", async () => {
    let x = await inspect(ta, one, "Notes")
    await ta.type(one, { target: x.element.ref, text: "line one", mode: "replace" })
    x = await inspect(ta, one, "Notes")
    await ta.key(one, { target: x.element.ref, key: "End" })
    await wait(() => states.get("one").events.some((e: any) => e.key === "End" && e.trusted), "key event")
    assert(states.get("one").notes === "line one", "textarea value")
  })
  await check("ordinary contenteditable replace and append use trusted input", async () => {
    let x = await inspect(ta, one, "Editor")
    await ta.type(one, { target: x.element.ref, text: "Editable \u03a9", mode: "replace" })
    await wait(() => states.get("one").editor === "Editable \u03a9", "contenteditable replacement")
    x = await inspect(ta, one, "Editor")
    await ta.type(one, { target: x.element.ref, text: " appended", mode: "append" })
    await wait(() => states.get("one").editor === "Editable \u03a9 appended", "contenteditable append")
    assert(
      states.get("one").events.every((e: any) => e.trusted),
      "Untrusted editing event",
    )
    ;(metadata.capabilities as Record<string, string>).contenteditable = "verified ordinary editing host"
  })
  await check("framework-controlled input receives replace and append events", async () => {
    await wait(() => states.get("one").controlled === "original framework", "framework fixture ready")
    let x = await inspect(ta, one, "Framework controlled")
    await ta.type(one, { target: x.element.ref, text: "Controlled", mode: "replace" })
    await wait(() => states.get("one").frameworkState === "Controlled", "framework replacement")
    x = await inspect(ta, one, "Framework controlled")
    await ta.type(one, { target: x.element.ref, text: " appended", mode: "append" })
    await wait(() => states.get("one").frameworkState === "Controlled appended", "framework append")
    assert(
      states.get("one").controlled === "Controlled appended" && states.get("one").events.every((e: any) => e.trusted),
      "Framework state or events mismatch",
    )
    ;(metadata.capabilities as Record<string, string>).frameworkControlledInput = "verified Solid signal-backed input"
  })
  await check("two background clicks each dispatch exactly once and trusted", async () => {
    const [x, y] = await Promise.all([inspect(ta, one, "Submit once"), inspect(tb, two, "Submit once")])
    await Promise.all([ta.click(one, { target: x.element.ref }), tb.click(two, { target: y.element.ref })])
    await wait(() => states.get("one").clicks === 1 + initialClicks && states.get("two").clicks === 1, "click effects")
    assert(
      [states.get("one"), states.get("two")].every(
        (s) =>
          s.events.filter((e: any) => e.type === "click").length === s.clicks && s.events.every((e: any) => e.trusted),
      ),
      "duplicate or untrusted",
    )
  })
  await check("open shadow root trusted click", async () => {
    const x = await inspect(ta, one, "Shadow button")
    await ta.click(one, { target: x.element.ref })
    await wait(() => states.get("one").shadow === 1, "shadow click")
  })
  await check("same-origin nested frame trusted click", async () => {
    const page = await ta.inspect(one)
    const frame = page.frames.find((x) => x.supported && new URL(x.url).searchParams.has("inner"))
    assert(frame, "Nested frame not exposed")
    const child = await ta.inspect(one, { frame: frame.handle })
    const target = child.elements.find((x) => x.label === "Nested frame button")
    assert(target, "Nested button not exposed")
    await ta.click(one, { target: target.ref })
    await wait(() => states.get("one").frame === 1, "nested frame click")
  })
  await check("screenshot DPR and measured mapping", async () => {
    const image = await ta.screenshot(one)
    assert(
      image.mime === "image/png" && Buffer.from(image.bytes).subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      "PNG signature",
    )
    assert(
      Math.abs(image.width * image.mapping.scaleX - image.viewport.width) < 1 &&
        Math.abs(image.height * image.mapping.scaleY - image.viewport.height) < 1,
      "mapping dimensions",
    )
    if (preparation.deviceScale)
      assert(
        Math.abs(image.viewport.deviceScale - preparation.deviceScale * preparation.zoom) < 0.05,
        "DPR/zoom not applied",
      )
    assert(
      Math.abs(image.width - image.viewport.width * image.viewport.deviceScale) < 2 &&
        Math.abs(image.height - image.viewport.height * image.viewport.deviceScale) < 2,
      "Capture did not cover the measured CSS viewport at device scale",
    )
    const path = join(runDir, "controller-screenshot.png")
    await writeFile(path, image.bytes, { flag: "wx", mode: 0o600 })
    metadata.screenshot = { ...image, bytes: undefined, path }
    if (!image.viewValid) {
      await rejected(() => ta.click(one, { x: 1, y: 1, view: image.viewToken }), ["stale_handle"])
      metadata.captureViewportChanged = "Invalidated image view rejected; later capture is a separate explicit read"
      ;(metadata.capabilities as Record<string, string>).viewportResizeAndOversizeCapture =
        "live viewport-change invalidation; encoded/decoded oversize bounds tested deterministically"
    }
    console.log(`SCREENSHOT ${path}`)
  })
  await check("coordinate click uses screenshot pixel mapping", async () => {
    const x = await inspect(ta, one, "Submit once")
    const image = await ta.screenshot(one)
    assert(image.viewValid, "Coordinate screenshot view was invalidated")
    assert(x.element.bounds, "Coordinate smoke requires measured element bounds; original snapshots may omit them")
    const cssX = x.element.bounds.x + x.element.bounds.width / 2,
      cssY = x.element.bounds.y + x.element.bounds.height / 2
    const pixelX = (cssX - image.mapping.offsetX) / image.mapping.scaleX,
      pixelY = (cssY - image.mapping.offsetY) / image.mapping.scaleY
    await ta.click(one, {
      x: pixelX * image.mapping.scaleX + image.mapping.offsetX,
      y: pixelY * image.mapping.scaleY + image.mapping.offsetY,
      view: image.viewToken,
    })
    await wait(() => states.get("one").clicks === 2 + initialClicks, "mapped coordinate click")
  })
  await check("horizontal vertical and diagonal wheel target local scroll", async () => {
    for (const [dx, dy] of [
      [120, 0],
      [0, 120],
      [80, 80],
    ]) {
      const before = { ...states.get("one") },
        bounds = before.scrollBounds
      const page = await ta.inspect(one)
      await ta.scroll(one, { deltaX: dx!, deltaY: dy!, x: bounds.x + 60, y: bounds.y + 60, view: page.viewToken })
      await wait(
        () =>
          (dx === 0 || states.get("one").scrollX > before.scrollX) &&
          (dy === 0 || states.get("one").scrollY > before.scrollY),
        "wheel axes",
      )
      if (dx === 0) assert(states.get("one").scrollX === before.scrollX, "Unexpected horizontal scroll")
      if (dy === 0) assert(states.get("one").scrollY === before.scrollY, "Unexpected vertical scroll")
    }
  })
  if (values["claim-fixtures"])
    await check("wheel at both scroll boundaries does not navigate", async () => {
      let page = await ta.inspect(one)
      const url = page.url
      let bounds = states.get("one").scrollBounds
      await ta.scroll(one, { deltaX: 10000, deltaY: 10000, x: bounds.x + 60, y: bounds.y + 60, view: page.viewToken })
      await wait(
        () =>
          states.get("one").scrollX === states.get("one").scrollMaxX &&
          states.get("one").scrollY === states.get("one").scrollMaxY,
        "scroll limits",
      )
      const wheels = states.get("one").wheels
      page = await ta.inspect(one)
      bounds = states.get("one").scrollBounds
      await ta.scroll(one, { deltaX: 10000, deltaY: 10000, x: bounds.x + 60, y: bounds.y + 60, view: page.viewToken })
      await wait(() => states.get("one").wheels > wheels, "boundary wheel dispatch")
      assert((await ta.inspect(one)).url === url, "Boundary wheel navigated the browser")
    })
  await check("SPA route invalidates old element reference", async () => {
    const page = await ta.inspect(one)
    const route = page.elements.find((x) => x.label === "SPA route")!,
      old = page.elements.find((x) => x.label === "Submit once")!
    await ta.click(one, { target: route.ref })
    return rejected(() => ta.click(one, { target: old.ref }), ["stale_handle", "target_changed"])
  })
  await check("replaced DOM element cannot silently retarget", async () => {
    const page = await ta.inspect(one)
    const replace = page.elements.find((x) => x.label === "Replace target")!,
      old = page.elements.find((x) => x.label === "Original target")!
    await ta.click(one, { target: replace.ref })
    return rejected(() => ta.click(one, { target: old.ref }), ["stale_handle", "target_changed"])
  })
  if (values["claim-fixtures"])
    await check("frame reload invalidates its document-bound handle", async () => {
      const page = await ta.inspect(one)
      const outer = page.frames.find(
        (x) => new URL(x.url).pathname === "/frame" && !new URL(x.url).searchParams.has("inner"),
      )!
      const button = page.elements.find((x) => x.label === "Reload frame")!
      const loads = states.get("one").frameLoads
      await ta.click(one, { target: button.ref })
      await wait(() => states.get("one").frameLoads > loads, "frame reload")
      await rejected(() => ta.inspect(one, { frame: outer.handle }), ["stale_handle", "target_changed"])
      const fresh = await ta.inspect(one)
      const current = fresh.frames.find(
        (x) => new URL(x.url).pathname === "/frame" && !new URL(x.url).searchParams.has("inner"),
      )!
      await ta.inspect(one, { frame: current.handle })
    })
  await check("removed same-origin frame invalidates its handle", async () => {
    const page = await ta.inspect(one)
    const child = page.frames.find((x) => new URL(x.url).searchParams.has("inner"))!
    const remove = page.elements.find((x) => x.label === "Remove frame")!
    await ta.click(one, { target: remove.ref })
    await rejected(() => ta.inspect(one, { frame: child.handle }), ["stale_handle", "target_changed"])
  })
  await check("overlay blocks native click without submitting", async () => {
    const control = await inspect(ta, one, "Obstruct submit")
    await ta.click(one, { target: control.element.ref })
    const target = await inspect(ta, one, "Submit once")
    const count = states.get("one").clicks
    await rejected(() => ta.click(one, { target: target.element.ref }), ["target_changed"])
    assert(states.get("one").clicks === count, "Obstructed click submitted")
    ;(metadata.capabilities as Record<string, string>).overlayObstructionAndFrameRemoval = "verified"
  })
  await check("large DOM and excluded values stay bounded", async () => {
    const tab = await ta.createTab({ url: `${origin}/large?token=${token}` })
    const page = await ta.inspect(tab)
    assert(
      page.truncated &&
        page.elements.length <= 200 &&
        Buffer.byteLength(page.text) <= 65536 &&
        Buffer.byteLength(JSON.stringify(page)) <= 131072,
      "Inspection limits",
    )
    assert(!JSON.stringify(page).includes("SECRET") && !page.text.includes("HIDDEN_TEXT"), "Excluded values leaked")
    ;(metadata.capabilities as Record<string, string>).largeDOM = "verified"
  })
  await check("redirect changes origin and denied content remains unread", async () => {
    const tab = await ta.createTab()
    const result = await ta.navigate(tab, { url: `${origin}/redirect?token=${token}` })
    assert(new URL(result.url).origin === `http://127.0.0.1:${alternate.port}`, "Redirect identity")
    await rejected(() => ta.inspect(tab), ["permission_denied"])
    ;(metadata.capabilities as Record<string, string>).contentPermissionsAndRedirects =
      "verified redirect and denied new-origin read"
  })
  await check("HTTP error document differs from browser navigation failure", async () => {
    const tab = await ta.createTab({ url: `${origin}/error?token=${token}` })
    assert((await ta.inspect(tab)).title === "HTTP error fixture", "HTTP error document missing")
    await rejected(
      () => ta.navigate(tab, { url: `${origin}/navigation-failure?token=${token}` }),
      ["navigation_failed"],
    )
  })
  await check("cross-origin frame boundary is explicit", async () => {
    const tab = await ta.createTab({ url: `${origin}/cross?token=${token}` })
    const page = await ta.inspect(tab)
    const foreign = page.frames.find((x) => !x.supported)
    assert(foreign, "Cross-origin frame boundary absent")
    await rejected(() => ta.inspect(tab, { frame: foreign.handle }), ["unsupported"])
    await rejected(() => ta.screenshot(tab), ["unsupported"])
  })
  if (values["claim-fixtures"])
    await check("nonzero document scroll preserves viewport screenshot mapping", async () => {
      const target = await inspect(ta, one, "Tall document")
      await ta.click(one, { target: target.element.ref })
      let page = await ta.inspect(one)
      const ends = states.get("one").documentScrollEnds
      await ta.scroll(one, { deltaX: 0, deltaY: 400, x: page.viewport.width - 10, y: 10, view: page.viewToken })
      await wait(
        () => states.get("one").documentScrollEnds > ends && states.get("one").documentScrollY > 0,
        "document scrollend",
      )
      const image = await ta.screenshot(one)
      assert(
        image.viewport.scrollY > 0 && Math.abs(image.width * image.mapping.scaleX - image.viewport.width) < 1,
        "Scrolled image mapping",
      )
      const path = join(runDir, "controller-scrolled.png")
      await writeFile(path, image.bytes, { flag: "wx", mode: 0o600 })
      metadata.scrolledScreenshot = { ...image, bytes: undefined, path }
    })
  await check("physical selection unchanged throughout input and screenshot", async () => {
    await Bun.sleep(300)
    const recent = observations.filter((x) => x.at >= baseline.at)
    assert(
      recent.length > 2 &&
        recent.every(
          (x) =>
            x.epoch === baseline.epoch &&
            x.activations.length === activationCount &&
            JSON.stringify(
              x.tabs
                .filter((t: any) => t.active)
                .map((t: any) => t.id)
                .sort(),
            ) === JSON.stringify(selected),
        ),
      "Physical activation or observer epoch changed",
    )
    return { samples: recent.length, selected }
  })
  // Disposal can change Chrome's tab/group selection. Keep this lifecycle fault out of the input/capture interval.
  if (values["claim-fixtures"])
    await check("never-ready page respects deadline without blocking another session", async () => {
      const session = await controller!.openSession({ browserId: "first", callerSessionId: "loading-fixture" })
      const turn = await session.beginTurn({ callerTurnId: "loading" })
      const tab = await turn.createTab()
      await rejected(
        () => turn.navigate(tab, { url: `${origin}/never-ready?token=${token}` }, { timeoutMs: 800 }),
        ["deadline_exceeded"],
      )
      await tb.inspect(two)
      const cleanup = await turn.end()
      assert(cleanup.confirmed, "Loading fixture cleanup was not confirmed")
      assert((await session.close()).confirmed, "Loading fixture session cleanup")
    })
  await check("handoff finalization and ordinary cleanup confirmed", async () => {
    const reports = await Promise.all([ta.end({ keep: [{ tab: one, status: "handoff" }] }), tb.end({ keep: [] })])
    metadata.cleanup = reports
    assert(
      reports.every((x) => x.confirmed),
      "Cleanup not independently confirmed",
    )
    return reports
  })
  const next = await a.beginTurn({ callerTurnId: "next" })
  let resumed: TabHandle[] = []
  await check("handoff resumes in later turn with fresh handle", async () => {
    resumed = await next.resumeTabs()
    assert(resumed.length === 1 && resumed[0] !== one, "Handoff missing or old handle")
    await next.inspect(resumed[0]!)
    return rejected(() => next.inspect(one), ["stale_handle"])
  })
  await check("deliverable preserved and released", async () => {
    const report = await next.end({ keep: resumed.map((tab) => ({ tab, status: "deliverable" as const })) })
    assert(report.confirmed, "Deliverable cleanup unconfirmed")
    return report
  })
  if (values["second-run-dir"])
    await check("second browser binding acts independently", async () => {
      const s = await controller!.openSession({ browserId: "second", callerSessionId: "second" })
      const t = await s.beginTurn({ callerTurnId: "second" })
      const tab = await t.createTab({ url: fixture("second") })
      const p = await t.inspect(tab)
      assert(p.url.includes("name=second"), "Wrong browser page")
      assert((await t.end({ keep: [] })).confirmed, "Second cleanup")
      await s.close()
    })
  await check("sessions close confirmed", async () => {
    assert((await a.close()).confirmed && (await b.close()).confirmed, "Session close")
  })
} catch (error) {
  if (error instanceof BrowserError && controller && error.operationId) {
    metadata.failedOperationStatus = await controller.operationStatus(error.operationId).catch(() => null)
  }
  metadata.failure =
    error instanceof BrowserError
      ? { code: error.code, outcome: error.outcome, operationId: error.operationId }
      : String(error)
} finally {
  identityClient?.close()
  if (controller) {
    try {
      metadata.close = await controller.close()
    } catch (error) {
      metadata.close = String(error)
    }
  }
  if (values.launch && metadata.discovery) {
    const discovery = metadata.discovery as { parentPid: number }
    const args = (await readFile(`/proc/${discovery.parentPid}/cmdline`, "utf8").catch(() => "")).split("\0")
    if (args.includes(`--user-data-dir=${preparation.userData}`)) {
      process.kill(discovery.parentPid, "SIGTERM")
      metadata.stoppedBrowserPID = discovery.parentPid
    }
  }
  if (values.launch && !metadata.discovery && typeof metadata.launcherPID === "number") {
    const args = (await readFile(`/proc/${metadata.launcherPID}/cmdline`, "utf8").catch(() => "")).split("\0")
    if (args.includes(preparation.launcher)) process.kill(metadata.launcherPID, "SIGTERM")
  }
  metadata.states = Object.fromEntries(states)
  metadata.observations = observations
  const unchanged =
    createHash("sha256")
      .update(await readFile(preparation.productionManifest.path))
      .digest("hex") === preparation.productionManifest.sha256
  assertions.push({ name: "production manifest unchanged after suite", passed: unchanged })
  server.stop(true)
  alternate.stop(true)
  const passed = !metadata.failure && assertions.every((x) => x.passed)
  await writeFile(
    join(runDir, "controller-report.json"),
    JSON.stringify(
      { passed, phase2AcceptancePassed: false, startedAt, endedAt: new Date().toISOString(), assertions, metadata },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  )
  console.log(JSON.stringify({ passed, assertions: assertions.length, report: join(runDir, "controller-report.json") }))
  if (!passed) process.exitCode = 1
}
