import { randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { chmod, lstat, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { endianness } from "node:os"
import { join } from "node:path"
import {
  BRIDGE_VERSION,
  EXTENSION_ORIGIN,
  privateDirectory,
  startIdentity,
  type CleanupReport,
  type Keep,
  type OperationStatus,
  type Turn,
} from "./client"
import { BrowserError } from "./errors"
import { MAX_READ_BYTES, MAX_WRITE_BYTES, RpcPeer, RpcTimeoutError } from "./native"

export const MAX_JOURNAL_BYTES = 1024 * 1024
export const MAX_SESSIONS = 8
export const MAX_WIRE_CALLS = 32
export const MAX_OPERATION_RECORDS = 256
export const MAX_OPERATION_IDS = 4096
const WIRE_TIMEOUT = 35000
type Lease = { tabId: number; origin: "agent" | "user"; status?: "handoff" | "deliverable" }
type Session = Turn & {
  state: "active" | "ending" | "ended" | "blocked"
  tabs: Lease[]
  keep?: Keep[]
  preservationPending?: boolean
  preservation?: Promise<{ preserved: true }>
  acquisitionUnknown?: boolean
  completion?: Promise<CleanupReport>
}
type Operation = OperationStatus & {
  session_id?: string
  kind: "create" | "claim" | "call"
  cancel?: (code: string) => void
  task?: Promise<unknown>
  tabId?: number
}
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)
const tabID = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0

export async function host(runDir: string, origin: string) {
  if (process.platform !== "linux" || endianness() !== "LE") throw new Error("Bridge requires little-endian Linux")
  if (origin !== EXTENSION_ORIGIN) throw new Error("Unexpected native-messaging caller origin")
  const directory = await privateDirectory(runDir)
  const epoch = randomUUID()
  const name = `host-${epoch}`
  const socketPath = join(directory, `${name}.sock`)
  if (Buffer.byteLength(socketPath) > 103) throw new Error("Native socket path too long")
  const discoveryPath = join(directory, `${name}.json`)
  const journalPath = join(directory, `journal-${epoch}.json`)
  const owner = randomUUID()
  const observer = { session_id: randomUUID(), turn_id: randomUUID() }
  const processStart = await startIdentity(process.pid)
  const parentStart = await startIdentity(process.ppid)
  let recoveryBlocked = false
  // A new host alone proves nothing. A browser born after an old host (or on
  // another boot) cannot own that host's leases. Retire only that quarantine;
  // never replay, clean up or rewrite the historical journal.
  const entries = await readdir(directory)
  const journals = entries.filter((file) => /^journal-.*\.json$/.test(file))
  if (
    entries.some(
      (file) => /^host-[a-f0-9-]+\.json$/.test(file) && !journals.includes(file.replace(/^host-/, "journal-")),
    )
  )
    recoveryBlocked = true
  if (journals.length > 64) recoveryBlocked = true
  for (const file of journals.slice(0, 65)) {
    try {
      const saved = await readJournal(join(directory, file))
      if (file !== `journal-${saved.epoch}.json`) throw new Error("Journal identity mismatch")
      const [browserBoot, browserTick] = parentStart.split(":")
      const [hostBoot, hostTick] = saved.processStart.split(":")
      const retired = browserBoot !== hostBoot || BigInt(browserTick!) > BigInt(hostTick!)
      if (saved.sessions.length && !retired && (await startIdentity(saved.pid).catch(() => "")) !== saved.processStart)
        recoveryBlocked = true
    } catch {
      recoveryBlocked = true
    }
  }
  let controller: RpcPeer | undefined
  let stopping: Promise<void> | undefined
  let cleaning: Promise<void> | undefined
  let notifications = 0
  let eventWrites = 0
  let journalFailed = false
  const sessions = new Map<string, Session>()
  const operations = new Map<string, Operation>()
  const operationIds = new Set<string>()
  let publication = Promise.resolve()
  await writeFile(
    journalPath,
    JSON.stringify({
      version: 2,
      epoch,
      owner,
      pid: process.pid,
      processStart,
      identity: { origin, profile: "unverified" },
      sessions: [],
      operations: [],
    }),
    { mode: 0o600, flag: "wx" },
  )
  const journalInode = (await lstat(journalPath)).ino
  let expectedInode = journalInode
  function persist() {
    const text = JSON.stringify({
      version: 2,
      epoch,
      owner,
      pid: process.pid,
      processStart,
      identity: { origin, profile: "unverified" },
      sessions: [...sessions.values()]
        .filter((s) => s.state !== "ended" || s.tabs.length)
        .map(({ session_id, turn_id, state, tabs, keep, preservationPending, acquisitionUnknown }) => ({
          session_id,
          turn_id,
          state,
          tabs,
          keep,
          preservationPending,
          acquisitionUnknown,
        })),
      operations: [...operations.values()]
        .filter((op) => op.session_id)
        .map(({ operationId, session_id, kind, state, outcome, tabId }) => ({
          operationId,
          session_id,
          kind,
          state,
          outcome: state === "preparing" ? "unknown" : outcome,
          tabId,
        })),
    })
    const task = publication
      .then(async () => {
        if (journalFailed || Buffer.byteLength(text) > MAX_JOURNAL_BYTES)
          throw new BrowserError("cleanup_unconfirmed", "", "not_dispatched")
        const info = await lstat(journalPath)
        if (
          !info.isFile() ||
          info.ino !== expectedInode ||
          info.uid !== process.getuid!() ||
          (info.mode & 0o777) !== 0o600 ||
          info.nlink !== 1
        )
          throw new Error("Unsafe journal")
        const current = await readJournal(journalPath)
        if (
          current.epoch !== epoch ||
          current.owner !== owner ||
          current.pid !== process.pid ||
          current.processStart !== processStart
        )
          throw new Error("Journal ownership changed")
        const temporary = `${journalPath}.${randomUUID()}.new`
        try {
          await writeFile(temporary, text, { mode: 0o600, flag: "wx" })
          await rename(temporary, journalPath)
          expectedInode = (await lstat(journalPath)).ino
        } finally {
          await unlink(temporary).catch(() => {})
        }
      })
      .catch(() => {
        journalFailed = true
        throw new BrowserError("cleanup_unconfirmed", "", "not_dispatched")
      })
    publication = task.catch(() => {})
    return task
  }
  await persist()
  const native = new RpcPeer(process.stdin, process.stdout, {
    allowVoidResponses: true,
    onNotification(method, params) {
      notifications++
      const recipient = controller
      if (!recipient) return
      if (++eventWrites > 256) {
        eventWrites--
        recipient.close()
        return
      }
      void recipient
        .notify(method, params)
        .catch(() => recipient.close())
        .finally(() => eventWrites--)
    },
    onClose() {
      void stop()
    },
  })
  const server = createServer((socket) => {
    socket.on("error", () => {})
    const busy = !!(controller || cleaning || stopping || native.closed)
    let negotiated = false
    const peer = new RpcPeer(socket, socket, {
      maxRead: MAX_WRITE_BYTES,
      maxWrite: MAX_READ_BYTES,
      onNotification(method, value) {
        if (!busy && negotiated && method === "bridge.cancel" && object(value) && identifier(value.operationId))
          operations
            .get(value.operationId)
            ?.cancel?.(value.code === "deadline_exceeded" ? "deadline_exceeded" : "cancelled")
      },
      async onRequest(method, value) {
        if (busy) throw new BrowserError("controller_busy", "", "not_dispatched")
        if (method === "bridge.hello") {
          if (!object(value) || value.version !== BRIDGE_VERSION)
            throw new BrowserError("protocol_error", "", "not_dispatched")
          negotiated = true
          return { version: BRIDGE_VERSION, epoch, capabilities: ["preserveTurn", "engineCleanup"] }
        }
        if (!negotiated) throw new BrowserError("protocol_error", "", "not_dispatched")
        if (method === "bridge.status")
          return {
            version: BRIDGE_VERSION,
            epoch,
            heartbeats: native.heartbeats,
            notifications,
            pid: process.pid,
            parentPid: process.ppid,
            recovery: recoveryBlocked || journalFailed ? "cleanup_unconfirmed" : "ready",
            sessions: [...sessions.values()].map(({ session_id, turn_id, state }) => ({ session_id, turn_id, state })),
          }
        if (method === "bridge.operationStatus") {
          if (!object(value) || !identifier(value.operationId))
            throw new BrowserError("protocol_error", "", "not_dispatched")
          const op = operations.get(value.operationId)
          return op ? { operationId: op.operationId, state: op.state, outcome: op.outcome, code: op.code } : null
        }
        if (method === "bridge.registerTurn") {
          const turn = parseTurn(value)
          if (recoveryBlocked || journalFailed) throw new BrowserError("cleanup_unconfirmed", "", "not_dispatched")
          const found = sessions.get(turn.session_id)
          if (found?.turn_id === turn.turn_id && found.state === "active") return { registered: true }
          if (found && found.state !== "ended") throw new BrowserError("stale_handle", "", "not_dispatched")
          if (found?.turn_id === turn.turn_id) throw new BrowserError("stale_handle", "", "not_dispatched")
          if (
            !found &&
            [...sessions.values()].filter((s) => s.state !== "ended" || s.tabs.length).length >= MAX_SESSIONS
          )
            throw new BrowserError("resource_limit", "", "not_dispatched")
          for (const [id, s] of sessions)
            if (s.state === "ended" && !s.tabs.length && id !== turn.session_id) sessions.delete(id)
          sessions.set(turn.session_id, { ...turn, state: "active", tabs: found?.tabs ?? [] })
          await persist()
          return { registered: true }
        }
        if (method === "bridge.preserveTurn" || method === "bridge.endTurn") {
          const turn = parseTurn(value)
          const s = sessions.get(turn.session_id)
          if (!s || s.turn_id !== turn.turn_id) throw new BrowserError("stale_handle", "", "not_dispatched")
          const keep = object(value) && value.keep !== undefined ? parseKeep(value.keep) : []
          if (method === "bridge.preserveTurn") {
            if (
              !object(value) ||
              !Array.isArray(value.keep) ||
              s.completion ||
              (s.state !== "active" && !s.preservationPending)
            )
              throw new BrowserError("stale_handle", "", "not_dispatched")
            if (s.preservation) {
              if (JSON.stringify(s.keep) !== JSON.stringify(keep))
                throw new BrowserError("stale_handle", "", "not_dispatched")
              return s.preservation
            }
            // Quarantine synchronously before publication yields: disconnect or
            // an authorization failure must never downgrade this to bare cleanup.
            s.keep = keep
            s.preservationPending = true
            s.state = "blocked"
            for (const op of operations.values()) if (op.session_id === s.session_id) op.cancel?.("cancelled")
            s.preservation = persist().then(() => ({ preserved: true as const }))
            return s.preservation
          }
          if (s.preservationPending) {
            if (JSON.stringify(s.keep) !== JSON.stringify(keep))
              throw new BrowserError("stale_handle", "", "not_dispatched")
            await s.preservation
          }
          if (s.completion) {
            if (JSON.stringify(s.keep) !== JSON.stringify(keep))
              throw new BrowserError("stale_handle", "", "not_dispatched")
            return s.completion
          }
          return finish(s, keep)
        }
        if (method !== "bridge.call" || !object(value)) throw new BrowserError("protocol_error", "", "not_dispatched")
        return dispatch(value)
      },
      onClose() {
        if (controller !== peer) return
        controller = undefined
        for (const op of operations.values()) op.cancel?.("disconnected")
        void cleanup()
      },
    })
    if (!busy) controller = peer
    // Bound idle/unnegotiated and rejected sockets without stealing ownership.
    const handshake = setTimeout(() => {
      if (busy || !negotiated) peer.close()
    }, 5000)
    socket.once("close", () => clearTimeout(handshake))
  })
  server.maxConnections = 32

  async function dispatch(value: Record<string, unknown>) {
    const id = value.operationId
    if (
      !identifier(id) ||
      typeof value.method !== "string" ||
      !value.method ||
      value.method.length > 128 ||
      typeof value.deadline !== "number" ||
      !Number.isSafeInteger(value.deadline) ||
      value.deadline > Date.now() + 30000
    )
      throw new BrowserError("protocol_error", "", "not_dispatched")
    if (operationIds.has(id)) throw new BrowserError("operation_uncertain", id, "not_dispatched")
    if (operationIds.size >= MAX_OPERATION_IDS) throw new BrowserError("resource_limit", id, "not_dispatched")
    if (value.deadline <= Date.now()) throw new BrowserError("deadline_exceeded", id, "not_dispatched")
    if (recoveryBlocked || journalFailed) throw new BrowserError("cleanup_unconfirmed", id, "not_dispatched")
    if (
      [...operations.values()].filter((op) => op.task || op.state === "preparing").length >=
      MAX_WIRE_CALLS - MAX_SESSIONS
    )
      throw new BrowserError("resource_limit", id, "not_dispatched")
    const params = value.params
    const scoped = object(params) && ("session_id" in params || "turn_id" in params)
    const turn = scoped ? parseTurn(params) : undefined
    const s = turn ? sessions.get(turn.session_id) : undefined
    const engineCleanup = value.cleanup === true && object(params) && (
      ["detach", "detachTarget"].includes(value.method) ||
      (value.method === "executeCdp" && object(params.commandParams) && (
        ["Runtime.removeBinding", "Page.removeScriptToEvaluateOnNewDocument", "Target.detachFromTarget", "Page.stopScreencast"].includes(String(params.method)) ||
        (params.method === "Runtime.evaluate" && typeof params.commandParams.expression === "string" &&
          /^globalThis\.__browserUseClipboardBridge\?\.bindingName === "[A-Za-z0-9_-]+" && globalThis\.__browserUseClipboardBridge\.cleanup\(\)$/.test(params.commandParams.expression))
      ))
    )
    if (value.cleanup === true && !engineCleanup) throw new BrowserError("unsupported", id, "not_dispatched")
    if (turn && (!s || s.turn_id !== turn.turn_id || (s.state !== "active" && !(s.state === "blocked" && s.preservationPending && !s.completion && engineCleanup))))
      throw new BrowserError("stale_handle", id, "not_dispatched")
    if (s && [...operations.values()].some((op) => op.session_id === s.session_id && op.state === "unresolved"))
      throw new BrowserError("operation_uncertain", id, "not_dispatched")
    if (value.method === "turnEnded" || value.method === "finalizeTabs" || value.method === "markTab")
      throw new BrowserError("unsupported", id, "not_dispatched")
    const kind = value.method === "createTab" ? "create" : value.method === "claimUserTab" ? "claim" : "call"
    if (kind !== "call" && !s) throw new BrowserError("stale_handle", id, "not_dispatched")
    if (
      s &&
      kind !== "call" &&
      s.tabs.length +
        [...operations.values()].filter(
          (op) => op.session_id === s.session_id && op.kind !== "call" && op.state !== "settled",
        ).length >=
        16
    )
      throw new BrowserError("resource_limit", id, "not_dispatched")
    if (kind === "claim" && (!object(params) || !tabID(params.tabId)))
      throw new BrowserError("protocol_error", id, "not_dispatched")
    while (operations.size >= MAX_OPERATION_RECORDS) {
      const old = [...operations].find(([, op]) => op.state === "settled")
      if (!old) throw new BrowserError("resource_limit", id, "not_dispatched")
      operations.delete(old[0])
    }
    const op: Operation = {
      operationId: id,
      session_id: s?.session_id,
      kind,
      state: "preparing",
      outcome: "not_dispatched",
      ...(kind === "claim" && object(params) ? { tabId: params.tabId as number } : {}),
    }
    operations.set(id, op)
    operationIds.add(id)
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let rejectCaller!: (error: BrowserError) => void
    const interrupted = new Promise<never>((_, reject) => {
      rejectCaller = reject
    })
    op.cancel = (code) => {
      if (op.state === "settled") return
      if (op.outcome === "not_dispatched") abort.abort()
      else {
        op.state = "unresolved"
        op.outcome = "unknown"
      }
      op.code = code
      rejectCaller(new BrowserError(code, id, op.outcome))
    }
    timer = setTimeout(() => op.cancel?.("deadline_exceeded"), Math.max(0, value.deadline - Date.now()))
    const work = (async () => {
      try {
        // Write intent before native dispatch, including ordinary scoped calls:
        // compound actions may have effects even if their final step never returns.
        await persist()
        if (abort.signal.aborted || op.code || Date.now() >= (value.deadline as number))
          throw new BrowserError(op.code ?? "deadline_exceeded", id, "not_dispatched")
        const wire = native.request(value.method as string, params, WIRE_TIMEOUT, {
          signal: abort.signal,
          deadline: value.deadline as number,
          onDispatch() {
            op.state = "dispatched"
            op.outcome = "unknown"
          },
        })
        const result = await wire
        op.state = "settled"
        op.outcome = "confirmed"
        delete op.code
        if (s && kind !== "call") {
          const tab = object(result) ? (result.id ?? result.tabId) : undefined
          if (tabID(tab)) {
            if (!s.tabs.some((t) => t.tabId === tab))
              s.tabs.push({ tabId: tab, origin: kind === "create" ? "agent" : "user" })
            op.tabId = tab
          } else s.acquisitionUnknown = true
        }
        await persist()
        if (Buffer.byteLength(JSON.stringify(result ?? null)) > MAX_READ_BYTES - 1024)
          throw new BrowserError("result_too_large", id, "confirmed")
        return result
      } catch (error) {
        const confirmed = object(error) && typeof error.code === "number"
        const outcome =
          op.outcome === "confirmed"
            ? "confirmed"
            : error instanceof BrowserError
              ? error.outcome
              : confirmed
                ? "confirmed"
                : op.outcome
        if (s && kind !== "call" && outcome !== "not_dispatched" && op.tabId === undefined) s.acquisitionUnknown = true
        if (
          s &&
          kind === "claim" &&
          outcome !== "not_dispatched" &&
          op.tabId !== undefined &&
          !s.tabs.some((tab) => tab.tabId === op.tabId)
        )
          s.tabs.push({ tabId: op.tabId, origin: "user" })
        op.outcome = outcome
        op.state = outcome === "unknown" ? "unresolved" : "settled"
        op.code =
          error instanceof BrowserError
            ? error.code
            : error instanceof RpcTimeoutError
              ? "deadline_exceeded"
              : confirmed
                ? "native_error"
                : "disconnected"
        await persist().catch(() => {})
        throw new BrowserError(
          op.code,
          id,
          outcome,
          undefined,
          confirmed ? Number((error as { code: number }).code) : undefined,
        )
      } finally {
        delete op.cancel
        delete op.task
      }
    })()
    op.task = work
    try {
      return await Promise.race([work, interrupted])
    } finally {
      clearTimeout(timer)
    }
  }

  function finish(s: Session, keep: Keep[]): Promise<CleanupReport> {
    if (s.completion) return s.completion
    s.state = "ending"
    s.preservationPending = false
    s.keep = keep
    for (const op of operations.values()) if (op.session_id === s.session_id) op.cancel?.("cancelled")
    s.completion = (async () => {
      const deadline = Date.now() + 39000
      let nativeConfirmed = false
      let stage: CleanupReport["stage"] = "settlement"
      let diagnosticCode: number | undefined
      const report = (confirmed: boolean, nativeConfirmed = false): CleanupReport => ({
        session_id: s.session_id,
        turn_id: s.turn_id,
        status: confirmed ? "confirmed" : "cleanup_unconfirmed",
        nativeConfirmed,
        stage,
        ...(diagnosticCode === undefined ? {} : { diagnosticCode }),
      })
      try {
        await persist()
        await Promise.allSettled(
          [...operations.values()]
            .filter((op) => op.session_id === s.session_id)
            .map((op) => op.task)
            .filter((p) => !!p),
        )
        if (
          native.closed ||
          journalFailed ||
          s.acquisitionUnknown ||
          [...operations.values()].some(
            (op) => op.session_id === s.session_id && (op.state === "unresolved" || op.state === "preparing"),
          )
        ) {
          s.state = "blocked"
          await persist()
          return report(false)
        }
        const params = { session_id: s.session_id, turn_id: s.turn_id }
        // Installed extension gg()/finalizeTabs validates precisely this keep shape
        // and ends the turn itself. Never follow uncertain keep with turnEnded.
        if (Date.now() >= deadline) throw new Error("Cleanup budget exhausted")
        stage = "completion"
        await native.request(
          keep.length ? "finalizeTabs" : "turnEnded",
          keep.length ? { ...params, keep } : params,
          Math.min(5000, deadline - Date.now()),
        )
        nativeConfirmed = true
        stage = "verification"
        s.state = "ended"
        // Completion internally uses best-effort detach. Its void acknowledgement
        // alone is not evidence that tabs/debuggers actually reached disposition.
        let verified = s.tabs.length === 0
        if (s.tabs.length) {
          if (Date.now() >= deadline) throw new Error("Cleanup budget exhausted")
          // executeCdp activates its session; using the ended session here would
          // accidentally resume handoff leases while trying to observe cleanup.
          const targets = await native.request<unknown>(
            "executeCdp",
            { ...observer, target: {}, method: "Target.getTargets", commandParams: {} },
            Math.min(3000, deadline - Date.now()),
          )
          if (
            object(targets) &&
            Array.isArray(targets.targetInfos) &&
            targets.targetInfos.every(
              (t) =>
                object(t) &&
                typeof t.id === "string" &&
                typeof t.type === "string" &&
                typeof t.attached === "boolean" &&
                (t.tabId === undefined ? t.type !== "page" : tabID(t.tabId)),
            )
          ) {
            const infos = targets.targetInfos
            verified = s.tabs.every((tab) => {
              const target = infos.find((t: { tabId?: number }) => t.tabId === tab.tabId)
              const preserved = tab.origin === "user" || keep.some((k) => k.tabId === tab.tabId)
              return preserved ? !!target && target.attached === false : !target
            })
          }
        }
        if (verified)
          s.tabs = s.tabs
            .filter((tab) => keep.some((k) => k.tabId === tab.tabId && k.status === "handoff"))
            .map((tab) => ({ ...tab, status: "handoff" }))
        else s.state = "blocked"
        await persist()
        return report(verified, true)
      } catch (error) {
        const code = (error as { code?: unknown })?.code
        if (typeof code === "number" && Number.isSafeInteger(code)) diagnosticCode = code
        s.state = "blocked"
        await persist().catch(() => {})
        return report(false, nativeConfirmed)
      }
    })()
    return s.completion
  }

  function cleanup() {
    if (cleaning) return cleaning
    cleaning = Promise.resolve()
      .then(async () => {
        const reports = await Promise.all(
          [...sessions.values()]
            .filter((s) => s.state !== "ended" && s.state !== "blocked" && !s.preservationPending)
            .map((s) => finish(s, s.keep ?? [])),
        )
        if (
          reports.some((r) => r.status === "cleanup_unconfirmed") ||
          [...sessions.values()].some((s) => s.state === "blocked")
        )
          process.stderr.write("chrome-bridge: turn cleanup unconfirmed\n")
      })
      .finally(() => {
        cleaning = undefined
      })
    return cleaning
  }
  function stop() {
    if (stopping) return stopping
    stopping = Promise.resolve().then(async () => {
      controller?.close()
      server.close()
      await cleanup()
      native.close()
      await publication
      await Promise.all([socketPath, discoveryPath, `${discoveryPath}.new`].map((path) => unlink(path).catch(() => {})))
      if (!journalFailed && ![...sessions.values()].some((s) => s.state !== "ended" || s.tabs.length)) {
        try {
          const current = await readJournal(journalPath)
          const info = await lstat(journalPath)
          if (
            info.ino === expectedInode &&
            current.epoch === epoch &&
            current.owner === owner &&
            current.pid === process.pid &&
            current.processStart === processStart
          )
            await unlink(journalPath)
        } catch {
          /* Preserve externally replaced or unverifiable recovery records. */
        }
      }
      process.removeListener("SIGTERM", signal)
      process.removeListener("SIGINT", signal)
    })
    return stopping
  }
  function signal() {
    void stop()
  }
  process.once("SIGTERM", signal)
  process.once("SIGINT", signal)
  server.on("error", () => {
    void stop()
  })
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, resolve)
    })
    await chmod(socketPath, 0o600)
    if (native.closed) throw new Error("Native connection ended during startup")
    await writeFile(
      `${discoveryPath}.new`,
      JSON.stringify({
        version: BRIDGE_VERSION,
        epoch,
        pid: process.pid,
        parentPid: process.ppid,
        processStart,
        origin,
        executable: process.execPath,
        socket: `${name}.sock`,
      }),
      { mode: 0o600, flag: "wx" },
    )
    await rename(`${discoveryPath}.new`, discoveryPath)
    if (native.closed || stopping) throw new Error("Native connection ended during publication")
    process.stderr.write("chrome-bridge: native host ready\n")
  } catch (error) {
    await stop()
    throw error
  }
  return { stop }
}

