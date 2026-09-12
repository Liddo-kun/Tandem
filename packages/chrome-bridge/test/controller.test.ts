import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  BrowserController,
  BrowserError,
  CONTROLLER_LIMITS,
  type Authorize,
  type AuthorizationRequest,
  type BrowserTurn,
} from "../src/controller"
import { EXTENSION_ORIGIN } from "../src/client"
import { RpcPeer, MAX_READ_BYTES, MAX_WRITE_BYTES } from "../src/native"

type Call = { method: string; params: any }
const fixtures: Fixture[] = []
const controllers: BrowserController[] = []
const relays: (() => void)[] = []
function snapshot(call: Call) {
  return (
    call.params?.method === "Runtime.evaluate" &&
    call.params.commandParams.expression.includes("incrementalAriaSnapshot") &&
    call.params.commandParams.expression.length < 10000
  )
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function waitFor(check: () => boolean, timeout = 2500) {
  const deadline = Date.now() + timeout
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Fixture condition timed out")
    await Bun.sleep(5)
  }
}

class Fixture {
  calls: Call[] = []
  tabs = new Map<
    number,
    { id: number; url: string; title: string; attached: boolean; agent: boolean; session?: string }
  >([
    [1, { id: 1, url: "https://fixture.test/one", title: "One", attached: false, agent: false }],
    [2, { id: 2, url: "https://fixture.test/two", title: "Two", attached: false, agent: false }],
  ])
  next = 10
  peer: RpcPeer
  hook?: (call: Call) => Promise<unknown> | undefined
  exit: Promise<unknown>
  private constructor(
    readonly directory: string,
    readonly child: ChildProcessWithoutNullStreams,
  ) {
    child.stderr.resume()
    this.exit = new Promise((resolve) => child.once("exit", resolve))
    this.peer = new RpcPeer(child.stdout, child.stdin, {
      maxRead: MAX_WRITE_BYTES,
      maxWrite: MAX_READ_BYTES,
      onRequest: async (method, params) => {
        const call = { method, params }
        this.calls.push(call)
        const hooked = this.hook?.(call)
        if (hooked) return hooked
        return this.reply(call)
      },
    })
  }
  static async start() {
    await mkdir("/tmp/tandem/chrome-controller-tests", { recursive: true, mode: 0o700 })
    const directory = await mkdtemp("/tmp/tandem/chrome-controller-tests/run-")
    await chmod(directory, 0o700)
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../src/host.ts", import.meta.url)), EXTENSION_ORIGIN],
      {
        cwd: directory,
        env: { HOME: directory, LANG: "C.UTF-8", TANDEM_CHROME_BRIDGE_RUN_DIR: directory, TMPDIR: directory },
        stdio: ["pipe", "pipe", "pipe"],
      },
    )
    const fixture = new Fixture(directory, child)
    fixtures.push(fixture)
    const deadline = Date.now() + 3000
    while (!(await readdir(directory)).some((name) => /^host-.*\.json$/.test(name))) {
      if (Date.now() > deadline) throw new Error("Host discovery timed out")
      await Bun.sleep(5)
    }
    return fixture
  }
  reply({ method, params }: Call): unknown {
    if (method === "getUserTabs" || method === "getTabs")
      return [...this.tabs.values()].map(({ id, url, title }) => ({ id, url, title }))
    if (method === "getInfo") return { version: "synthetic" }
    if (method === "createTab") {
      const tab = {
        id: this.next++,
        url: "about:blank",
        title: "Created",
        attached: false,
        agent: true,
        session: params.session_id,
      }
      this.tabs.set(tab.id, tab)
      return { id: tab.id }
    }
    if (method === "claimUserTab") {
      const tab = this.tabs.get(params.tabId)!
      if (tab.session && tab.session !== params.session_id) throw new Error("Fixture lease already owned")
      tab.session = params.session_id
      return { id: tab.id }
    }
    if (method === "attach") {
      const tab = this.tabs.get(params.tabId)!
      if (tab.session !== params.session_id) throw new Error("Attach requires an acquired lease")
      tab.attached = true
      tab.session = params.session_id
      return undefined
    }
    if (method === "turnEnded" || method === "finalizeTabs") {
      for (const tab of this.tabs.values()) {
        if (tab.session !== params.session_id) continue
        const keep = params.keep?.find((item: any) => item.tabId === tab.id)
        if (tab.agent && !keep) this.tabs.delete(tab.id)
        else {
          tab.attached = false
          if (keep?.status !== "handoff") tab.session = undefined
        }
      }
      return undefined
    }
    if (method === "detach") {
      this.tabs.get(params.tabId)!.attached = false
      return {}
    }
    if (method === "moveMouse") return {}
    if (method !== "executeCdp") throw new Error(`Unsupported fixture method: ${method}`)
    const command = params.method
    const args = params.commandParams
    if (command === "Target.getTargets")
      return {
        targetInfos: [...this.tabs.values()].map((tab) => ({
          id: `target-${tab.id}`,
          tabId: tab.id,
          attached: tab.attached,
          type: "page",
          url: tab.url,
        })),
      }
    const tab = this.tabs.get(params.target.tabId)!
    if (command === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: tab.url, url: tab.url } } }
    if (command === "Page.getLayoutMetrics")
      return { cssVisualViewport: { clientWidth: 800, clientHeight: 600, zoom: 1 } }
    if (command === "Page.createIsolatedWorld") return { executionContextId: tab.id }
    // Synthetic CDP return values exercise controller policy/transport only.
    // The injected scripts are not executed here; original-*.test.ts covers source seams.
    if (command === "Runtime.evaluate") {
      if (args.expression === "document.title") return { result: { value: tab.title } }
      if (args.expression.includes("readyState: document.readyState"))
        return { result: { value: { href: tab.url, readyState: "complete", painted: true } } }
      if (args.expression.includes("url:location.href"))
        return {
          result: { value: { url: tab.url, title: tab.title, dpr: 1, scrollX: 0, scrollY: 0, ready: "complete" } },
        }
      if (snapshot({ method, params }))
        return { result: { value: { full: "Fixture text", iframeRefs: [], iframeDepths: {} } } }
      if (args.expression.includes("__browserUseVisibleDomState"))
        return {
          result: {
            value: {
              items: [{ ref: "local", line: "<input node_id=local>Input</input>" }],
              viewport: { left: 0, top: 0, right: 800, bottom: 600 },
              frameElements: [],
            },
          },
        }
      if (args.expression.includes("__codexPlaywrightInjected")) return { result: { value: true } }
    }
    if (command === "Page.navigate") {
      tab.url = args.url
      return { frameId: "top", loaderId: tab.url }
    }
    if (
      [
        "Page.enable",
        "Runtime.enable",
        "Target.setAutoAttach",
        "Emulation.setFocusEmulationEnabled",
        "Fetch.enable",
        "Fetch.disable",
        "Input.dispatchMouseEvent",
      ].includes(command)
    )
      return {}
    throw new Error(`Unsupported fixture CDP method: ${command} ${JSON.stringify(args)?.slice(0, 200)}`)
  }
  async controller(authorize: Authorize = () => "allow", extra: Fixture[] = []) {
    const controller = await BrowserController.create({
      connections: [this, ...extra].map((fixture, i) => ({
        id: `browser-${i}`,
        label: `Fixture ${i}`,
        directory: fixture.directory,
      })),
      authorize,
    })
    controllers.push(controller)
    return controller
  }
  async turn(controller: BrowserController, caller = "session", browserId = "browser-0") {
    const session = await controller.openSession({ browserId, callerSessionId: caller })
    const turn = await session.beginTurn({ callerTurnId: "turn" })
    return { session, turn }
  }
  count(method: string) {
    return this.calls.filter((call) => call.method === method || call.params?.method === method).length
  }
  async stop() {
    this.peer.close()
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM")
    await Promise.race([this.exit, Bun.sleep(500)])
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL")
      await this.exit
    }
    await rm(this.directory, { recursive: true, force: true })
  }
}

