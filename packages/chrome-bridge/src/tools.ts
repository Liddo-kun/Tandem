import { randomBytes, randomUUID } from "node:crypto"
import { browserDocumentation } from "./documentation"
import type { LocatorRead, MouseOptions, MousePoint } from "./original-page"
import {
  BrowserController,
  BrowserError,
  type AuthorizationRequest,
  type BrowserSession,
  type BrowserTurn,
  type CleanupReport,
  type ConnectionConfig,
  type ElementRef,
  type FrameHandle,
  type Keep,
  type TabDescriptorHandle,
  type TabHandle,
  type ViewToken,
} from "./controller"

// This adapter knows model aliases and invocation leases, but no Tandem services or UI.
export type ToolConnection = ConnectionConfig & { screenshotVerified?: boolean }
export type BrowserToolInput = {
  action:
    | "browsers"
    | "documentation"
    | "discover"
    | "create"
    | "claim"
    | "resume"
    | "inspect"
    | "read"
    | "navigate"
    | "click"
    | "dblclick"
    | "move"
    | "drag"
    | "type"
    | "key"
    | "scroll"
    | "screenshot"
    | "status"
    | "keep"
    | "finalize"
    | "execute"
  browser?: string
  topic?: string
  offset?: number
  limit?: number
  tab?: string
  descriptor?: string
  frame?: string
  detail?: "visible" | "page"
  ref?: string
  selector?: string
  read?: LocatorRead
  attribute?: string
  view?: string
  operation?: string
  url?: string
  text?: string
  mode?: "replace" | "append"
  key?: string
  shift?: boolean
  x?: number
  y?: number
  path?: readonly MousePoint[]
  button?: MouseOptions["button"]
  modifiers?: MouseOptions["modifiers"]
  deltaX?: number
  deltaY?: number
  disposition?: "handoff" | "deliverable"
  steps?: readonly BrowserBatchStep[]
}
export type BrowserBatchStep = Omit<BrowserToolInput, "action" | "browser" | "tab" | "steps"> & {
  action: "click" | "dblclick" | "move" | "drag" | "type" | "key" | "scroll" | "navigate" | "read" | "inspect" | "screenshot"
}
export type BrowserToolResult = {
  title: string
  text: string
  modelText?: string
  metadata: { action: string; outcome: string; code?: string; operation?: string; browser?: string; completed?: number; failedStep?: number; failedAction?: string }
  image?: { bytes: Uint8Array; mime: "image/png"; width: number; height: number }
}
export type BrowserToolInvocation = {
  messageID: string
  callID: string
  signal: AbortSignal
  vision: boolean
  authorize: (request: AuthorizationRequest) => Promise<"allow" | "deny" | "cancel">
}
type Identity = { runtime: "legacy" | "v2"; location: string; sessionID: string }
type Session = {
  identity: Identity
  caller: string
  browsers: Map<string, Promise<BrowserSession>>
  operations: Map<string, { id: string; browser: string }>
  active?: BrowserToolExecution
  closing?: Promise<CleanupReport[]>
}
type Binding = { browser: string; turn: BrowserTurn; source?: object; keep: Map<TabHandle, Keep>; finalization?: Promise<CleanupReport> }
type Handles = { tab: TabHandle; descriptor: TabDescriptorHandle; frame: FrameHandle; ref: ElementRef; view: ViewToken }
type Alias = { kind: keyof Handles; value: Handles[keyof Handles]; binding: Binding; tab?: TabHandle; title?: string }
type Source = {
  action: BrowserToolInput["action"]
  session: Session
  execution: BrowserToolExecution
  browser: string
  invocation: BrowserToolInvocation
  tabScope?: string
  tabTitle?: string
}
const LIMITS = { sessions: 64, calls: 256, aliases: 8192, output: 160 * 1024, cached: 16 * 1024 * 1024 }
// Never reuse a public alias across observations/executions; random process scope
// also separates aliases retained in history across server restarts.
const aliasScope = randomBytes(8).toString("base64url")
let nextAlias = 0
const batchActions = new Set(["click", "dblclick", "move", "drag", "type", "key", "scroll", "navigate", "read", "inspect", "screenshot"])
const observations = new Set(["read", "inspect", "screenshot"])
const fields = new Set([
  "action",
  "topic",
  "offset",
  "limit",
  "browser",
  "tab",
  "descriptor",
  "frame",
  "detail",
  "ref",
  "selector",
  "read",
  "attribute",
  "view",
  "operation",
  "url",
  "text",
  "mode",
  "key",
  "shift",
  "x",
  "y",
  "path",
  "button",
  "modifiers",
  "deltaX",
  "deltaY",
  "disposition",
  "steps",
])
const actions = new Set([
  "browsers",
  "documentation",
  "discover",
  "create",
  "claim",
  "resume",
  "inspect",
  "read",
  "navigate",
  "click",
  "dblclick",
  "move",
  "drag",
  "type",
  "key",
  "scroll",
  "screenshot",
  "status",
  "keep",
  "finalize",
  "execute",
])
const argumentsByAction: Record<BrowserToolInput["action"], readonly string[]> = {
  browsers: [],
  documentation: ["topic", "offset", "limit"],
  discover: [],
  create: ["url"],
  claim: ["descriptor"],
  resume: [],
  inspect: ["tab", "frame", "detail"],
  read: ["tab", "selector", "read", "attribute"],
  navigate: ["tab", "url"],
  click: ["tab", "ref", "selector", "view", "x", "y", "button", "modifiers"],
  dblclick: ["tab", "ref", "selector", "view", "x", "y", "button", "modifiers"],
  move: ["tab", "view", "x", "y", "modifiers"],
  drag: ["tab", "view", "path", "modifiers"],
  type: ["tab", "ref", "selector", "text", "mode"],
  key: ["tab", "ref", "selector", "key", "shift"],
  scroll: ["tab", "view", "x", "y", "deltaX", "deltaY"],
  screenshot: ["tab"],
  status: ["operation"],
  keep: ["tab", "disposition"],
  finalize: [],
  execute: ["tab", "steps"],
}
const fail = (code: string) => new BrowserError(code, randomUUID(), "not_dispatched")
const key = (identity: Identity) => JSON.stringify([identity.runtime, identity.location, identity.sessionID])
const unconfirmed = (): CleanupReport => ({
  confirmed: false,
  code: "cleanup_unconfirmed",
  tabs: 0,
  retained: 0,
  message: "Browser cleanup could not be confirmed; preserve tabs",
})

