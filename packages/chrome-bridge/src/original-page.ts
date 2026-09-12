import { randomUUID } from "node:crypto"
import { createBrowserEngine } from "../vendor/original/browser-service.mjs"
import { BrowserError } from "./errors"
import { PageError, decodePNG, type PageMetadata, type PageInspection, type PageScreenshot } from "./page"

type NativeCall = <T>(method: string, params?: Record<string, unknown>) => Promise<T>
export type LocatorRead = "innerText" | "textContent" | "getAttribute" | "count" | "isVisible" | "isEnabled"
export type LocatorReadInput = { selector: string; read: LocatorRead; attribute?: string }
export type MouseOptions = {
  button?: "left" | "middle" | "right"
  modifiers?: readonly ("Alt" | "Control" | "ControlOrMeta" | "Meta" | "Shift")[]
}
export type MousePoint = { x: number; y: number }
type DriverOptions = {
  getCurrentSessionId?: () => string | undefined
  getCurrentTurnId?: () => string | undefined
  browserId?: string
  platform?: string
}

// Original DOM caches are module-global and keyed by numeric tab ID, not browser.
let nextTabId = 1_000_000_000_000

// The original engine owns DOM snapshots, live node references, Playwright
// locators, input and capture. This file only adapts Tandem's transport/results.
export class PageDriver {
  private readonly tabId = nextTabId++
  private listeners = new Map<string, Set<(value: any) => void>>()
  private engine: ReturnType<typeof createBrowserEngine>
  private views = new Map<string, PageMetadata>()
  private disposed = false
  private cleanupPromise?: Promise<void>

  constructor(private readonly nativeTabId: number, native: NativeCall, options: DriverOptions = {}) {
    if (!Number.isSafeInteger(this.tabId) || !Number.isSafeInteger(nativeTabId) || nativeTabId <= 0)
      throw new PageError("unsupported", "Invalid page driver tab identity")
    const request: NativeCall = async <T>(method: string, params?: Record<string, unknown>): Promise<T> => {
      if (this.disposed) throw new PageError("stale_handle", "Page driver is disposed")
      if (method === "getTabs") {
        const tabs = await native<{ id: number; [key: string]: unknown }[]>(method)
        return tabs.filter((tab) => tab.id === this.nativeTabId)
          .map((tab) => ({ ...tab, id: this.tabId })) as T
      }
      // Only transport routing fields are identities; never rewrite CDP arguments.
      const root = method === "executeCdp" ? params?.target : params
      if (!root || typeof root !== "object" || !("tabId" in root) || root.tabId !== this.tabId)
        throw new PageError("stale_handle", "Native request does not belong to this page driver")
      const result = await native<any>(method, method === "executeCdp"
        ? { ...params, target: { ...root, tabId: this.nativeTabId } }
        : { ...params, tabId: this.nativeTabId }).catch((error) => {
          // Original executeTargetCdp matches a string, not Error.message, and
          // retries once only after the extension rejected an unattached command.
          if (method === "executeCdp" && error instanceof BrowserError &&
            error.code === "debugger_unattached" && error.outcome === "confirmed") throw "Debugger unattached"
          throw error
        })
      // The extension can annotate CDP TargetInfo with its native root tab ID.
      if (method === "executeCdp" && params?.method === "Target.getTargets")
        return { ...result, targetInfos: result.targetInfos
          .filter((info: any) => info.tabId == null || info.tabId === this.nativeTabId)
          .map((info: any) => info.tabId == null ? info : { ...info, tabId: this.tabId }) } as T
      if (method === "executeCdp" && params?.method === "Target.getTargetInfo" && result.targetInfo?.tabId != null) {
        if (result.targetInfo.tabId !== this.nativeTabId)
          throw new PageError("stale_handle", "Native target does not belong to this page driver")
        return { ...result, targetInfo: { ...result.targetInfo, tabId: this.tabId } } as T
      }
      return result as T
    }
    const memory = { async get() {}, async set() {}, async update() {} }
    const api = {
      addEventListener: (name: string, listener: (value: any) => void) => {
        const set = this.listeners.get(name) ?? new Set()
        set.add(listener)
        this.listeners.set(name, set)
        return () => set.delete(listener)
      },
      addCloseListener: () => () => {},
      attach: (tabId: number) => request("attach", { tabId }),
      detach: (tabId: number) => request("detach", { tabId }),
      attachTarget: (tabId: number, targetId: string) => request("attachTarget", { tabId, targetId }),
      detachTarget: (tabId: number, targetId: string) => request("detachTarget", { tabId, targetId }),
      executeCdp: (params: Record<string, unknown>) => request("executeCdp", params),
      executeCdpWithCachedExpression: (params: Record<string, unknown>) => request("executeCdp", params),
      moveMouse: (params: Record<string, unknown>) => request("moveMouse", params),
      getTabs: () => request("getTabs"),
      getCurrentSessionId: options.getCurrentSessionId ?? (() => "tandem-adapter"),
      getCurrentTurnId: options.getCurrentTurnId ?? (() => undefined),
    }
    this.engine = createBrowserEngine(api, options.browserId ?? "tandem", { type: "extension", family: "chrome" }, {
      platform: options.platform ?? "linux",
      env: {},
      // No Codex network policy, telemetry, authentication, or model requests.
      async fetch() { throw new Error("Original engine host-network services are not enabled") },
    }, {
      global: memory,
      session: () => memory,
      async readAll() { return { config: {} } },
      async readRequirements() { return { requirements: {} } },
    })
  }