afterEach(async () => {
  for (const close of relays.splice(0)) close()
  // Stop only subprocesses owned by this fixture, never a pattern-matched browser.
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()))
  await Promise.all(controllers.splice(0).map((controller) => controller.close()))
})

async function registrationRelay(fixture: Fixture, unknown = false) {
  const file = (await readdir(fixture.directory)).find((name) => /^host-.*\.json$/.test(name))!
  const discovery = JSON.parse(await readFile(join(fixture.directory, file), "utf8"))
  const directory = join(fixture.directory, "relay")
  await mkdir(directory, { mode: 0o700 })
  const entered = deferred<{ session_id: string; turn_id: string }>(),
    release = deferred()
  const peers: RpcPeer[] = []
  const server = createServer((socket) => {
    const wire = createConnection(join(fixture.directory, discovery.socket))
    let downstream: RpcPeer
    const upstream = new RpcPeer(wire, wire, {
      maxRead: MAX_READ_BYTES,
      maxWrite: MAX_WRITE_BYTES,
      onNotification: (method, params) => downstream.notify(method, params),
    })
    downstream = new RpcPeer(socket, socket, {
      maxRead: MAX_READ_BYTES,
      maxWrite: MAX_WRITE_BYTES,
      onRequest: async (method, params) => {
        const result = await upstream.request(method, params)
        if (method === "bridge.registerTurn") {
          entered.resolve(params as { session_id: string; turn_id: string })
          if (unknown) throw new BrowserError("disconnected", "registration", "unknown")
          await release.promise
        }
        return result
      },
    })
    peers.push(upstream, downstream)
  })
  await new Promise<void>((resolve) => server.listen(join(directory, discovery.socket), resolve))
  await chmod(join(directory, discovery.socket), 0o600)
  await writeFile(join(directory, file), JSON.stringify(discovery), { mode: 0o600 })
  relays.push(() => {
    release.resolve()
    for (const peer of peers) peer.close()
    server.close()
  })
  const controller = await BrowserController.create({
    connections: [{ id: "browser-0", label: "Relayed fixture", directory }],
    authorize: () => "allow",
  })
  controllers.push(controller)
  return { controller, entered, release }
}

async function claim(turn: BrowserTurn, index = 0) {
  return turn.claimTab((await turn.discoverTabs()).tabs[index]!.handle)
}
async function error(promise: Promise<unknown>, code: string, outcome?: string) {
  const result = await promise.then(
    () => undefined,
    (error) => error,
  )
  expect(result).toBeInstanceOf(BrowserError)
  expect(result.code).toBe(code)
  if (outcome) expect(result.outcome).toBe(outcome)
  if (!(result instanceof BrowserError)) throw new Error("Expected BrowserError")
  return result
}