export class BrowserToolOwner {
  readonly connections: readonly ToolConnection[]
  #controller?: Promise<BrowserController>
  #sessions = new Map<string, Session>()
  #sources = new WeakMap<object, Source>()
  #closing?: Promise<CleanupReport[]>

  constructor(input: { connections: ToolConnection[] }) {
    if (
      !input.connections.length ||
      input.connections.length > 8 ||
      new Set(input.connections.map((item) => item.id)).size !== input.connections.length
    )
      throw fail("unsupported")
    this.connections = Object.freeze(input.connections.map((item) => Object.freeze({ ...item })))
  }

  begin(identity: Identity): BrowserToolExecution {
    if (this.#closing) throw fail("disconnected")
    if (!identity.sessionID || !identity.location || !["legacy", "v2"].includes(identity.runtime))
      throw fail("unsupported_execution")
    const id = key(identity)
    let session = this.#sessions.get(id)
    if (!session) {
      if (this.#sessions.size >= LIMITS.sessions) throw fail("resource_limit")
      session = { identity: { ...identity }, caller: randomUUID(), browsers: new Map(), operations: new Map() }
      this.#sessions.set(id, session)
    }
    if (session.active || session.closing) throw fail("execution_busy")
    const execution = new BrowserToolExecution(this, session, {
      controller: () => this.#connect(),
      source: (token, source) => this.#sources.set(token, source),
      finished: () => {
        if (session.active === execution) session.active = undefined
        if (!session.active && !session.browsers.size && !session.operations.size && !session.closing)
          this.#sessions.delete(id)
      },
    })
    session.active = execution
    return execution
  }

  current(identity: Identity): BrowserToolExecution {
    const execution = this.#sessions.get(key(identity))?.active
    if (!execution || !execution.active) throw fail("unsupported_execution")
    return execution
  }

  #connect() {
    if (this.#closing) return Promise.reject(fail("disconnected"))
    return (this.#controller ??= BrowserController.create({
      connections: this.connections.map(({ screenshotVerified: _, ...connection }) => connection),
      authorize: async (request) => {
        const source = request.authorizationContext && this.#sources.get(request.authorizationContext)
        if (
          !source ||
          source.browser !== request.browserId ||
          source.session.caller !== request.callerSessionId ||
          request.signal.aborted
        )
          return "deny"
        const lifecycle = !source.execution.active
        if (lifecycle && request.capability !== "handoff" && request.capability !== "discovery") return "deny"
        if (!lifecycle && request.callerTurnId !== source.execution.id) return "deny"
        // Creating an empty agent tab and releasing/preserving our own leases do
        // not grant access to page content. Site access and user-tab claims do.
        if (request.capability === "create" || request.capability === "handoff" ||
          ((lifecycle || source.action === "finalize") && request.capability === "discovery")) return "allow"
        const site = ["read", "input", "navigation", "screenshot"].includes(request.capability)
        const origin = request.destination ? new URL(request.destination).origin : request.documentOrigin
        const approval = Object.freeze({ ...request,
          ...(site ? { capability: "site" as const, documentOrigin: origin,
            frameOrigin: request.destination ? origin : request.frameOrigin } : {}),
          ...(request.capability === "discovery" ? {
            documentOrigin: undefined, frameOrigin: undefined, destination: undefined,
          } : {}),
          tabScope: source.tabScope, tabTitle: source.tabTitle,
        })
        return source.execution.authorize(approval, source.invocation)
      },
    }).catch((error) => {
      this.#controller = undefined
      throw error
    }))
  }

