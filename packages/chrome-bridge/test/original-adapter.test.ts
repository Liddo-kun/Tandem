import { afterEach, test, expect } from "bun:test"
import { PageDriver } from "../src/original-page"
import { createBrowserEngine } from "../vendor/original/browser-service.mjs"
import { runInNewContext } from "node:vm"

// Instance-local seams only: these check source routing, not browser usability.
const disposables: { dispose(): void }[] = []
afterEach(() => {
  for (const value of disposables.splice(0)) value.dispose()
})

test("ref bridge preserves original frame and node binding without re-querying a selector", async () => {
  const target = { tabId: 17, sessionId: "oopif" }
  const calls: any[] = []
  const context = {
    cdp: {
      callTarget: async (actual: any, method: string, params: any) => {
        expect(actual).toBe(target)
        expect(method).toBe("DOM.describeNode")
        expect(params.objectId).toBe("dom-world-node")
        return { node: { backendNodeId: 71 } }
      },
    },
    playwright: {
      releaseRuntimeObjects: async (...args: any[]) => {
        calls.push(args)
      },
      withPlaywrightNode: async (node: any, run: any) => {
        expect(node.backendNodeId).toBe(71)
        expect(node.frameId).toBe("frame")
        expect(node.target).toBe(target)
        return run("playwright-world-node", 42)
      },
    },
  }
  const source = await Bun.file(new URL("../src/original-exports.js", import.meta.url)).text()
  const factory = runInNewContext(source.replace("export function", "function") + "\ncreateBrowserEngine", {
    Km: function () {
      return context
    },
    hr: "jpeg",
    _M: {},
    CM: {},
    J2: {},
    H: Number,
    Yp: (value: string) => value,
    TI: (tab: number, ref: string) => {
      expect(tab).toBe(17)
      expect(ref).toBe("9")
      return { target, frameId: "frame", loaderId: "loader", localRef: "local" }
    },
    nu: async (_cdp: any, actual: any, frame: string, loader: string, expression: string, options: any) => {
      expect(actual).toBe(target)
      expect(frame).toBe("frame")
      expect(loader).toBe("loader")
      expect(expression).toContain('get("local")')
      expect(options.returnByValue).toBe(false)
      return { result: { objectId: "dom-world-node" } }
    },
    cu: async (params: any, ctx: any) => {
      const binding = ctx.playwright.boundSelector
      expect(binding.objectId).toBe("playwright-world-node")
      expect(binding.executionContextId).toBe(42)
      expect(binding.target).toBe(target)
      expect(binding.selector).toBe(params.selector)
      return { pressed: true }
    },
  })
  const engine = factory({}, "offline", {}, {}, {})
  expect(await engine.input({ tab_id: "17", node_id: "9", value: "Enter" }, "press")).toEqual({ pressed: true })
  expect(calls).toEqual([[target, ["dom-world-node"], {}]])
})

test("driver routes targeted input, rejects changed coordinate viewport, and cleans once", async () => {
  const driver = new PageDriver(17, async () => {
    throw new Error("No browser RPC permitted")
  })
  disposables.push(driver)
  const internal = driver as any
  const page = {
    documentId: "doc",
    origin: "https://fixture.invalid",
    viewport: { width: 100, height: 100 },
    viewToken: "view",
  }
  internal.metadata = async () => page
  internal.views.set("view", { ...page, viewport: { width: 101, height: 100 } })
  await expect(driver.click({ x: 1, y: 1, viewToken: "view" }, page as any)).rejects.toMatchObject({
    code: "view_expired",
  })
  const calls: any[] = []
  internal.engine.input = async (...args: any[]) => calls.push(args)
  await driver.type({ target: "9", text: "", mode: "replace" }, page as any)
  await driver.key({ target: "9", key: "Enter" }, page as any)
  expect(calls).toEqual([
    [{ tab_id: String(internal.tabId), node_id: "9", selector: undefined, value: "", replace: true }, "fill"],
    [{ tab_id: String(internal.tabId), node_id: "9", selector: undefined, value: "Enter" }, "press"],
  ])
  let cleaned = 0
  internal.engine.cleanup = async () => {
    cleaned++
  }
  await Promise.all([driver.cleanup(), driver.cleanup()])
  expect(cleaned).toBe(1)
  expect(internal.listeners.size).toBe(0)
  expect(internal.disposed).toBe(true)
})

test.each([false, true])("capture adapter maps decoded pixels and reports viewport drift: %s", async (changed) => {
  const driver = new PageDriver(17, async () => {
    throw new Error("No browser RPC permitted")
  })
  disposables.push(driver)
  const internal = driver as any
  const page = {
    documentId: "doc",
    origin: "https://fixture.invalid",
    viewToken: "view",
    viewport: {
      width: 800,
      height: 600,
      offsetX: 20,
      offsetY: 30,
      scale: 1,
      deviceScale: 1,
      browserZoom: 1,
      scrollX: 0,
      scrollY: 0,
      transform: "none",
    },
  }
  let reads = 0
  internal.metadata = async () =>
    ++reads === 2 && changed ? { ...page, viewport: { ...page.viewport, width: 700 } } : page
  internal.engine.execute = async (command: string, params: any) => {
    expect(command).toBe("tab_screenshot")
    expect(params).toEqual({ tab_id: String(internal.tabId) })
    return { data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }
  }
  const image = await driver.screenshot(page as any)
  expect(image.bytes).toBeInstanceOf(Uint8Array)
  expect(image).toMatchObject({
    width: 1,
    height: 1,
    mime: "image/png",
    viewToken: "view",
    viewValid: !changed,
    mapping: { scaleX: 800, scaleY: 600, offsetX: 20, offsetY: 30 },
  })
  expect(image.viewport).toBe(page.viewport)
})

