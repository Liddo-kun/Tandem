import { randomUUID } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import { connect } from "./client"
import { BrowserError } from "./errors"
import { PageError, type PageInspection, type PageScreenshot } from "./page"
import { PageDriver, type LocatorReadInput, type MouseOptions, type MousePoint } from "./original-page"

export { BrowserError } from "./errors"

export const CONTROLLER_LIMITS = Object.freeze({
  sessions: 8,
  tabs: 16,
  tabActions: 16,
  connectionActions: 128,
  timeoutMs: 15_000,
  maxTimeoutMs: 30_000,
  maxPermissionTimeoutMs: 300_000,
  events: 256,
})
declare const opaque: unique symbol
export type TabHandle = Readonly<{ [opaque]: "tab" }>
export type TabDescriptorHandle = Readonly<{ [opaque]: "descriptor" }>
export type FrameHandle = Readonly<{ [opaque]: "frame" }>
export type ElementRef = Readonly<{ [opaque]: "element" }>
export type ViewToken = Readonly<{ [opaque]: "view" }>
// Trusted host identity only; never copied into native requests or the journal.
export type OperationOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  /** Additional total budget used only while awaiting authorization. */
  permissionTimeoutMs?: number
  authorizationContext?: object
}
export type Capability = "discovery" | "claim" | "create" | "read" | "input" | "navigation" | "screenshot" | "handoff" | "site"
export type AuthorizationRequest = Readonly<{
  browserId: string
  browserLabel: string
  callerSessionId: string
  callerTurnId: string
  capability: Capability
  tabOrigin?: "user" | "agent"
  documentOrigin?: string
  frameOrigin?: string
  destination?: string
  operationId: string
  signal: AbortSignal
  authorizationContext?: object
  tabScope?: string
  tabTitle?: string
}>
export type Authorize = (
  request: AuthorizationRequest,
) => "allow" | "deny" | "cancel" | Promise<"allow" | "deny" | "cancel">
export type ConnectionConfig = { id: string; label: string; directory: string; hostId?: string }
export type CleanupReport = {
  confirmed: boolean
  code?: "cleanup_unconfirmed"
  tabs: number
  retained: number
  message: string
  nativeConfirmed?: boolean
  stage?: "preservation" | "settlement" | "page_cleanup" | "authorization" | "completion" | "verification"
  reasonCode?: string
  diagnosticCode?: number
}
export type BrowserEvent = {
  type: "disconnected" | "tab_changed" | "tab_closed" | "state_invalidated"
  browserId: string
  tab?: TabHandle
}
export type Keep = { tab: TabHandle; status: "handoff" | "deliverable"; authorizationContext?: object }
export type Inspection = Omit<PageInspection, "elements" | "frames" | "viewToken" | "frameId" | "topFrameId"> & {
  elements: (Omit<PageInspection["elements"][number], "ref"> & { ref: ElementRef })[]
  frames: { handle: FrameHandle; url: string; origin: string; supported: boolean }[]
  viewToken: ViewToken
}
export type Screenshot = Omit<PageScreenshot, "viewToken"> & { viewToken: ViewToken }
export interface BrowserSession {
  readonly connected: boolean
  beginTurn(input: { callerTurnId: string }): Promise<BrowserTurn>
  events(): BrowserEvent[]
  close(): Promise<CleanupReport>
}
export interface BrowserTurn {
  /** Checks locally known validity only; native document/viewport checks still run on use. */
  validHandle(handle: TabHandle | TabDescriptorHandle | FrameHandle | ElementRef | ViewToken): boolean
  discoverTabs(
    options?: OperationOptions,
  ): Promise<{ tabs: { handle: TabDescriptorHandle; title: string; url: string }[]; truncated: boolean }>
  createTab(input?: { url?: string }, options?: OperationOptions): Promise<TabHandle>
  claimTab(descriptor: TabDescriptorHandle, options?: OperationOptions): Promise<TabHandle>
  resumeTabs(options?: OperationOptions): Promise<TabHandle[]>
  inspect(tab: TabHandle, options?: OperationOptions & { frame?: FrameHandle; detail?: "visible" | "page" }): Promise<Inspection>
  read(tab: TabHandle, input: LocatorReadInput, options?: OperationOptions): Promise<string | number | boolean | null>
  navigate(
    tab: TabHandle,
    input: { url: string },
    options?: OperationOptions,
  ): Promise<{ url: string; documentId: string; revision: number; httpStatus: "unavailable" }>
  click(
    tab: TabHandle,
    input: ({ target: ElementRef } | { selector: string } | { x: number; y: number; view: ViewToken }) & MouseOptions,
    options?: OperationOptions,
  ): Promise<void>
  dblclick(
    tab: TabHandle,
    input: ({ target: ElementRef } | { selector: string } | { x: number; y: number; view: ViewToken }) & MouseOptions,
    options?: OperationOptions,
  ): Promise<void>
  move(tab: TabHandle, input: MousePoint & { view: ViewToken; modifiers?: MouseOptions["modifiers"] }, options?: OperationOptions): Promise<void>
  drag(tab: TabHandle, input: { path: readonly MousePoint[]; view: ViewToken; modifiers?: MouseOptions["modifiers"] }, options?: OperationOptions): Promise<void>
  type(
    tab: TabHandle,
    input: { target?: ElementRef; selector?: string; text: string; mode?: "replace" | "append" },
    options?: OperationOptions,
  ): Promise<void>
  key(
    tab: TabHandle,
    input: { target?: ElementRef; selector?: string; key: string; modifiers?: string[] },
    options?: OperationOptions,
  ): Promise<void>
  scroll(
    tab: TabHandle,
    input: { deltaX: number; deltaY: number; view: ViewToken; x?: number; y?: number },
    options?: OperationOptions,
  ): Promise<void>
  screenshot(tab: TabHandle, options?: OperationOptions): Promise<Screenshot>
  /** Context authorizes cleanup discovery; each keep supplies its own handoff source. First end wins. */
  end(input?: { keep?: Keep[]; authorizationContext?: object; preserveUnmarked?: boolean }): Promise<CleanupReport>
}