  closeSession(identity: Identity): Promise<CleanupReport[]> {
    const session = this.#sessions.get(key(identity))
    if (!session) return Promise.resolve([])
    if (session.closing) return session.closing
    session.closing = (async () => {
      const reports = session.active ? await session.active.end() : []
      for (const pending of session.browsers.values()) {
        const browser = await pending.catch(() => undefined)
        if (browser) reports.push(await browser.close().catch(unconfirmed))
      }
      session.operations.clear()
      // Keep a failed lease blocked until process teardown, never reacquire an uncertain session.
      if (reports.every((report) => report.confirmed)) this.#sessions.delete(key(identity))
      return reports
    })()
    return session.closing
  }

  async closeLocation(location: string) {
    return (
      await Promise.all(
        [...this.#sessions.values()]
          .filter((session) => session.identity.location === location)
          .map((session) => this.closeSession(session.identity)),
      )
    ).flat()
  }

  close(): Promise<CleanupReport[]> {
    if (this.#closing) return this.#closing
    this.#closing = (async () => {
      const reports = (
        await Promise.all([...this.#sessions.values()].map((session) => this.closeSession(session.identity)))
      ).flat()
      const controller = await this.#controller?.catch(() => undefined)
      if (controller) reports.push(await controller.close().catch(unconfirmed))
      return reports
    })()
    return this.#closing
  }
}

export class BrowserToolExecution {
  readonly id = randomUUID()
  #approvals = new Map<string, Promise<"allow" | "deny" | "cancel">>()
  #bindings = new Map<string, Promise<Binding>>()
  #aliases = new Map<string, Alias>()
  #calls = new Map<string, { fingerprint: string; result: Promise<BrowserToolResult> }>()
  #pending = new Set<Promise<BrowserToolResult>>()
  #abort = new AbortController()
  #end?: Promise<CleanupReport[]>
  #cached = 0

  constructor(
    private owner: BrowserToolOwner,
    private session: Session,
    private hooks: {
      controller: () => Promise<BrowserController>
      source: (token: object, source: Source) => void
      finished: () => void
    },
  ) {}

  get active() {
    return !this.#end && !this.#abort.signal.aborted
  }

  async authorize(request: AuthorizationRequest, invocation: BrowserToolInvocation) {
    if (!this.active || request.signal.aborted) return "cancel" as const
    // Reuse acquisition approval for attachment of this exact claim only. Resume
    // can claim several tabs in one operation without descriptor scopes.
    if (request.capability === "claim" && !request.tabScope) return invocation.authorize(request)
    const key = JSON.stringify([request.browserId, request.capability, request.documentOrigin, request.frameOrigin,
      ...(request.capability === "claim" ? [request.operationId, request.tabScope, request.tabOrigin] : [])])
    let pending = this.#approvals.get(key)
    if (!pending) {
      pending = Promise.resolve().then(() => invocation.authorize(request)).then((decision) => {
        if (decision !== "allow" || request.signal.aborted) this.#approvals.delete(key)
        return request.signal.aborted ? "cancel" as const : decision
      }, (error) => {
        this.#approvals.delete(key)
        throw error
      })
      this.#approvals.set(key, pending)
    }
    const decision = await abortable(pending, request.signal)
    return request.signal.aborted ? "cancel" as const : decision
  }

  async execute(input: BrowserToolInput, invocation: BrowserToolInvocation): Promise<BrowserToolResult> {
    let operation: string | undefined
    const errorResult = (error: unknown) => {
      if (!(error instanceof BrowserError)) throw error
      if (error.operationId && input.browser && error.outcome !== "not_dispatched") {
        operation = this.#operation(error.operationId, input.browser)
      }
      return result(
        input.action,
        error.outcome,
        {
          code: error.code,
          message: error.message,
          operation,
          browser: input.browser,
          retry: "Do not replay mutations. Inspect status and refresh stale observations.",
        },
        error.code,
      )
    }
    try {
      validate(input)
      if (!this.active) throw fail("stale_handle")
      if (!invocation.messageID || !invocation.callID || typeof invocation.authorize !== "function")
        throw fail("unsupported_execution")
      const id = JSON.stringify([invocation.messageID, invocation.callID])
      const fingerprint = JSON.stringify(
        Object.entries(input)
          .filter(([, value]) => value !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      )
      const admitted = this.#calls.get(id)
      if (admitted) {
        if (admitted.fingerprint !== fingerprint) throw fail("duplicate_conflict")
        return admitted.result
      }
      if (this.#calls.size >= LIMITS.calls || this.#cached >= LIMITS.cached) throw fail("resource_limit")
      if (this.session.operations.size + this.#pending.size >= LIMITS.calls && input.action !== "status")
        throw fail("resource_limit")
      const pending = this.#run(input, invocation)
        .catch(errorResult)
        .finally(() => this.#prune())
      // Admit before yielding; concurrent duplicate delivery joins settlement and never redispatches.
      const cached = {
        fingerprint,
        result: pending.then((value) => {
          this.#cached += Buffer.byteLength(value.text) + Buffer.byteLength(value.modelText ?? "")
          return value.image
            ? result(
                input.action,
                value.metadata.outcome,
                { code: "already_settled", message: "Capture already delivered; mutation was not repeated." },
                "already_settled",
              )
            : value
        }),
      }
      // Observe a defect without converting it to success; exact duplicate callers still see the rejection.
      void cached.result.catch(() => {})
      this.#calls.set(id, cached)
      this.#pending.add(pending)
      try {
        return await pending
      } finally {
        this.#pending.delete(pending)
      }
    } catch (error) {
      return errorResult(error)
    }
  }

  async #binding(browser: string): Promise<Binding> {
    const existing = this.#bindings.get(browser)
    if (existing) return existing
    if (!this.owner.connections.some((connection) => connection.id === browser)) throw fail("browser_unavailable")
    const pending = (async () => {
      const controller = await this.hooks.controller()
      if (!this.active) throw fail("cancelled")
      await controller.reconnect(browser)
      let session = this.session.browsers.get(browser)
      if (session && !(await session.catch(() => undefined))?.connected) {
        this.session.browsers.delete(browser)
        session = undefined
      }
      if (!session) {
        session = controller.openSession({ browserId: browser, callerSessionId: this.session.caller })
        this.session.browsers.set(browser, session)
      }
      const turn = await (await session).beginTurn({ callerTurnId: this.id })
      return { browser, turn, keep: new Map<TabHandle, Keep>() }
    })()
    this.#bindings.set(browser, pending)
    return pending
  }

  #alias<K extends keyof Handles>(binding: Binding, kind: K, value: Handles[K], tab?: TabHandle, title?: string) {
    this.#prune()
    for (const [id, alias] of this.#aliases)
      if (alias.binding === binding && alias.kind === kind && alias.value === value) return id
    if (this.#aliases.size >= LIMITS.aliases) throw fail("resource_limit")
    if (!Number.isSafeInteger(++nextAlias)) throw fail("resource_limit")
    const id = `${kind[0]}${aliasScope}_${nextAlias.toString(36)}`
    this.#aliases.set(id, { binding, kind, value, tab, title })
    return id
  }

  #resolve<K extends keyof Handles>(id: string | undefined, kind: K, binding: Binding, tab?: TabHandle): Handles[K] {
    const alias = id && this.#aliases.get(id)
    if (
      !alias ||
      alias.kind !== kind ||
      alias.binding !== binding ||
      (tab && alias.tab !== tab) ||
      !binding.turn.validHandle(alias.value)
    )
      throw fail("stale_handle")
    return alias.value as Handles[K]
  }

  #prune() {
    for (const [id, alias] of this.#aliases) if (!alias.binding.turn.validHandle(alias.value)) this.#aliases.delete(id)
  }

  #remove(binding: Binding, kind?: keyof Handles, tab?: TabHandle) {
    for (const [id, alias] of this.#aliases)
      if (alias.binding === binding && (!kind || alias.kind === kind) && (!tab || alias.tab === tab))
        this.#aliases.delete(id)
  }

  #operation(id: string, browser: string) {
    for (const [alias, entry] of this.session.operations) if (entry.id === id && entry.browser === browser) return alias
    // Unknown status IDs must not be evicted to make further mutations possible.
    if (this.session.operations.size >= LIMITS.calls) throw fail("resource_limit")
    const alias = `operation_${randomUUID()}`
    this.session.operations.set(alias, { id, browser })
    return alias
  }

  async #run(input: BrowserToolInput, invocation: BrowserToolInvocation): Promise<BrowserToolResult> {
    if (invocation.signal.aborted) throw fail("cancelled")
    if (input.action === "execute") {
      let completed = 0
      for (const step of input.steps ?? []) {
        try {
          const value = await this.#run({ ...step, tab: input.tab, browser: input.browser }, invocation)
          if (value.metadata.code || value.metadata.outcome !== "confirmed") {
            return result("execute", value.metadata.outcome, {
              completed, failedStep: completed + 1, failedAction: step.action,
              code: value.metadata.code, operation: value.metadata.operation,
              browser: input.browser, failure: value.modelText ?? value.text,
              retry: "Stopped; remaining steps were not run. Do not replay the batch or completed input.",
            }, value.metadata.code ?? "batch_stopped")
          }
          if (observations.has(step.action)) {
            const output = result("execute", "confirmed", { completed: completed + 1, observation: JSON.parse(value.text) })
            output.modelText = `Execute: ${completed + 1} steps completed.\n${value.modelText ?? value.text}`
            output.image = value.image
            return output
          }
          completed++
        } catch (error) {
          if (!(error instanceof BrowserError)) throw error
          const browser = input.browser ?? (input.tab ? this.#aliases.get(input.tab)?.binding.browser : undefined)
          const operation = error.operationId && browser && error.outcome !== "not_dispatched"
            ? this.#operation(error.operationId, browser) : undefined
          return result("execute", error.outcome, {
            completed, failedStep: completed + 1, failedAction: step.action,
            code: error.code, message: error.message, browser, operation,
            retry: "Stopped; remaining steps were not run. No rollback. Do not replay the batch or completed input; inspect status for uncertain input.",
          }, error.code)
        }
      }
      return result("execute", "confirmed", { completed,
        refresh: "Obtain the cheapest state check needed for the next decision; confirmation is not business-task success." })
    }
    if (input.action === "documentation") {
      const connection = this.owner.connections.find((item) => item.id === input.browser)
      if (!connection) throw fail(input.browser ? "browser_unavailable" : "browser_required")
      const doc = browserDocumentation({
        id: connection.id,
        label: connection.label,
        capture: connection.screenshotVerified === true && invocation.vision,
        topic: input.topic,
        offset: input.offset,
        limit: input.limit,
      })
      return {
        title: "Browser documentation",
        text: doc.text ?? doc.error,
        metadata: {
          action: input.action,
          outcome: "not_dispatched",
          browser: connection.id,
          ...(doc.error ? { code: "documentation_unavailable" } : {}),
        },
      }
    }
    if (input.action === "browsers") {
      return result(input.action, "not_dispatched", {
        browsers: this.owner.connections.map((connection) => ({
          id: connection.id,
          label: connection.label,
          profileIdentity: "unverified",
          capture: connection.screenshotVerified ? "verified_setup" : "unverified_setup",
          capabilities: [
            "documentation",
            "discover",
            "create",
            "claim",
            "resume",
            "inspect",
            "read",
            "screenshot",
            "status",
            "keep",
            "finalize",
            "execute",
          ],
          coordinates: "viewport CSS pixels",
          excluded: ["evaluation", "CDP", "clipboard", "files", "history"],
        })),
      })
    }
    const browser = input.browser ?? (() => {
      if (!input.tab) throw fail("browser_required")
      const alias = this.#aliases.get(input.tab)
      if (!alias || alias.kind !== "tab" || !alias.binding.turn.validHandle(alias.value)) throw fail("stale_handle")
      return alias.binding.browser
    })()
    if (input.action === "status") {
      if (!input.operation) throw fail("operation_required")
      const entry = input.operation && this.session.operations.get(input.operation)
      if (!entry || entry.browser !== browser) throw fail("stale_handle")
      const status = await (await this.hooks.controller()).operationStatus(entry.id)
      return result(input.action, status.outcome, {
        operation: input.operation,
        state: status.state,
        code: status.code,
        quarantine: "Status does not release ownership or authorize replay.",
      })
    }
    if (input.action === "screenshot") {
      if (!invocation.vision) throw fail("unsupported_modality")
      if (!this.owner.connections.find((connection) => connection.id === browser)?.screenshotVerified)
        throw fail("capture_unverified")
    }
    if (this.session.operations.size >= LIMITS.calls) throw fail("resource_limit")
    const signal = AbortSignal.any([invocation.signal, this.#abort.signal])
    const started = Date.now()
    const binding = await abortable(this.#binding(browser), signal)
    if (!this.active) throw fail("cancelled")
    if (binding.finalization && input.action !== "finalize") throw fail("stale_handle")
    const source = Object.freeze({})
    const scope = input.action === "claim" ? input.descriptor : input.tab
    const selected = scope ? this.#aliases.get(scope) : undefined
    this.hooks.source(source, {
      action: input.action,
      session: this.session,
      execution: this,
      browser,
      invocation,
      tabScope: selected?.binding === binding ? scope : undefined,
      tabTitle: selected?.binding === binding ? selected.title : undefined,
    })
    binding.source = source
    const remaining = 15_000 - (Date.now() - started)
    if (remaining <= 0) throw fail("deadline_exceeded")
    const options = { authorizationContext: source, signal, timeoutMs: remaining, permissionTimeoutMs: 300_000 }
    const turn = binding.turn
    if (input.action === "finalize") {
      binding.finalization ??= turn.end({ keep: [...binding.keep.values()], authorizationContext: source }).catch(unconfirmed)
      const cleanup = await binding.finalization
      this.#remove(binding)
      return result(input.action, cleanup.confirmed ? "confirmed" : "unknown", {
        browser,
        cleanup,
        ...(cleanup.code ? { code: cleanup.code } : {}),
        message: cleanup.confirmed
          ? "Finalization verified. This browser's aliases are closed for this execution; resume handoffs next turn."
          : "Finalization unconfirmed. Tabs remain protected; do not repeat input or claim them through another session.",
      }, cleanup.code)
    }
    if (input.action === "discover") {
      const page = await turn.discoverTabs(options)
      this.#remove(binding, "descriptor")
      return result(input.action, "confirmed", {
        tabs: page.tabs.map(({ handle, title, url }) => ({
          descriptor: this.#alias(binding, "descriptor", handle, undefined, title),
          title,
          url,
        })),
        truncated: page.truncated,
        untrusted: true,
      })
    }
    if (input.action === "create" || input.action === "claim") {
      const tab =
        input.action === "create"
          ? await turn.createTab({ url: input.url }, options)
          : await turn.claimTab(this.#resolve(input.descriptor, "descriptor", binding), options)
      return result(input.action, "confirmed", {
        tab: this.#alias(binding, "tab", tab, undefined, selected?.title),
        readAuthorized: false,
      })
    }
    if (input.action === "resume") {
      return result(input.action, "confirmed", {
        tabs: (await turn.resumeTabs(options)).map((tab) => this.#alias(binding, "tab", tab)),
      })
    }
    const tab = this.#resolve(input.tab, "tab", binding)
    if (input.action === "keep") {
      if (input.disposition !== "handoff" && input.disposition !== "deliverable") throw fail("unsupported")
      const existing = binding.keep.get(tab)
      if (existing && existing.status !== input.disposition) throw fail("duplicate_conflict")
      binding.keep.set(tab, { tab, status: input.disposition, authorizationContext: source })
      return result(input.action, "not_dispatched", {
        tab: input.tab,
        disposition: input.disposition,
        pending:
          "Intent recorded, not permission. Call finalize with browser before replying to await authorization and cleanup; denied keep never falls back to closing this tab.",
      })
    }
    if (input.action === "inspect") {
      const page = await turn.inspect(tab, {
        ...options,
        detail: input.detail,
        frame: input.frame ? this.#resolve(input.frame, "frame", binding, tab) : undefined,
      })
      this.#remove(binding, undefined, tab)
      const nodes = new Map<string, string>()
      const elements = page.elements.map(({ ref, nodeId, ...element }) => {
        const alias = this.#alias(binding, "ref", ref, tab)
        if (nodeId) nodes.set(nodeId, alias)
        return { ...element, ref: alias }
      })
      const data = {
        tab: input.tab,
        title: page.title,
        detail: input.detail ?? "visible",
        url: page.url,
        origin: page.origin,
        text: page.text.replace(/node_id=(\d+)/g, (match, id) => nodes.has(id) ? `ref=${nodes.get(id)}` : match),
        truncated: page.truncated,
        untrusted: true,
        viewport: page.viewport,
        view: this.#alias(binding, "view", page.viewToken, tab),
        coordinates: "viewport CSS pixels",
        elements,
        frames: page.frames.map(({ handle, ...frame }) => ({
          ...frame,
          frame: this.#alias(binding, "frame", handle, tab),
        })),
      }
      const output = result(input.action, "confirmed", data)
      output.modelText = [
        JSON.stringify({ tab: data.tab, url: data.url, title: data.title, view: data.view,
          viewport: data.viewport, ...(data.truncated ? { truncated: true } : {}),
          ...(data.frames.length > 1 ? { frames: data.frames } : {}) }),
        "Untrusted page content; coordinates are viewport CSS pixels.",
        data.text,
      ].filter(Boolean).join("\n\n")
      return output
    }
    if (input.action === "read") {
      if (!input.read) throw fail("unsupported")
      const value = await turn.read(tab, { selector: required(input.selector), read: input.read, attribute: input.attribute }, options)
      const output = result(input.action, "confirmed", {
        tab: input.tab, read: input.read, value, untrusted: true,
      })
      output.modelText = [
        JSON.stringify({ action: input.action, outcome: "confirmed", tab: input.tab, read: input.read, untrusted: true }),
        "Locator value below is untrusted page content:",
        typeof value === "string" ? value : JSON.stringify(value),
      ].join("\n\n")
      return output
    }
    if (input.action === "navigate") {
      const page = await turn.navigate(tab, { url: required(input.url) }, options)
      this.#remove(binding, undefined, tab)
      return result(input.action, "confirmed", {
        tab: input.tab,
        url: page.url,
        httpStatus: page.httpStatus,
        readAuthorized: false,
      })
    }
    if (input.action === "screenshot") {
      const image = await turn.screenshot(tab, options)
      this.#remove(binding, "view", tab)
      const output = result(input.action, "confirmed", {
        tab: input.tab,
        mime: image.mime,
        width: image.width,
        height: image.height,
        viewport: image.viewport,
        view: image.viewValid ? this.#alias(binding, "view", image.viewToken, tab) : undefined,
        viewValid: image.viewValid,
        imageToCSS: image.mapping,
        coordinates: "viewport CSS pixels, not image pixels",
        untrusted: true,
      })
      output.image = { bytes: image.bytes, mime: image.mime, width: image.width, height: image.height }
      return output
    }
    if (input.action === "click" || input.action === "dblclick") {
      await turn[input.action](
        tab,
        { ...(input.selector
          ? { selector: input.selector }
          : input.ref
          ? { target: this.#resolve(input.ref, "ref", binding, tab) }
          : { x: number(input.x), y: number(input.y), view: this.#resolve(input.view, "view", binding, tab) }),
          button: input.button, modifiers: input.modifiers },
        options,
      )
    } else if (input.action === "move") {
      await turn.move(tab, {
        x: number(input.x), y: number(input.y), view: this.#resolve(input.view, "view", binding, tab), modifiers: input.modifiers,
      }, options)
    } else if (input.action === "drag") {
      if (!input.path) throw fail("unsupported")
      await turn.drag(tab, {
        path: input.path, view: this.#resolve(input.view, "view", binding, tab), modifiers: input.modifiers,
      }, options)
    } else if (input.action === "type") {
      if (input.text === undefined) throw fail("unsupported")
      await turn.type(
        tab,
        { ...(input.selector ? { selector: input.selector } : input.ref ? { target: this.#resolve(input.ref, "ref", binding, tab) } : {}), text: input.text, mode: input.mode },
        options,
      )
    } else if (input.action === "key") {
      await turn.key(
        tab,
        {
          ...(input.selector ? { selector: input.selector } : input.ref ? { target: this.#resolve(input.ref, "ref", binding, tab) } : {}),
          key: required(input.key),
          modifiers: input.shift ? ["Shift"] : undefined,
        },
        options,
      )
    } else if (input.action === "scroll") {
      await turn.scroll(
        tab,
        {
          deltaX: number(input.deltaX),
          deltaY: number(input.deltaY),
          view: this.#resolve(input.view, "view", binding, tab),
          x: input.x,
          y: input.y,
        },
        options,
      )
    } else throw fail("unsupported")
    return result(input.action, "confirmed", {
      tab: input.tab,
      refresh: "Obtain the cheapest state check needed for the next decision; confirmation is not business-task success.",
    })
  }

  end(): Promise<CleanupReport[]> {
    if (this.#end) return this.#end
    this.#abort.abort()
    this.#end = (async () => {
      await Promise.allSettled([...this.#pending])
      const reports: CleanupReport[] = []
      await Promise.all(
        [...this.#bindings.entries()].map(async ([browser, pending]) => {
          const binding = await pending.catch(() => undefined)
          if (!binding) {
            // Registration can have reached the host even though no public turn was returned.
            const session = await this.session.browsers.get(browser)?.catch(() => undefined)
            if (session) {
              const closed = await session.close().catch(unconfirmed)
              reports.push(closed)
              if (closed.confirmed) this.session.browsers.delete(browser)
            }
            return
          }
          binding.finalization ??= binding.turn
            .end({ keep: [...binding.keep.values()], authorizationContext: binding.source, preserveUnmarked: true })
            .catch(unconfirmed)
          const report = await binding.finalization
          reports.push(report)
          if (report.confirmed && report.retained === 0) {
            const session = await this.session.browsers.get(browser)?.catch(() => undefined)
            if (session) {
              const closed = await session.close().catch(unconfirmed)
              if (closed.confirmed) this.session.browsers.delete(browser)
              else reports.push(closed)
            }
          }
        }),
      )
      this.#aliases.clear()
      this.#approvals.clear()
      this.#calls.clear()
      this.hooks.finished()
      return reports
    })()
    return this.#end
  }
}

function required(value: string | undefined) {
  if (!value) throw fail("unsupported")
  return value
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(fail("cancelled"))
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) abort()
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}
function number(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) throw fail("unsupported")
  return value
}
function validate(input: BrowserToolInput, step = false) {
  if (
    !input ||
    typeof input !== "object" ||
    !actions.has(input.action) ||
    Object.keys(input).some((field) => !fields.has(field))
  )
    throw fail("unsupported")
  // Page input has one sequence-shaped public entry point; individual handlers
  // remain internal so their authorization and original-engine semantics are shared.
  if (!step && batchActions.has(input.action) && !observations.has(input.action)) throw fail("unsupported")
  if (input.detail !== undefined && input.detail !== "visible" && input.detail !== "page") throw fail("unsupported")
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (field !== "action" && field !== "browser" && !argumentsByAction[input.action].includes(field))
      throw fail("unsupported")
    if (typeof value === "string" && value.length > (field === "text" ? 65536 : field === "url" ? 8192 : field === "selector" ? 4096 : 256))
      throw fail("resource_limit")
    if (["x", "y", "deltaX", "deltaY", "offset", "limit"].includes(field)) {
      if (typeof value !== "number" || !Number.isFinite(value)) throw fail("unsupported")
    } else if (field === "shift") {
      if (typeof value !== "boolean") throw fail("unsupported")
    } else if (field === "modifiers") {
      if (!Array.isArray(value) || value.length > 5 ||
        value.some((item) => !["Alt", "Control", "ControlOrMeta", "Meta", "Shift"].includes(item))) throw fail("unsupported")
    } else if (field === "path") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 256 || value.some((point) =>
        !point || typeof point !== "object" || Object.keys(point).some((key) => key !== "x" && key !== "y") ||
        !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw fail("unsupported")
    } else if (field === "steps") {
      if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw fail("unsupported")
    } else if (typeof value !== "string") throw fail("unsupported")
  }
  if (input.action === "execute") {
    if (!input.tab || !input.steps) throw fail("unsupported")
    if (Buffer.byteLength(JSON.stringify(input)) > 65536) throw fail("resource_limit")
    for (const [index, step] of input.steps.entries()) {
      if (!step || typeof step !== "object" || !batchActions.has(step.action) ||
        Object.keys(step).some((field) => ["browser", "tab", "steps"].includes(field)) ||
        observations.has(step.action) && index !== input.steps.length - 1) throw fail("unsupported")
      validate({ ...step, tab: input.tab, browser: input.browser }, true)
      if (step.action === "navigate" && !step.url || step.action === "scroll" &&
        (!step.view || step.deltaX === undefined || step.deltaY === undefined)) throw fail("unsupported")
    }
  }
  if (input.ref !== undefined && !input.ref || input.selector !== undefined && !input.selector) throw fail("unsupported")
  if (input.ref !== undefined && input.selector !== undefined) throw fail("unsupported")
  if (input.action === "read" && (
    !input.selector || !input.read || !["innerText", "textContent", "getAttribute", "count", "isVisible", "isEnabled"].includes(input.read) ||
    (input.read === "getAttribute" ? !input.attribute : input.attribute !== undefined)
  )) throw fail("unsupported")
  if (input.action === "type" && (input.text === undefined ||
    (input.ref || input.selector ? input.mode !== "replace" && input.mode !== "append" : input.mode !== undefined)
  )) throw fail("unsupported")
  if (input.action === "key" && !input.key) throw fail("unsupported")
  if (input.button !== undefined && !["left", "middle", "right"].includes(input.button)) throw fail("unsupported")
  if (input.action === "click" || input.action === "dblclick") {
    if (input.ref || input.selector) {
      if (input.view !== undefined || input.x !== undefined || input.y !== undefined) throw fail("unsupported")
    } else if (!input.view || input.x === undefined || input.y === undefined) throw fail("unsupported")
    if (input.ref && (input.button !== undefined || input.modifiers !== undefined) ||
      input.action === "dblclick" && !input.selector && input.button !== undefined) throw fail("unsupported")
  }
  if (input.action === "move" && (!input.view || input.x === undefined || input.y === undefined)) throw fail("unsupported")
  if (input.action === "drag" && (!input.view || !input.path)) throw fail("unsupported")
}
function result(action: string, outcome: string, data: Record<string, unknown>, code?: string): BrowserToolResult {
  const text = JSON.stringify({ action, outcome, ...data })
  if (Buffer.byteLength(text) > LIMITS.output) throw fail("result_too_large")
  return {
    title: `Browser ${action}: ${code ?? outcome}`,
    text,
    metadata: {
      action,
      outcome,
      ...(code ? { code } : {}),
      ...(typeof data.operation === "string" ? { operation: data.operation } : {}),
      ...(typeof data.browser === "string" ? { browser: data.browser } : {}),
      ...(typeof data.completed === "number" ? { completed: data.completed } : {}),
      ...(typeof data.failedStep === "number" ? { failedStep: data.failedStep } : {}),
      ...(typeof data.failedAction === "string" ? { failedAction: data.failedAction } : {}),
    },
  }
}
