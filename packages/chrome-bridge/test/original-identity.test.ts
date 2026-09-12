import { afterEach, expect, test } from "bun:test"
import { PageDriver } from "../src/original-page"

// Real original caches and adapter routing, with an offline native transport.
const drivers: PageDriver[] = []
afterEach(() => {
  for (const driver of drivers.splice(0)) driver.dispose()
})

function fixture(name: string, contextId: number) {
  const calls: any[] = []
  const driver = new PageDriver(
    17,
    async <T>(method: string, params?: any): Promise<T> => {
      calls.push({ method, params })
      if (method === "getTabs") return [{ id: 17, title: name }, { id: 18 }] as T
      expect(method === "executeCdp" ? params.target.tabId : params.tabId).toBe(17)
      if (method !== "executeCdp") return {} as T
      switch (params.method) {
        case "Target.getTargets":
          return {
            targetInfos: [{ targetId: "own", tabId: 17 }, { targetId: "other", tabId: 18 }, { targetId: "opaque" }],
          } as T
        case "Target.getTargetInfo":
          return { targetInfo: { targetId: "own", tabId: 17 } } as T
        case "Page.getFrameTree":
          return {
            frameTree: { frame: { id: "same-frame", loaderId: "same-loader", url: "https://fixture.invalid" } },
          } as T
        case "Page.createIsolatedWorld":
          return { executionContextId: contextId } as T
        case "Runtime.evaluate":
          if (params.commandParams.returnByValue === false) {
            expect(params.commandParams.contextId).toBe(contextId)
            expect(params.commandParams.expression).toContain(`get("${name}-local")`)
            return { result: { objectId: name } } as T
          }
          return {
            result: {
              value: {
                items: [{ ref: `${name}-local`, line: `<input node_id=${name}-local />` }],
                viewport: { left: 0, top: 0, right: 100, bottom: 100 },
                frameElements: [],
              },
            },
          } as T
        case "DOM.describeNode":
          expect(params.commandParams.objectId).toBe(name)
          return { node: { backendNodeId: contextId } } as T
        default:
          return {} as T
      }
    },
    { browserId: name, getCurrentSessionId: () => name, getCurrentTurnId: () => "turn" },
  )
  drivers.push(driver)
  return { driver, calls, id: (driver as any).tabId as number, engine: (driver as any).engine }
}

test("two native browsers with tab 17 have isolated original DOM refs and world caches", async () => {
  const a = fixture("browser-A", 101)
  const b = fixture("browser-B", 202)
  expect(a.id).not.toBe(b.id)
  expect(Number.isSafeInteger(a.id)).toBe(true)
  expect(a.id).toBeGreaterThanOrEqual(1e12)
  for (const f of [a, b]) {
    const dom = await f.engine.execute("dom_cua_get_visible_dom", { tab_id: String(f.id) })
    expect(dom).toBe("<input node_id=1 />")
    f.engine.context.playwright.withPlaywrightNode = async (node: any) => node
  }
  const resolve = (f: typeof a) => f.engine.input({ tab_id: String(f.id), node_id: "1", value: "Enter" }, "press")
  expect((await resolve(a)).backendNodeId).toBe(101)
  expect((await resolve(b)).backendNodeId).toBe(202)
  await b.driver.cleanup()
  expect((await resolve(a)).backendNodeId).toBe(101)
  expect(a.calls.filter((x) => x.params?.method === "Page.createIsolatedWorld")).toHaveLength(1)
  await a.driver.cleanup()
})

test("native routing translates only owned roots, not opaque values or CDP arguments", async () => {
  const f = fixture("routing", 303)
  const api = f.engine.context.api
  expect(await api.getTabs()).toEqual([{ id: f.id, title: "routing" }])
  expect(api.getCurrentSessionId()).toBe("routing")
  expect(api.getCurrentTurnId()).toBe("turn")
  await api.attach(f.id)
  await api.detach(f.id)
  await api.attachTarget(f.id, "opaque-target")
  await api.detachTarget(f.id, "opaque-target")
  await api.moveMouse({ tabId: f.id, x: f.id, y: 5 })
  const params = {
    target: { tabId: f.id, sessionId: "opaque-session", targetId: "opaque-target" },
    method: "Input.dispatchMouseEvent",
    commandParams: { x: f.id, tabId: f.id },
  }
  await api.executeCdp(params)
  await api.executeCdpWithCachedExpression(params, "opaque-cache-key")
  expect(params.target.tabId).toBe(f.id)
  expect(f.calls.at(-1).params).toEqual({ ...params, target: { ...params.target, tabId: 17 } })
  expect(f.calls.find((x) => x.method === "moveMouse").params).toEqual({ tabId: 17, x: f.id, y: 5 })
  const before = f.calls.length
  await expect(api.executeCdp({ ...params, target: { tabId: 17 } })).rejects.toMatchObject({ code: "stale_handle" })
  await expect(api.attachTarget(f.id + 1, "opaque-target")).rejects.toMatchObject({ code: "stale_handle" })
  expect(f.calls.length).toBe(before)
  expect((await api.executeCdp({ target: { tabId: f.id }, method: "Target.getTargets" })).targetInfos).toEqual([
    { targetId: "own", tabId: f.id },
    { targetId: "opaque" },
  ])
  expect((await api.executeCdp({ target: { tabId: f.id }, method: "Target.getTargetInfo" })).targetInfo.tabId).toBe(
    f.id,
  )
})

test("notifications bind native roots and known rootless sessions without mutating payloads", () => {
  const f = fixture("events", 404)
  const events: any[] = []
  f.engine.context.api.addEventListener("onCDPEvent", (event: any) => events.push(event))
  f.engine.context.api.addEventListener("onCDPDetach", (event: any) => events.push(event))
  const event = {
    source: { tabId: 17, sessionId: "opaque-session" },
    method: "Page.screencastFrame",
    params: { sessionId: 17, data: "unchanged" },
  }
  f.driver.notification("onCDPEvent", event)
  expect(events[0]).toEqual({ ...event, source: { ...event.source, tabId: f.id } })
  expect(event.source.tabId).toBe(17)
  f.driver.notification("onCDPEvent", { ...event, source: { tabId: 18 } })
  f.driver.notification("onCDPEvent", { ...event, source: { sessionId: "unknown" } })
  expect(events).toHaveLength(1)
  f.engine.context.cdp.frameSessionsBySessionId.set("known", { target: { tabId: f.id } })
  f.driver.notification("onCDPEvent", { ...event, source: { sessionId: "known" } })
  expect(events.at(-1).source).toEqual({ sessionId: "known", tabId: f.id })
  f.driver.notification("onCDPEvent", {
    source: { tabId: 17 },
    method: "Target.targetInfoChanged",
    params: { targetInfo: { tabId: 17, targetId: "opaque" } },
  })
  expect(events.at(-1).params.targetInfo).toEqual({ tabId: f.id, targetId: "opaque" })
  f.driver.invalidate()
  expect(events.at(-1)).toEqual({ tabId: f.id })
})