type Bridge = Awaited<ReturnType<typeof connect>>
type Connection = {
  config: ConnectionConfig
  bridge: Bridge
  epoch: string
  connected: boolean
  sessions: Set<Session>
  owners: Map<number, Tab>
  pending: number
}
type Session = {
  controller: State
  connection: Connection
  caller: string
  wire: string
  active?: Turn
  tabs: Set<Tab>
  acquisitions: number
  acquisitionUncertain: boolean
  closing: boolean
  close?: Promise<CleanupReport>
  events: BrowserEvent[]
  authorizationContext?: object
}
type Turn = {
  session: Session
  caller: string
  wire: string
  state: "starting" | "active" | "ending" | "ended" | "blocked"
  operations: Set<Operation>
  registration?: Promise<void>
  keepIntent?: string
  inheritedKeep?: Tab[]
  end?: Promise<CleanupReport>
}
type Tab = {
  id: number
  session: Session
  origin: "user" | "agent"
  url: string
  epoch: string
  turn?: Turn
  handle?: TabHandle
  valid: boolean
  retained: boolean
  authorizationContext?: object
  uncertain: boolean
  pending: number
  revision: number
  lock?: Promise<void>
  unlock?: () => void
  driver?: PageDriver
  operation?: Operation
}
type Operation = {
  id: string
  authorizationContext?: object
  turn: Turn
  tab?: Tab
  abort: AbortController
  deadline: number
  permissionRemaining: number
  timer?: ReturnType<typeof setTimeout>
  dispatched: number
  inFlight: number
  steps: string[]
  state: "preparing" | "queued" | "dispatched" | "settled" | "unresolved"
  outcome: "not_dispatched" | "confirmed" | "unknown"
  error?: string
}
type State = {
  authorize: Authorize
  connections: Map<string, Connection>
  handles: WeakMap<object, { tab: Tab; turn: Turn; epoch: string }>
  descriptors: WeakMap<object, { connection: Connection; turn: Turn; epoch: string; id: number; url: string }>
  references: WeakMap<
    object,
    { tab: Tab; turn: Turn; revision: number; kind: string; value: string; frameId: string; frameDocument?: string }
  >
  operations: Map<string, Operation>
  closing: boolean
  close?: Promise<CleanupReport>
}

const pageContext = new AsyncLocalStorage<{ operation: Operation } | { tab: Tab; turn: Turn; deadline: number }>()

async function pageNative<T>(tab: Tab, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const context = pageContext.getStore()
  if (!context) throw failure("stale_handle")
  if ("operation" in context) {
    const op = context.operation
    if (op.tab !== tab) throw failure("stale_handle")
    const remaining = Math.max(1, op.deadline - Date.now())
    return call<T>(op, method, {
      ...params,
      timeoutMs: Math.min(typeof params.timeoutMs === "number" ? params.timeoutMs : remaining, remaining),
    })
  }
  // Event responders and finalization retain the original lease, not a later
  // tool's permission/deadline. They cannot outlive native ownership.
  if (context.tab !== tab || tab.turn !== context.turn || !tab.valid || !tab.session.connection.connected ||
      !["active", "ending"].includes(context.turn.state) || Date.now() >= context.deadline)
    throw failure("stale_handle")
  return tab.session.connection.bridge.call<T>(method, {
    ...params, session_id: tab.session.wire, turn_id: context.turn.wire, session_context: "live",
  }, Math.max(1, Math.min(5000, context.deadline - Date.now())), { cleanup: context.turn.state === "ending" })
}

function failure(
  code: string,
  operationId: string = randomUUID(),
  outcome: Operation["outcome"] = "not_dispatched",
  diagnosticCode?: number,
) {
  return new BrowserError(code, operationId, outcome, undefined, diagnosticCode)
}

function origin(url: string, blank = false) {
  boundedURL(url)
  if (blank && url === "about:blank") return "about:blank"
  let value: URL
  try {
    value = new URL(url)
  } catch {
    throw failure("unsupported")
  }
  if (!["http:", "https:"].includes(value.protocol) || value.origin === "null" || value.username || value.password)
    throw failure("unsupported")
  return value.origin
}

function boundedURL(url: string) {
  if (typeof url !== "string") throw failure("unsupported")
  if (Buffer.byteLength(url, "utf8") > 8192) throw failure("result_too_large")
}

function withinDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(failure("cleanup_unconfirmed")), Math.max(1, deadline - Date.now()))
    }),
  ]).finally(() => clearTimeout(timer))
}

function register(turn: Turn) {
  turn.registration = turn.session.connection.bridge
    .registerTurn({ session_id: turn.session.wire, turn_id: turn.wire })
    .then(
      () => {
        turn.state = "active"
      },
      (error) => {
        if (error instanceof BrowserError && error.outcome === "not_dispatched") {
          turn.state = "ended"
          if (turn.session.active === turn) turn.session.active = undefined
        } else {
          turn.state = "blocked"
          turn.session.acquisitionUncertain = true
        }
        throw error
      },
    )
  return turn.registration
}

async function lifecyclePermission(
  turn: Turn,
  capability: Capability,
  deadline: number,
  authorizationContext?: object,
  tab?: Tab,
) {
  if (Date.now() >= deadline || !turn.session.connection.connected) throw failure("cleanup_unconfirmed")
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), Math.max(1, Math.min(15_000, deadline - Date.now())))
  const session = turn.session
  try {
    const request: AuthorizationRequest = Object.freeze({
      browserId: session.connection.config.id,
      browserLabel: session.connection.config.label,
      callerSessionId: session.caller,
      callerTurnId: turn.caller,
      capability,
      tabOrigin: tab?.origin,
      documentOrigin: tab ? origin(tab.url, tab.origin === "agent") : undefined,
      frameOrigin: tab ? origin(tab.url, tab.origin === "agent") : undefined,
      operationId: randomUUID(),
      signal: abort.signal,
      authorizationContext,
    })
    const decision = await Promise.race([
      Promise.resolve().then(() => session.controller.authorize(request)),
      new Promise<never>((_, reject) =>
        abort.signal.addEventListener("abort", () => reject(failure("permission_cancelled")), { once: true }),
      ),
    ])
    if (Date.now() >= deadline || abort.signal.aborted) throw failure("permission_cancelled")
    if (decision !== "allow") throw failure(decision === "cancel" ? "permission_cancelled" : "permission_denied")
  } finally {
    clearTimeout(timer)
  }
}

// Unscoped discovery neither activates an extension session nor attaches a debugger.
async function observe(turn: Turn, tabs: Tab[], deadline: number, op?: Operation) {
  const signal = op?.abort.signal
  if (!turn.session.connection.connected || Date.now() >= deadline || signal?.aborted)
    throw failure("cleanup_unconfirmed")
  const status = await withinDeadline(turn.session.connection.bridge.status(), deadline)
  const lease = status.sessions.find((item) => item.session_id === turn.session.wire && item.turn_id === turn.wire)
  if (
    status.epoch !== turn.session.connection.epoch ||
    !lease ||
    !["active", "blocked"].includes(lease.state) ||
    Date.now() >= deadline ||
    signal?.aborted
  )
    throw failure("cleanup_unconfirmed")
  const value = op
    ? await call<{ id: number; url?: string; pendingUrl?: string }[]>(op, "getUserTabs", {}, false)
    : await turn.session.connection.bridge.call<{ id: number; url?: string; pendingUrl?: string }[]>(
        "getUserTabs",
        {},
        Math.max(1, Math.min(5000, deadline - Date.now())),
        { signal },
      )
  if (!Array.isArray(value) || value.length > 1000) throw failure("cleanup_unconfirmed")
  const seen = new Set<number>()
  const urls = new Map<number, string>()
  for (const item of value) {
    if (!Number.isSafeInteger(item.id) || seen.has(item.id)) throw failure("protocol_error")
    seen.add(item.id)
    if (!tabs.some((tab) => tab.id === item.id)) continue
    if (item.pendingUrl && item.pendingUrl !== item.url) throw failure("target_changed")
    const url = item.url
    if (typeof url !== "string") throw failure("cleanup_unconfirmed")
    boundedURL(url)
    urls.set(item.id, url)
  }
  for (const tab of tabs) {
    if (
      !tab.valid ||
      tab.epoch !== turn.session.connection.epoch ||
      turn.session.connection.owners.get(tab.id) !== tab ||
      !urls.has(tab.id)
    )
      throw failure("cleanup_unconfirmed")
    origin(urls.get(tab.id)!, tab.origin === "agent")
  }
  return urls
}

