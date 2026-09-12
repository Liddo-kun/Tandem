import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { cp, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { inflateSync } from "node:zlib"
import { BrowserController, BrowserError } from "../src/controller"
import { BrowserToolOwner, type BrowserToolInput } from "../src/tools"
import { connect } from "../src/client"

// Trusted fixture runner only: no evaluator/CDP endpoint or browser shortcut is exposed to models.
const directory = resolve(process.argv[2] ?? "")
const dpr = Number(process.argv[3] ?? 1)
assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
assert([1, 1.25, 2].includes(dpr))
process.umask(0o077)
const preparation = await Bun.file(join(directory, "preparation.json")).json()
assert(preparation.observer && preparation.browser.args.includes("--enable-features=CDPScreenshotNewSurface"))
const token = preparation.observer.token
const origin = `http://127.0.0.1:${preparation.observer.port}`
const states = new Map<string, any>()
const events = new Map<string, any[]>()
const commands = new Map<string, any>()
const zoomReplies = new Map<string, any>()
let zoomCommand: any
let physical: any
const checks: any[] = []
const samples: any[] = []
const invalidCaptures: any[] = []
const failures: any[] = []
const hashes: Record<string, string> = {}
const sourceFiles = [
  "src/controller.ts",
  "src/page.ts",
  "src/tools.ts",
  "src/client.ts",
  "src/host.ts",
  "src/native.ts",
  "script/coordinate-acceptance.ts",
  "script/prepare.ts",
  "script/session-native-tap.ts",
  "test/fixtures/coordinate.html",
  "test/fixtures/coordinate-observer/background.js",
  "test/fixtures/coordinate-observer/manifest.json",
]
for (const path of sourceFiles) hashes[path] = hash(await readFile(new URL(`../${path}`, import.meta.url)))
const html = await Bun.file(new URL("../test/fixtures/coordinate.html", import.meta.url)).text()
const foreign = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response("<button>Foreign</button>", { headers: { "content-type": "text/html" } }),
})
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: preparation.observer.port,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.searchParams.get("token") !== token) return new Response("Forbidden", { status: 403 })
    const name = url.searchParams.get("name")!
    if (url.pathname === "/observer") {
      physical = await request.json()
      return new Response("ok")
    }
    if (url.pathname === "/zoom") {
      if (request.method === "POST") {
        const reply: any = await request.json()
        zoomReplies.set(reply.id, reply)
        return new Response("ok")
      }
      const value = zoomCommand
      zoomCommand = undefined
      return Response.json(value ?? null)
    }
    if (url.pathname === "/state") {
      states.set(name, await request.json())
      const command = commands.get(name)
      commands.delete(name)
      return Response.json(command ?? null)
    }
    if (url.pathname === "/event") {
      const list = events.get(name) ?? []
      list.push(await request.json())
      events.set(name, list)
      return new Response("ok")
    }
    if (url.pathname === "/frame")
      return new Response(
        `<!doctype html><html><style>body{margin:0}button{position:absolute;left:20px;top:30px;width:90px;height:50px}</style><button id="frame">Frame target</button><script>document.documentElement.dataset.generation=crypto.randomUUID();document.addEventListener('click',e=>fetch('/event'+location.search,{method:'POST',body:JSON.stringify({target:'frame',trusted:e.isTrusted,x:e.clientX,y:e.clientY})}));</script>`,
        { headers: { "content-type": "text/html", "cache-control": "no-store" } },
      )
    return new Response(html.replace("__CONFIG__", JSON.stringify({ token, name })), {
      headers: { "content-type": "text/html", "cache-control": "no-store" },
    })
  },
})
const zoomExtension = join(directory, "coordinate-observer")
await cp(new URL("../test/fixtures/coordinate-observer", import.meta.url), zoomExtension, { recursive: true })
await writeFile(
  join(zoomExtension, "config.js"),
  `globalThis.TANDEM_COORDINATE=${JSON.stringify({ endpoint: `${origin}/zoom?token=${token}`, origin })}\n`,
  { flag: "wx" },
)
const extensions = [preparation.extension.path, preparation.observer.path, zoomExtension].join(",")
const browser = Bun.spawn(
  [
    preparation.launcher,
    `--force-device-scale-factor=${dpr}`,
    `--load-extension=${extensions}`,
    `--disable-extensions-except=${extensions}`,
  ],
  {
    stdout: Bun.file(join(directory, "coordinate-browser.log")),
    stderr: Bun.file(join(directory, "coordinate-browser-error.log")),
  },
)
let nativePIDs: any
let currentOwner: BrowserToolOwner | BrowserController | undefined
async function wait(test: () => unknown | Promise<unknown>, label: string) {
  const end = Date.now() + 12000
  while (!(await test())) {
    assert(Date.now() < end, `Timeout: ${label}`)
    await Bun.sleep(100)
  }
}
async function counts() {
  const lines = (await Bun.file(join(directory, "native-dispatch.jsonl")).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  return {
    press: lines.filter((x) => x.inputType === "mousePressed").length,
    release: lines.filter((x) => x.inputType === "mouseReleased").length,
    wheel: lines.filter((x) => x.inputType === "mouseWheel").length,
    capture: lines.filter((x) => x.cdp === "Page.captureScreenshot").length,
    input: lines.filter((x) => x.cdp?.startsWith("Input.")).length,
  }
}
async function check(name: string, action: () => Promise<unknown>) {
  const before = await counts()
  try {
    const detail = await action()
    checks.push({ name, passed: true, before, after: await counts(), detail })
    console.log(`PASS ${name}`)
  } catch (error) {
    checks.push({ name, passed: false, before, after: await counts(), error: String(error) })
    throw error
  }
}
async function stale(name: string, action: () => Promise<any>, codes = ["stale_handle", "target_changed"]) {
  await check(name, async () => {
    const before = await counts()
    let code: string | undefined
    try {
      const result = await action()
      code = result?.metadata?.code
    } catch (error) {
      assert(error instanceof BrowserError)
      code = error.code
      assert.notEqual(error.outcome, "unknown")
    }
    assert(codes.includes(code!), `Expected ${codes}, received ${code}`)
    assert.equal((await counts()).input, before.input, "Rejected target dispatched native input")
    return { code, nativeInputDelta: 0 }
  })
}
async function setup(name: string, command: any, ready: () => boolean) {
  commands.set(name, command)
  await wait(ready, `fixture ${name} ${command.action}`)
  await Bun.sleep(150)
}
try {
  await wait(async () => {
    try {
      const raw = await connect(directory)
      raw.close()
      return true
    } catch {
      return false
    }
  }, "native host")
  nativePIDs = await Bun.file(join(directory, "native-processes.json")).json()
  for (const route of ["controller", "adapter"] as const) {
    const connection = { id: "fixture", label: "Coordinate isolated", directory, screenshotVerified: true }
    let calls = 0
    let close: () => Promise<unknown>
    let api: any
    if (route === "controller") {
      const controller = await BrowserController.create({ connections: [connection], authorize: () => "allow" })
      currentOwner = controller
      const session = await controller.openSession({ browserId: "fixture", callerSessionId: randomUUID() })
      const turn = await session.beginTurn({ callerTurnId: randomUUID() })
      api = {
        create: (url: string) => turn.createTab({ url }),
        inspect: (tab: any, frame?: any) => turn.inspect(tab, { frame }),
        capture: (tab: any) => turn.screenshot(tab),
        click: (tab: any, input: any) => turn.click(tab, input.ref ? { target: input.ref } : input),
        scroll: (tab: any, input: any) => turn.scroll(tab, input),
      }
      close = async () => {
        assert((await turn.end()).confirmed)
        assert((await session.close()).confirmed)
        assert((await controller.close()).confirmed)
      }
    } else {
      const owner = new BrowserToolOwner({ connections: [connection] })
      currentOwner = owner
      const execution = owner.begin({ runtime: "v2", location: directory, sessionID: randomUUID() })
      const invoke = async (input: BrowserToolInput, allowError = false) => {
        const result = await execution.execute(
          { browser: "fixture", ...input },
          {
            messageID: "coordinate",
            callID: String(++calls),
            signal: AbortSignal.timeout(20000),
            vision: true,
            authorize: async () => "allow",
          },
        )
        if (result.metadata.code) {
          if (allowError) return result
          throw new Error(JSON.stringify(result.metadata))
        }
        const data = JSON.parse(result.text)
        return { ...data, bytes: result.image?.bytes }
      }
      api = {
        create: async (url: string) => (await invoke({ action: "create", url })).tab,
        inspect: async (tab: string, frame?: string) => {
          const page = await invoke({ action: "inspect", tab, frame }, true)
          return { ...page, viewToken: page.view, frames: page.frames?.map((f: any) => ({ ...f, handle: f.frame })) }
        },
        capture: async (tab: string) => {
          const image = await invoke({ action: "screenshot", tab }, true)
          return { ...image, viewToken: image.view, mapping: image.imageToCSS }
        },
        click: (tab: string, input: any) => invoke({ action: "click", tab, ...input }, true),
        scroll: (tab: string, input: any) => invoke({ action: "scroll", tab, ...input }, true),
      }
      close = async () => {
        assert((await execution.end()).every((x) => x.confirmed))
        assert((await owner.close()).every((x) => x.confirmed))
      }
    }
    const capture = api.capture
    api.capture = async (tab: any) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const image = await capture(tab)
        if (image.metadata?.code || image.viewValid) return image
        const path = join(directory, `${route}-invalid-${checks.length}.png`)
        await writeFile(path, image.bytes, { flag: "wx" })
        invalidCaptures.push({
          path,
          width: image.width,
          height: image.height,
          viewport: image.viewport,
          mapping: image.mapping,
          sha256: hash(image.bytes),
        })
        await stale(
          `${route} capture viewport changed ${checks.length}`,
          () => api.click(tab, { x: 1, y: 1, view: image.viewToken }),
          ["stale_handle", "unsupported"],
        )
        await Bun.sleep(250)
      }
      throw new Error("Three explicit captures remained viewport-invalid")
    }
    const name = `${route}-${dpr}`
    const url = `${origin}/?token=${token}&name=${name}`
    const tab = await api.create(url)
    await wait(() => states.get(name)?.child && physical?.tabs, "fixture ready")
    const selected = physical.tabs.filter((t: any) => t.active).map((t: any) => t.id)
    for (const zoom of [1, 0.8, 1.25, 1.5]) {
      const previousImage = zoom === 1 ? undefined : await api.capture(tab)
      const id = randomUUID()
      zoomCommand = { id, url, zoom }
      await wait(() => zoomReplies.has(id) && Math.abs(states.get(name)?.dpr - dpr * zoom) < 0.015, "real tab zoom")
      assert(Math.abs(zoomReplies.get(id).zoom - zoom) < 0.001)
      if (previousImage)
        await stale(`${route} DPR ${dpr} zoom ${zoom} previous zoom screenshot`, () =>
          api.click(tab, { x: 178, y: 210, view: previousImage.viewToken }),
        )
      await setup(
        name,
        { action: "scroll", x: 0, y: 0 },
        () => states.get(name)?.y === 0 && states.get(name)?.x === 0 && !commands.has(name),
      )
      for (const scroll of [0, 500]) {
        const label = `${route} DPR ${dpr} zoom ${zoom} scroll ${scroll}`
        if (scroll) {
          const old = await api.inspect(tab)
          const oldImage = await api.capture(tab)
          const oldRef = old.elements.find((e: any) => e.label === "Top target").ref
          await check(`${label} native wheel`, async () => {
            const before = await counts()
            const result = await api.scroll(tab, { deltaX: 0, deltaY: 500, x: 50, y: 50, view: oldImage.viewToken })
            assert(!result?.metadata?.code, JSON.stringify(result))
            await wait(() => states.get(name)?.y > 0, "native scroll")
            assert.equal((await counts()).wheel - before.wheel, 1)
          })
          await stale(`${label} stale screenshot`, () => api.click(tab, { x: 178, y: 210, view: oldImage.viewToken }))
          await stale(`${label} stale element`, () => api.click(tab, { ref: oldRef }))
          await setup(
            name,
            { action: "scroll", x: 100, y: 500 },
            () => Math.abs(states.get(name)?.y - 500) < 1 && Math.abs(states.get(name)?.x - 100) < 1,
          )
        }
        await check(`${label} PNG mapped trusted click`, async () => {
          const page = await api.inspect(tab)
          const target = page.elements.find((e: any) => e.label === (scroll ? "Scrolled target" : "Top target"))
          assert(target)
          const image = await api.capture(tab)
          assert(image.viewValid, JSON.stringify(image.metadata))
          const v = image.viewport
          assert(Math.abs(v.browserZoom - zoom) < 0.015)
          assert(Math.abs(v.deviceScale - dpr * zoom) < 0.015)
          assert.equal(v.scale, 1, "Not pinch/pageScale zoom")
          assert(Math.abs(image.width - v.width * v.deviceScale) < 3)
          assert(Math.abs(image.height - v.height * v.deviceScale) < 3)
          // Find the actual green target in decoded PNG pixels, then map that pixel into the API.
          const pixel = greenPixel(image.bytes)
          const x = pixel.x * image.mapping.scaleX + image.mapping.offsetX
          const y = pixel.y * image.mapping.scaleY + image.mapping.offsetY
          assert(
            x > target.bounds.x && x < target.bounds.x + target.bounds.width,
            `PNG x ${x} outside ${JSON.stringify(target.bounds)}`,
          )
          assert(
            y > target.bounds.y && y < target.bounds.y + target.bounds.height,
            `PNG y ${y} outside ${JSON.stringify(target.bounds)}`,
          )
          const before = await counts(),
            eventCount = events.get(name)?.length ?? 0
          const result = await api.click(tab, { x, y, view: image.viewToken })
          assert(!result?.metadata?.code, JSON.stringify(result))
          await wait(() => (events.get(name)?.length ?? 0) > eventCount, "trusted click")
          const received = events.get(name)!.slice(eventCount)
          assert.equal(received.length, 1)
          assert.equal(received[0].target, scroll ? "lower" : "top")
          assert.equal(received[0].trusted, true)
          assert(Math.abs(received[0].x - x) < 1.1 && Math.abs(received[0].y - y) < 1.1)
          const after = await counts()
          assert.equal(after.press - before.press, 1)
          assert.equal(after.release - before.release, 1)
          const path = join(directory, `${route}-${zoom}-${scroll}.png`)
          await writeFile(path, image.bytes, { flag: "wx" })
          const sample = {
            route,
            dpr,
            zoom,
            requestedScroll: scroll,
            viewport: v,
            png: { path, width: image.width, height: image.height, sha256: hash(image.bytes) },
            mapping: image.mapping,
            pixel,
            css: { x, y },
            event: received[0],
            native: { press: 1, release: 1 },
          }
          samples.push(sample)
          return sample
        })
      }
      const scope = `${route} DPR ${dpr} zoom ${zoom}`
      await setup(name, { action: "scroll", x: 0, y: 0 }, () => states.get(name)?.y === 0 && states.get(name)?.x === 0)
      let page = await api.inspect(tab)
      const oldFrame = page.frames.find((f: any) => f.url.includes("/frame"))
      const oldChild = await api.inspect(tab, oldFrame.handle)
      const childGeneration = states.get(name).child
      await setup(
        name,
        { action: "child" },
        () => states.get(name)?.child && states.get(name).child !== childGeneration,
      )
      await stale(`${scope} same-URL child element`, () => api.click(tab, { ref: oldChild.elements[0].ref }))
      await stale(`${scope} same-URL child view`, () => api.click(tab, { x: 400, y: 150, view: oldChild.viewToken }))
      // Acquire a frame handle without superseding it with child inspection before the reload.
      page = await api.inspect(tab)
      const frameHandle = page.frames.find((f: any) => f.url.includes("/frame")).handle
      const generation = states.get(name).child
      await setup(name, { action: "child" }, () => states.get(name)?.child && states.get(name).child !== generation)
      await stale(`${scope} same-URL frame handle`, () => api.inspect(tab, frameHandle))
      const parentImage = await api.capture(tab)
      const parentChildGeneration = states.get(name).child
      await setup(
        name,
        { action: "child" },
        () => states.get(name)?.child && states.get(name).child !== parentChildGeneration,
      )
      await stale(`${scope} parent screenshot after same-URL child reload`, () =>
        api.click(tab, { x: 178, y: 210, view: parentImage.viewToken }),
      )
      await check(`${scope} child reinspection click`, async () => {
        page = await api.inspect(tab)
        const child = await api.inspect(tab, page.frames.find((f: any) => f.url.includes("/frame")).handle)
        const before = events.get(name)!.length
        const result = await api.click(tab, { ref: child.elements[0].ref })
        assert(!result?.metadata?.code)
        await wait(() => events.get(name)!.length > before, "fresh frame click")
        assert.equal(events.get(name)!.at(-1).target, "frame")
        assert(events.get(name)!.at(-1).trusted)
      })
      page = await api.inspect(tab)
      const image = await api.capture(tab)
      const topGeneration = states.get(name).generation
      await setup(
        name,
        { action: "reload" },
        () => states.get(name)?.generation !== topGeneration && states.get(name)?.child,
      )
      await stale(`${scope} same-URL top element`, () => api.click(tab, { ref: page.elements[0].ref }))
      await stale(`${scope} same-URL top screenshot`, () => api.click(tab, { x: 178, y: 210, view: image.viewToken }))
      await check(`${scope} top reinspection click`, async () => {
        const fresh = await api.inspect(tab),
          before = events.get(name)!.length
        const result = await api.click(tab, { ref: fresh.elements.find((e: any) => e.label === "Top target").ref })
        assert(!result?.metadata?.code)
        await wait(() => events.get(name)!.length > before, "fresh top click")
        assert.equal(events.get(name)!.at(-1).target, "top")
        assert(events.get(name)!.at(-1).trusted)
      })
    }
    await setup(name, { action: "cross", url: `http://127.0.0.1:${foreign.port}/` }, () => !commands.has(name))
    await Bun.sleep(300)
    const page = await api.inspect(tab)
    const cross = page.frames.find((f: any) => !f.supported)
    assert(cross)
    await stale(`${route} cross-origin frame`, () => api.inspect(tab, cross.handle), ["unsupported"])
    await stale(`${route} cross-origin screenshot`, () => api.capture(tab), ["unsupported"])
    await check(`${route} no selection change or decoy clicks`, async () => {
      assert.deepEqual(
        physical.tabs.filter((t: any) => t.active).map((t: any) => t.id),
        selected,
      )
      assert(events.get(name)!.every((e) => e.trusted && e.target !== "decoy"))
    })
    await close()
    currentOwner = undefined
    await Bun.sleep(200)
  }
} catch (error) {
  failures.push({ error: String(error), stack: error instanceof Error ? error.stack : undefined })
  console.error(error)
} finally {
  if (currentOwner) await currentOwner.close().catch((error) => failures.push({ cleanup: String(error) }))
  browser.kill("SIGTERM")
  await Promise.race([browser.exited, Bun.sleep(8000)])
  if (browser.exitCode === null) {
    browser.kill("SIGKILL")
    await browser.exited
  }
  const pids = [browser.pid, nativePIDs?.tapPid, nativePIDs?.hostPid].filter(Boolean)
  await Bun.sleep(500)
  const alive: number[] = []
  for (const pid of pids) {
    try {
      process.kill(pid, 0)
      alive.push(pid)
    } catch {}
  }
  if (alive.length) failures.push({ alive })
  for (const path of sourceFiles)
    if (hash(await readFile(new URL(`../${path}`, import.meta.url))) !== hashes[path])
      failures.push({ sourceChanged: path })
  for (const [path, expected] of [
    [preparation.productionManifest.path, preparation.productionManifest.sha256],
    [join(preparation.extension.path, "background.js"), preparation.extension.backgroundSha256],
    [join(preparation.extension.path, "manifest.json"), preparation.extension.manifestSha256],
  ])
    if (hash(await readFile(path)) !== expected) failures.push({ changed: path })
  const report = {
    passed: !failures.length && checks.every((c) => c.passed),
    checks,
    samples,
    invalidCaptures,
    failures,
    sourceHashes: hashes,
    preparation,
    actualDPRFlag: dpr,
    zoomMechanism:
      "chrome.tabs.setZoom + getZoom in test-only observer; visualViewport.scale=1 independently asserted; no raw CDP",
    counts: await counts(),
    cleanup: { pids, alive },
  }
  await writeFile(join(directory, "coordinate-report.json"), JSON.stringify(report, null, 2), { flag: "wx" })
  server.stop(true)
  foreign.stop(true)
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, samples: samples.length, directory }))
  if (!report.passed) process.exitCode = 1
}
function hash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}
function greenPixel(bytes: Uint8Array) {
  const png = Buffer.from(bytes),
    width = png.readUInt32BE(16),
    height = png.readUInt32BE(20)
  const channels = png[25] === 2 ? 3 : 4
  assert([2, 6].includes(png[25]!))
  assert.equal(png[24], 8)
  const chunks: Buffer[] = []
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset)
    if (png.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(png.subarray(offset + 8, offset + 8 + length))
    offset += length + 12
  }
  const stride = width * channels,
    data = inflateSync(Buffer.concat(chunks), { maxOutputLength: (stride + 1) * height })
  let previous = Buffer.alloc(stride),
    firstY = -1,
    minX = width,
    maxX = 0,
    maxY = 0
  for (let y = 0; y < height; y++) {
    const row = Buffer.from(data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))),
      filter = data[y * (stride + 1)]!
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels]! : 0,
        b = previous[i]!,
        c = i >= channels ? previous[i - channels]! : 0
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c)
      const predictor =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? Math.floor((a + b) / 2)
              : filter === 4
                ? pa <= pb && pa <= pc
                  ? a
                  : pb <= pc
                    ? b
                    : c
                : 0
      row[i] = (row[i]! + predictor) & 255
    }
    let found = false
    for (let x = 0; x < width; x++)
      if (row[x * channels] === 0 && row[x * channels + 1] === 192 && row[x * channels + 2] === 80) {
        if (firstY < 0) firstY = y
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        maxY = y
        found = true
      }
    if (!found && firstY >= 0) break
    previous = row
  }
  assert(firstY >= 0, "Green target missing from PNG")
  return { x: (minX + maxX) / 2, y: (firstY + maxY) / 2 }
}
