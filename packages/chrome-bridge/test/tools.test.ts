import { afterEach, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { EXTENSION_ORIGIN, startIdentity } from "../src/client"
import { MAX_READ_BYTES, MAX_WRITE_BYTES, RpcPeer } from "../src/native"
import { BrowserToolOwner, BrowserToolExecution, type BrowserToolInput, type BrowserToolInvocation } from "../src/tools"
import { BrowserError, type AuthorizationRequest } from "../src/controller"

type Call = { method: string; params: any }
type Tab = {
  id: number
  url: string
  title: string
  attached: boolean
  agent: boolean
  session?: string
  loader: number
}
const fixtures: Fixture[] = []
const owners: BrowserToolOwner[] = []
const disposers: (() => void)[] = []
function wheel(call: Call) {
  return call.params?.method === "Input.dispatchMouseEvent" && call.params.commandParams.type === "mouseWheel"
}
let sequence = 0

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function invocation(input: Partial<BrowserToolInvocation> = {}): BrowserToolInvocation {
  return {
    messageID: "assistant",
    callID: `call-${++sequence}`,
    signal: new AbortController().signal,
    vision: false,
    authorize: async () => "allow",
    ...input,
  }
}

const identity = (sessionID: string) => ({ runtime: "v2" as const, location: "fixture-location", sessionID })
async function execute(execution: BrowserToolExecution, input: BrowserToolInput, source = invocation()) {
  const result = await execution.execute({ browser: "fixture", ...input }, source)
  return { ...result, body: JSON.parse(result.text) }
}

// Same transport boundary as controller.test.ts, kept local to avoid importing a test suite or Core.
// Page replies are synthetic protocol observations, not evidence of actual DOM/browser behavior.
class Fixture {
  calls: Call[] = []
  tabs = new Map<number, Tab>([
    [
      1,
      {
        id: 1,
        url: "https://fixture.test/one",
        title: "User One",
        attached: false,
        agent: false,
        loader: 1,
      },
    ],
    [
      2,
      {
        id: 2,
        url: "https://fixture.test/two",
        title: "User Two",
        attached: false,
        agent: false,
        loader: 1,
      },
    ],
  ])
  next = 10
  peer: RpcPeer
  hook?: (call: Call) => Promise<unknown> | undefined
  exited: Promise<unknown>

  constructor(
    readonly directory: string,
    readonly child: ChildProcessWithoutNullStreams,
  ) {
    child.stderr.resume()
    this.exited = new Promise((resolve) => child.once("exit", resolve))
    this.peer = new RpcPeer(child.stdout, child.stdin, {
      maxRead: MAX_WRITE_BYTES,
      maxWrite: MAX_READ_BYTES,
      onRequest: async (method, params) => {
        const call = { method, params }
        this.calls.push(call)
        return this.hook?.(call) ?? this.reply(call)
      },
    })
  }

  static async start(existing?: string) {
    await mkdir("/tmp/tandem/chrome-tools-tests", { recursive: true, mode: 0o700 })
    const directory = existing ?? await mkdtemp("/tmp/tandem/chrome-tools-tests/run-")
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
    while (!(await Promise.all((await readdir(directory)).filter((name) => /^host-.*\.json$/.test(name))
      .map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")).pid))).includes(child.pid)) {
      if (Date.now() >= deadline) throw new Error("Adapter host discovery timed out")
      await Bun.sleep(5)
    }
    return fixture
  }

  owner(directory = this.directory, screenshotVerified = false) {
    const owner = new BrowserToolOwner({
      connections: [{ id: "fixture", label: "Adapter fixture", directory, screenshotVerified }],
    })
    owners.push(owner)
    return owner
  }

  count(method: string) {
    return this.calls.filter((call) => call.method === method || call.params?.method === method).length
  }

  reply({ method, params }: Call): unknown {
    if (method === "getInfo") return { version: "synthetic" }
    if (method === "getUserTabs" || method === "getTabs")
      return [...this.tabs.values()].map(({ id, url, title }) => ({ id, url, title }))
    if (method === "createTab") {
      const tab: Tab = {
        id: this.next++,
        url: "about:blank",
        title: "Created",
        attached: false,
        agent: true,
        session: params.session_id,
        loader: 1,
      }
      this.tabs.set(tab.id, tab)
      return { id: tab.id }
    }
    if (method === "claimUserTab") {
      const tab = this.tabs.get(params.tabId)!
      if (tab.session && tab.session !== params.session_id) throw new Error("Foreign fixture lease")
      tab.session = params.session_id
      return { id: tab.id }
    }
    if (method === "attach") {
      const tab = this.tabs.get(params.tabId)!
      if (tab.session !== params.session_id) throw new Error("Unclaimed fixture tab")
      tab.attached = true
      return
    }
    if (method === "turnEnded" || method === "finalizeTabs") {
      for (const tab of this.tabs.values()) {
        if (tab.session !== params.session_id) continue
        const keep = params.keep?.find((item: { tabId: number }) => item.tabId === tab.id)
        if (tab.agent && !keep) this.tabs.delete(tab.id)
        else {
          tab.attached = false
          if (keep?.status !== "handoff") tab.session = undefined
        }
      }
      return
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
    if (command === "Page.getFrameTree")
      return { frameTree: { frame: { id: "native-top-frame", loaderId: `loader-${tab.loader}`, url: tab.url } } }
    if (command === "Page.getLayoutMetrics")
      return { cssVisualViewport: { clientWidth: 800, clientHeight: 600, zoom: 1 } }
    if (command === "Page.createIsolatedWorld") return { executionContextId: tab.id }
    if (command === "Page.startScreencast") {
      return this.peer
        .notify("onCDPEvent", {
          source: { tabId: tab.id },
          method: "Page.screencastFrame",
          params: {
            sessionId: this.count("Page.startScreencast"),
            metadata: { timestamp: Date.now() / 1000 },
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          },
        })
        .then(() => ({}))
    }
    // Return protocol observations, never execute or imitate the injected DOM scripts.
    if (command === "Runtime.evaluate") {
      if (args.expression === "document.title") return { result: { value: tab.title } }
      if (args.expression.includes("url:location.href"))
        return {
          result: { value: { url: tab.url, title: tab.title, dpr: 1, scrollX: 0, scrollY: 0, ready: "complete" } },
        }
      if (args.expression.includes("incrementalAriaSnapshot") && args.expression.length < 10000)
        return { result: { value: { full: "Untrusted fixture page text", iframeRefs: [], iframeDepths: {} } } }
      if (args.expression.includes("__browserUseVisibleDomState"))
        return {
          result: {
            value: {
              items: [{ ref: "native-element-ref", line: "<input node_id=native-element-ref>Input</input>" }],
              viewport: { left: 0, top: 0, right: 800, bottom: 600 },
              frameElements: [],
            },
          },
        }
      if (args.expression.includes("__codexPlaywrightInjected")) return { result: { value: true } }
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
        "Page.stopScreencast",
        "Page.screencastFrameAck",
      ].includes(command)
    )
      return {}
    throw new Error(`Unsupported fixture CDP: ${command} ${JSON.stringify(args)?.slice(0, 200)}`)
  }

  async stop() {
    this.peer.close()
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM")
    await Promise.race([this.exited, Bun.sleep(500)])
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL")
    await this.exited
    await rm(this.directory, { recursive: true, force: true })
  }
}

afterEach(async () => {
  for (const dispose of disposers.splice(0)) dispose()
  // Disconnect owned peers before fallback owner cleanup so a failed assertion cannot wait on a held wire call.
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.stop()))
  await Promise.all(owners.splice(0).map((owner) => owner.close()))
})

async function page(execution: BrowserToolExecution) {
  const created = await execute(execution, { action: "create" })
  expect(created.metadata.outcome).toBe("confirmed")
  const inspected = await execute(execution, { action: "inspect", tab: created.body.tab })
  expect(inspected.metadata.outcome).toBe("confirmed")
  return {
    tab: created.body.tab as string,
    ref: inspected.body.elements[0].ref as string,
    view: inspected.body.view as string,
    frame: inspected.body.frames[0].frame as string,
  }
}

describe("model browser adapter over private native IPC", () => {
  test("same chat reconnects with fresh handles, preserving uncertain operations and retired journals", async () => {
    const first = await Fixture.start()
    const owner = first.owner()
    const execution = owner.begin(identity("historical"))
    const created = await execute(execution, { action: "create" })
    const inspected = await execute(execution, { action: "inspect", tab: created.body.tab })
    expect(created.metadata.outcome).toBe("confirmed")
    expect(inspected.metadata.outcome).toBe("confirmed")
    const entered = deferred()
    first.hook = (call) => {
      if (!wheel(call)) return undefined
      entered.resolve()
      return new Promise(() => {})
    }
    const source = invocation()
    const input = { action: "scroll" as const, tab: created.body.tab, view: inspected.body.view, deltaX: 1, deltaY: 20 }
    const pending = execute(execution, input, source)
    await Promise.race([entered.promise, pending.then((value) => { throw new Error(value.text) })])
    first.child.kill("SIGKILL")
    await first.exited
    const uncertain = await pending
    expect(uncertain.metadata.outcome).toBe("unknown")
    expect((await execute(execution, input, source)).text).toBe(uncertain.text)
    const reports = await execution.end()
    expect(reports.some((report) => !report.confirmed)).toBe(true)
    const unavailable = owner.begin(identity("historical"))
    expect((await execute(unavailable, { action: "discover" })).metadata.code).toBe("browser_unavailable")
    await unavailable.end()
    const journal = (await readdir(first.directory)).find((file) => file.startsWith("journal-"))!
    const path = join(first.directory, journal)
    const saved = JSON.parse(await readFile(path, "utf8"))
    // Model a host predating the browser parent. Actual Chromium process replacement
    // is covered by the separate HTTP acceptance, not this synthetic native peer.
    const [boot, tick] = (await startIdentity(process.pid)).split(":")
    saved.processStart = `${boot}:${BigInt(tick!) - 1n}`
    await writeFile(path, JSON.stringify(saved), { mode: 0o600 })
    const original = await readFile(path, "utf8")
    const second = await Fixture.start(first.directory)
    const fresh = owner.begin(identity("historical"))
    expect((await execute(fresh, { action: "inspect", tab: created.body.tab })).metadata.code).toBe("stale_handle")
    const status = await execute(fresh, { action: "status", operation: uncertain.body.operation })
    expect(status.body.outcome).toBe("unknown")
    expect((await execute(fresh, { action: "discover" }, invocation({ authorize: async () => "deny" }))).metadata.code)
      .toBe("permission_denied")
    expect(second.count("createTab")).toBe(0)
    const next = await execute(fresh, { action: "create" })
    expect(next.metadata.outcome).toBe("confirmed")
    expect(next.body.tab).not.toBe(created.body.tab)
    expect(second.count("createTab")).toBe(1)
    expect(second.calls.filter(wheel)).toHaveLength(0)
    expect(second.calls.find((call) => call.method === "createTab")!.params.session_id)
      .not.toBe(first.calls.find((call) => call.method === "createTab")!.params.session_id)
    expect((await execute(fresh, { action: "status", operation: uncertain.body.operation })).body.outcome).toBe("unknown")
    expect((await execute(fresh, { action: "type", tab: next.body.tab, ref: inspected.body.elements[0].ref,
      text: "must not replay", mode: "replace" })).metadata.code).toBe("stale_handle")
    expect(await readFile(path, "utf8")).toBe(original)
    expect((await fresh.end()).every((report) => report.confirmed)).toBe(true)
    expect(await execution.end()).toEqual(reports)
    expect(await readFile(path, "utf8")).toBe(original)
  })

  test("initial missing browser does not cache a failed controller forever", async () => {
    const fixture = await Fixture.start()
    const directory = join(fixture.directory, "later")
    await mkdir(directory, { mode: 0o700 })
    const owner = fixture.owner(directory)
    const first = owner.begin(identity("early"))
    expect((await execute(first, { action: "discover" })).metadata.code).toBe("browser_unavailable")
    await first.end()
    await Fixture.start(directory)
    const second = owner.begin(identity("early"))
    expect((await execute(second, { action: "discover" })).metadata.outcome).toBe("confirmed")
    await second.end()
  })
  test("infers browser for owned tab inspect and keep without a browser field", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("implicit-browser"))
    const created = await execute(execution, { action: "create" })
    const tab = created.body.tab
    expect((await execution.execute({ action: "inspect", tab }, invocation())).metadata.outcome).toBe("confirmed")
    const kept = await execution.execute({ action: "keep", tab, disposition: "deliverable" }, invocation())
    expect(kept.metadata.code).toBeUndefined()
    expect(JSON.parse(kept.text).disposition).toBe("deliverable")
    expect((await execution.end()).every((report) => report.confirmed && report.retained === 1)).toBe(true)
  })

  test("automatic fallback preserves unmarked agent tabs for the next turn", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const first = owner.begin(identity("fallback-handoff"))
    const created = await execute(first, { action: "create" })
    const reports = await first.end()
    expect(reports).toMatchObject([{ confirmed: true, retained: 1 }])
    expect(fixture.tabs.has(10)).toBe(true)
    expect(fixture.count("turnEnded")).toBe(0)
    const next = owner.begin(identity("fallback-handoff"))
    const resumed = await execute(next, { action: "resume" })
    expect(resumed.body.tabs).toHaveLength(1)
    expect(resumed.body.tabs[0]).not.toBe(created.body.tab)
    await execute(next, { action: "keep", tab: resumed.body.tabs[0], disposition: "deliverable" })
    expect((await execute(next, { action: "finalize" })).body.cleanup.confirmed).toBe(true)
    await next.end()
  })

  test("site approval covers routine actions but not a different site, frame, or turn", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const execution = owner.begin(identity("site-scopes"))
    const requests: AuthorizationRequest[] = []
    const source = invocation({ authorize: async (request) => { requests.push(request); return "allow" } })
    const approval = (origin: string, frame = origin) => ({ browserId: "fixture", browserLabel: "Fixture",
      callerSessionId: "site-scopes", callerTurnId: execution.id, capability: "site" as const,
      documentOrigin: origin, frameOrigin: frame, operationId: "scope-test", signal: source.signal })
    await Promise.all([execution.authorize(approval("https://example.com"), source),
      execution.authorize(approval("https://example.com"), source)])
    expect(requests).toHaveLength(1)
    await execution.authorize(approval("https://www.wikipedia.org"), source)
    await execution.authorize(approval("https://example.com", "https://embedded.example.org"), source)
    expect(requests).toHaveLength(3)
    await execution.end()
    const next = owner.begin(identity("site-scopes"))
    await next.authorize({ ...approval("https://example.com"), callerTurnId: next.id }, source)
    expect(requests).toHaveLength(4)
    await next.end()
  })

  test("one real tool approval covers inspection, input and capture; claims stay separate", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner(fixture.directory, true).begin(identity("routine-approvals"))
    const requests: AuthorizationRequest[] = []
    const source = () => invocation({ vision: true, authorize: async (request) => { requests.push(request); return "allow" } })
    await execute(execution, { action: "discover" }, source())
    await execute(execution, { action: "discover" }, source())
    expect(requests.map((request) => request.capability)).toEqual(["discovery"])
    // A fresh discovery supersedes descriptors, so get the current one.
    const current = await execute(execution, { action: "discover" }, source())
    const claimed = await execute(execution, { action: "claim", descriptor: current.body.tabs[0].descriptor }, source())
    expect(claimed.metadata.code).toBeUndefined()
    const inspected = await execute(execution, { action: "inspect", tab: claimed.body.tab }, source())
    await execute(execution, { action: "scroll", tab: claimed.body.tab, view: inspected.body.view, deltaX: 0, deltaY: 5 }, source())
    const capture = await execute(execution, { action: "screenshot", tab: claimed.body.tab }, source())
    expect(capture.metadata.code).toBeUndefined()
    expect(requests.map((request) => request.capability)).toEqual(["discovery", "claim", "site"])
    expect(requests.at(-1)?.documentOrigin).toBe("https://fixture.test")
    await execute(execution, { action: "finalize" }, source())
    expect(requests).toHaveLength(3)
    await execution.end()
  })

  test("denied site access is not cached as approval", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("denied-site"))
    const created = await execute(execution, { action: "create" })
    const denied = await execute(execution, { action: "inspect", tab: created.body.tab }, invocation({ authorize: async () => "deny" }))
    expect(denied.metadata.code).toBe("permission_denied")
    expect((await execute(execution, { action: "inspect", tab: created.body.tab })).metadata.code).toBeUndefined()
    await execution.end()
  })

  test("explicit finalization closes unmarked tabs once and returns verification before execution end", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("explicit-finalize"))
    const created = await execute(execution, { action: "create" })
    const finalized = await execute(execution, { action: "finalize" })
    expect(finalized.body.cleanup).toMatchObject({ confirmed: true, retained: 0, nativeConfirmed: true })
    expect(fixture.tabs.has(10)).toBe(false)
    const count = fixture.count("turnEnded")
    expect((await execute(execution, { action: "finalize" })).body.cleanup).toEqual(finalized.body.cleanup)
    expect((await execute(execution, { action: "inspect", tab: created.body.tab })).metadata.code).toBe("stale_handle")
    await execution.end()
    expect(fixture.count("turnEnded")).toBe(count)
  })

  test("failed explicit finalization never falls back to closing a handoff", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("failed-finalize"))
    const created = await execute(execution, { action: "create" })
    await execute(execution, { action: "keep", tab: created.body.tab, disposition: "handoff" })
    fixture.hook = (call) => call.method === "finalizeTabs" ? Promise.reject(new Error("keep failed")) : undefined
    const finalized = await execute(execution, { action: "finalize" })
    expect(finalized.metadata.code).toBe("cleanup_unconfirmed")
    expect(finalized.body.cleanup.confirmed).toBe(false)
    const count = fixture.count("finalizeTabs")
    await execute(execution, { action: "finalize" })
    await execution.end()
    expect(fixture.count("finalizeTabs")).toBe(count)
    expect(fixture.count("turnEnded")).toBe(0)
    expect(fixture.tabs.has(10)).toBe(true)
  })

  test("automatic handoff protects the tab without requesting routine approval", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const execution = owner.begin(identity("denied-fallback"))
    await execute(execution, { action: "create" }, invocation({
      authorize: async (request) => request.capability === "handoff" ? "deny" : "allow",
    }))
    const reports = await execution.end()
    expect(reports).toMatchObject([{ confirmed: true, retained: 1 }])
    expect(fixture.tabs.has(10)).toBe(true)
    expect(fixture.count("turnEnded")).toBe(0)
    expect(fixture.count("finalizeTabs")).toBe(1)
    const next = owner.begin(identity("denied-fallback"))
    expect((await execute(next, { action: "resume" })).body.tabs).toHaveLength(1)
    await next.end()
  })

  test("missing browser cannot infer foreign or expired tabs or select a default", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const first = owner.begin(identity("implicit-original"))
    const target = await page(first)
    const other = owner.begin(identity("implicit-other"))
    const before = fixture.calls.length
    for (const tab of [target.tab, "tab_forged", target.ref]) {
      expect((await other.execute({ action: "inspect", tab }, invocation())).metadata.code).toBe("stale_handle")
    }
    expect((await first.execute({ action: "inspect", tab: target.ref }, invocation())).metadata.code).toBe(
      "stale_handle",
    )
    expect((await other.execute({ action: "create" }, invocation())).metadata.code).toBe("browser_required")
    expect(fixture.calls.length).toBe(before)
    await other.end()
    await first.end()
    const resumed = owner.begin(identity("implicit-original"))
    const after = fixture.calls.length
    expect((await resumed.execute({ action: "inspect", tab: target.tab }, invocation())).metadata.code).toBe(
      "stale_handle",
    )
    expect(fixture.calls.length).toBe(after)
    await resumed.end()
  })

  test("reclaims more than 64 browser-free sessions without connecting", async () => {
    const owner = new BrowserToolOwner({
      connections: [{ id: "fixture", label: "Unused", directory: "/tmp/tandem/not-a-browser" }],
    })
    owners.push(owner)
    for (let i = 0; i < 70; i++) {
      const execution = owner.begin(identity(`empty-${i}`))
      expect((await execute(execution, { action: "browsers" })).body.browsers).toHaveLength(1)
      expect(await execution.end()).toEqual([])
      expect(() => owner.current(identity(`empty-${i}`))).toThrow()
    }
  })

  test("reclaims more than eight browser sessions after confirmed cleanup", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    for (let i = 0; i < 12; i++) {
      const execution = owner.begin(identity(`used-${i}`))
      expect((await execute(execution, { action: "create" })).metadata.outcome).toBe("confirmed")
      expect((await execute(execution, { action: "finalize" })).body.cleanup.confirmed).toBe(true)
      const reports = await execution.end()
      expect(reports.length).toBeGreaterThan(0)
      expect(reports.every((report) => report.confirmed && report.retained === 0)).toBe(true)
      expect([...fixture.tabs.values()].filter((tab) => tab.agent)).toHaveLength(0)
    }
    expect(fixture.count("createTab")).toBe(12)
    expect(fixture.count("turnEnded")).toBe(12)
    expect([...fixture.tabs.keys()]).toEqual([1, 2])
  })

  test("rejects forged, foreign, forked and previous-turn aliases without native dispatch", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const first = owner.begin(identity("original"))
    const target = await page(first)
    const fork = owner.begin(identity("fork"))
    const before = fixture.count("executeCdp")
    for (const tab of [target.tab, "tab_forged", "10"]) {
      expect((await execute(fork, { action: "inspect", tab })).metadata.code).toBe("stale_handle")
    }
    expect(fixture.count("executeCdp")).toBe(before)
    await fork.end()
    await first.end()
    const resumed = owner.begin(identity("original"))
    const calls = fixture.count("executeCdp")
    expect((await execute(resumed, { action: "inspect", tab: target.tab })).metadata.code).toBe("stale_handle")
    expect((await execute(first, { action: "inspect", tab: target.tab })).metadata.code).toBe("stale_handle")
    expect(fixture.count("executeCdp")).toBe(calls)
    await resumed.end()
  })

  test("supersedes refs and rejects same-URL reloaded frame handles", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("refs"))
    const target = await page(execution)
    const fresh = await execute(execution, { action: "inspect", tab: target.tab })
    expect(fresh.body.elements[0].ref).not.toBe(target.ref)
    const before = fixture.count("Input.dispatchMouseEvent")
    expect(
      (await execute(execution, { action: "type", tab: target.tab, ref: target.ref, mode: "replace", text: "wrong" }))
        .metadata.code,
    ).toBe("stale_handle")
    expect(
      (await execute(execution, { action: "click", tab: target.tab, view: target.view, x: 10, y: 10 })).metadata.code,
    ).toBe("stale_handle")
    fixture.tabs.get(10)!.loader++
    const reloaded = await execute(execution, { action: "inspect", tab: target.tab, frame: fresh.body.frames[0].frame })
    expect(reloaded.metadata.code).toBe("stale_handle")
    expect(fixture.count("Input.dispatchMouseEvent")).toBe(before)
    const refreshed = await execute(execution, { action: "inspect", tab: target.tab })
    expect(refreshed.metadata.outcome).toBe("confirmed")
    expect(
      (
        await execute(execution, {
          action: "scroll",
          tab: target.tab,
          view: refreshed.body.view,
          deltaX: 1,
          deltaY: 20,
        })
      ).metadata.outcome,
    ).toBe("confirmed")
    expect(refreshed.body.elements[0].ref).toMatch(/^ref_/)
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    await execution.end()
  })

  test("concurrent duplicate mutation joins once and changed input conflicts", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("duplicate"))
    const target = await page(execution)
    const entered = deferred(),
      release = deferred()
    fixture.hook = (call) => {
      if (!wheel(call)) return
      entered.resolve()
      return release.promise.then(() => fixture.reply(call))
    }
    disposers.push(() => release.resolve())
    const source = invocation()
    const input: BrowserToolInput = { action: "scroll", tab: target.tab, view: target.view, deltaX: 1, deltaY: 20 }
    const first = execute(execution, input, source)
    await entered.promise
    const second = execute(execution, input, source)
    expect((await execute(execution, { ...input, deltaY: 40 }, source)).metadata.code).toBe("duplicate_conflict")
    release.resolve()
    const results = await Promise.all([first, second])
    expect(results[0].text).toBe(results[1].text)
    expect(results[0].metadata.outcome).toBe("confirmed")
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    expect(fixture.calls.find(wheel)!.params.commandParams.deltaY).toBe(20)
    expect((await execute(execution, input, source)).text).toBe(results[0].text)
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    await execution.end()
  })

  test("admits 256 unique calls, preserves deduplication at the bound, then resets next execution", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const execution = owner.begin(identity("bounded"))
    const source = invocation()
    const first = await execute(execution, { action: "browsers" }, source)
    for (let i = 1; i < 256; i++)
      expect((await execute(execution, { action: "browsers" })).metadata.code).toBeUndefined()
    expect((await execute(execution, { action: "browsers" })).metadata.code).toBe("resource_limit")
    expect((await execute(execution, { action: "browsers" }, source)).text).toBe(first.text)
    expect((await execute(execution, { action: "create" }, source)).metadata.code).toBe("duplicate_conflict")
    expect(fixture.calls).toHaveLength(0)
    await execution.end()
    const next = owner.begin(identity("bounded"))
    expect((await execute(next, { action: "create" })).metadata.outcome).toBe("confirmed")
    await next.end()
  })

  test("routes parallel approvals to their invocation and exposes only trusted selected-tab context", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("parallel"))
    const discovery = await execute(execution, { action: "discover" })
    const entered = deferred(),
      release = deferred<"allow">()
    const requests: { call: string; request: AuthorizationRequest }[] = []
    const a = execute(
      execution,
      { action: "claim", descriptor: discovery.body.tabs[0].descriptor },
      invocation({
        authorize: async (request) => {
          requests.push({ call: "a", request })
          if (request.capability === "claim") {
            entered.resolve()
            return release.promise
          }
          return "allow"
        },
      }),
    )
    disposers.push(() => release.resolve("allow"))
    await entered.promise
    const b = await execute(
      execution,
      { action: "claim", descriptor: discovery.body.tabs[1].descriptor },
      invocation({
        authorize: async (request) => {
          requests.push({ call: "b", request })
          return "allow"
        },
      }),
    )
    expect(b.metadata.outcome).toBe("confirmed")
    expect(fixture.tabs.get(1)!.attached).toBe(false)
    expect(fixture.tabs.get(2)!.attached).toBe(true)
    release.resolve("allow")
    expect((await a).metadata.outcome).toBe("confirmed")
    for (const { call, request } of requests) {
      const index = call === "a" ? 0 : 1
      expect(request.tabScope).toBe(discovery.body.tabs[index].descriptor)
      expect(request.tabTitle).toBe(index === 0 ? "User One" : "User Two")
    }
    await execution.end()
    expect([...fixture.tabs.values()].every((tab) => !tab.attached && !tab.session)).toBe(true)
  })

  for (const failure of ["denied", "native-failure"] as const)
    test(`${failure} keep preserves tabs without destructive fallback`, async () => {
      const fixture = await Fixture.start()
      const execution = fixture.owner().begin(identity("denied-keep"))
      const target = await page(execution)
      const requests: AuthorizationRequest[] = []
      if (failure === "native-failure")
        fixture.hook = (call) =>
          call.method === "finalizeTabs" ? Promise.reject(new Error("Fixture finalization failed")) : undefined
      expect(
        (
          await execute(
            execution,
            { action: "keep", tab: target.tab, disposition: "deliverable" },
            invocation({
              authorize: async (request) => {
                requests.push(request)
                return failure === "denied" && request.capability === "handoff" ? "deny" : "allow"
              },
            }),
          )
        ).body.outcome,
      ).toBe("not_dispatched")
      expect(requests).toHaveLength(0)
      const reports = await execution.end()
      expect(reports.some((report) => !report.confirmed)).toBe(failure === "native-failure")
      expect(requests).toHaveLength(0)
      expect(fixture.tabs.has(10)).toBe(true)
      expect(fixture.count("turnEnded")).toBe(0)
      expect(fixture.count("finalizeTabs")).toBe(1)
      expect(await execution.end()).toEqual(reports)
    })

  for (const decision of ["deny", "cancel", "throw"] as const)
    test(`authorization ${decision} fails closed before tab discovery`, async () => {
      const fixture = await Fixture.start()
      const execution = fixture.owner().begin(identity(`permission-${decision}`))
      const result = await execute(
        execution,
        { action: "discover" },
        invocation({
          authorize: async () => {
            if (decision === "throw") throw new Error("Fixture callback failed")
            return decision
          },
        }),
      )
      expect(result.metadata.code).toBe(decision === "cancel" ? "permission_cancelled" : "permission_denied")
      expect(result.metadata.outcome).toBe("not_dispatched")
      expect(fixture.count("getUserTabs")).toBe(0)
      expect(fixture.count("claimUserTab")).toBe(0)
      expect(fixture.count("attach")).toBe(0)
      await execution.end()
    })

  test("confirmed handoff resumes with fresh aliases and session close releases it", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const first = owner.begin(identity("handoff"))
    const target = await page(first)
    await execute(first, { action: "keep", tab: target.tab, disposition: "handoff" })
    expect((await first.end()).every((report) => report.confirmed && report.retained === 1)).toBe(true)
    expect(fixture.tabs.get(10)!.attached).toBe(false)
    const next = owner.begin(identity("handoff"))
    const resumed = await execute(next, { action: "resume" })
    expect(resumed.body.tabs).toHaveLength(1)
    expect(resumed.body.tabs[0]).not.toBe(target.tab)
    expect((await execute(next, { action: "inspect", tab: target.tab })).metadata.code).toBe("stale_handle")
    expect((await execute(next, { action: "inspect", tab: resumed.body.tabs[0] })).metadata.outcome).toBe("confirmed")
    await execute(next, { action: "keep", tab: resumed.body.tabs[0], disposition: "handoff" })
    await next.end()
    expect((await owner.closeSession(identity("handoff"))).every((report) => report.confirmed)).toBe(true)
    expect(fixture.tabs.get(10)!.attached).toBe(false)
    expect(fixture.tabs.get(10)!.session).toBeUndefined()
  })

  test("cancelled dispatched mutation retains opaque status metadata without replay or foreign access", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    const execution = owner.begin(identity("unknown"))
    const target = await page(execution)
    const entered = deferred(),
      release = deferred()
    fixture.hook = (call) => {
      if (!wheel(call)) return
      fixture.reply(call)
      entered.resolve()
      return release.promise.then(() => ({}))
    }
    disposers.push(() => release.resolve())
    const abort = new AbortController()
    const source = invocation({ signal: abort.signal })
    const pending = execute(
      execution,
      { action: "scroll", tab: target.tab, view: target.view, deltaX: 1, deltaY: 20 },
      source,
    )
    await entered.promise
    abort.abort()
    const cancelled = await pending
    expect(cancelled.metadata.outcome).toBe("unknown")
    expect(cancelled.metadata.operation).toMatch(/^operation_[a-f0-9-]+$/)
    expect(cancelled.metadata.operation).toBe(cancelled.body.operation)
    expect(cancelled.metadata.browser).toBe("fixture")
    const foreign = owner.begin(identity("foreign-status"))
    expect((await execute(foreign, { action: "status", operation: cancelled.metadata.operation })).metadata.code).toBe(
      "stale_handle",
    )
    release.resolve()
    let status = await execute(execution, { action: "status", operation: cancelled.metadata.operation })
    const deadline = Date.now() + 2000
    while (status.body.state !== "settled" && Date.now() < deadline) {
      await Bun.sleep(5)
      status = await execute(execution, { action: "status", operation: cancelled.metadata.operation })
    }
    expect(status.body.state).toBe("settled")
    expect(status.body.operation).toBe(cancelled.metadata.operation)
    expect(status.body.steps).toBeUndefined()
    const quarantined = await execute(execution, {
      action: "scroll",
      tab: target.tab,
      view: target.view,
      deltaX: 1,
      deltaY: 40,
    })
    expect(["stale_handle", "operation_uncertain"]).toContain(quarantined.metadata.code ?? "")
    expect(
      (
        await execute(
          execution,
          { action: "scroll", tab: target.tab, view: target.view, deltaX: 1, deltaY: 20 },
          source,
        )
      ).text,
    ).toBe(cancelled.text)
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    expect(fixture.calls.find(wheel)!.params.commandParams.deltaY).toBe(20)
    await foreign.end()
    await execution.end()
  })

  for (const failure of ["cancel", "unknown"] as const)
    test(`${failure} setup reports its actual cleanup outcome`, async () => {
      const fixture = await Fixture.start()
      const filename = (await readdir(fixture.directory)).find((name) => /^host-.*\.json$/.test(name))!
      const discovery = JSON.parse(await readFile(join(fixture.directory, filename), "utf8"))
      const directory = join(fixture.directory, "relay")
      await mkdir(directory, { mode: 0o700 })
      const entered = deferred(),
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
              entered.resolve()
              if (failure === "unknown") throw new BrowserError("disconnected", "registration", "unknown")
              await release.promise
            }
            return result
          },
        })
        peers.push(upstream, downstream)
      })
      disposers.push(() => {
        release.resolve()
        for (const peer of peers) peer.close()
        server.close()
      })
      await new Promise<void>((resolve) => server.listen(join(directory, discovery.socket), resolve))
      await chmod(join(directory, discovery.socket), 0o600)
      await writeFile(join(directory, filename), JSON.stringify(discovery), { mode: 0o600 })
      const execution = fixture.owner(directory).begin(identity("setup"))
      const abort = new AbortController()
      const pending = execute(execution, { action: "create" }, invocation({ signal: abort.signal }))
      await entered.promise
      if (failure === "unknown") {
        const failed = await pending
        expect(failed.metadata.outcome).toBe("unknown")
        const reports = await execution.end()
        expect(reports.length).toBeGreaterThan(0)
        expect(reports.some((report) => !report.confirmed && report.code === "cleanup_unconfirmed")).toBe(true)
        expect(fixture.count("createTab")).toBe(0)
        expect(fixture.count("turnEnded")).toBe(0)
        expect(await execution.end()).toEqual(reports)
        return
      }
      const started = Date.now()
      abort.abort()
      const cancelled = await pending
      expect(Date.now() - started).toBeLessThan(250)
      expect(cancelled.metadata.code).toBe("cancelled")
      expect(cancelled.metadata.outcome).toBe("not_dispatched")
      expect(fixture.count("createTab")).toBe(0)
      const ending = execution.end()
      release.resolve()
      expect((await ending).every((report) => report.confirmed)).toBe(true)
      expect(fixture.count("createTab")).toBe(0)
      expect(fixture.count("turnEnded")).toBe(1)
    })

  test("rejects a spoofed descriptor before approval and binds valid input to its actual tab", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("spoofed-approval"))
    const discovered = await execute(execution, { action: "discover" })
    const claimed = await execute(execution, { action: "claim", descriptor: discovered.body.tabs[1].descriptor })
    const inspected = await execute(execution, { action: "inspect", tab: claimed.body.tab })
    const requests: AuthorizationRequest[] = []
    const source = () =>
      invocation({
        authorize: async (request) => {
          requests.push(request)
          return "allow"
        },
      })
    const input: BrowserToolInput = {
      action: "scroll",
      tab: claimed.body.tab,
      view: inspected.body.view,
      deltaX: 1,
      deltaY: 20,
    }
    const before = fixture.calls.length
    expect(
      (await execute(execution, { ...input, descriptor: discovered.body.tabs[0].descriptor }, source())).metadata.code,
    ).toBe("unsupported")
    expect(requests).toHaveLength(0)
    expect(fixture.calls).toHaveLength(before)
    expect((await execute(execution, input, source())).metadata.outcome).toBe("confirmed")
    expect(requests).toHaveLength(0) // The inspected site's turn-scoped access is already approved.
    expect(requests.every((request) => request.tabScope === claimed.body.tab && request.tabTitle === "User Two")).toBe(
      true,
    )
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    expect(fixture.calls.find(wheel)!.params.target.tabId).toBe(2)
    await execution.end()
  })

  test("reserves the last operation slot before admitting concurrent failures", async () => {
    const fixture = await Fixture.start()
    const owner = fixture.owner()
    fixture.hook = (call) =>
      call.method === "getUserTabs" ? Promise.reject(new Error("Fixture discovery failure")) : undefined
    const first = owner.begin(identity("operation-capacity"))
    for (let i = 0; i < 255; i++) {
      const failed = await execute(first, { action: "discover" })
      expect(failed.metadata.outcome).toBe("confirmed")
      expect(failed.metadata.operation).toMatch(/^operation_/)
    }
    await first.end()
    const next = owner.begin(identity("operation-capacity"))
    const entered = deferred(),
      release = deferred<"allow">()
    disposers.push(() => release.resolve("allow"))
    const source = invocation({
      authorize: async () => {
        entered.resolve()
        return release.promise
      },
    })
    const pending = execute(next, { action: "discover" }, source)
    await entered.promise
    const overflow = await execute(next, { action: "discover" })
    expect(overflow.metadata.code).toBe("resource_limit")
    expect(overflow.metadata.outcome).toBe("not_dispatched")
    expect(fixture.count("getUserTabs")).toBe(255)
    release.resolve("allow")
    const settled = await pending
    expect(settled.metadata.outcome).toBe("confirmed")
    expect(settled.metadata.operation).toMatch(/^operation_/)
    expect((await execute(next, { action: "discover" }, source)).text).toBe(settled.text)
    expect(fixture.count("getUserTabs")).toBe(256)
    await next.end()
  })

  test("observes cached defect rejection while preserving the same failure for duplicate callers", async () => {
    const owner = new BrowserToolOwner({
      connections: [{ id: "fixture", label: "Fault injection", directory: "/tmp/tandem/no-connection" }],
    })
    owners.push(owner)
    const defect = new Error("Injected unexpected setup defect")
    // Exercise the exported adapter boundary's exceptional hook path; ordinary BrowserErrors become envelopes.
    const execution = new BrowserToolExecution(
      owner,
      {
        identity: identity("cached-defect"),
        caller: "trusted-caller",
        browsers: new Map(),
        operations: new Map(),
      },
      {
        controller: async () => {
          throw defect
        },
        source: () => {},
        finished: () => {},
      },
    )
    const unhandled: unknown[] = []
    const observe = (error: unknown) => {
      unhandled.push(error)
    }
    process.on("unhandledRejection", observe)
    try {
      const source = invocation()
      await expect(execute(execution, { action: "discover" }, source)).rejects.toBe(defect)
      await Bun.sleep(0)
      expect(unhandled).toEqual([])
      await expect(execute(execution, { action: "discover" }, source)).rejects.toBe(defect)
      await execution.end()
    } finally {
      process.off("unhandledRejection", observe)
    }
  })

  test("screenshot modality and unverified capture setup fail explicitly before dispatch", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("capture-gates"))
    const denied = await execute(execution, { action: "screenshot", tab: "tab_unused" })
    expect(denied.metadata.code).toBe("unsupported_modality")
    expect(denied.metadata.outcome).toBe("not_dispatched")
    const unverified = await execute(
      execution,
      { action: "screenshot", tab: "tab_unused" },
      invocation({ vision: true }),
    )
    expect(unverified.metadata.code).toBe("capture_unverified")
    expect(unverified.metadata.outcome).toBe("not_dispatched")
    expect(denied.image).toBeUndefined()
    expect(unverified.image).toBeUndefined()
    expect(fixture.calls).toHaveLength(0)
    expect(await execution.end()).toEqual([])
  })

  test("a new screenshot supersedes coordinate aliases without replaying a duplicate capture", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner(fixture.directory, true).begin(identity("capture-views"))
    const target = await page(execution)
    const input: BrowserToolInput = { action: "screenshot", tab: target.tab }
    const source = invocation({ vision: true })
    const first = await execute(execution, input, source)
    expect(first.metadata.outcome).toBe("confirmed")
    expect(first.image?.mime).toBe("image/png")
    expect(first.image?.width).toBe(1)
    expect(first.image?.height).toBe(1)
    expect(first.body.viewValid).toBe(true)
    const duplicate = await execute(execution, input, source)
    expect(duplicate.metadata.code).toBe("already_settled")
    expect(duplicate.image).toBeUndefined()
    expect(fixture.count("Page.startScreencast")).toBe(1)
    const second = await execute(execution, input, invocation({ vision: true }))
    expect(second.body.view).not.toBe(first.body.view)
    const before = fixture.count("Input.dispatchMouseEvent")
    for (const view of [target.view, first.body.view]) {
      const stale = await execute(execution, { action: "click", tab: target.tab, view, x: 10, y: 10 })
      expect(stale.metadata.code).toBe("stale_handle")
      expect(stale.metadata.outcome).toBe("not_dispatched")
    }
    expect(fixture.count("Input.dispatchMouseEvent")).toBe(before)
    expect(
      (await execute(execution, { action: "scroll", tab: target.tab, view: second.body.view, deltaX: 1, deltaY: 20 }))
        .metadata.outcome,
    ).toBe("confirmed")
    expect(fixture.calls.filter(wheel)).toHaveLength(1)
    await execution.end()
  })

  test("model observations contain aliases, never transport identities or paths", async () => {
    const fixture = await Fixture.start()
    const execution = fixture.owner().begin(identity("private-session"))
    const discovery = await execute(execution, { action: "discover" })
    const target = await page(execution)
    const inspection = await execute(execution, { action: "inspect", tab: target.tab })
    const browsers = await execute(execution, { action: "browsers" })
    const output = JSON.stringify([discovery.body, inspection.body, browsers.body])
    for (const secret of [
      fixture.directory,
      "private-session",
      execution.id,
      "native-top-frame",
      "native-element-ref",
      "loader-1",
    ])
      expect(output).not.toContain(secret)
    for (const call of fixture.calls) {
      if (call.params?.session_id) expect(output).not.toContain(call.params.session_id)
      if (call.params?.turn_id) expect(output).not.toContain(call.params.turn_id)
    }
    expect(discovery.body.tabs[0].descriptor).toMatch(/^descriptor_/)
    expect(inspection.body.elements[0].ref).toMatch(/^ref_/)
    expect(inspection.body.frames[0].frame).toMatch(/^frame_/)
    expect(inspection.body.view).toMatch(/^view_/)
    const before = fixture.calls.length
    expect(
      (await execute(execution, { action: "create", session_id: "forged" } as BrowserToolInput)).metadata.code,
    ).toBe("unsupported")
    expect(fixture.calls.length).toBe(before)
    await execution.end()
  })
})