async function settle(turn: Turn, deadline: number) {
  for (;;) {
    if (Date.now() >= deadline || !turn.session.connection.connected) throw failure("cleanup_unconfirmed")
    let pending = turn.operations.size > 0
    for (const op of turn.session.controller.operations.values()) {
      if (op.turn !== turn || (op.state === "settled" && !op.inFlight)) continue
      for (const id of op.steps) {
        if (Date.now() >= deadline) throw failure("cleanup_unconfirmed")
        const status = await withinDeadline(turn.session.connection.bridge.operationStatus(id), deadline)
        if (!status || status.state !== "settled") pending = true
      }
    }
    if (!pending) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function active(turn: Turn) {
  if (!turn.session.connection.connected) throw failure("disconnected")
  if (
    turn.session.controller.closing ||
    turn.session.closing ||
    turn.state !== "active" ||
    turn.session.active !== turn
  )
    throw failure("stale_handle")
}

function check(op: Operation) {
  if (Date.now() >= op.deadline && !op.abort.signal.aborted) op.abort.abort("deadline_exceeded")
  if (op.abort.signal.aborted)
    throw failure(
      ["deadline_exceeded", "disconnected"].includes(op.abort.signal.reason) ? op.abort.signal.reason : "cancelled",
      op.id,
      op.inFlight ? "unknown" : op.dispatched ? "confirmed" : "not_dispatched",
    )
  active(op.turn)
  if (op.tab && (!op.tab.valid || op.tab.turn !== op.turn || op.tab.epoch !== op.turn.session.connection.epoch))
    throw failure("stale_handle", op.id)
  if (op.tab?.uncertain) throw failure("operation_uncertain", op.id)
}

function armDeadline(op: Operation) {
  clearTimeout(op.timer)
  if (!op.abort.signal.aborted)
    op.timer = setTimeout(() => op.abort.abort("deadline_exceeded"), Math.max(1, op.deadline - Date.now()))
}

async function permission(op: Operation, capability: Capability, destination?: string) {
  check(op)
  const session = op.turn.session
  let decision: unknown
  const started = Date.now()
  const allowance = op.permissionRemaining
  op.deadline += allowance
  armDeadline(op)
  try {
    decision = await interrupt(
      op,
      Promise.resolve().then(() =>
        session.controller.authorize(
          Object.freeze({
            browserId: session.connection.config.id,
            browserLabel: session.connection.config.label,
            callerSessionId: session.caller,
            callerTurnId: op.turn.caller,
            capability,
            tabOrigin: op.tab?.origin,
            documentOrigin: op.tab ? origin(op.tab.url, op.tab.origin === "agent") : undefined,
            frameOrigin: op.tab ? origin(op.tab.url, op.tab.origin === "agent") : undefined,
            destination,
            signal: op.abort.signal,
            operationId: op.id,
            authorizationContext: op.authorizationContext,
          }),
        ),
      ),
    )
  } catch {
    check(op)
    throw failure("permission_denied", op.id)
  } finally {
    const unused = Math.max(0, allowance - (Date.now() - started))
    op.permissionRemaining = unused
    op.deadline -= unused
    armDeadline(op)
  }
  check(op)
  if (decision !== "allow") throw failure(decision === "cancel" ? "permission_cancelled" : "permission_denied", op.id)
}

function interrupt<T>(op: Operation, promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      op.abort.signal.removeEventListener("abort", abort)
      reject(
        failure(
          ["deadline_exceeded", "disconnected"].includes(op.abort.signal.reason) ? op.abort.signal.reason : "cancelled",
          op.id,
          op.inFlight ? "unknown" : op.dispatched ? "confirmed" : "not_dispatched",
        ),
      )
    }
    op.abort.signal.addEventListener("abort", abort, { once: true })
    if (op.abort.signal.aborted) abort()
    promise.then(resolve, reject).finally(() => op.abort.signal.removeEventListener("abort", abort))
  })
}

async function call<T>(op: Operation, method: string, params: Record<string, unknown> = {}, scoped = true) {
  check(op)
  const id = randomUUID()
  op.steps.push(id)
  op.inFlight++
  op.state = "dispatched"
  try {
    const value = await op.turn.session.connection.bridge.call<T>(
      method,
      {
        ...(scoped ? { session_id: op.turn.session.wire, turn_id: op.turn.wire, session_context: "live" } : {}),
        ...params,
      },
      Math.max(1, op.deadline - Date.now()),
      { signal: op.abort.signal, operationId: id },
    )
    op.dispatched++
    return value
  } catch (error) {
    if (error instanceof BrowserError) {
      if (error.outcome !== "not_dispatched") op.dispatched++
      if (error.outcome === "unknown") {
        op.outcome = "unknown"
        if (op.tab) op.tab.uncertain = true
      }
      throw failure(
        error.code,
        op.id,
        error.outcome === "not_dispatched" && op.dispatched ? "confirmed" : error.outcome,
        error.diagnosticCode,
      )
    }
    op.outcome = "unknown"
    if (op.tab) op.tab.uncertain = true
    throw failure("protocol_error", op.id, "unknown")
  } finally {
    op.inFlight--
  }
}

async function run<T>(
  turn: Turn,
  tab: Tab | undefined,
  options: OperationOptions | undefined,
  work: (op: Operation) => Promise<T>,
): Promise<T> {
  active(turn)
  const timeout = options?.timeoutMs ?? CONTROLLER_LIMITS.timeoutMs
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > CONTROLLER_LIMITS.maxTimeoutMs)
    throw failure("unsupported")
  const permissionTimeout = options?.permissionTimeoutMs ?? 0
  if (!Number.isSafeInteger(permissionTimeout) || permissionTimeout < 0 || permissionTimeout > CONTROLLER_LIMITS.maxPermissionTimeoutMs)
    throw failure("unsupported")
  const connection = turn.session.connection
  if (connection.pending >= CONTROLLER_LIMITS.connectionActions || (tab && tab.pending >= CONTROLLER_LIMITS.tabActions))
    throw failure("resource_limit")
  const op: Operation = {
    id: randomUUID(),
    authorizationContext: options?.authorizationContext,
    turn,
    tab,
    abort: new AbortController(),
    deadline: Date.now() + timeout,
    permissionRemaining: permissionTimeout,
    dispatched: 0,
    inFlight: 0,
    steps: [],
    state: "preparing",
    outcome: "not_dispatched",
  }
  connection.pending++
  if (tab) tab.pending++
  turn.operations.add(op)
  const records = turn.session.controller.operations
  if (records.size >= 1024) {
    for (const [id, record] of records)
      if (record.state === "settled") {
        records.delete(id)
        break
      }
    if (records.size >= 1024) {
      connection.pending--
      if (tab) tab.pending--
      turn.operations.delete(op)
      throw failure("operation_uncertain", op.id)
    }
  }
  records.set(op.id, op)
  const abort = () => op.abort.abort("cancelled")
  options?.signal?.addEventListener("abort", abort, { once: true })
  if (options?.signal?.aborted) abort()
  armDeadline(op)
  try {
    check(op)
    const value = await interrupt(op, work(op))
    check(op)
    op.outcome = op.dispatched ? "confirmed" : "not_dispatched"
    op.state = "settled"
    return value
  } catch (error) {
    const result =
      error instanceof BrowserError
        ? failure(
            error.code,
            op.id,
            op.outcome === "unknown"
              ? "unknown"
              : error.outcome === "not_dispatched" && op.dispatched
                ? "confirmed"
                : error.outcome,
            error.diagnosticCode,
          )
        : failure("protocol_error", op.id, op.inFlight ? "unknown" : op.dispatched ? "confirmed" : "not_dispatched")
    op.outcome = result.outcome
    op.error = result.code
    op.state = result.outcome === "unknown" ? "unresolved" : "settled"
    if (tab && result.outcome === "unknown") tab.uncertain = true
    throw result
  } finally {
    clearTimeout(op.timer)
    options?.signal?.removeEventListener("abort", abort)
    connection.pending--
    if (tab) tab.pending--
    turn.operations.delete(op)
  }
}

