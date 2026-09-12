import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { createConnection, createServer } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { connect, EXTENSION_ORIGIN, privateDirectory } from "../src/client"
import { MAX_READ_BYTES, MAX_WRITE_BYTES, RpcPeer } from "../src/native"

const root = "/tmp/tandem/chrome-bridge"
const hostPath = fileURLToPath(new URL("../src/host.ts", import.meta.url))
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)

beforeAll(async () => {
  process.on("unhandledRejection", onUnhandled)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await chmod(root, 0o700)
})

afterAll(async () => {
  await Bun.sleep(20)
  process.off("unhandledRejection", onUnhandled)
  expect(unhandled).toEqual([])
})

type Handler = (method: string, params: unknown) => unknown | Promise<unknown>

class TestHost {
  readonly child: ChildProcessWithoutNullStreams
  readonly extension: RpcPeer
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  readonly stderr: string[] = []
  discovery!: { socket: string; pid: number; parentPid: number }

  private constructor(
    readonly runDir: string,
    child: ChildProcessWithoutNullStreams,
    handler: Handler,
  ) {
    this.child = child
    child.stderr.on("data", (chunk: Buffer) => this.stderr.push(chunk.toString("utf8")))
    this.exited = new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code, signal) => resolve({ code, signal }))
    })
    this.extension = new RpcPeer(child.stdout, child.stdin, {
      maxRead: MAX_WRITE_BYTES,
      maxWrite: MAX_READ_BYTES,
      onRequest: handler,
    })
  }

  static async start(
    handler: Handler = (method) => {
      throw new Error(`Unsupported extension method: ${method}`)
    },
    directory?: string,
  ) {
    const runDir = directory ?? (await makeRunDir())
    const child = spawn(process.execPath, [hostPath, EXTENSION_ORIGIN], {
      cwd: runDir,
      env: childEnvironment(runDir),
      stdio: ["pipe", "pipe", "pipe"],
    })
    const result = new TestHost(runDir, child, handler)
    const discoveryPath = await waitFor(async () => {
      const files = (await readdir(runDir)).filter((name) => /^host-[a-f0-9-]+\.json$/.test(name))
      for (const file of files) {
        const data = JSON.parse(await readFile(join(runDir, file), "utf8"))
        if (data.pid === child.pid) return join(runDir, file)
      }
      return undefined
    })
    result.discovery = JSON.parse(await readFile(discoveryPath, "utf8"))
    return result
  }

  async stop() {
    if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGTERM")
    try {
      await within(this.exited, 1000)
    } catch {
      this.child.kill("SIGKILL")
      await within(this.exited, 1000)
    }
    if (!this.extension.closed) this.extension.close()
    await rm(this.runDir, { recursive: true, force: true })
  }
}

function childEnvironment(runDir: string): NodeJS.ProcessEnv {
  return {
    HOME: join(runDir, "home"),
    LANG: "C.UTF-8",
    TANDEM_CHROME_BRIDGE_RUN_DIR: runDir,
    TMPDIR: runDir,
  }
}

async function makeRunDir() {
  await mkdir(root, { recursive: true, mode: 0o700 })
  const runDir = await mkdtemp(join(root, "test-"))
  await chmod(runDir, 0o700)
  await mkdir(join(runDir, "home"), { mode: 0o700 })
  return runDir
}

async function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, timeoutMs = 2000): Promise<T> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const value = await check()
    if (value !== undefined) return value
    await Bun.sleep(5)
  }
  throw new Error("condition was not reached")
}

async function within<T>(promise: Promise<T>, timeoutMs = 1000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>(
        (_, reject) => (timer = setTimeout(() => reject(new Error("operation was not bounded")), timeoutMs)),
      ),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function capture<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  )
}

function socketPath(host: TestHost) {
  return join(host.runDir, host.discovery.socket)
}

function rawController(host: TestHost) {
  const socket = createConnection(socketPath(host))
  return new RpcPeer(socket, socket, { maxRead: MAX_READ_BYTES, maxWrite: MAX_WRITE_BYTES })
}