function parseTurn(value: unknown): Turn {
  if (!object(value) || !identifier(value.session_id) || !identifier(value.turn_id))
    throw new BrowserError("protocol_error", "", "not_dispatched")
  return { session_id: value.session_id, turn_id: value.turn_id }
}
function parseKeep(value: unknown): Keep[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    !value.every((k) => object(k) && tabID(k.tabId) && (k.status === "handoff" || k.status === "deliverable")) ||
    new Set(value.map((k) => k.tabId)).size !== value.length
  )
    throw new BrowserError("protocol_error", "", "not_dispatched")
  return value.map(({ tabId, status }) => ({ tabId, status })).sort((a, b) => a.tabId - b.tabId)
}
async function readJournal(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid!() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.nlink !== 1 ||
      stat.size > MAX_JOURNAL_BYTES
    )
      throw new Error("Unsafe journal")
    const bytes = Buffer.alloc(MAX_JOURNAL_BYTES + 1)
    const read = await handle.read(bytes, 0, bytes.length, 0)
    if (read.bytesRead > MAX_JOURNAL_BYTES) throw new Error("Oversized journal")
    const value: unknown = JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"))
    if (
      !object(value) ||
      value.version !== 2 ||
      !identifier(value.epoch) ||
      !identifier(value.owner) ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) < 1 ||
      typeof value.processStart !== "string" ||
      !/^[a-f0-9-]{36}:\d+$/.test(value.processStart) ||
      !object(value.identity) ||
      value.identity.origin !== EXTENSION_ORIGIN ||
      value.identity.profile !== "unverified" ||
      !Array.isArray(value.sessions) ||
      value.sessions.length > MAX_SESSIONS ||
      !Array.isArray(value.operations) ||
      value.operations.length > MAX_OPERATION_RECORDS
    )
      throw new Error("Invalid journal")
    for (const s of value.sessions) {
      parseTurn(s)
      if (
        !object(s) ||
        !["active", "ending", "ended", "blocked"].includes(String(s.state)) ||
        !Array.isArray(s.tabs) ||
        s.tabs.length > 16 ||
        !s.tabs.every((t) => object(t) && tabID(t.tabId) && (t.origin === "agent" || t.origin === "user"))
      )
        throw new Error("Invalid journal")
      if (s.keep !== undefined) parseKeep(s.keep)
      if (s.preservationPending !== undefined && typeof s.preservationPending !== "boolean")
        throw new Error("Invalid journal")
      if (s.preservationPending === true && (s.state !== "blocked" || s.keep === undefined))
        throw new Error("Invalid journal")
    }
    for (const op of value.operations)
      if (
        !object(op) ||
        !identifier(op.operationId) ||
        !identifier(op.session_id) ||
        !["create", "claim", "call"].includes(String(op.kind)) ||
        !["preparing", "dispatched", "settled", "unresolved"].includes(String(op.state)) ||
        !["not_dispatched", "confirmed", "unknown"].includes(String(op.outcome))
      )
        throw new Error("Invalid journal")
    return {
      epoch: value.epoch,
      owner: value.owner,
      pid: Number(value.pid),
      processStart: value.processStart,
      sessions: value.sessions,
    }
  } finally {
    await handle.close()
  }
}

if (import.meta.main) {
  process.umask(0o077)
  try {
    const runDir = process.env.TANDEM_CHROME_BRIDGE_RUN_DIR
    if (!runDir) throw new Error("Missing run directory")
    await host(runDir, process.argv[2] ?? "")
  } catch {
    process.stderr.write("chrome-bridge: startup failed (check origin, run directory, and platform)\n")
    process.exitCode = 1
  }
}