function tabFor(turn: Turn, handle: TabHandle) {
  active(turn)
  const bound = handle && turn.session.controller.handles.get(handle)
  if (
    !bound ||
    bound.turn !== turn ||
    bound.epoch !== turn.session.connection.epoch ||
    bound.tab.session !== turn.session ||
    !bound.tab.valid ||
    bound.tab.turn !== turn
  )
    throw failure("stale_handle")
  if (bound.tab.uncertain) throw failure("operation_uncertain")
  return bound.tab
}

function bind(tab: Tab, turn: Turn) {
  tab.turn = turn
  tab.retained = false
  tab.revision++
  tab.driver = undefined
  const handle = Object.freeze({}) as TabHandle
  tab.handle = handle
  turn.session.controller.handles.set(handle, { tab, turn, epoch: tab.epoch })
  return handle
}

function reserve(turn: Turn, id: number, url: string, tabOrigin: Tab["origin"]) {
  const session = turn.session
  if (!Number.isSafeInteger(id) || id <= 0) throw failure("protocol_error")
  if (session.tabs.size + session.acquisitions >= CONTROLLER_LIMITS.tabs) throw failure("resource_limit")
  if (session.acquisitionUncertain) throw failure("operation_uncertain")
  if (session.connection.owners.has(id)) throw failure("tab_owned")
  const tab: Tab = {
    id,
    session,
    origin: tabOrigin,
    url,
    epoch: session.connection.epoch,
    turn,
    valid: true,
    retained: false,
    uncertain: false,
    pending: 0,
    revision: 0,
  }
  session.tabs.add(tab)
  session.connection.owners.set(id, tab)
  return tab
}

function release(tab: Tab) {
  tab.valid = false
  tab.revision++
  tab.session.tabs.delete(tab)
  if (tab.session.connection.owners.get(tab.id) === tab) tab.session.connection.owners.delete(tab.id)
}

async function locked<T>(
  op: Operation,
  capability: Capability,
  destination: string | undefined,
  work: () => Promise<T>,
) {
  const tab = op.tab!
  for (;;) {
    check(op)
    const revision = tab.revision
    await permission(op, capability, destination)
    let waited = false
    while (tab.lock) {
      waited = true
      op.state = "queued"
      await interrupt(op, tab.lock)
      check(op)
    }
    if (waited || revision !== tab.revision) continue
    let unlock!: () => void
    tab.lock = new Promise<void>((resolve) => {
      unlock = resolve
    })
    tab.operation = op
    try {
      check(op)
      return await work()
    } finally {
      tab.operation = undefined
      tab.lock = undefined
      unlock()
    }
  }
}

function report(tabs: number, retained: number, confirmed = false): CleanupReport {
  return {
    confirmed,
    ...(confirmed ? {} : { code: "cleanup_unconfirmed" as const }),
    tabs,
    retained,
    message: confirmed
      ? "Requested tab dispositions verified"
      : "Browser lease, existence and debugger cleanup are not independently verified",
  }
}

function end(
  turn: Turn,
  input: { keep?: Keep[]; authorizationContext?: object; preserveUnmarked?: boolean } = {},
  budget = Date.now() + 30_000,
): Promise<CleanupReport> {
  const keep = input.keep ?? []
  const selected = new Map<Tab, { status: Keep["status"]; authorizationContext?: object }>()
  for (const item of keep) {
    // An uncertain action must not prevent recording a non-destructive keep intent.
    const bound = turn.session.controller.handles.get(item.tab)
    const tab = bound?.tab
    if (
      !tab ||
      bound.turn !== turn ||
      bound.epoch !== turn.session.connection.epoch ||
      (!turn.end && tab.turn !== turn) ||
      tab.session !== turn.session
    )
      throw failure("stale_handle")
    if (!["handoff", "deliverable"].includes(item.status) || selected.has(tab)) throw failure("unsupported")
    selected.set(tab, { status: item.status, authorizationContext: item.authorizationContext })
  }
  if (input.preserveUnmarked && !turn.end) {
    for (const tab of turn.session.tabs)
      if (tab.turn === turn && tab.origin === "agent" && !selected.has(tab))
        selected.set(tab, { status: "handoff", authorizationContext: input.authorizationContext })
  }
  const inherited = turn.inheritedKeep ?? [...turn.session.tabs].filter((tab) => tab.retained)
  for (const tab of inherited)
    if (!selected.has(tab)) selected.set(tab, { status: "handoff", authorizationContext: tab.authorizationContext })
  const wireKeep = [...selected]
    .map(([tab, item]) => ({ tabId: tab.id, status: item.status }))
    .sort((a, b) => a.tabId - b.tabId)
  const intent = JSON.stringify(wireKeep)
  if (turn.end) {
    if (turn.keepIntent !== intent) throw failure("stale_handle")
    return turn.end
  }
  if (turn.state !== "active") throw failure("stale_handle")
  turn.keepIntent = intent
  turn.inheritedKeep = inherited
  const authorizationContext = input.authorizationContext ?? turn.session.authorizationContext
  turn.session.authorizationContext = authorizationContext
  for (const [tab, item] of selected) tab.authorizationContext = item.authorizationContext
  // Block admission synchronously, including while keep permission is pending.
  turn.state = "ending"
  for (const op of turn.operations) op.abort.abort("cancelled")
  const deadline = Math.min(budget, Date.now() + 30_000)
  turn.end = (async () => {
    const session = turn.session
    const tabs = [...session.tabs].filter((tab) => tab.turn === turn || selected.has(tab))
    let stage: CleanupReport["stage"] = "preservation"
    try {
      if (selected.size)
        await session.connection.bridge.preserveTurn({ session_id: session.wire, turn_id: turn.wire, keep: wireKeep })
      stage = "settlement"
      await settle(turn, deadline)
      stage = "page_cleanup"
      for (const tab of tabs) {
        if (!tab.driver) continue
        await withinDeadline(pageContext.run({ tab, turn, deadline }, () => tab.driver!.cleanup()), deadline)
      }
      if (selected.size) {
        stage = "authorization"
        await lifecyclePermission(turn, "discovery", deadline, authorizationContext)
        for (;;) {
          const observed = await observe(turn, [...selected.keys()], deadline)
          for (const [tab, item] of selected) {
            tab.url = observed.get(tab.id)!
            await lifecyclePermission(turn, "handoff", deadline, item.authorizationContext, tab)
          }
          const current = await observe(turn, [...selected.keys()], deadline)
          if ([...selected.keys()].every((tab) => current.get(tab.id) === observed.get(tab.id))) break
        }
      }
      if (Date.now() >= deadline || !session.connection.connected) return { ...report(tabs.length, selected.size), stage }
      stage = "completion"
      let timer: ReturnType<typeof setTimeout> | undefined
      const result = await Promise.race([
        session.connection.bridge.endTurn({
          session_id: session.wire,
          turn_id: turn.wire,
          keep: wireKeep,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(failure("cleanup_unconfirmed")), Math.max(1, deadline - Date.now()))
        }),
      ]).finally(() => clearTimeout(timer))
      // Only the host's independent target verification permits releasing reservations.
      for (const tab of tabs) {
        tab.revision++
        tab.driver = undefined
        if (result.status !== "confirmed") {
          tab.valid = false
          tab.uncertain = true
        } else if (selected.get(tab)?.status === "handoff") {
          tab.retained = true
          tab.turn = undefined
          tab.uncertain = false
          tab.valid = true
        } else release(tab)
      }
      if (result.status === "confirmed") session.acquisitionUncertain = false
      turn.state = result.status === "confirmed" ? "ended" : "blocked"
      return {
        ...report(tabs.length, selected.size, result.status === "confirmed" && !session.acquisitionUncertain),
        nativeConfirmed: result.nativeConfirmed,
        stage: result.stage,
        diagnosticCode: result.diagnosticCode,
      }
    } catch (error) {
      turn.state = "blocked"
      for (const tab of tabs) tab.uncertain = true
      return { ...report(tabs.length, selected.size), stage,
        ...(error instanceof BrowserError ? { reasonCode: error.code } : {}) }
    } finally {
      if (turn.state === "ending") turn.state = "blocked"
      if (turn.state === "ended" && session.active === turn) session.active = undefined
    }
  })()
  return turn.end
}