describe("native host subprocess", () => {
  test("rejects older v2 hosts without preservation capability before any browser work", async () => {
    const directory = await makeRunDir()
    const epoch = randomUUID()
    const name = `host-${epoch}`
    const path = join(directory, `${name}.sock`)
    const calls: string[] = []
    let peer: RpcPeer | undefined
    const server = createServer((socket) => {
      peer = new RpcPeer(socket, socket, {
        onRequest(method) {
          calls.push(method)
          return { version: 2, epoch }
        },
      })
    })
    try {
      await new Promise<void>((resolve) => server.listen(path, resolve))
      await chmod(path, 0o600)
      await writeFile(
        join(directory, `${name}.json`),
        JSON.stringify({ version: 2, epoch, origin: EXTENSION_ORIGIN, socket: `${name}.sock` }),
        { mode: 0o600 },
      )
      await expect(connect(directory)).rejects.toMatchObject({ code: "protocol_error", outcome: "not_dispatched" })
      expect(calls).toEqual(["bridge.hello"])
    } finally {
      peer?.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })

  test.each(["denied", "cancelled", "throws", "pending"])(
    "uncommitted %s keep survives disconnect without any lifecycle dispatch",
    async (decision) => {
      const calls: string[] = []
      const host = await TestHost.start((method) => {
        calls.push(method)
        return method === "createTab" ? { id: 7 } : null
      })
      const client = await connect(host.runDir)
      const turn = { session_id: "preserved", turn_id: "turn" }
      const keep = [{ tabId: 7, status: "deliverable" as const }]
      try {
        await client.call("createTab", turn)
        expect(await client.preserveTurn({ ...turn, keep })).toEqual({ preserved: true })
        const journal = join(host.runDir, `journal-${client.discovery.epoch}.json`)
        const saved = JSON.parse(await readFile(journal, "utf8"))
        expect(saved.sessions[0]).toMatchObject({ ...turn, keep, preservationPending: true, state: "blocked" })
        // Neither denial nor an outstanding permission promise authorizes endTurn.
        const authorization = capture(
          (async () => {
            if (decision === "throws") throw new Error("Authorization failed")
            if (decision === "pending") return new Promise(() => {})
            return decision === "denied" ? "deny" : "cancel"
          })(),
        )
        if (decision !== "pending") await authorization
        await expect(client.call("read", turn)).rejects.toMatchObject({
          code: "stale_handle",
          outcome: "not_dispatched",
        })
        await expect(client.endTurn({ ...turn, keep: [] })).rejects.toMatchObject({
          code: "stale_handle",
          outcome: "not_dispatched",
        })
        client.close()
        await waitFor(() => (host.stderr.join("").includes("cleanup unconfirmed") ? true : undefined))
        expect(calls).toEqual(["createTab"])
        expect(JSON.parse(await readFile(journal, "utf8")).sessions[0].preservationPending).toBe(true)
        host.child.kill("SIGTERM")
        await within(host.exited)
        expect(calls).toEqual(["createTab"])
        expect(JSON.parse(await readFile(journal, "utf8")).sessions[0].keep).toEqual(keep)
      } finally {
        client.close()
        await host.stop()
      }
    },
  )

  test("only explicit matching endTurn commits preservation authorization", async () => {
    const calls: Array<[string, unknown]> = []
    const host = await TestHost.start((method, params) => {
      calls.push([method, params])
      if (method === "createTab") return { id: 7 }
      if (method === "executeCdp") return { targetInfos: [{ id: "target-7", type: "page", tabId: 7, attached: false }] }
      return null
    })
    const client = await connect(host.runDir)
    const intent = { session_id: "commit", turn_id: "turn", keep: [{ tabId: 7, status: "deliverable" as const }] }
    try {
      await client.call("createTab", { session_id: intent.session_id, turn_id: intent.turn_id })
      await Promise.all([client.preserveTurn(intent), client.preserveTurn(intent)])
      expect(calls.map(([method]) => method)).toEqual(["createTab"])
      const results = await Promise.all([client.endTurn(intent), client.endTurn(intent)])
      expect(results[0]).toMatchObject({ status: "confirmed", nativeConfirmed: true })
      expect(results[1]).toEqual(results[0])
      expect(calls.filter(([method]) => method === "finalizeTabs")).toEqual([["finalizeTabs", intent]])
      expect(calls.some(([method]) => method === "turnEnded")).toBe(false)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("controller SIGKILL after preservation acknowledgement cannot authorize cleanup", async () => {
    const calls: string[] = []
    const host = await TestHost.start((method) => {
      calls.push(method)
      return method === "createTab" ? { id: 7 } : null
    })
    const source = `import {connect} from ${JSON.stringify(fileURLToPath(new URL("../src/client.ts", import.meta.url)))}; const c=await connect(${JSON.stringify(host.runDir)}); const t={session_id:"crash-keep",turn_id:"turn"}; await c.call("createTab",t); await c.preserveTurn({...t,keep:[{tabId:7,status:"deliverable"}]}); process.stdout.write("preserved"); await new Promise(()=>{});`
    const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "ignore"] })
    const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    try {
      await within(new Promise<void>((resolve) => child.stdout!.once("data", () => resolve())))
      child.kill("SIGKILL")
      await within(exit)
      await waitFor(() => (host.stderr.join("").includes("cleanup unconfirmed") ? true : undefined))
      expect(calls).toEqual(["createTab"])
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await host.stop()
    }
  })

  test("host SIGKILL preserves pending keep journal and blocks unknown-epoch recovery", async () => {
    const first = await TestHost.start((method) => (method === "createTab" ? { id: 7 } : null))
    const client = await connect(first.runDir)
    let second: TestHost | undefined
    const turn = { session_id: "killed-host", turn_id: "turn" }
    try {
      await client.call("createTab", turn)
      await client.preserveTurn({ ...turn, keep: [{ tabId: 7, status: "deliverable" }] })
      const path = join(first.runDir, `journal-${client.discovery.epoch}.json`)
      const original = await readFile(path, "utf8")
      first.child.kill("SIGKILL")
      await within(first.exited)
      const calls: string[] = []
      second = await TestHost.start((method) => {
        calls.push(method)
        return null
      }, first.runDir)
      const next = await connect(second.runDir, { hostId: second.discovery.socket.replace(".sock", "") })
      try {
        expect((await next.status()).recovery).toBe("cleanup_unconfirmed")
        await expect(next.registerTurn(turn)).rejects.toMatchObject({
          code: "cleanup_unconfirmed",
          outcome: "not_dispatched",
        })
        expect(await readFile(path, "utf8")).toBe(original)
        expect(calls).toEqual([])
      } finally {
        next.close()
      }
    } finally {
      client.close()
      if (second) await second.stop()
      await first.stop()
    }
  })

  test("a prior-boot journal is retired without replay or rewriting its uncertainty", async () => {
    const first = await TestHost.start(() => null)
    const client = await connect(first.runDir)
    let second: TestHost | undefined
    try {
      await client.registerTurn({ session_id: "old-boot", turn_id: "turn" })
      const path = join(first.runDir, `journal-${client.discovery.epoch}.json`)
      const value = JSON.parse(await readFile(path, "utf8"))
      value.processStart = `${randomUUID()}:${value.processStart.split(":")[1]}`
      await writeFile(path, JSON.stringify(value), { mode: 0o600 })
      const original = await readFile(path, "utf8")
      const calls: string[] = []
      second = await TestHost.start((method) => { calls.push(method); return null }, first.runDir)
      const next = await connect(second.runDir, { hostId: second.discovery.socket.replace(".sock", "") })
      try {
        expect((await next.status()).recovery).toBe("ready")
        expect(await readFile(path, "utf8")).toBe(original)
        expect(calls).toEqual([])
      } finally {
        next.close()
      }
    } finally {
      client.close()
      if (second) await second.stop()
      await first.stop()
    }
  })

  test("a killed but unreaped process is not a live recovery owner", async () => {
    const parent = spawn(
      "python3",
      [
        "-c",
        "import os,sys\npid=os.fork()\nif pid == 0: os._exit(0)\nprint(pid,flush=True)\nsys.stdin.read()\nos.waitpid(pid,0)",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
    const exited = new Promise<void>((resolve) => parent.once("exit", () => resolve()))
    const first = await TestHost.start(() => null)
    const client = await connect(first.runDir)
    let second: TestHost | undefined
    try {
      const pid = await within(
        new Promise<number>((resolve) => parent.stdout.once("data", (data) => resolve(Number(String(data).trim())))),
      )
      const start = await waitFor(async () => {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8")
        const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
        return fields[0] === "Z" ? fields[19] : undefined
      })
      await client.registerTurn({ session_id: "zombie-owner", turn_id: "turn" })
      const path = join(first.runDir, `journal-${client.discovery.epoch}.json`)
      const value = JSON.parse(await readFile(path, "utf8"))
      value.pid = pid
      value.processStart = `${value.processStart.split(":")[0]}:${start}`
      await writeFile(path, JSON.stringify(value), { mode: 0o600 })
      second = await TestHost.start(() => null, first.runDir)
      const next = await connect(second.runDir, { hostId: second.discovery.socket.replace(".sock", "") })
      try {
        expect((await next.status()).recovery).toBe("cleanup_unconfirmed")
      } finally {
        next.close()
      }
    } finally {
      parent.stdin.end()
      await within(exited)
      client.close()
      if (second) await second.stop()
      await first.stop()
    }
  })

  test("negotiates v2 and rejects unregistered scoped raw IPC", async () => {
    const calls: string[] = []
    const host = await TestHost.start((method) => {
      calls.push(method)
      return null
    })
    const peer = rawController(host)
    try {
      await expect(peer.request("bridge.hello", { version: 1 }, 300)).rejects.toMatchObject({
        code: "protocol_error",
        outcome: "not_dispatched",
      })
      await expect(peer.request("bridge.hello", { version: 2 }, 300)).resolves.toMatchObject({ version: 2 })
      await expect(
        peer.request(
          "bridge.call",
          {
            method: "createTab",
            params: { session_id: "s", turn_id: "t" },
            operationId: "op",
            deadline: Date.now() + 500,
          },
          1000,
        ),
      ).rejects.toMatchObject({ code: "stale_handle", outcome: "not_dispatched" })
      expect(calls).toEqual([])
    } finally {
      peer.close()
      await host.stop()
    }
  })

  test("returns typed controller_busy without disrupting the owner", async () => {
    const host = await TestHost.start(() => null)
    const client = await connect(host.runDir)
    try {
      await expect(connect(host.runDir)).rejects.toMatchObject({ code: "controller_busy", outcome: "not_dispatched" })
      expect((await client.status()).pid).toBe(host.child.pid!)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("selects one of two live discoveries only with explicit hostId", async () => {
    const first = await TestHost.start(() => "one")
    const second = await TestHost.start(() => "two", first.runDir)
    try {
      await expect(connect(first.runDir)).rejects.toMatchObject({ code: "ambiguous_browser" })
      const a = await connect(first.runDir, { hostId: first.discovery.socket.replace(".sock", ".json") })
      const b = await connect(second.runDir, { hostId: second.discovery.socket.replace(".sock", "") })
      try {
        expect(a.discovery.epoch).not.toBe(b.discovery.epoch)
        expect(await a.call<string>("read")).toBe("one")
        expect(await b.call<string>("read")).toBe("two")
      } finally {
        a.close()
        b.close()
      }
    } finally {
      await second.stop()
      await first.stop()
    }
  })

  test("abort settles promptly, quarantines only its session, and records late success without replay", async () => {
    let release!: (value: unknown) => void
    let started = false
    let count = 0
    const host = await TestHost.start((method) => {
      if (method === "mutate") {
        count++
        started = true
        return new Promise((resolve) => {
          release = resolve
        })
      }
      return null
    })
    const client = await connect(host.runDir)
    const s = { session_id: "a", turn_id: "one" }
    const abort = new AbortController()
    try {
      const result = capture(client.call("mutate", s, 10000, { signal: abort.signal, operationId: "cancel-me" }))
      await waitFor(() => (started ? true : undefined))
      abort.abort()
      const settled = await within(result, 250)
      expect(settled).toMatchObject({
        ok: false,
        error: { code: "cancelled", operationId: "cancel-me", outcome: "unknown" },
      })
      await waitFor(async () =>
        (await client.operationStatus("cancel-me"))?.state === "unresolved" ? true : undefined,
      )
      await expect(client.call("read", s)).rejects.toMatchObject({
        code: "operation_uncertain",
        outcome: "not_dispatched",
      })
      await expect(client.call("read", { session_id: "b", turn_id: "one" })).resolves.toBeNull()
      release("late")
      await waitFor(async () =>
        (await client.operationStatus("cancel-me"))?.outcome === "confirmed" ? true : undefined,
      )
      await expect(client.call("read", s)).resolves.toBeNull()
      expect(count).toBe(1)
      await expect(client.call("mutate", s, 1000, { operationId: "cancel-me" })).rejects.toMatchObject({
        code: "operation_uncertain",
      })
    } finally {
      release?.(null)
      client.close()
      await host.stop()
    }
  })

  test("pre-aborted calls dispatch nothing and return not_dispatched", async () => {
    const calls: string[] = []
    const host = await TestHost.start((m) => {
      calls.push(m)
      return null
    })
    const client = await connect(host.runDir)
    try {
      const abort = new AbortController()
      abort.abort()
      await expect(
        client.call("createTab", { session_id: "s", turn_id: "t" }, 1000, { signal: abort.signal }),
      ).rejects.toMatchObject({ code: "cancelled", outcome: "not_dispatched" })
      expect(calls).toEqual([])
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("bounds active sessions and writes a private payload-free intent before acquisition", async () => {
    let intent: unknown
    const host = await TestHost.start(async (method) => {
      if (method === "createTab") {
        const file = (await readdir(host.runDir)).find((f) => f.startsWith("journal-"))!
        intent = JSON.parse(await readFile(join(host.runDir, file), "utf8"))
        return { id: 7 }
      }
      if (method === "executeCdp") return { targetInfos: [] }
      return null
    })
    const client = await connect(host.runDir)
    try {
      for (let i = 0; i < 8; i++) await client.registerTurn({ session_id: `s${i}`, turn_id: "t" })
      await expect(client.registerTurn({ session_id: "overflow", turn_id: "t" })).rejects.toMatchObject({
        code: "resource_limit",
      })
      await client.call(
        "createTab",
        { session_id: "s0", turn_id: "t", url: "https://secret.example/", text: "secret text" },
        1000,
        { operationId: "intent" },
      )
      expect(intent).toMatchObject({
        version: 2,
        operations: [{ operationId: "intent", kind: "create", state: "preparing", outcome: "unknown" }],
      })
      expect(JSON.stringify(intent)).not.toContain("secret")
      const file = (await readdir(host.runDir)).find((f) => f.startsWith("journal-"))!
      expect((await lstat(join(host.runDir, file))).mode & 0o777).toBe(0o600)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("uses exact keep contract once and never falls back after failed finalization", async () => {
    const calls: Array<[string, unknown]> = []
    const host = await TestHost.start((method, params) => {
      calls.push([method, params])
      if (method === "createTab") return { id: 7 }
      if (method === "finalizeTabs") throw new Error("private page title")
      return null
    })
    const client = await connect(host.runDir)
    const turn = { session_id: "keep", turn_id: "turn" }
    try {
      await client.call("createTab", turn)
      const end = { ...turn, keep: [{ tabId: 7, status: "deliverable" as const }] }
      const [a, b] = await Promise.all([client.endTurn(end), client.endTurn(end)])
      expect(a.status).toBe("cleanup_unconfirmed")
      expect(b).toEqual(a)
      expect(calls.filter(([method]) => method === "finalizeTabs")).toEqual([["finalizeTabs", end]])
      client.close()
      await Bun.sleep(30)
      expect(calls.some(([method]) => method === "turnEnded")).toBe(false)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("does not mistake a void cleanup acknowledgement for verified tab cleanup", async () => {
    const host = await TestHost.start((method) => (method === "createTab" ? { id: 7 } : undefined))
    const client = await connect(host.runDir)
    const turn = { session_id: "s", turn_id: "t" }
    try {
      await client.call("createTab", turn)
      expect(await client.endTurn(turn)).toMatchObject({ status: "cleanup_unconfirmed", nativeConfirmed: true })
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("late native errors retain bounded diagnostic codes without leaking messages", async () => {
    let release!: () => void
    let started = false
    const blocked = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = await TestHost.start(async (method) => {
      if (method === "mutate") {
        started = true
        await blocked
        throw new Error("secret cookie=" + "x".repeat(50000))
      }
      return null
    })
    const client = await connect(host.runDir)
    try {
      const pending = capture(
        client.call("mutate", { session_id: "s", turn_id: "t" }, 250, { operationId: "late-error" }),
      )
      await waitFor(() => (started ? true : undefined))
      expect(await pending).toMatchObject({
        ok: false,
        error: { code: "deadline_exceeded", operationId: "late-error", outcome: "unknown" },
      })
      release()
      await waitFor(async () =>
        (await client.operationStatus("late-error"))?.outcome === "confirmed" ? true : undefined,
      )
      expect(await client.operationStatus("late-error")).toMatchObject({
        state: "settled",
        outcome: "confirmed",
        code: "native_error",
      })
      const failure = await capture(client.call("mutate", {}, 1000, { operationId: "direct-error" }))
      expect(failure).toMatchObject({
        ok: false,
        error: { code: "native_error", outcome: "confirmed", diagnosticCode: -32603 },
      })
      expect(JSON.stringify(failure)).not.toContain("secret")
      expect(host.stderr.join("")).not.toContain("secret")
    } finally {
      release()
      client.close()
      await host.stop()
    }
  })

  test("journal ownership tampering fails before privileged dispatch", async () => {
    let calls = 0
    const host = await TestHost.start(() => {
      calls++
      return null
    })
    const client = await connect(host.runDir)
    try {
      const file = (await readdir(host.runDir)).find((f) => f.startsWith("journal-"))!
      const path = join(host.runDir, file)
      const value = JSON.parse(await readFile(path, "utf8"))
      value.owner = randomUUID()
      await writeFile(path, JSON.stringify(value), { mode: 0o600 })
      await expect(client.call("mutate", {}, 1000)).rejects.toMatchObject({
        code: "cleanup_unconfirmed",
        outcome: "not_dispatched",
      })
      expect(calls).toBe(0)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("shutdown does not delete a journal reassigned to another owner", async () => {
    const host = await TestHost.start(() => null)
    try {
      const path = join(host.runDir, host.discovery.socket.replace(/^host-/, "journal-").replace(/\.sock$/, ".json"))
      const saved = JSON.parse(await readFile(path, "utf8"))
      saved.owner = randomUUID()
      const replacement = JSON.stringify(saved)
      await writeFile(path, replacement, { mode: 0o600 })
      host.child.kill("SIGTERM")
      await within(host.exited)
      expect(await readFile(path, "utf8")).toBe(replacement)
    } finally {
      await host.stop()
    }
  })

  test("reserves lifecycle capacity when ordinary native admission is full", async () => {
    let release!: (value: unknown) => void
    const pending = new Promise((resolve) => {
      release = resolve
    })
    let calls = 0
    const host = await TestHost.start((method) => {
      if (method === "wait") {
        calls++
        return pending
      }
      return null
    })
    const client = await connect(host.runDir)
    try {
      await client.registerTurn({ session_id: "cleanup", turn_id: "turn" })
      const work = Array.from({ length: 24 }, (_, i) =>
        capture(client.call("wait", {}, 3000, { operationId: `wait-${i}` })),
      )
      await waitFor(() => (calls === 24 ? true : undefined))
      await expect(client.call("overflow")).rejects.toMatchObject({ code: "resource_limit", outcome: "not_dispatched" })
      expect((await client.endTurn({ session_id: "cleanup", turn_id: "turn" })).status).toBe("confirmed")
      release(null)
      expect((await Promise.all(work)).every((result) => result.ok)).toBe(true)
    } finally {
      release(null)
      client.close()
      await host.stop()
    }
  })

  test("enforces tab acquisition bounds before the seventeenth dispatch", async () => {
    let tabs = 0
    const host = await TestHost.start((method) =>
      method === "createTab" ? { id: ++tabs } : method === "executeCdp" ? { targetInfos: [] } : null,
    )
    const client = await connect(host.runDir)
    const turn = { session_id: "tabs", turn_id: "turn" }
    try {
      for (let i = 0; i < 16; i++) await client.call("createTab", turn)
      await expect(client.call("createTab", turn)).rejects.toMatchObject({
        code: "resource_limit",
        outcome: "not_dispatched",
      })
      expect(tabs).toBe(16)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("evicts bounded status history without allowing operation-ID replay", async () => {
    const host = await TestHost.start(() => null)
    const client = await connect(host.runDir)
    try {
      for (let i = 0; i < 260; i++) await client.call("read", {}, 1000, { operationId: `history-${i}` })
      expect(await client.operationStatus("history-0")).toBeNull()
      expect(await client.operationStatus("history-259")).toMatchObject({ state: "settled", outcome: "confirmed" })
      await expect(client.call("read", {}, 1000, { operationId: "history-0" })).rejects.toMatchObject({
        code: "operation_uncertain",
        outcome: "not_dispatched",
      })
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("handoff verification does not reactivate the just-ended session", async () => {
    const turn = { session_id: "handoff-session", turn_id: "turn" }
    let observer: unknown
    const host = await TestHost.start((method, params) => {
      if (method === "createTab") return { id: 7 }
      if (method === "executeCdp") {
        observer = params
        return { targetInfos: [{ id: "target-7", type: "page", tabId: 7, attached: false }] }
      }
      return null
    })
    const client = await connect(host.runDir)
    try {
      await client.call("createTab", turn)
      expect(await client.endTurn({ ...turn, keep: [{ tabId: 7, status: "handoff" }] })).toMatchObject({
        status: "confirmed",
        nativeConfirmed: true,
      })
      expect(observer).not.toMatchObject({ session_id: turn.session_id })
      await expect(client.registerTurn({ session_id: turn.session_id, turn_id: "next" })).resolves.toMatchObject({
        registered: true,
      })
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("controller process kill orders cleanup after its late acquisition", async () => {
    let release!: (value: unknown) => void
    const events: string[] = []
    const host = await TestHost.start((method) => {
      if (method === "createTab") {
        events.push("create")
        return new Promise((resolve) => {
          release = resolve
        })
      }
      if (method === "turnEnded") events.push("end")
      return method === "executeCdp" ? { targetInfos: [] } : null
    })
    const source = `import {connect} from ${JSON.stringify(fileURLToPath(new URL("../src/client.ts", import.meta.url)))}; const c=await connect(${JSON.stringify(host.runDir)}); await c.call("createTab",{session_id:"crash",turn_id:"turn"},30000);`
    const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "ignore", "ignore"] })
    const exit = new Promise<void>((resolve) => child.once("exit", () => resolve()))
    try {
      await waitFor(() => (events.length ? true : undefined))
      child.kill("SIGKILL")
      await within(exit)
      await Bun.sleep(20)
      expect(events).toEqual(["create"])
      release({ id: 7 })
      await waitFor(() => (events.includes("end") ? true : undefined))
      expect(events).toEqual(["create", "end"])
    } finally {
      child.kill("SIGKILL")
      release?.({ id: 7 })
      await host.stop()
    }
  })

  test("SIGKILL recovery preserves unknown old-epoch leases without mutation replay", async () => {
    const first = await TestHost.start((method) => (method === "createTab" ? { id: 7 } : null))
    const client = await connect(first.runDir)
    let second: TestHost | undefined
    try {
      await client.call("createTab", { session_id: "old", turn_id: "turn" })
      first.child.kill("SIGKILL")
      await within(first.exited)
      const calls: string[] = []
      second = await TestHost.start((method) => {
        calls.push(method)
        return null
      }, first.runDir)
      const next = await connect(second.runDir, { hostId: second.discovery.socket.replace(".sock", "") })
      try {
        await expect(next.registerTurn({ session_id: "new", turn_id: "turn" })).rejects.toMatchObject({
          code: "cleanup_unconfirmed",
        })
        expect(calls).toEqual([])
      } finally {
        next.close()
      }
    } finally {
      client.close()
      if (second) await second.stop()
      await first.stop()
    }
  })

  test.each(["corrupt", "oversized", "symlink", "mode"])(
    "blocks %s recovery journal without native cleanup",
    async (fault) => {
      const dir = await makeRunDir()
      const path = join(dir, `journal-${randomUUID()}.json`)
      if (fault === "symlink") {
        await writeFile(join(dir, "target"), "do not change", { mode: 0o600 })
        await symlink(join(dir, "target"), path)
      } else
        await writeFile(path, fault === "oversized" ? "x".repeat(1024 * 1024 + 1) : "{}", {
          mode: fault === "mode" ? 0o644 : 0o600,
        })
      const calls: string[] = []
      const host = await TestHost.start((m) => {
        calls.push(m)
        return null
      }, dir)
      const client = await connect(dir)
      try {
        await expect(client.call("read")).rejects.toMatchObject({
          code: "cleanup_unconfirmed",
          outcome: "not_dispatched",
        })
        expect(calls).toEqual([])
        if (fault === "symlink") expect(await readFile(join(dir, "target"), "utf8")).toBe("do not change")
      } finally {
        client.close()
        await host.stop()
      }
    },
  )

  test("rejects a non-Chrome origin without writing diagnostics to stdout", async () => {
    const runDir = await makeRunDir()
    const child = spawn(process.execPath, [hostPath, "https://example.test/"], {
      cwd: runDir,
      env: childEnvironment(runDir),
      stdio: ["pipe", "pipe", "pipe"],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    const exit = new Promise<{ code: number | null }>((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code) => resolve({ code }))
    })

    try {
      expect((await within(exit)).code).toBe(1)
      expect(Buffer.concat(stdout)).toHaveLength(0)
      expect(Buffer.concat(stderr).toString()).toContain("startup failed")
      expect(Buffer.concat(stderr).toString()).not.toContain("example.test")
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL")
      await rm(runDir, { recursive: true, force: true })
    }
  })

  test("forwards RPC responses and extension events", async () => {
    const calls: Array<[string, unknown]> = []
    const host = await TestHost.start((method, params) => {
      calls.push([method, params])
      return { method, params }
    })
    const events: Array<[string, unknown]> = []
    const client = await connect(host.runDir, { onNotification: (method, params) => events.push([method, params]) })
    try {
      await expect(client.call("getInfo", { detail: true })).resolves.toEqual({
        method: "getInfo",
        params: { detail: true },
      })
      await host.extension.notify("tabChanged", { tabId: 42 })
      await waitFor(() => (events.length === 1 ? true : undefined))
      expect(calls).toEqual([["getInfo", { detail: true }]])
      expect(events).toEqual([["tabChanged", { tabId: 42 }]])
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("keeps heartbeats bidirectional while a CDP request is stalled", async () => {
    let release!: (value: unknown) => void
    let started = false
    const stalledResponse = new Promise((resolve) => (release = resolve))
    const host = await TestHost.start((method) => {
      if (method === "executeCdp") {
        started = true
        return stalledResponse
      }
      throw new Error(`unexpected method: ${method}`)
    })
    const client = await connect(host.runDir)
    try {
      const stalled = capture(client.call("executeCdp", {}, 1000))
      await waitFor(() => (started ? true : undefined))
      await expect(client.call("ping", {}, 200)).resolves.toBe("pong")
      await expect(host.extension.request("ping", undefined, 200)).resolves.toBe("pong")
      expect((await client.status()).heartbeats).toBeGreaterThanOrEqual(1)
      release({ done: true })
      expect(await stalled).toEqual({ ok: true, value: { done: true } })
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("creates private discovery artifacts and rejects a second controller", async () => {
    const host = await TestHost.start(() => null)
    const first = await connect(host.runDir)
    const second = rawController(host)
    try {
      expect((await lstat(host.runDir)).mode & 0o777).toBe(0o700)
      expect((await lstat(socketPath(host))).mode & 0o777).toBe(0o600)
      const discovery = join(host.runDir, host.discovery.socket.replace(/\.sock$/, ".json"))
      expect((await lstat(discovery)).mode & 0o777).toBe(0o600)
      await expect(within(second.request("bridge.status", {}, 300))).rejects.toThrow()
      await expect(first.status()).resolves.toMatchObject({ pid: host.child.pid, parentPid: process.pid })
    } finally {
      second.close()
      first.close()
      await host.stop()
    }
  })

  test("times out a mutation once and ignores its late response", async () => {
    let mutations = 0
    const host = await TestHost.start(async (method) => {
      if (method === "mutate") {
        mutations++
        await Bun.sleep(80)
        return { mutation: mutations }
      }
      if (method === "read") return mutations
      throw new Error("unknown")
    })
    const client = await connect(host.runDir)
    try {
      await expect(client.call("mutate", {}, 10)).rejects.toThrow("timed out")
      await Bun.sleep(100)
      await expect(client.call("read")).resolves.toBe(1)
      expect(mutations).toBe(1)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("rejects pending controller work promptly on native EOF", async () => {
    const host = await TestHost.start(() => new Promise(() => {}))
    const client = await connect(host.runDir)
    try {
      const pending = capture(client.call("never", {}, 30000))
      await Bun.sleep(10)
      host.child.stdin.end()
      const result = await within(pending, 1000)
      expect(result.ok).toBe(false)
      expect(host.extension.closed).toBe(true)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("rejects pending controller work promptly when the host is killed", async () => {
    const host = await TestHost.start(() => new Promise(() => {}))
    const client = await connect(host.runDir)
    try {
      const pending = capture(client.call("never", {}, 30000))
      await Bun.sleep(10)
      host.child.kill("SIGKILL")
      const result = await within(pending, 1000)
      expect(result.ok).toBe(false)
      await within(host.exited, 1000)
    } finally {
      client.close()
      await host.stop()
    }
  })

  test("cleans up a late scoped create after caller timeout and admits a fresh controller", async () => {
    let finishCreate!: (value: unknown) => void
    let createStarted = false
    const createResult = new Promise((resolve) => (finishCreate = resolve))
    const events: string[] = []
    const calls: Array<{ method: string; params: unknown }> = []
    const host = await TestHost.start(async (method, params) => {
      calls.push({ method, params })
      if (method === "createTab") {
        events.push("createTab started")
        createStarted = true
        const result = await createResult
        events.push("createTab completed")
        return result
      }
      if (method === "turnEnded") {
        events.push("turnEnded")
        return { cleaned: true }
      }
      if (method === "executeCdp") return { targetInfos: [] }
      return null
    })
    const first = await connect(host.runDir)
    const turn = { session_id: "phase1-session", turn_id: "phase1-turn" }
    try {
      const pending = capture(first.call("createTab", turn, 20))
      await waitFor(() => (createStarted ? true : undefined))
      expect((await within(pending)).ok).toBe(false)
      first.close()
      await Bun.sleep(20)
      expect(events).toEqual(["createTab started"])

      finishCreate({ tabId: 7 })
      await waitFor(() => (events.includes("turnEnded") ? true : undefined))
      expect(events).toEqual(["createTab started", "createTab completed", "turnEnded"])
      expect(calls.filter((call) => call.method !== "executeCdp")).toEqual([
        { method: "createTab", params: turn },
        { method: "turnEnded", params: turn },
      ])

      const next = await waitFor(async () => {
        try {
          return await connect(host.runDir, { timeoutMs: 200 })
        } catch {
          return undefined
        }
      })
      await expect(next.status()).resolves.toMatchObject({ pid: host.child.pid })
      next.close()
    } finally {
      first.close()
      await host.stop()
    }
  })

  test("SIGTERM ends an active turn before closing native transport and exits bounded", async () => {
    let finishCleanup!: (value: unknown) => void
    const cleanupResult = new Promise((resolve) => (finishCleanup = resolve))
    const events: string[] = []
    let cleanupParams: unknown
    const host = await TestHost.start(async (method, params) => {
      if (method === "createTab") {
        events.push("createTab")
        return { tabId: 9 }
      }
      if (method === "turnEnded") {
        cleanupParams = params
        events.push("turnEnded started")
        const result = await cleanupResult
        events.push("turnEnded completed")
        return result
      }
      if (method === "executeCdp") return { targetInfos: [] }
      return null
    })
    const client = await connect(host.runDir)
    const turn = { session_id: "signal-session", turn_id: "signal-turn" }
    let exited = false
    host.child.once("exit", () => (exited = true))
    try {
      await expect(client.call("createTab", turn)).resolves.toEqual({ tabId: 9 })
      expect(events).toEqual(["createTab"])

      host.child.kill("SIGTERM")
      await waitFor(() => (events.includes("turnEnded started") ? true : undefined))
      await Bun.sleep(20)
      expect(cleanupParams).toEqual(turn)
      expect(events).toEqual(["createTab", "turnEnded started"])
      expect(host.extension.closed).toBe(false)
      expect(exited).toBe(false)

      finishCleanup({ cleaned: true })
      await within(host.exited, 1000)
      expect(events).toEqual(["createTab", "turnEnded started", "turnEnded completed"])
      expect(host.stderr.join("")).not.toContain("cleanup unconfirmed")
    } finally {
      client.close()
      finishCleanup({ cleaned: true })
      await host.stop()
    }
  })

  test("returns an error for an unknown local method and remains usable", async () => {
    const host = await TestHost.start(() => null)
    const peer = rawController(host)
    try {
      await peer.request("bridge.hello", { version: 2 }, 300)
      await expect(peer.request("not.a.bridge.method", {}, 300)).rejects.toMatchObject({ code: "protocol_error" })
      await expect(peer.request("bridge.status", {}, 300)).resolves.toMatchObject({ pid: host.child.pid })
    } finally {
      peer.close()
      await host.stop()
    }
  })

  test("drops a malformed local client and accepts a clean reconnect", async () => {
    const host = await TestHost.start(() => null)
    const socket = createConnection(socketPath(host))
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve)
        socket.once("error", reject)
      })
      const malformed = Buffer.alloc(5)
      malformed.writeUInt32LE(1, 0)
      malformed[4] = "{".charCodeAt(0)
      socket.end(malformed)
      await within(new Promise<void>((resolve) => socket.once("close", () => resolve())))

      const client = await waitFor(async () => {
        try {
          return await connect(host.runDir, { timeoutMs: 200 })
        } catch {
          return undefined
        }
      })
      await expect(client.status()).resolves.toMatchObject({ pid: host.child.pid })
      client.close()
    } finally {
      socket.destroy()
      await host.stop()
    }
  })
})

describe("local discovery safety", () => {
  test("rejects non-private directories and paths containing symlinks", async () => {
    const runDir = await makeRunDir()
    const unsafe = join(runDir, "unsafe")
    const actual = join(runDir, "actual")
    const linked = join(runDir, "linked")
    await mkdir(unsafe, { mode: 0o755 })
    await mkdir(actual, { mode: 0o700 })
    await mkdir(join(actual, "child"), { mode: 0o700 })
    await symlink(actual, linked)
    try {
      await expect(privateDirectory(unsafe)).rejects.toThrow("owner-only")
      await expect(privateDirectory(join(linked, "child"))).rejects.toThrow("must not contain symlinks")
    } finally {
      await rm(runDir, { recursive: true, force: true })
    }
  })

  test("does not silently select stale or ambiguous discovery", async () => {
    const stale = await makeRunDir()
    const name = `host-${randomUUID()}`
    const manifest = join(stale, `${name}.json`)
    await writeFile(
      manifest,
      JSON.stringify({
        version: 2,
        epoch: randomUUID(),
        pid: 1,
        parentPid: 1,
        origin: EXTENSION_ORIGIN,
        executable: process.execPath,
        socket: `${name}.sock`,
      }),
      { mode: 0o600 },
    )
    try {
      await expect(connect(stale, { timeoutMs: 100 })).rejects.toMatchObject({
        code: "browser_unavailable",
        outcome: "not_dispatched",
      })
    } finally {
      await rm(stale, { recursive: true, force: true })
    }

    const ambiguous = await makeRunDir()
    await writeFile(join(ambiguous, `host-${randomUUID()}.json`), "{}", { mode: 0o600 })
    await writeFile(join(ambiguous, `host-${randomUUID()}.json`), "{}", { mode: 0o600 })
    try {
      await expect(connect(ambiguous, { timeoutMs: 100 })).rejects.toMatchObject({ code: "protocol_error" })
    } finally {
      await rm(ambiguous, { recursive: true, force: true })
    }
  })
})