test("inspection budget reaches the original engine and Chromium evaluation timeout", async () => {
  const driver = new PageDriver(17, async () => {
    throw new Error("No browser RPC permitted")
  })
  disposables.push(driver)
  const internal = driver as any
  const page = { documentId: "doc", origin: "https://fixture.invalid" }
  internal.metadata = async () => page
  const pw = internal.engine.context.playwright
  pw.ensurePlaywrightInjectedInTarget = async () => {}
  let evaluated = false
  pw.callRuntimeEvaluateInExecutionTarget = async (_target: any, params: any, options: any) => {
    // Shopee's real snapshot exceeded the original 3000 ms default.
    expect(params.timeout).toBe(10_000)
    expect(options.timeoutMs).toBe(10_000)
    evaluated = true
    return { result: { value: { full: "Catalog snapshot", iframeRefs: [], iframeDepths: {} } } }
  }
  internal.engine.context.cdp.call = async () => ({ result: { value: "Catalog" } })
  const execute = internal.engine.execute.bind(internal.engine)
  internal.engine.execute = async (type: string, params: any) => {
    if (type !== "dom_cua_get_visible_dom") return execute(type, params)
    expect(params.timeout_ms).toBe(10_000)
    expect(params.max).toBe(10_000)
    return '<button node_id=1>Browse</button>'
  }
  const result = await driver.inspect(page as any)
  expect(evaluated).toBe(true)
  expect(result.text).toContain("Catalog snapshot")
  expect(result.elements[0]?.label).toBe("Browse")
})

test("original fill uses bound node; append moves to end and empty replace dispatches deletion", async () => {
  const memory = { async get() {}, async set() {}, async update() {} }
  const engine = createBrowserEngine(
    { addEventListener() {}, addCloseListener: () => () => {}, getCurrentSessionId: () => "offline" },
    "offline",
    { type: "extension" },
    { platform: "linux", env: {} },
    { global: memory, session: () => memory },
  )
  disposables.push(engine)
  const pw = engine.context.playwright
  let end = 0
  const node = {
    value: "first\nlast",
    selectionStart: 2,
    isContentEditable: false,
    scrollIntoView() {},
    setSelectionRange(start: number, stop: number) {
      expect(start).toBe(stop)
      end = stop
    },
    matches: () => true,
  }
  const injected = {
    retarget: () => node,
    elementState: () => ({ matches: true }),
    focusNode: () => "done",
    fill: (_: any, value: string) => (value === "" ? "needsinput" : "done"),
  }
  pw.withBoundPlaywrightSelector = async (_tab: any, _selector: any, check: any, run: any) => {
    expect(await check()).toBe(true)
    return run(pw)
  }
  pw.evaluateOnPlaywrightSelectorWithTarget = async (_tab: any, _selector: any, fn: any, options: any = {}) => ({
    executionContextId: 33,
    target: { tabId: 17, sessionId: "child" },
    result: await fn(node, injected, options.arg),
  })
  engine.context.clipboard.ensurePageClipboard = async () => {}
  const events: any[] = []
  engine.context.cdp.callTarget = async (target: any, method: string, params: any) => {
    events.push({ target, method, params })
    return { result: { value: { ok: true, data: {} } } }
  }
  await engine.input({ tab_id: "17", selector: "input", value: "suffix", replace: false }, "fill")
  expect(end).toBe(node.value.length)
  const paste = events.find((x) => x.method === "Runtime.evaluate")
  expect(paste.target.sessionId).toBe("child")
  expect(paste.params.contextId).toBe(33)
  events.length = 0
  await engine.input({ tab_id: "17", selector: "input", value: "", replace: true }, "fill")
  expect(events.some((x) => x.method === "Input.dispatchKeyEvent" && x.params.key === "Backspace")).toBe(true)
  expect(events.filter((x) => x.method === "Input.dispatchKeyEvent").every((x) => x.target.sessionId === "child")).toBe(
    true,
  )
  engine.context.cdp.readDocumentState = async () => {
    throw new Error("navigation entered")
  }
  await expect(engine.execute("navigate_tab_url", { tab_id: "17", url: "https://fixture.invalid" })).rejects.toThrow(
    "navigation entered",
  )
  const lifecycle: string[] = []
  engine.context.clipboard.cleanupPageClipboards = async () => {
    lifecycle.push("clipboard")
  }
  engine.context.cdp.detachTab = async (tab: number) => {
    expect(tab).toBe(17)
    lifecycle.push("detach")
  }
  await engine.cleanup(17)
  expect(lifecycle).toEqual(["clipboard", "detach"])
  engine.dispose()
  expect(Object.values(engine.context.cdp.listeners).every((listeners: any) => listeners.length === 0)).toBe(true)
})