function closeSession(session: Session): Promise<CleanupReport> {
  if (session.close) return session.close
  session.closing = true
  const deadline = Date.now() + 39_000
  session.close = (async () => {
    if (session.active?.registration) await session.active.registration.catch(() => {})
    if (session.active?.state === "active") await end(session.active)
    else if (session.active?.end) await session.active.end
    const retained = [...session.tabs].filter((tab) => tab.retained && tab.valid && !tab.uncertain)
    if (retained.length && !session.active && session.connection.connected && Date.now() < deadline - 5000) {
      const turn: Turn = {
        session,
        caller: "session-close",
        wire: randomUUID(),
        state: "starting",
        operations: new Set(),
      }
      try {
        session.active = turn
        await register(turn)
        await end(
          turn,
          {
            keep: retained.map((tab) => ({
              tab: bind(tab, turn),
              status: "deliverable",
              authorizationContext: tab.authorizationContext,
            })),
          },
          deadline,
        )
      } catch {
        for (const tab of retained) tab.uncertain = true
      }
    }
    const tabs = session.tabs.size
    for (const tab of session.tabs) {
      tab.valid = false
      tab.revision++
    }
    // Keep uncertain ownership reservations until the connection is closed.
    if (!tabs && !session.acquisitionUncertain && !session.active) session.connection.sessions.delete(session)
    return report(
      tabs,
      [...session.tabs].filter((tab) => tab.retained).length,
      tabs === 0 && !session.acquisitionUncertain && !session.active,
    )
  })()
  return session.close
}

function notification(connection: Connection, method: string, value: unknown) {
  if (!value || typeof value !== "object") return
  const params = value as Record<string, any>
  if (method === "onCDPEvent" || method === "onCDPDetach") {
    for (const tab of connection.owners.values()) {
      if (!tab.driver || !tab.turn) continue
      pageContext.run({ tab, turn: tab.turn, deadline: Date.now() + 5000 }, () => tab.driver!.notification(method, params))
    }
    return
  }
  const id = params.tabId ?? params.target?.tabId
  const tab = Number.isSafeInteger(id) ? connection.owners.get(id) : undefined
  const wire = params.session_id
  if (tab) {
    const closed = /closed|removed|detached/i.test(method)
    if (closed || (wire && wire !== tab.session.wire)) {
      tab.revision++
      tab.driver?.dispose()
      tab.valid = false
      tab.uncertain = true
    }
    emit(tab.session, {
      type: wire && wire !== tab.session.wire ? "state_invalidated" : closed ? "tab_closed" : "tab_changed",
      browserId: connection.config.id,
      ...(wire && wire !== tab.session.wire ? {} : { tab: tab.handle }),
    })
    return
  }
  // Unattributed notifications are not evidence that every document changed.
}

function emit(session: Session, event: BrowserEvent) {
  const all = [...session.connection.sessions].reduce((count, item) => count + item.events.length, 0)
  if (all >= CONTROLLER_LIMITS.events) {
    for (const item of session.connection.sessions)
      item.events = [
        ...item.events.filter((event) => event.type === "disconnected").slice(-1),
        { type: "state_invalidated", browserId: session.connection.config.id },
      ]
  }
  session.events.push(Object.freeze(event))
}

export class BrowserController {
  #state: State
  #reconnections = new Map<string, Promise<void>>()
  private constructor(state: State) {
    this.#state = state
  }

  static async create(input: { connections: ConnectionConfig[]; authorize: Authorize }) {
    if (!input || typeof input.authorize !== "function") throw failure("permission_denied")
    if (!Array.isArray(input.connections) || !input.connections.length) throw failure("browser_unavailable")
    const ids = new Set<string>()
    for (const config of input.connections) {
      if (!config.id || !config.label || !config.directory || ids.has(config.id)) throw failure("ambiguous_browser")
      ids.add(config.id)
    }
    const state: State = {
      authorize: input.authorize,
      connections: new Map(),
      handles: new WeakMap(),
      descriptors: new WeakMap(),
      references: new WeakMap(),
      operations: new Map(),
      closing: false,
    }
    try {
      for (const config of input.connections) {
        let connection: Connection | undefined
        const bridge = await connect(config.directory, {
          hostId: config.hostId,
          onNotification: (method, params) => {
            if (connection) notification(connection, method, params)
          },
          onDisconnect: () => {
            if (!connection) return
            connection.connected = false
            for (const session of connection.sessions) {
              for (const tab of session.tabs) {
                tab.driver?.dispose()
                tab.valid = false
                tab.revision++
              }
              emit(session, { type: "disconnected", browserId: config.id })
              for (const op of session.active?.operations ?? []) op.abort.abort("disconnected")
            }
          },
        })
        if (typeof bridge.discovery.epoch !== "string" || !bridge.discovery.epoch) {
          bridge.close()
          throw failure("protocol_error")
        }
        connection = {
          config: Object.freeze({ ...config }),
          bridge,
          epoch: bridge.discovery.epoch,
          connected: true,
          sessions: new Set(),
          owners: new Map(),
          pending: 0,
        }
        state.connections.set(config.id, connection)
      }
      return new BrowserController(state)
    } catch (error) {
      for (const connection of state.connections.values()) connection.bridge.close()
      if (error instanceof BrowserError) throw error
      throw failure("browser_unavailable")
    }
  }