describe("authorized controller with native host subprocess", () => {
  test("parallel invocations capture their own context across permission waits and reauthorization", async () => {
    const fixture = await Fixture.start()
    const first = {},
      second = {}
    const requests: AuthorizationRequest[] = []
    const entered = deferred(),
      permit = deferred<"allow">()
    const controller = await fixture.controller((request) => {
      requests.push(request)
      if (
        request.authorizationContext === first &&
        requests.filter((x) => x.authorizationContext === first).length === 1
      ) {
        entered.resolve()
        return permit.promise
      }
      return "allow"
    })
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    requests.length = 0
    const options = { authorizationContext: first }
    const pending = turn.inspect(tab, options)
    await entered.promise
    options.authorizationContext = second
    await turn.inspect(tab, { authorizationContext: second })
    permit.resolve("allow")
    await pending
    const a = requests.filter((x) => x.authorizationContext === first)
    expect(a.length).toBeGreaterThanOrEqual(2)
    expect(new Set(a.map((x) => x.operationId)).size).toBe(1)
    expect(requests.filter((x) => x.authorizationContext === second)).toHaveLength(1)
    expect(requests.every(Object.isFrozen)).toBe(true)
  })

  test("keep invocation contexts survive inheritance, failed resume, and retained session close without serialization", async () => {
    const fixture = await Fixture.start()
    const context = () => ({
      toJSON() {
        throw new Error("Host context must not be serialized")
      },
    })
    const first = context(),
      second = context(),
      execution = context(),
      resume = context()
    const requests: AuthorizationRequest[] = []
    const controller = await fixture.controller((request) => {
      requests.push(request)
      return request.authorizationContext === resume && request.capability === "claim" ? "deny" : "allow"
    })
    const { turn, session } = await fixture.turn(controller)
    const a = await turn.createTab({}, { authorizationContext: first })
    const b = await turn.createTab({}, { authorizationContext: second })
    requests.length = 0
    const keep = [
      { tab: a, status: "handoff" as const, authorizationContext: first },
      { tab: b, status: "handoff" as const, authorizationContext: second },
    ]
    const ending = turn.end({ keep, authorizationContext: execution })
    keep[0]!.authorizationContext = second
    expect(turn.end({ keep, authorizationContext: second })).toBe(ending)
    expect((await ending).confirmed).toBe(true)
    const next = await session.beginTurn({ callerTurnId: "next" })
    await error(next.resumeTabs({ authorizationContext: resume }), "permission_denied")
    expect((await next.end({ authorizationContext: execution })).confirmed).toBe(true)
    expect((await session.close()).confirmed).toBe(true)
    const handoffs = requests.filter((x) => x.capability === "handoff")
    expect(handoffs).toHaveLength(6)
    for (const [index, source] of [first, second, first, second, first, second].entries())
      expect(handoffs[index]!.authorizationContext).toBe(source)
    expect(
      requests
        .filter((x) => x.capability === "discovery" && x.authorizationContext !== resume)
        .every((x) => x.authorizationContext === execution),
    ).toBe(true)
    expect(requests.filter((x) => x.callerTurnId === "session-close")).toHaveLength(3)
    expect(JSON.stringify(fixture.calls)).not.toContain("authorizationContext")
    for (const name of (await readdir(fixture.directory)).filter((name) => /^journal-.*\.json$/.test(name)))
      expect(await readFile(join(fixture.directory, name), "utf8")).not.toContain("authorizationContext")
  })

  test("resumed keeps replace their source and local handle checks prune superseded and foreign observations", async () => {
    const fixture = await Fixture.start()
    const first = {},
      second = {},
      execution = {}
    const requests: AuthorizationRequest[] = []
    const controller = await fixture.controller((request) => {
      requests.push(request)
      return "allow"
    })
    const { turn, session } = await fixture.turn(controller)
    const other = await fixture.turn(controller, "other")
    const descriptor = (await turn.discoverTabs()).tabs[0]!.handle
    expect(turn.validHandle(descriptor)).toBe(true)
    expect(other.turn.validHandle(descriptor)).toBe(false)
    const tab = await turn.claimTab(descriptor)
    const page = await turn.inspect(tab)
    const handles = [tab, page.elements[0]!.ref, page.frames[0]!.handle, page.viewToken]
    const before = fixture.calls.length
    expect(handles.every((handle) => turn.validHandle(handle))).toBe(true)
    expect(handles.some((handle) => other.turn.validHandle(handle))).toBe(false)
    expect(turn.validHandle({ ...tab })).toBe(false)
    expect(fixture.calls).toHaveLength(before)
    await turn.inspect(tab)
    expect(handles.slice(1).some((handle) => turn.validHandle(handle))).toBe(false)
    expect(turn.validHandle(tab)).toBe(true)
    const ended = await turn.end({
      keep: [{ tab, status: "handoff", authorizationContext: first }],
      authorizationContext: execution,
    })
    expect(ended.confirmed).toBe(true)
    expect(turn.validHandle(tab)).toBe(false)
    expect(turn.validHandle(descriptor)).toBe(false)
    const next = await session.beginTurn({ callerTurnId: "next" })
    const [resumed] = await next.resumeTabs({ authorizationContext: second })
    expect(next.validHandle(tab)).toBe(false)
    expect(next.validHandle(resumed!)).toBe(true)
    await next.end({
      keep: [{ tab: resumed!, status: "handoff", authorizationContext: second }],
      authorizationContext: execution,
    })
    expect((await session.close()).confirmed).toBe(true)
    const handoffs = requests.filter((x) => x.capability === "handoff")
    expect(handoffs).toHaveLength(3)
    for (const [index, source] of [first, second, second].entries())
      expect(handoffs[index]!.authorizationContext).toBe(source)
  })

  test("top-frame and coordinate handles cannot adopt a same-URL document reload", async () => {
    const f = await Fixture.start()
    let loader = "before"
    f.hook = (call) => {
      if (call.params?.method !== "Page.getFrameTree") return
      const url = f.tabs.get(call.params.target.tabId)!.url
      return Promise.resolve({
        frameTree: {
          frame: { id: "top", loaderId: loader, url },
        },
      })
    }
    const controller = await f.controller()
    const { turn } = await f.turn(controller)
    const tab = await claim(turn)
    const page = await turn.inspect(tab)
    const frame = page.frames[0]!.handle
    loader = "after"
    const reads = () => f.calls.filter(snapshot).length
    const before = reads()
    await error(turn.inspect(tab, { frame }), "stale_handle")
    expect(reads()).toBe(before)
    await error(turn.click(tab, { x: 20, y: 20, view: page.viewToken }), "view_expired")
    await error(turn.scroll(tab, { deltaX: 0, deltaY: 100, view: page.viewToken }), "view_expired")
    expect(f.calls.filter((call) => call.params?.method?.startsWith("Input."))).toHaveLength(0)
    const fresh = await turn.inspect(tab)
    await turn.inspect(tab, { frame: fresh.frames[0]!.handle })
    expect(reads()).toBe(before + 2)
  })
  test("user acquisition is journaled before a separately authorized debugger attachment", async () => {
    const fixture = await Fixture.start()
    let checked = false
    fixture.hook = (call) =>
      call.method === "attach"
        ? (async () => {
            const name = (await readdir(fixture.directory)).find((name) => /^journal-.*\.json$/.test(name))!
            const journal = JSON.parse(await readFile(join(fixture.directory, name), "utf8"))
            expect(
              journal.sessions.some(
                (session: any) =>
                  session.session_id === call.params.session_id &&
                  session.tabs.some((tab: any) => tab.tabId === 1 && tab.origin === "user"),
              ),
            ).toBe(true)
            checked = true
            return fixture.reply(call)
          })()
        : undefined
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    await claim(turn)
    expect(checked).toBe(true)
    expect(
      fixture.calls.filter((call) => ["claimUserTab", "attach"].includes(call.method)).map((call) => call.method),
    ).toEqual(["claimUserTab", "attach"])
  })

  test("controller process SIGKILL during keep authorization preserves the durable intent", async () => {
    const fixture = await Fixture.start()
    const script = join(fixture.directory, "crash-controller.ts")
    const module = fileURLToPath(new URL("../src/controller.ts", import.meta.url))
    await writeFile(
      script,
      `import { BrowserController } from ${JSON.stringify(module)};
const controller = await BrowserController.create({connections:[{id:"b",label:"Crash fixture",directory:${JSON.stringify(fixture.directory)}}], authorize: request => {
  if (request.capability === "handoff") process.kill(process.pid, "SIGKILL");
  return "allow";
}});
const session = await controller.openSession({browserId:"b",callerSessionId:"crash"});
const turn = await session.beginTurn({callerTurnId:"turn"});
const tab = await turn.createTab();
await turn.end({keep:[{tab,status:"deliverable"}]});
throw new Error("Unreachable after policy crash");
`,
      { mode: 0o600 },
    )
    const child = spawn(process.execPath, [script], {
      cwd: fixture.directory,
      env: { HOME: fixture.directory },
      stdio: ["ignore", "ignore", "pipe"],
    })
    child.stderr.resume()
    try {
      const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Controller crash fixture timed out")), 5000)
        child.once("error", reject)
        child.once("exit", (code, signal) => {
          clearTimeout(timer)
          resolve({ code, signal })
        })
      })
      expect(exit.signal).toBe("SIGKILL")
      await Bun.sleep(30)
      expect(fixture.count("finalizeTabs")).toBe(0)
      expect(fixture.count("turnEnded")).toBe(0)
      expect(fixture.tabs.has(10)).toBe(true)
      const name = (await readdir(fixture.directory)).find((name) => /^journal-.*\.json$/.test(name))!
      const journal = JSON.parse(await readFile(join(fixture.directory, name), "utf8"))
      expect(
        journal.sessions.some(
          (session: any) => session.preservationPending && session.keep[0].status === "deliverable",
        ),
      ).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }
  })

  test.each(["session", "controller"])(
    "%s close waits for starting registration and cleans the exact wire turn",
    async (scope) => {
      const fixture = await Fixture.start()
      const relay = await registrationRelay(fixture)
      const session = await relay.controller.openSession({ browserId: "browser-0", callerSessionId: "starting" })
      const pending = session.beginTurn({ callerTurnId: "start" }).catch((error) => error)
      const wire = await relay.entered.promise
      let closed = false
      const closing = (scope === "session" ? session.close() : relay.controller.close()).then((value) => {
        closed = true
        return value
      })
      await Bun.sleep(20)
      expect(closed).toBe(false)
      relay.release.resolve()
      expect((await pending).code).toBe("disconnected")
      expect((await closing).confirmed).toBe(true)
      expect(
        fixture.calls
          .filter((call) => call.method === "turnEnded")
          .map((call) => ({ session_id: call.params.session_id, turn_id: call.params.turn_id })),
      ).toEqual([wire])
    },
  )

  test("unknown registration retains active ownership and cannot be re-admitted", async () => {
    const fixture = await Fixture.start()
    const relay = await registrationRelay(fixture, true)
    const session = await relay.controller.openSession({ browserId: "browser-0", callerSessionId: "unknown" })
    await error(session.beginTurn({ callerTurnId: "first" }), "disconnected", "unknown")
    await error(session.beginTurn({ callerTurnId: "second" }), "cleanup_unconfirmed", "not_dispatched")
    await error(relay.controller.openSession({ browserId: "browser-0", callerSessionId: "unknown" }), "tab_owned")
    expect((await session.close()).confirmed).toBe(false)
  })

  test.each(["deny", "cancel", "throw"])(
    "keep %s persists non-dispatch intent before policy and survives disconnect",
    async (decision) => {
      const fixture = await Fixture.start()
      let checked = false
      const controller = await fixture.controller(async (request) => {
        if (request.capability !== "handoff") return "allow"
        const name = (await readdir(fixture.directory)).find((name) => /^journal-.*\.json$/.test(name))!
        const journal = JSON.parse(await readFile(join(fixture.directory, name), "utf8"))
        expect(
          journal.sessions.some(
            (session: any) => session.preservationPending === true && session.keep?.[0]?.tabId === 10,
          ),
        ).toBe(true)
        checked = true
        if (decision === "throw") throw new Error("private policy failure")
        return decision as "deny" | "cancel"
      })
      const { turn } = await fixture.turn(controller)
      const tab = await turn.createTab()
      expect((await turn.end({ keep: [{ tab, status: "deliverable" }] })).confirmed).toBe(false)
      expect(checked).toBe(true)
      await controller.close()
      await Bun.sleep(30)
      expect(fixture.count("turnEnded")).toBe(0)
      expect(fixture.count("finalizeTabs")).toBe(0)
      expect(fixture.tabs.has(10)).toBe(true)
    },
  )

  test("keep refreshes an origin changed during authorization before finalizing", async () => {
    const fixture = await Fixture.start()
    const seen: string[] = []
    const controller = await fixture.controller((request) => {
      if (request.capability !== "handoff") return "allow"
      seen.push(request.documentOrigin!)
      if (request.documentOrigin === "https://denied.test") return "deny"
      fixture.tabs.get(10)!.url = "https://denied.test/new"
      return "allow"
    })
    const { turn } = await fixture.turn(controller)
    const tab = await turn.createTab()
    fixture.tabs.get(10)!.url = "https://fixture.test/old"
    expect((await turn.end({ keep: [{ tab, status: "deliverable" }] })).confirmed).toBe(false)
    expect(seen).toEqual(["https://fixture.test", "https://denied.test"])
    expect(fixture.count("finalizeTabs")).toBe(0)
    expect(fixture.count("turnEnded")).toBe(0)
  })

  test("keep waits for late mutation settlement before observing its actual origin", async () => {
    const fixture = await Fixture.start()
    const seen: string[] = []
    const controller = await fixture.controller((request) => {
      if (request.capability === "handoff") {
        seen.push(request.documentOrigin!)
        return "deny"
      }
      return "allow"
    })
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    const page = await turn.inspect(tab)
    const hold = deferred()
    fixture.hook = (call) =>
      call.params?.method === "Input.dispatchMouseEvent" && call.params.commandParams.type === "mouseWheel"
        ? hold.promise.then(() => {
            fixture.tabs.get(1)!.url = "https://changed.test/late"
            return {}
          })
        : undefined
    const abort = new AbortController()
    const scrolling = turn.scroll(tab, { view: page.viewToken, deltaX: 1, deltaY: 20 }, { signal: abort.signal })
    await waitFor(() => fixture.calls.some((call) => call.params?.commandParams?.type === "mouseWheel"))
    abort.abort()
    await error(scrolling, "cancelled", "unknown")
    const ending = turn.end({ keep: [{ tab, status: "deliverable" }] })
    await Bun.sleep(20)
    expect(seen).toEqual([])
    hold.resolve()
    expect((await ending).confirmed).toBe(false)
    expect(seen).toEqual(["https://changed.test"])
    expect(fixture.calls.filter((call) => call.params?.commandParams?.type === "mouseWheel")).toHaveLength(1)
  })

  test("resume refreshes a manually changed origin without attaching", async () => {
    const fixture = await Fixture.start()
    const seen: string[] = []
    const controller = await fixture.controller((request) => {
      if (request.capability === "claim") {
        seen.push(request.documentOrigin!)
        return request.documentOrigin === "https://denied.test" ? "deny" : "allow"
      }
      return "allow"
    })
    const { turn, session } = await fixture.turn(controller)
    const tab = await turn.createTab()
    fixture.tabs.get(10)!.url = "https://fixture.test/old"
    await turn.end({ keep: [{ tab, status: "handoff" }] })
    fixture.tabs.get(10)!.url = "https://denied.test/new"
    const next = await session.beginTurn({ callerTurnId: "next" })
    const before = fixture.count("attach")
    await error(next.resumeTabs(), "permission_denied", "confirmed")
    expect(seen).toEqual(["https://denied.test"])
    expect(fixture.count("attach")).toBe(before)
  })

  test("resume revalidates after its authorization callback changes the origin", async () => {
    const fixture = await Fixture.start()
    const seen: string[] = []
    const controller = await fixture.controller((request) => {
      if (request.capability !== "claim") return "allow"
      seen.push(request.documentOrigin!)
      if (request.documentOrigin === "https://denied.test") return "deny"
      fixture.tabs.get(10)!.url = "https://denied.test/changed-in-prompt"
      return "allow"
    })
    const { turn, session } = await fixture.turn(controller)
    const tab = await turn.createTab()
    fixture.tabs.get(10)!.url = "https://fixture.test/old"
    await turn.end({ keep: [{ tab, status: "handoff" }] })
    const next = await session.beginTurn({ callerTurnId: "next" })
    const before = fixture.count("attach")
    await error(next.resumeTabs(), "permission_denied", "confirmed")
    expect(seen).toEqual(["https://fixture.test", "https://denied.test"])
    expect(fixture.count("attach")).toBe(before)
  })

  test("mismatched wire event invalidates the known owner without leaking payload to another session", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const a = await fixture.turn(controller, "a"),
      b = await fixture.turn(controller, "b")
    const tab = await claim(a.turn),
      other = await claim(b.turn, 1)
    const page = await a.turn.inspect(tab)
    const wire = fixture.calls.find((call) => call.method === "claimUserTab" && call.params.tabId === 2)!.params
      .session_id
    await fixture.peer.notify("tabChanged", { tabId: 1, session_id: wire, text: "private text" })
    await fixture.peer.request("ping")
    await b.turn.inspect(other)
    expect(a.session.events()).toEqual([{ type: "state_invalidated", browserId: "browser-0" }])
    expect(b.session.events()).toEqual([])
    await error(a.turn.type(tab, { target: page.elements[0]!.ref, text: "blocked", mode: "append" }), "stale_handle")
  })

  test("end canonicalizes matching keep and rejects conflicting keep before and after completion", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const a = await turn.createTab(),
      b = await turn.createTab()
    const ending = turn.end({
      keep: [
        { tab: a, status: "deliverable" },
        { tab: b, status: "handoff" },
      ],
    })
    expect(
      turn.end({
        keep: [
          { tab: b, status: "handoff" },
          { tab: a, status: "deliverable" },
        ],
      }),
    ).toBe(ending)
    expect(() => turn.end({ keep: [] })).toThrow(BrowserError)
    expect(() =>
      turn.end({
        keep: [
          { tab: a, status: "handoff" },
          { tab: b, status: "handoff" },
        ],
      }),
    ).toThrow(BrowserError)
    await ending
    expect(
      turn.end({
        keep: [
          { tab: b, status: "handoff" },
          { tab: a, status: "deliverable" },
        ],
      }),
    ).toBe(ending)
    expect(() => turn.end()).toThrow(BrowserError)
  })

  test("8192 URL bytes are rejected before policy or action admission, including Unicode", async () => {
    const fixture = await Fixture.start()
    let policies = 0
    const controller = await fixture.controller(() => {
      policies++
      return "allow"
    })
    const { turn } = await fixture.turn(controller)
    const ascii = "https://fixture.test/" + "a".repeat(8192)
    const unicode = "https://fixture.test/" + "\u00e9".repeat(4096)
    await error(turn.createTab({ url: ascii }), "result_too_large", "not_dispatched")
    await error(turn.createTab({ url: unicode }), "result_too_large", "not_dispatched")
    expect(policies).toBe(0)
    expect(fixture.count("createTab")).toBe(0)
    const tab = await claim(turn)
    const before = policies
    await error(turn.navigate(tab, { url: unicode }), "result_too_large", "not_dispatched")
    expect(policies).toBe(before)
    fixture.tabs.get(1)!.url = unicode
    await error(turn.discoverTabs(), "result_too_large", "confirmed")
  })
  test("requires policy, explicit browser selection, and no raw escape hatch", async () => {
    await error(BrowserController.create({ connections: [] } as any), "permission_denied", "not_dispatched")
    const a = await Fixture.start(),
      b = await Fixture.start()
    const controller = await a.controller(undefined, [b])
    expect(controller.browsers().map((item) => item.profileIdentity)).toEqual(["unverified", "unverified"])
    expect(controller.browsers()[0]!.epoch).not.toBe(controller.browsers()[1]!.epoch)
    expect(controller.browsers()[0]!.capabilities.rawEvaluation).toBe(false)
    expect((await controller.status())[0]!.extension).toEqual({
      version: "synthetic",
      id: "unknown",
      instanceId: "unknown",
      generation: "unknown",
    })
    await error(controller.openSession({ browserId: "absent", callerSessionId: "x" }), "browser_unavailable")
    const { turn } = await a.turn(controller, "selected", "browser-1")
    await turn.discoverTabs()
    expect(a.count("getUserTabs")).toBe(0)
    expect(b.count("getUserTabs")).toBe(1)
    expect("call" in controller).toBe(false)
    expect("evaluate" in turn).toBe(false)
    expect("cdp" in turn).toBe(false)
    await error(a.controller(), "controller_busy")
  })

  test.each(["deny", "cancel", "throw", "invalid"])("fails closed for %s policy", async (decision) => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller((() => {
      if (decision === "throw") throw new Error("sensitive policy content")
      return decision
    }) as Authorize)
    const { turn } = await fixture.turn(controller)
    const result = await error(
      turn.discoverTabs(),
      decision === "cancel" ? "permission_cancelled" : "permission_denied",
      "not_dispatched",
    )
    expect(result.message).not.toContain("sensitive")
    expect(fixture.count("getUserTabs")).toBe(0)
  })

  test("missing and ambiguous discovery fail explicitly; hostId selects the exact host", async () => {
    const fixture = await Fixture.start()
    const empty = join(fixture.directory, "empty")
    await mkdir(empty, { mode: 0o700 })
    await error(
      BrowserController.create({
        connections: [{ id: "b", label: "Missing", directory: empty }],
        authorize: () => "allow",
      }),
      "browser_unavailable",
    )
    const file = (await readdir(fixture.directory)).find((name) => /^host-.*\.json$/.test(name))!
    const duplicate = join(fixture.directory, "host-00000000-0000-0000-0000-000000000000.json")
    const discovery = JSON.parse(await readFile(join(fixture.directory, file), "utf8"))
    await writeFile(duplicate, JSON.stringify({ ...discovery, socket: "host-00000000-0000-0000-0000-000000000000.sock" }))
    await chmod(duplicate, 0o600)
    await error(fixture.controller(), "ambiguous_browser")
    const selected = await BrowserController.create({
      connections: [{ id: "b", label: "Explicit", directory: fixture.directory, hostId: file }],
      authorize: () => "allow",
    })
    controllers.push(selected)
    expect(selected.browsers()[0]!.label).toBe("Explicit")
  })

  test("cancels and expires permission waits within 250ms without dispatch", async () => {
    const fixture = await Fixture.start()
    const started = deferred()
    const controller = await fixture.controller(() => {
      started.resolve()
      return new Promise(() => {})
    })
    const { turn } = await fixture.turn(controller)
    const abort = new AbortController()
    const pending = turn.discoverTabs({ signal: abort.signal })
    await started.promise
    const time = Date.now()
    abort.abort()
    await error(pending, "cancelled", "not_dispatched")
    expect(Date.now() - time).toBeLessThan(250)
    await error(turn.discoverTabs({ timeoutMs: 25 }), "deadline_exceeded", "not_dispatched")
    expect(fixture.count("getUserTabs")).toBe(0)
  })

  test("approval budget permits human delay but does not extend native execution", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller(async () => {
      await Bun.sleep(80)
      return "allow" as const
    })
    const { turn } = await fixture.turn(controller)
    const options = { timeoutMs: 50, permissionTimeoutMs: 200 }
    expect((await turn.discoverTabs(options)).tabs.length).toBeGreaterThan(0)
    fixture.hook = (call) => (call.method === "getUserTabs" ? new Promise(() => {}) : undefined)
    const started = Date.now()
    await error(turn.discoverTabs(options), "deadline_exceeded")
    expect(Date.now() - started).toBeLessThan(230)
  })

  test("approval budget stays bounded and stop cancels it without dispatch", async () => {
    const fixture = await Fixture.start()
    const entered = deferred()
    const controller = await fixture.controller(() => {
      entered.resolve()
      return new Promise(() => {})
    })
    const { turn } = await fixture.turn(controller)
    await error(turn.discoverTabs({ timeoutMs: 20, permissionTimeoutMs: 40 }), "deadline_exceeded", "not_dispatched")
    const abort = new AbortController()
    const pending = turn.discoverTabs({ signal: abort.signal, permissionTimeoutMs: 300_000 })
    await entered.promise
    abort.abort()
    await error(pending, "cancelled", "not_dispatched")
    expect(fixture.count("getUserTabs")).toBe(0)
    await error(turn.discoverTabs({ permissionTimeoutMs: 300_001 }), "unsupported", "not_dispatched")
  })

  test("atomic competing claims, foreign/forged handles, and caller identity isolation", async () => {
    const fixture = await Fixture.start()
    const requests: any[] = []
    const controller = await fixture.controller((request) => {
      requests.push(request)
      return "allow"
    })
    const a = await fixture.turn(controller, "a"),
      b = await fixture.turn(controller, "b")
    const da = (await a.turn.discoverTabs()).tabs[0]!,
      db = (await b.turn.discoverTabs()).tabs[0]!
    const outcomes = await Promise.allSettled([a.turn.claimTab(da.handle), b.turn.claimTab(db.handle)])
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    expect(fixture.count("attach")).toBe(1)
    const won = outcomes[0].status === "fulfilled" ? 0 : 1
    const winner = outcomes[won]
    if (winner.status !== "fulfilled") throw new Error("Expected exactly one successful claim")
    const handle = winner.value
    await error((won === 0 ? b : a).turn.inspect(handle), "stale_handle", "not_dispatched")
    await error((won === 0 ? a : b).turn.inspect({ ...handle }), "stale_handle", "not_dispatched")
    await error(b.turn.claimTab(da.handle), "stale_handle")
    const wire = fixture.calls.find((call) => call.method === "attach")!.params
    expect(wire.session_id).not.toBe(won === 0 ? "a" : "b")
    expect(wire.turn_id).not.toBe("turn")
    expect(
      requests.some((request) => request.capability === "claim" && request.documentOrigin === "https://fixture.test"),
    ).toBe(true)
  })

  test("denied claims release reservations and do not attach", async () => {
    const fixture = await Fixture.start()
    let allowed = false
    const controller = await fixture.controller((request) =>
      request.capability === "claim" && !allowed ? "deny" : "allow",
    )
    const { turn } = await fixture.turn(controller)
    const descriptor = (await turn.discoverTabs()).tabs[0]!.handle
    await error(turn.claimTab(descriptor), "permission_denied")
    expect(fixture.count("attach")).toBe(0)
    allowed = true
    await turn.claimTab(descriptor)
    expect(fixture.count("attach")).toBe(1)
  })

  test("eight sessions and sixteen tab acquisitions are enforced before dispatch", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn, session } = await fixture.turn(controller)
    await error(session.beginTurn({ callerTurnId: "duplicate" }), "tab_owned")
    await error(controller.openSession({ browserId: "browser-0", callerSessionId: "session" }), "tab_owned")
    for (let i = 1; i < CONTROLLER_LIMITS.sessions; i++)
      await controller.openSession({ browserId: "browser-0", callerSessionId: `s-${i}` })
    await error(controller.openSession({ browserId: "browser-0", callerSessionId: "overflow" }), "tab_owned")
    const tabs = await Promise.all(Array.from({ length: CONTROLLER_LIMITS.tabs }, () => turn.createTab()))
    expect(tabs).toHaveLength(16)
    await error(turn.createTab(), "resource_limit", "not_dispatched")
    expect(fixture.count("createTab")).toBe(16)
  })

  test("opaque page refs are inspection-, session-, and turn-bound", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    const page = await turn.inspect(tab)
    expect(page.text).toContain("Fixture text")
    expect(typeof page.elements[0]!.ref).toBe("object")
    expect("frameId" in page).toBe(false)
    expect(turn.validHandle(page.elements[0]!.ref)).toBe(true)
    await turn.inspect(tab)
    await error(turn.type(tab, { target: page.elements[0]!.ref, text: "again", mode: "append" }), "stale_handle")
    expect(fixture.calls.some((call) => call.params?.method?.startsWith("Input."))).toBe(false)
  })

  test("queued revocation and cancellation do not dispatch dependent actions; other tabs proceed", async () => {
    const fixture = await Fixture.start()
    let allow = true
    const requests: string[] = []
    const controller = await fixture.controller((request) => {
      requests.push(request.capability)
      return request.capability === "input" && !allow ? "deny" : "allow"
    })
    const a = await fixture.turn(controller, "a"),
      b = await fixture.turn(controller, "b")
    const tab = await claim(a.turn),
      other = await claim(b.turn, 1)
    const page = await a.turn.inspect(tab)
    const hold = deferred<unknown>()
    fixture.hook = (call) => (snapshot(call) && call.params.target.tabId === 1 ? hold.promise : undefined)
    const first = a.turn.inspect(tab)
    await waitFor(() => fixture.calls.filter(snapshot).length === 2)
    const queued = a.turn.type(tab, { target: page.elements[0]!.ref, text: "never", mode: "append" })
    const abort = new AbortController()
    const cancelled = a.turn.inspect(tab, { signal: abort.signal })
    const time = Date.now()
    abort.abort()
    await error(cancelled, "cancelled", "not_dispatched")
    expect(Date.now() - time).toBeLessThan(250)
    expect((await b.turn.inspect(other)).text).toContain("Fixture text")
    allow = false
    hold.resolve({
      result: { value: { full: "Fixture text", iframeRefs: [], iframeDepths: {} } },
    })
    await first
    await error(queued, "permission_denied", "not_dispatched")
    expect(requests.filter((capability) => capability === "input").length).toBeGreaterThanOrEqual(2)
    expect(fixture.calls.some((call) => call.params?.method?.startsWith("Input."))).toBe(false)
  })

  test("post-dispatch cancellation records unknown without replay and isolates sessions", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const a = await fixture.turn(controller, "a"),
      b = await fixture.turn(controller, "b")
    const tab = await claim(a.turn),
      other = await claim(b.turn, 1)
    const page = await a.turn.inspect(tab)
    const hold = deferred<unknown>()
    fixture.hook = (call) => (call.params?.commandParams?.type === "mouseWheel" ? hold.promise : undefined)
    const abort = new AbortController()
    const pending = a.turn.scroll(tab, { view: page.viewToken, deltaX: 1, deltaY: 20 }, { signal: abort.signal })
    await waitFor(() => fixture.calls.some((call) => call.params?.commandParams?.type === "mouseWheel"))
    const time = Date.now()
    abort.abort()
    const result = await error(pending, "cancelled", "unknown")
    expect(Date.now() - time).toBeLessThan(250)
    expect(a.turn.validHandle(tab)).toBe(false)
    expect(a.turn.validHandle(page.viewToken)).toBe(false)
    await error(a.turn.inspect(tab), "operation_uncertain")
    expect((await b.turn.inspect(other)).text).toContain("Fixture text")
    hold.resolve({})
    await Bun.sleep(30)
    expect((await controller.operationStatus(result.operationId)).state).toBe("settled")
    expect(fixture.calls.filter((call) => call.params?.commandParams?.type === "mouseWheel")).toHaveLength(1)
  })

  test("origin change triggers fresh authorization before content read", async () => {
    const fixture = await Fixture.start()
    const requests: any[] = []
    const controller = await fixture.controller((request) => {
      requests.push(request)
      return request.documentOrigin === "https://denied.test" ? "deny" : "allow"
    })
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    fixture.tabs.get(1)!.url = "https://denied.test/private"
    await error(turn.inspect(tab), "permission_denied", "confirmed")
    expect(requests.some((request) => request.documentOrigin === "https://denied.test")).toBe(true)
    expect(fixture.calls.some(snapshot)).toBe(false)
  })

  test("claim refreshes origin after permission waits, before debugger attachment", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller((request) =>
      request.documentOrigin === "https://denied.test" ? "deny" : "allow",
    )
    const { turn } = await fixture.turn(controller)
    const descriptor = (await turn.discoverTabs()).tabs[0]!.handle
    fixture.tabs.get(1)!.url = "https://denied.test/new-document"
    await error(turn.claimTab(descriptor), "permission_denied", "confirmed")
    expect(fixture.count("attach")).toBe(0)
  })

  test("permission waits hold no tab execution lock", async () => {
    const fixture = await Fixture.start()
    let pause = false
    const entered = deferred(),
      permit = deferred<"allow">()
    const controller = await fixture.controller((request) => {
      if (pause && request.capability === "read") {
        pause = false
        entered.resolve()
        return permit.promise
      }
      return "allow"
    })
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    pause = true
    const first = turn.inspect(tab)
    await entered.promise
    expect((await turn.inspect(tab)).text).toContain("Fixture text")
    permit.resolve("allow")
    expect((await first).text).toContain("Fixture text")
  })

  test("tab queue bound includes preparation and queued deadlines", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    const hold = deferred<unknown>()
    fixture.hook = (call) => (snapshot(call) ? hold.promise : undefined)
    const first = turn.inspect(tab)
    await waitFor(() => fixture.calls.some(snapshot))
    const abort = new AbortController()
    const queued = Array.from({ length: 14 }, () => turn.inspect(tab, { signal: abort.signal }).catch((error) => error))
    const expired = turn.inspect(tab, { timeoutMs: 30 })
    await error(turn.inspect(tab), "resource_limit", "not_dispatched")
    await error(expired, "deadline_exceeded", "not_dispatched")
    abort.abort()
    expect(
      (await Promise.all(queued)).every((item) => item.code === "cancelled" && item.outcome === "not_dispatched"),
    ).toBe(true)
    hold.resolve({
      result: { value: { full: "Fixture text", iframeRefs: [], iframeDepths: {} } },
    })
    await first
    expect(fixture.calls.filter(snapshot)).toHaveLength(1)
  })

  test("connection admission bounds include all permission waiters", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller(() => new Promise(() => {}))
    const { turn } = await fixture.turn(controller)
    const abort = new AbortController()
    const pending = Array.from({ length: 128 }, () =>
      turn.discoverTabs({ signal: abort.signal }).catch((error) => error),
    )
    await error(turn.discoverTabs(), "resource_limit", "not_dispatched")
    abort.abort()
    expect((await Promise.all(pending)).every((item) => item.code === "cancelled")).toBe(true)
    expect(fixture.count("getUserTabs")).toBe(0)
  })

  test("end cancels permission waiters and closing an idle session frees its slot", async () => {
    const fixture = await Fixture.start()
    let block = true
    const controller = await fixture.controller(() => (block ? new Promise(() => {}) : "allow"))
    const { turn, session } = await fixture.turn(controller)
    const pending = turn.discoverTabs()
    const ending = turn.end()
    await error(pending, "cancelled", "not_dispatched")
    expect((await ending).confirmed).toBe(true)
    expect((await session.close()).confirmed).toBe(true)
    block = false
    const again = await fixture.turn(controller)
    expect((await again.turn.discoverTabs()).tabs).toHaveLength(2)
  })

  test("routes normalized owner events; only closure invalidates ownership", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const a = await fixture.turn(controller, "a"),
      b = await fixture.turn(controller, "b")
    const tab = await claim(a.turn)
    const page = await a.turn.inspect(tab)
    await fixture.peer.notify("tabChanged", { tabId: 1, text: "secret payload", url: "https://secret.test" })
    await Bun.sleep(30)
    expect(a.session.events()).toEqual([{ type: "tab_changed", browserId: "browser-0", tab }])
    expect(b.session.events()).toEqual([])
    expect(a.turn.validHandle(tab)).toBe(true)
    expect(a.turn.validHandle(page.elements[0]!.ref)).toBe(true)
    await fixture.peer.notify("tabClosed", { tabId: 1 })
    await waitFor(() => !a.turn.validHandle(tab))
    expect(a.turn.validHandle(page.elements[0]!.ref)).toBe(false)
    await error(a.turn.click(tab, { target: page.elements[0]!.ref }), "stale_handle")
  })

  test("deduplicates completion, blocks new work, preserves user tabs and releases handoff on close", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn, session } = await fixture.turn(controller)
    await claim(turn)
    const created = await turn.createTab()
    const first = turn.end({ keep: [{ tab: created, status: "handoff" }] })
    expect(turn.end({ keep: [{ tab: created, status: "handoff" }] })).toBe(first)
    expect(() => turn.end()).toThrow(BrowserError)
    await error(turn.discoverTabs(), "stale_handle")
    expect((await first).confirmed).toBe(true)
    expect(fixture.tabs.get(1)?.attached).toBe(false)
    const next = await session.beginTurn({ callerTurnId: "next" })
    await error(next.inspect(created), "stale_handle")
    const resumed = await next.resumeTabs()
    expect(resumed).toHaveLength(1)
    await next.end({ keep: [{ tab: resumed[0]!, status: "handoff" }] })
    expect((await session.close()).confirmed).toBe(true)
    expect(fixture.tabs.size).toBe(3)
    expect([...fixture.tabs.values()].every((tab) => !tab.attached)).toBe(true)
  })

  test("failed navigation retains the created lease for verified cleanup", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    fixture.hook = (call) =>
      call.params?.method === "Page.navigate"
        ? Promise.reject(new Error("synthetic navigation transport failure"))
        : undefined
    await error(turn.createTab({ url: "https://fixture.test/fail" }), "native_error", "confirmed")
    expect(fixture.count("createTab")).toBe(1)
    expect(fixture.tabs.size).toBe(3)
    expect((await turn.end()).confirmed).toBe(true)
    expect(fixture.tabs.size).toBe(2)
  })

  test("lost create reply is cleaned by exact wire lifecycle without guessing the new tab", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const hold = deferred()
    fixture.hook = (call) => (call.method === "createTab" ? hold.promise.then(() => fixture.reply(call)) : undefined)
    const abort = new AbortController()
    const pending = turn.createTab({}, { signal: abort.signal })
    await waitFor(() => fixture.count("createTab") === 1)
    abort.abort()
    await error(pending, "cancelled", "unknown")
    await error(turn.createTab(), "operation_uncertain", "not_dispatched")
    const ending = turn.end()
    hold.resolve()
    expect((await ending).confirmed).toBe(true)
    expect(fixture.count("createTab")).toBe(1)
    expect(fixture.tabs.size).toBe(2)
  })

  test("event overflow is bounded and exposes invalidation instead of raw payloads", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn, session } = await fixture.turn(controller)
    await claim(turn)
    for (let i = 0; i < 300; i++) await fixture.peer.notify("tabChanged", { tabId: 1, text: "private-content" })
    const deadline = Date.now() + 2500
    while (true) {
      const status = (await controller.status())[0]!
      if (!status.connected || (status.transport?.notifications ?? 0) >= 300) break
      if (Date.now() >= deadline) throw new Error("Notification forwarding timed out")
      await Bun.sleep(5)
    }
    if (controller.browsers()[0]!.connected)
      await turn.discoverTabs().catch((error) => {
        if (!(error instanceof BrowserError) || error.code !== "disconnected") throw error
      })
    const events = session.events()
    expect(events.length).toBeLessThanOrEqual(CONTROLLER_LIMITS.events)
    expect(events.some((event) => event.type === "state_invalidated" || event.type === "disconnected")).toBe(true)
    expect(JSON.stringify(events)).not.toContain("private-content")
  })

  test("scroll transport and opaque view handles stay tab scoped", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const tab = await claim(turn)
    const page = await turn.inspect(tab)
    await turn.scroll(tab, { deltaX: 20, deltaY: 30, view: page.viewToken })
    const calls = fixture.calls.filter((call) => call.params?.method?.startsWith("Input."))
    expect(calls.every((call) => call.params.target.tabId === 1)).toBe(true)
    expect(calls.find((call) => call.params.commandParams.type === "mouseWheel")?.params.commandParams).toMatchObject({
      deltaX: 20,
      deltaY: 30,
    })
    await error(turn.click(tab, { x: 50, y: 50, view: { ...page.viewToken } }), "stale_handle", "not_dispatched")
    await error(turn.navigate(tab, { url: "file:///etc/passwd" }), "unsupported", "not_dispatched")
  })

  test("discovery is bounded and reports truncation", async () => {
    const fixture = await Fixture.start()
    for (let id = 3; id < 110; id++)
      fixture.tabs.set(id, {
        id,
        url: `https://fixture.test/${id}`,
        title: "t".repeat(2000),
        attached: false,
        agent: false,
      })
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const result = await turn.discoverTabs()
    expect(result.tabs).toHaveLength(100)
    expect(result.truncated).toBe(true)
    expect(result.tabs.every((tab) => tab.title.length <= 1024)).toBe(true)
  })

  test("uncertain keep never falls back to destructive turnEnded", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn } = await fixture.turn(controller)
    const tab = await turn.createTab()
    fixture.hook = (call) => (call.method === "finalizeTabs" ? Promise.reject(new Error("keep failed")) : undefined)
    const result = await turn.end({ keep: [{ tab, status: "deliverable" }] })
    expect(result.confirmed).toBe(false)
    expect(result.code).toBe("cleanup_unconfirmed")
    expect(fixture.count("turnEnded")).toBe(0)
    expect(fixture.tabs.size).toBe(3)
  })

  test("denied handoff resumption does not make the retained tab disposable", async () => {
    const fixture = await Fixture.start()
    let deny = false
    const controller = await fixture.controller((request) =>
      deny && request.capability === "claim" ? "deny" : "allow",
    )
    const { turn, session } = await fixture.turn(controller)
    const tab = await turn.createTab()
    expect((await turn.end({ keep: [{ tab, status: "handoff" }] })).confirmed).toBe(true)
    const next = await session.beginTurn({ callerTurnId: "next" })
    deny = true
    await error(next.resumeTabs(), "permission_denied", "confirmed")
    expect((await next.end()).confirmed).toBe(true)
    expect(fixture.tabs.has(10)).toBe(true)
    expect(fixture.count("turnEnded")).toBe(0)
    expect((await session.close()).confirmed).toBe(true)
    expect(fixture.tabs.has(10)).toBe(true)
  })

  test("disconnect invalidates the actual epoch rather than reusing a tab ID", async () => {
    const fixture = await Fixture.start()
    const controller = await fixture.controller()
    const { turn, session } = await fixture.turn(controller)
    const tab = await claim(turn)
    fixture.child.kill("SIGKILL")
    await fixture.exit
    await waitFor(() => !controller.browsers()[0]!.connected)
    expect(turn.validHandle(tab)).toBe(false)
    await error(turn.inspect(tab), "disconnected", "not_dispatched")
    expect(session.events().some((event) => event.type === "disconnected")).toBe(true)
    expect((await session.close()).confirmed).toBe(false)
  })
})