  notification(method: string, params: unknown) {
    if (this.disposed) return
    if (method === "onCDPEvent" || method === "onCDPDetach") {
      if (!params || typeof params !== "object") return
      const event = params as Record<string, unknown>
      const source = method === "onCDPEvent" ? event.source : event
      if (!source || typeof source !== "object") return
      const root = source as Record<string, unknown>
      if (root.tabId != null) {
        if (root.tabId !== this.nativeTabId) return
      } else if (this.engine.context.cdp.attachedTabIdForCdpEvent(root) !== this.tabId) {
        // Rootless OOPIF events are accepted only for an already known session/target.
        return
      }
      params = method === "onCDPEvent"
        ? { ...event, source: { ...root, tabId: this.tabId } }
        : { ...event, tabId: this.tabId }
      if (method === "onCDPEvent" && typeof event.method === "string" && event.method.startsWith("Target.")) {
        const data = event.params as { targetInfo?: { tabId?: number } } | undefined
        if (data?.targetInfo?.tabId != null) {
          if (data.targetInfo.tabId !== this.nativeTabId) return
          params = { ...params as object, params: { ...data, targetInfo: { ...data.targetInfo, tabId: this.tabId } } }
        }
      }
    }
    for (const listener of this.listeners.get(method) ?? []) listener(params)
  }

  invalidate() {
    this.views.clear()
    this.notification("onCDPDetach", { tabId: this.nativeTabId })
  }

  // Await while the host still holds the lease and allows maintenance RPCs.
  cleanup(): Promise<void> {
    return this.cleanupPromise ??= this.engine.cleanup(this.tabId).then(() => this.dispose())
  }

