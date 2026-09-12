import { lstat, open, readdir, readFile, realpath } from "node:fs/promises"
import { constants } from "node:fs"
import { createConnection } from "node:net"
import { basename, join, resolve } from "node:path"
import { RpcPeer, MAX_READ_BYTES, MAX_WRITE_BYTES } from "./native"
import { randomUUID } from "node:crypto"
import { BrowserError, type Outcome } from "./errors"

export const BRIDGE_VERSION = 2
export type Turn = { session_id: string; turn_id: string }
export type Keep = { tabId: number; status: "handoff" | "deliverable" }
export type CleanupReport = Turn & {
  status: "confirmed" | "cleanup_unconfirmed"
  nativeConfirmed: boolean
  stage: "settlement" | "completion" | "verification"
  diagnosticCode?: number
}
export type OperationStatus = {
  operationId: string
  state: "preparing" | "dispatched" | "settled" | "unresolved"
  outcome: Outcome
  code?: string
}
export type BridgeStatus = {
  version: number
  epoch: string
  heartbeats: number
  notifications: number
  pid: number
  parentPid: number
  recovery: "ready" | "cleanup_unconfirmed"
  sessions: Array<Turn & { state: "active" | "ending" | "ended" | "blocked" }>
}

export const EXTENSION_ID = "hehggadaopoacecdllhhajmbjkdcmajg"
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`
export const HOST_NAME = "com.openai.codexextension"

export async function startIdentity(pid: number) {
  const [stat, boot] = await Promise.all([
    readFile(`/proc/${pid}/stat`, "utf8"),
    readFile("/proc/sys/kernel/random/boot_id", "utf8"),
  ])
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  if (fields[0] === "Z" || fields[0] === "X" || !/^\d+$/.test(fields[19] ?? ""))
    throw new Error("Journal owner is not live")
  return `${boot.trim()}:${fields[19]}`
}

export async function privateDirectory(path: string) {
  const directory = resolve(path)
  const info = await lstat(directory)
  if (!info.isDirectory() || info.uid !== process.getuid!() || (info.mode & 0o077) !== 0) {
    throw new Error("Bridge directory must be an owner-only directory (0700)")
  }
  if ((await realpath(directory)) !== directory) throw new Error("Bridge directory must not contain symlinks")
  return directory
}

export async function connect(
  runDir: string,
  options: {
    timeoutMs?: number
    hostId?: string
    onNotification?: (method: string, params: unknown) => void
    onDisconnect?: (error: BrowserError) => void
  } = {},
) {
  try {
    const directory = await privateDirectory(runDir)
    const selected = options.hostId?.replace(/\.json$/, "")
    if (selected !== undefined && !/^host-[a-f0-9-]+$/.test(selected))
      throw new BrowserError("protocol_error", "", "not_dispatched")
    const files = (await readdir(directory)).filter(
      (name) => /^host-[a-f0-9-]+\.json$/.test(name) && (!selected || name === `${selected}.json`),
    )
    if (files.length > 128) throw new BrowserError("resource_limit", "", "not_dispatched")
    const candidates = []
    for (const file of files) {
      const manifest = join(directory, file)
      const handle = await open(manifest, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      const data = await (async () => {
        try {
          const info = await handle.stat()
          if (
            !info.isFile() ||
            info.size > 4096 ||
            info.uid !== process.getuid!() ||
            (info.mode & 0o777) !== 0o600 ||
            info.nlink !== 1
          )
            throw new BrowserError("protocol_error", "", "not_dispatched")
          const bytes = Buffer.alloc(4097)
          const result = await handle.read(bytes, 0, bytes.length, 0)
          if (result.bytesRead > 4096) throw new BrowserError("protocol_error", "", "not_dispatched")
          return JSON.parse(bytes.subarray(0, result.bytesRead).toString("utf8"))
        } finally {
          await handle.close()
        }
      })()
      if (
        data.version !== BRIDGE_VERSION ||
        typeof data.epoch !== "string" ||
        !/^[a-f0-9-]{36}$/.test(data.epoch) ||
        data.origin !== EXTENSION_ORIGIN ||
        typeof data.socket !== "string" ||
        basename(data.socket) !== data.socket ||
        data.socket !== file.replace(/\.json$/, ".sock")
      ) {
        throw new BrowserError("protocol_error", "", "not_dispatched")
      }
      if (data.processStart !== undefined) {
        if (
          !Number.isSafeInteger(data.pid) ||
          data.pid < 1 ||
          typeof data.processStart !== "string" ||
          !/^[a-f0-9-]{36}:\d+$/.test(data.processStart)
        )
          throw new BrowserError("protocol_error", "", "not_dispatched")
        if ((await startIdentity(data.pid).catch(() => "")) !== data.processStart) continue
      }
      candidates.push(data)
    }
    if (candidates.length !== 1)
      throw new BrowserError(candidates.length ? "ambiguous_browser" : "browser_unavailable", "", "not_dispatched")
    const data = candidates[0]!
    const path = join(directory, data.socket)
    const socketInfo = await lstat(path).catch(() => {
      throw new Error("Stale native host discovery; start a fresh run")
    })
    if (!socketInfo.isSocket() || socketInfo.uid !== process.getuid!() || (socketInfo.mode & 0o077) !== 0) {
      throw new Error("Unsafe native host socket")
    }
    const socket = createConnection(path)
    const timeoutMs = options.timeoutMs ?? 5000
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error("Native host connection timed out"))
      }, timeoutMs)
      socket.once("connect", () => {
        clearTimeout(timer)
        resolve()
      })
      socket.once("error", () => {
        clearTimeout(timer)
        reject(new Error("Native host unavailable; discovery may be stale"))
      })
    })
    const peer = new RpcPeer(socket, socket, {
      maxRead: MAX_READ_BYTES,
      maxWrite: MAX_WRITE_BYTES,
      onNotification: options.onNotification,
      onClose: () => {
        try {
          options.onDisconnect?.(new BrowserError("disconnected", "", "unknown"))
        } catch {}
      },
    })
    try {
      const hello = await peer.request<{ version: number; epoch: string; capabilities?: string[] }>(
        "bridge.hello",
        { version: BRIDGE_VERSION },
        timeoutMs,
      )
      if (
        hello.version !== BRIDGE_VERSION ||
        hello.epoch !== data.epoch ||
        !Array.isArray(hello.capabilities) ||
        !hello.capabilities.includes("preserveTurn")
      )
        throw new BrowserError("protocol_error", "", "not_dispatched")
    } catch (error) {
      peer.close()
      throw error
    }
    const registered = new Map<string, Promise<unknown>>()
    const request = async <T>(method: string, params: unknown, timeout = 5000): Promise<T> => {
      try {
        return await peer.request<T>(method, params, timeout)
      } catch (error) {
        if (error instanceof BrowserError) throw error
        throw new BrowserError("disconnected", "", "unknown")
      }
    }
    const registerTurn = (turn: Turn) => {
      const key = JSON.stringify([turn.session_id, turn.turn_id])
      const found = registered.get(key)
      if (found) return found
      if (registered.size >= 256) registered.delete(registered.keys().next().value!)
      const promise = request("bridge.registerTurn", turn).catch((error) => {
        registered.delete(key)
        throw error
      })
      registered.set(key, promise)
      return promise
    }
    const endTurn = (turn: Turn & { keep?: Keep[] }) => request<CleanupReport>("bridge.endTurn", turn, 40000)
    return {
      discovery: data as {
        version: number
        epoch: string
        pid: number
        parentPid: number
        origin: string
        socket: string
        executable: string
      },
      async call<T = unknown>(
        method: string,
        params: unknown = {},
        deadlineMs = 15000,
        options: { signal?: AbortSignal; operationId?: string; cleanup?: boolean } = {},
      ): Promise<T> {
        const operationId = options.operationId ?? randomUUID()
        if (
          !/^[a-zA-Z0-9:_-]{1,128}$/.test(operationId) ||
          !Number.isSafeInteger(deadlineMs) ||
          deadlineMs < 1 ||
          deadlineMs > 30000
        )
          throw new BrowserError("protocol_error", operationId, "not_dispatched")
        const deadline = Date.now() + deadlineMs
        if (options.signal?.aborted) throw new BrowserError("cancelled", operationId, "not_dispatched")
        let submitted = false
        let timer: ReturnType<typeof setTimeout> | undefined
        let abort!: () => void
        const interrupted = new Promise<never>((_, reject) => {
          const cancel = (code: string) => {
            if (submitted) void peer.notify("bridge.cancel", { operationId, code }).catch(() => {})
            reject(new BrowserError(code, operationId, submitted ? "unknown" : "not_dispatched"))
          }
          abort = () => cancel("cancelled")
          options.signal?.addEventListener("abort", abort, { once: true })
          timer = setTimeout(() => cancel("deadline_exceeded"), deadlineMs)
        })
        try {
          const work = async () => {
            if (params && typeof params === "object" && "session_id" in params && "turn_id" in params) {
              const turn = params as Turn
              await registerTurn(turn)
              if (options.signal?.aborted || Date.now() >= deadline)
                throw new BrowserError(
                  options.signal?.aborted ? "cancelled" : "deadline_exceeded",
                  operationId,
                  "not_dispatched",
                )
              if (method === "turnEnded" || method === "finalizeTabs") {
                submitted = true
                return (await endTurn(method === "turnEnded" ? turn : (params as Turn & { keep: Keep[] }))) as T
              }
            }
            if (options.signal?.aborted || Date.now() >= deadline)
              throw new BrowserError(
                options.signal?.aborted ? "cancelled" : "deadline_exceeded",
                operationId,
                "not_dispatched",
              )
            submitted = true
            return await request<T>(
              "bridge.call",
              { method, params, deadline, operationId, ...(options.cleanup ? { cleanup: true } : {}) },
              deadlineMs + 1000,
            )
          }
          return await Promise.race([work(), interrupted])
        } catch (error) {
          if (error instanceof BrowserError)
            throw new BrowserError(error.code, operationId, error.outcome, undefined, error.diagnosticCode)
          throw new BrowserError("disconnected", operationId, submitted ? "unknown" : "not_dispatched")
        } finally {
          clearTimeout(timer)
          options.signal?.removeEventListener("abort", abort)
        }
      },
      registerTurn,
      preserveTurn(turn: Turn & { keep: Keep[] }) {
        return request<{ preserved: true }>("bridge.preserveTurn", turn)
      },
      endTurn,
      operationStatus(operationId: string) {
        return request<OperationStatus | null>("bridge.operationStatus", { operationId })
      },
      status() {
        return request<BridgeStatus>("bridge.status", {}, 5000)
      },
      close() {
        peer.close()
      },
    }
  } catch (error) {
    if (error instanceof BrowserError) throw error
    throw new BrowserError("browser_unavailable", "", "not_dispatched")
  }
}