  browsers() {
    return [...this.#state.connections.values()].map((connection) => ({
      id: connection.config.id,
      label: connection.config.label,
      epoch: connection.epoch,
      connected: connection.connected,
      profileIdentity: "unverified" as const,
      capabilities: {
        inspection: "bounded visible DOM",
        frames: "top-level and explicit same-origin frames",
        input: "background click/double-click, mouse movement/hover, drag paths, replace/append/focused typing, page keys and wheel",
        screenshots: "viewport PNG; Chromium 149 requires CDPScreenshotNewSurface for reliable background capture",
        rawEvaluation: false,
        crossOriginFrames: false,
      },
    }))
  }

  reconnect(browserId: string): Promise<void> {
    if (this.#state.closing) return Promise.reject(failure("disconnected"))
    const connection = this.#state.connections.get(browserId)
    if (!connection) return Promise.reject(failure("browser_unavailable"))
    if (connection.connected) return Promise.resolve()
    const pending = this.#reconnections.get(browserId)
    if (pending) return pending
    const task = BrowserController.create({ connections: [connection.config], authorize: this.#state.authorize })
      .then(async (replacement) => {
        if (this.#state.closing) {
          await replacement.close()
          throw failure("disconnected")
        }
        // Old sessions and operations retain their original transport and epoch.
        this.#state.connections.set(browserId, replacement.#state.connections.get(browserId)!)
      })
      .finally(() => this.#reconnections.delete(browserId))
    this.#reconnections.set(browserId, task)
    return task
  }

  async status() {
    return Promise.all(
      [...this.#state.connections.values()].map(async (connection) => {
        const transport = await connection.bridge.status().catch((error) => {
          if (!(error instanceof BrowserError) || error.code !== "disconnected") throw error
          connection.connected = false
          return {
            code: "disconnected" as const,
            pid: connection.bridge.discovery.pid,
            parentPid: connection.bridge.discovery.parentPid,
            notifications: null,
          }
        })
        const info = connection.connected
          ? await connection.bridge.call<any>("getInfo", {}, 5000).catch(() => undefined)
          : undefined
        const text = (value: unknown) =>
          typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : "unknown"
        return {
          browserId: connection.config.id,
          connected: connection.connected,
          sessions: connection.sessions.size,
          pending: connection.pending,
          transport,
          extension: {
            version: text(info?.version),
            id: text(info?.metadata?.extensionId),
            instanceId: text(info?.metadata?.extensionInstanceId),
            generation: text(info?.browserTabMentions?.generation),
          },
        }
      }),
    )
  }

  async operationStatus(id: string) {
    const op = this.#state.operations.get(id)
    if (!op) throw failure("stale_handle")
    const steps = op.turn.session.connection.connected
      ? await Promise.all(op.steps.map((step) => op.turn.session.connection.bridge.operationStatus(step)))
      : []
    if (op.state === "unresolved" && steps.length && steps.every((step) => step?.state === "settled")) {
      op.state = "settled"
      op.outcome = steps.some((step) => step?.outcome === "confirmed") ? "confirmed" : "not_dispatched"
    }
    return { operationId: id, state: op.state, outcome: op.outcome, code: op.error, steps }
  }

  async openSession(input: { browserId: string; callerSessionId: string }): Promise<BrowserSession> {
    if (this.#state.closing) throw failure("stale_handle")
    const connection = this.#state.connections.get(input.browserId)
    if (!connection?.connected) throw failure("browser_unavailable")
    if (!input.callerSessionId || input.callerSessionId.length > 256) throw failure("unsupported")
    if ([...connection.sessions].some((session) => session.caller === input.callerSessionId)) throw failure("tab_owned")
    if (connection.sessions.size >= CONTROLLER_LIMITS.sessions) throw failure("tab_owned")
    const session: Session = {
      controller: this.#state,
      connection,
      caller: input.callerSessionId,
      wire: randomUUID(),
      tabs: new Set(),
      acquisitions: 0,
      acquisitionUncertain: false,
      closing: false,
      events: [],
    }
    connection.sessions.add(session)
    return Object.freeze({
      get connected() {
        return connection.connected
      },
      async beginTurn(input: { callerTurnId: string }) {
        if (session.controller.closing || !connection.connected) throw failure("disconnected")
        if (session.active?.state === "blocked") throw failure("cleanup_unconfirmed")
        if (session.closing) throw failure("disconnected")
        if (session.active) throw failure("tab_owned")
        if (!input.callerTurnId || input.callerTurnId.length > 256) throw failure("unsupported")
        const turn: Turn = {
          session,
          caller: input.callerTurnId,
          wire: randomUUID(),
          state: "starting",
          operations: new Set(),
        }
        session.active = turn
        try {
          await register(turn)
          if (session.closing || session.controller.closing || !connection.connected) {
            if (!turn.end && turn.state === "active") await end(turn)
            throw failure("disconnected")
          }
          return publicTurn(turn)
        } catch (error) {
          throw error
        }
      },
      events() {
        return session.events.splice(0)
      },
      close() {
        return closeSession(session)
      },
    })
  }

  close(): Promise<CleanupReport> {
    const state = this.#state
    if (state.close) return state.close
    state.closing = true
    state.close = (async () => {
      const reports = await Promise.all(
        [...state.connections.values()].flatMap((connection) => [...connection.sessions].map(closeSession)),
      )
      for (const connection of state.connections.values()) {
        connection.connected = false
        connection.bridge.close()
      }
      return report(
        reports.reduce((n, item) => n + item.tabs, 0),
        reports.reduce((n, item) => n + item.retained, 0),
        reports.every((item) => item.confirmed),
      )
    })()
    return state.close
  }
}

function publicTurn(turn: Turn): BrowserTurn {
  return Object.freeze({
    validHandle(handle: TabHandle | TabDescriptorHandle | FrameHandle | ElementRef | ViewToken) {
      try {
        active(turn)
        const state = turn.session.controller
        if (state.handles.has(handle)) return !!tabFor(turn, handle as TabHandle)
        const descriptor = state.descriptors.get(handle)
        if (descriptor)
          return (
            descriptor.turn === turn &&
            descriptor.connection === turn.session.connection &&
            descriptor.epoch === turn.session.connection.epoch
          )
        const ref = state.references.get(handle)
        return (
          !!ref &&
          ref.turn === turn &&
          ref.revision === ref.tab.revision &&
          ref.kind !== "invalid" &&
          !!ref.tab.handle &&
          tabFor(turn, ref.tab.handle) === ref.tab
        )
      } catch {
        return false
      }
    },
    discoverTabs(options?: OperationOptions) {
      return run(turn, undefined, options, async (op) => {
        await permission(op, "discovery")
        const value = await call<
          { tabs: { id: number; title: string; url: string }[] } | { id: number; title: string; url: string }[]
        >(op, "getUserTabs")
        check(op)
        const tabs = Array.isArray(value) ? value : value?.tabs
        if (!Array.isArray(tabs)) throw failure("protocol_error", op.id, "confirmed")
        return {
          tabs: tabs.slice(0, 100).map((tab) => {
            if (
              !Number.isSafeInteger(tab.id) ||
              tab.id <= 0 ||
              typeof tab.url !== "string" ||
              typeof tab.title !== "string"
            )
              throw failure("protocol_error", op.id, "confirmed")
            const handle = Object.freeze({}) as TabDescriptorHandle
            boundedURL(tab.url)
            turn.session.controller.descriptors.set(handle, {
              connection: turn.session.connection,
              turn,
              epoch: turn.session.connection.epoch,
              id: tab.id,
              url: tab.url,
            })
            return { handle, title: tab.title.slice(0, 1024), url: tab.url }
          }),
          truncated: tabs.length > 100,
        }
      })
    },
    claimTab(descriptor: TabDescriptorHandle, options?: OperationOptions) {
      return run(turn, undefined, options, async (op) => {
        const item = descriptor && turn.session.controller.descriptors.get(descriptor)
        if (
          !item ||
          item.turn !== turn ||
          item.connection !== turn.session.connection ||
          item.epoch !== item.connection.epoch
        )
          throw failure("stale_handle", op.id)
        origin(item.url)
        const tab = reserve(turn, item.id, item.url, "user")
        op.tab = tab
        let acquired = false
        try {
          for (;;) {
            await permission(op, "claim")
            // Refresh descriptors without debugger attachment; a permission dialog can outlive navigation.
            await permission(op, "discovery")
            const value = await call<{ tabs: { id: number; url: string }[] } | { id: number; url: string }[]>(
              op,
              "getUserTabs",
            )
            const tabs = Array.isArray(value) ? value : value?.tabs
            if (!Array.isArray(tabs)) throw failure("protocol_error", op.id, "confirmed")
            const current = tabs.find((item) => item.id === tab.id)
            if (!current || typeof current.url !== "string") throw failure("stale_handle", op.id, "confirmed")
            origin(current.url)
            if (current.url === tab.url) break
            tab.url = current.url
          }
          const claimed = await call<{ id: number }>(op, "claimUserTab", { tabId: tab.id })
          acquired = true
          if (claimed?.id !== tab.id) {
            tab.uncertain = true
            throw failure("protocol_error", op.id, "confirmed")
          }
          // Acquisition and debugger attachment are separate privileged operations.
          await permission(op, "discovery")
          for (;;) {
            const observed = await observe(turn, [tab], op.deadline, op)
            tab.url = observed.get(tab.id)!
            await permission(op, "claim")
            const current = await observe(turn, [tab], op.deadline, op)
            if (current.get(tab.id) === tab.url) break
          }
          await call(op, "attach", { tabId: tab.id })
          return bind(tab, turn)
        } catch (error) {
          if (tab.uncertain || op.outcome === "unknown" || op.inFlight || acquired) tab.uncertain = true
          else release(tab)
          throw error
        }
      })
    },
    async createTab(input: { url?: string } = {}, options?: OperationOptions) {
      if (input.url !== undefined) origin(input.url)
      return run(turn, undefined, options, async (op) => {
        await permission(op, "create", input.url)
        const session = turn.session
        if (session.acquisitionUncertain) throw failure("operation_uncertain", op.id)
        if (session.tabs.size + session.acquisitions >= CONTROLLER_LIMITS.tabs) throw failure("resource_limit", op.id)
        session.acquisitions++
        let created: { id: number }
        try {
          created = await call<{ id: number }>(op, "createTab")
        } catch (error) {
          if (op.outcome === "unknown" || op.inFlight || op.dispatched) session.acquisitionUncertain = true
          throw error
        } finally {
          session.acquisitions--
        }
        let tab: Tab
        try {
          tab = reserve(turn, created.id, "about:blank", "agent")
        } catch (error) {
          session.acquisitionUncertain = true
          throw error
        }
        op.tab = tab
        const handle = bind(tab, turn)
        await call(op, "attach", { tabId: tab.id })
        if (input.url) await performPage(op, "navigation", "navigate", { url: input.url })
        return handle
      })
    },
    resumeTabs(options?: OperationOptions) {
      return run(turn, undefined, options, async (op) => {
        const handles: TabHandle[] = []
        for (const tab of turn.session.tabs) {
          if (!tab.retained) continue
          if (tab.turn) throw failure("tab_owned", op.id)
          if (tab.uncertain || !tab.valid) throw failure("cleanup_unconfirmed", op.id)
          op.tab = tab
          tab.turn = turn
          try {
            await permission(op, "discovery")
            for (;;) {
              const observed = await observe(turn, [tab], op.deadline, op)
              tab.url = observed.get(tab.id)!
              await permission(op, "claim")
              const current = await observe(turn, [tab], op.deadline, op)
              if (current.get(tab.id) === tab.url) break
            }
            await call(op, "attach", { tabId: tab.id })
            handles.push(bind(tab, turn))
          } catch (error) {
            tab.turn = undefined
            if (op.outcome === "unknown" || op.inFlight) tab.uncertain = true
            for (const handle of handles) {
              const acquired = turn.session.controller.handles.get(handle)!.tab
              acquired.retained = true
              acquired.turn = undefined
              acquired.revision++
            }
            throw error
          }
        }
        return handles
      })
    },
    inspect: (tab: TabHandle, options?: OperationOptions & { frame?: FrameHandle; detail?: "visible" | "page" }) =>
      pageAction(turn, tab, "read", "inspect", options, options),
    read: (tab: TabHandle, input: LocatorReadInput, options?: OperationOptions) =>
      pageAction(turn, tab, "read", "read", input, options),
    navigate: (tab: TabHandle, input: { url: string }, options?: OperationOptions) =>
      pageAction(turn, tab, "navigation", "navigate", input, options),
    click: (tab: TabHandle, input: any, options?: OperationOptions) =>
      pageAction(turn, tab, "input", "click", input, options),
    dblclick: (tab: TabHandle, input: Parameters<BrowserTurn["dblclick"]>[1], options?: OperationOptions) =>
      pageAction(turn, tab, "input", "dblclick", input, options),
    move: (tab: TabHandle, input: Parameters<BrowserTurn["move"]>[1], options?: OperationOptions) =>
      pageAction(turn, tab, "input", "move", input, options),
    drag: (tab: TabHandle, input: Parameters<BrowserTurn["drag"]>[1], options?: OperationOptions) =>
      pageAction(turn, tab, "input", "drag", input, options),
    type: (tab: TabHandle, input: any, options?: OperationOptions) =>
      pageAction(turn, tab, "input", "type", input, options),
    key: (tab: TabHandle, input: any, options?: OperationOptions) =>
      pageAction(turn, tab, "input", "key", input, options),
    scroll: (tab: TabHandle, input: any, options?: OperationOptions) =>
      pageAction(turn, tab, "input", "scroll", input, options),
    screenshot: (tab: TabHandle, options?: OperationOptions) =>
      pageAction(turn, tab, "screenshot", "screenshot", undefined, options),
    end: (input?: { keep?: Keep[]; authorizationContext?: object; preserveUnmarked?: boolean }) => end(turn, input),
  })
}

async function pageAction(
  turn: Turn,
  handle: TabHandle,
  capability: Capability,
  method: string,
  input: any,
  options?: OperationOptions,
): Promise<any> {
  const tab = tabFor(turn, handle)
  if (method === "navigate") origin(input.url)
  return run(turn, tab, options, async (op) => performPage(op, capability, method, input))
}

function reference(op: Operation, value: object, kind: string) {
  const ref = value && op.turn.session.controller.references.get(value)
  if (!ref || ref.tab !== op.tab || ref.turn !== op.turn || ref.revision !== op.tab.revision || ref.kind !== kind)
    throw failure("stale_handle", op.id)
  return ref
}

function wrap(op: Operation, kind: string, value: string, frameId: string, frameDocument?: string) {
  const handle = Object.freeze({})
  op.turn.session.controller.references.set(handle, {
    tab: op.tab!,
    turn: op.turn,
    revision: op.tab!.revision,
    kind,
    value,
    frameId,
    frameDocument,
  })
  return handle
}

async function performPage(op: Operation, capability: Capability, method: string, input: any): Promise<any> {
  return pageContext.run({ operation: op }, async () => {
  const tab = op.tab!
  for (;;) {
    let changed = false
    const result = await locked(op, capability, method === "navigate" ? input.url : undefined, async () => {
      if (!tab.driver)
        tab.driver = new PageDriver(tab.id, <T>(method: string, params?: Record<string, unknown>) => pageNative<T>(tab, method, params), {
          getCurrentSessionId: () => tab.session.wire,
          getCurrentTurnId: () => tab.turn?.wire,
          browserId: tab.session.connection.config.id,
        })
      const driver = tab.driver
      let frameId: string | undefined
      let target: string | undefined
      let viewToken: string | undefined
      const frameRef = input?.frame ? reference(op, input.frame, "frame") : undefined
      if (frameRef) frameId = frameRef.value
      if (input?.target) {
        const ref = reference(op, input.target, "element")
        frameId = ref.frameId
        target = ref.value
      }
      if (input?.view) {
        const ref = reference(op, input.view, "view")
        frameId = ref.frameId
        viewToken = ref.value
      }
      try {
        const expected = await driver.metadata(frameId)
        check(op)
        // A frame ID survives navigation; an inspection handle must not adopt its replacement document.
        if (frameRef) {
          const frame = expected.frames.find((frame) => frame.id === frameId)
          if (!frame || frameRef.frameDocument !== JSON.stringify([frame.documentId, frame.url]))
            throw failure("stale_handle", op.id)
        }
        if (expected.url !== tab.url && expected.frameId === expected.topFrameId) {
          tab.url = expected.url
          tab.revision++
          changed = true
          return undefined
        }
        origin(expected.url, tab.origin === "agent")
        if (expected.frameId !== expected.topFrameId && expected.origin !== origin(tab.url, tab.origin === "agent"))
          throw failure("unsupported", op.id)
        const revision = tab.revision
        let value: unknown
        if (method === "inspect") {
          const page = await driver.inspect(expected, input.detail)
          check(op)
          if (tab.revision !== revision) throw failure("target_changed", op.id)
          // Each new inspection supersedes every previous element/frame/view capability.
          tab.revision++
          const { frameId: _frameId, topFrameId: _topFrameId, frames, elements, viewToken, ...metadata } = page
          return {
            ...metadata,
            frames: frames.map((frame) => ({
              handle: wrap(op, "frame", frame.id, frame.id, JSON.stringify([frame.documentId, frame.url])),
              url: frame.url,
              origin: frame.origin,
              supported: frame.supported,
            })),
            elements: elements.map((element) => ({ ...element, ref: wrap(op, "element", element.ref, page.frameId) })),
            viewToken: wrap(op, "view", viewToken, page.frameId),
          }
        }
        if (method === "read") {
          const value = await driver.read(input, expected)
          check(op)
          if (tab.revision !== revision) throw failure("target_changed", op.id)
          return value
        }
        if (method === "navigate") {
          const page = await driver.navigate(input.url, expected)
          tab.url = page.url
          tab.revision++
          return { url: page.url, documentId: page.documentId, revision: page.revision, httpStatus: "unavailable" }
        }
        if (method === "screenshot") {
          const image = await driver.screenshot(expected)
          check(op)
          if (tab.revision !== revision) throw failure("target_changed", op.id)
          return {
            ...image,
            viewToken: wrap(op, image.viewValid ? "view" : "invalid", image.viewToken, expected.frameId),
          }
        }
        if (method === "click" || method === "dblclick")
          value = await driver.click({ target, selector: input.selector, x: input.x, y: input.y, viewToken,
            button: input.button, modifiers: input.modifiers }, expected, method === "dblclick" ? 2 : 1)
        else if (method === "move")
          value = await driver.move({ x: input.x, y: input.y, viewToken: viewToken!, modifiers: input.modifiers }, expected)
        else if (method === "drag")
          value = await driver.drag({ path: input.path, viewToken: viewToken!, modifiers: input.modifiers }, expected)
        else if (method === "type")
          value = await driver.type({ target, selector: input.selector, text: input.text, mode: input.mode }, expected)
        else if (method === "key")
          value = await driver.key({ target, selector: input.selector, key: input.key, modifiers: input.modifiers }, expected)
        else if (method === "scroll")
          value = await driver.scroll(
            { deltaX: input.deltaX, deltaY: input.deltaY, x: input.x, y: input.y, viewToken: viewToken! },
            expected,
          )
        else throw failure("unsupported", op.id)
        check(op)
        return value
      } catch (error) {
        if (error instanceof PageError) throw failure(error.code, op.id, op.dispatched ? "confirmed" : "not_dispatched")
        if (error instanceof BrowserError && (method !== "screenshot" || error.code !== "native_error")) throw error
        const message = error instanceof Error ? error.message : String(error)
        const code = message === "Debugger unattached" ? "debugger_unattached"
          : method === "screenshot" ? "capture_failed"
          : /stale or missing|not connected|notconnected|detached from the DOM/i.test(message) ? "element_stale"
          : /strict mode|multiple.*match/i.test(message) ? "element_ambiguous"
          : /no.*match|not visible|not enabled|not editable|waiting for selector/i.test(message) ? "element_unavailable"
          : "engine_error"
        throw failure(code, op.id, op.inFlight ? "unknown" : op.dispatched ? "confirmed" : "not_dispatched")
      }
    })
    if (!changed) return result
    // Metadata is safe to observe, but new-origin content requires a new permit without a lock.
  }
  })
}