  // Local-only disposal cannot restore page scripts; use cleanup before handoff.
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.engine.dispose()
    this.listeners.clear()
    this.views.clear()
  }

  private command(type: string, params: Record<string, unknown> = {}) {
    return this.engine.execute(type, { ...params, tab_id: String(this.tabId) })
  }

  async metadata(frameId?: string): Promise<PageMetadata> {
    if (this.disposed || this.cleanupPromise) throw new PageError("stale_handle", "Page driver is closing or disposed")
    const cdp = this.engine.context.cdp
    const { frameTree } = await cdp.call(this.tabId, "Page.getFrameTree")
    if (frameId && frameId !== frameTree.frame.id)
      throw new PageError("unsupported_frame_selection", "Inspect the page; the original snapshot includes embedded frames")
    const { cssVisualViewport: layout } = await cdp.call(this.tabId, "Page.getLayoutMetrics")
    const result = await cdp.call(this.tabId, "Runtime.evaluate", {
      expression: "({url:location.href,title:document.title,dpr:devicePixelRatio,scrollX,scrollY,width:innerWidth,height:innerHeight,ready:document.readyState})",
      returnByValue: true,
    })
    const value = result.result.value
    const frames: PageMetadata["frames"] = []
    const visit = (node: any) => {
      frames.push({ id: node.frame.id, parentId: node.frame.parentId, documentId: node.frame.loaderId,
        url: node.frame.url, origin: URL.canParse(node.frame.url) ? new URL(node.frame.url).origin : "null", supported: node.frame.id === frameTree.frame.id })
      for (const child of node.childFrames ?? []) visit(child)
    }
    visit(frameTree)
    const page: PageMetadata = {
      url: value.url, origin: new URL(value.url).origin,
      documentId: frameTree.frame.loaderId, revision: 0,
      frameId: frameTree.frame.id, topFrameId: frameTree.frame.id, frames,
      viewport: { width: layout.clientWidth, height: layout.clientHeight, offsetX: layout.offsetX ?? 0,
        offsetY: layout.offsetY ?? 0, scale: layout.scale ?? 1, deviceScale: value.dpr,
        browserZoom: layout.zoom ?? 1, scrollX: value.scrollX, scrollY: value.scrollY, transform: "none" },
      viewToken: randomUUID(),
    }
    this.views.set(page.viewToken, page)
    while (this.views.size > 32) this.views.delete(this.views.keys().next().value!)
    return page
  }

  private async check(expected: PageMetadata) {
    const current = await this.metadata()
    if (current.documentId !== expected.documentId || current.origin !== expected.origin)
      throw new PageError("document_changed", "The document navigated; inspect before acting. The browser is still connected")
    return current
  }

  async inspect(expected: PageMetadata, detail: "visible" | "page" = "visible"): Promise<PageInspection> {
    await this.check(expected)
    // Original visible DOM already bounds itself to 20,000 characters/200 nodes.
    // Full semantic page content is a separate, explicitly requested observation.
    const snapshot = detail === "page"
      ? await this.command("playwright_dom_snapshot")
      : undefined
    const dom: string = detail === "visible"
      ? await this.command("dom_cua_get_visible_dom")
      : ""
    await this.check(expected)
    const title = await this.engine.context.cdp.call(this.tabId, "Runtime.evaluate", {expression:"document.title",returnByValue:true})
    const elements = Array.from(dom.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bnode_id=(\d+)[^>]*)>([^<]*)/g), match => ({
      ref: match[3]!, nodeId: match[3]!, tag: match[1]!, role: "", label: match[4]!.trim() || match[2]!.replace(/\bnode_id=\d+\s*/, "").trim(), type: "",
      disabled: /\bdisabled\b/.test(match[2]!), checked: /\bchecked\b/.test(match[2]!),
    }))
    const text = snapshot ? "Page content (semantic snapshot):\n" + snapshot.dom_snapshot
      : "Visible controls (viewport):\n" + dom
    return { ...expected, title: title.result.value, text, elements, truncated: false }
  }

  async read(input: LocatorReadInput, expected: PageMetadata): Promise<string | number | boolean | null> {
    const commands = {
      innerText: "playwright_locator_inner_text",
      textContent: "playwright_locator_text_content",
      getAttribute: "playwright_locator_get_attribute",
      count: "playwright_locator_count",
      isVisible: "playwright_locator_is_visible",
      isEnabled: "playwright_locator_is_enabled",
    }
    if (!Object.hasOwn(commands, input.read) || !input.selector || input.selector.length > 4096 ||
      (input.read === "getAttribute" ? !input.attribute || input.attribute.length > 256 : input.attribute !== undefined))
      throw new PageError("unsupported", "Read requires a selector, supported read kind, and attribute only for getAttribute")
    await this.check(expected)
    const result = await this.command(commands[input.read], {
      selector: input.selector,
      ...(input.read === "getAttribute" ? { name: input.attribute } : {}),
    })
    await this.check(expected)
    return input.read === "count" ? result.count : result.value
  }

  async navigate(url: string, expected: PageMetadata) {
    await this.check(expected)
    await this.command("navigate_tab_url", { url })
    this.views.clear()
    return this.metadata()
  }

  async click(input: { target?: string; selector?: string; x?: number; y?: number; viewToken?: string } & MouseOptions, expected: PageMetadata, clickCount: 1 | 2 = 1) {
    if (input.target && (input.button !== undefined || input.modifiers !== undefined) ||
      clickCount === 2 && !input.selector && input.button !== undefined)
      throw new PageError("unsupported", "Original ref clicks have no mouse options; coordinate double-click is left-button only")
    const current = await this.check(expected)
    if (input.selector) return this.command(clickCount === 2 ? "playwright_locator_dblclick" : "playwright_locator_click", {
      selector: input.selector, button: input.button, modifiers: input.modifiers,
    })
    if (input.target) return this.command(clickCount === 2 ? "dom_cua_double_click" : "dom_cua_click", { node_id: input.target })
    if (input.x === undefined || input.y === undefined) throw new PageError("unsupported", "Coordinate click requires x and y")
    this.view(input.viewToken, current, [{ x: input.x, y: input.y }])
    return this.command(clickCount === 2 ? "cua_double_click" : "cua_click", {
      x: input.x, y: input.y, keys: input.modifiers,
      ...(input.button === undefined ? {} : { button: { left: 1, middle: 2, right: 3 }[input.button] }),
    })
  }

  async move(input: MousePoint & { viewToken: string; modifiers?: MouseOptions["modifiers"] }, expected: PageMetadata) {
    const current = await this.check(expected)
    this.view(input.viewToken, current, [input])
    return this.command("cua_move", { x: input.x, y: input.y, keys: input.modifiers })
  }

  async drag(input: { path: readonly MousePoint[]; viewToken: string; modifiers?: MouseOptions["modifiers"] }, expected: PageMetadata) {
    if (!Array.isArray(input.path) || input.path.length < 1 || input.path.length > 256)
      throw new PageError("unsupported", "Drag requires 1-256 viewport points")
    const current = await this.check(expected)
    this.view(input.viewToken, current, input.path)
    return this.command("cua_drag", { path: input.path, keys: input.modifiers })
  }

  async type(input: { target?: string; selector?: string; text: string; mode?: "replace" | "append" }, expected: PageMetadata) {
    await this.check(expected)
    if (!input.target && !input.selector) {
      if (input.mode !== undefined) throw new PageError("unsupported", "Focused typing does not accept mode")
      return this.command("dom_cua_type", { text: input.text })
    }
    if (input.mode !== "replace" && input.mode !== "append") throw new PageError("unsupported", "Targeted typing requires replace or append")
    return this.engine.input({ tab_id: String(this.tabId), node_id: input.target, selector: input.selector,
      value: input.text, replace: input.mode === "replace" }, "fill")
  }

  async key(input: { target?: string; selector?: string; key: string; modifiers?: "Shift"[] }, expected: PageMetadata) {
    await this.check(expected)
    const value = [...input.modifiers ?? [], input.key].join("+")
    if (input.selector || input.target) return this.engine.input({ tab_id: String(this.tabId),
      selector: input.selector, node_id: input.target, value }, "press")
    return this.command("dom_cua_keypress", { keys: [value] })
  }

  private view(token: string | undefined, expected: PageMetadata, points: readonly MousePoint[] = []) {
    const saved = token && this.views.get(token)
    if (!saved || saved.documentId !== expected.documentId || saved.origin !== expected.origin ||
      JSON.stringify(saved.viewport) !== JSON.stringify(expected.viewport))
      throw new PageError("view_expired", "Inspect or capture the current document before coordinate input")
    const v = expected.viewport
    if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < v.offsetX || point.y < v.offsetY || point.x >= v.offsetX + v.width || point.y >= v.offsetY + v.height))
      throw new PageError("unsupported", "Mouse points must be finite and within the observed viewport")
  }

  async scroll(input: { deltaX: number; deltaY: number; x?: number; y?: number; viewToken: string }, expected: PageMetadata) {
    const current = await this.check(expected)
    this.view(input.viewToken, current)
    return this.engine.context.cua.scrollPoint({ tabId: this.tabId, modifiers: 0,
      point: {x: input.x ?? expected.viewport.width / 2, y: input.y ?? expected.viewport.height / 2},
      scrollX: input.deltaX, scrollY: input.deltaY })
  }

  async screenshot(expected: PageMetadata): Promise<PageScreenshot> {
    await this.check(expected)
    const capture = await this.command("tab_screenshot")
    const { bytes, width, height } = decodePNG(capture.data)
    const after = await this.check(expected)
    const v = expected.viewport
    return { bytes, mime: "image/png", width, height, viewport: v, viewToken: expected.viewToken,
      viewValid: JSON.stringify(v) === JSON.stringify(after.viewport),
      mapping: {scaleX:v.width/width,scaleY:v.height/height,offsetX:v.offsetX,offsetY:v.offsetY} }
  }
}
