export * as Browser from "./browser"

import { Cause, Context, Effect, Exit, Layer, Schema } from "effect"
import { isAbsolute } from "node:path"
import {
  BrowserToolOwner,
  type BrowserToolExecution,
  type BrowserToolInput,
  type BrowserToolResult,
  type ToolConnection,
} from "@tandem/chrome-bridge/tools"
import type { AuthorizationRequest, CleanupReport } from "@tandem/chrome-bridge"
import { makeGlobalNode, makeLocationNode } from "./effect/app-node"
import { memoMap } from "./effect/memo-map"
import { Location } from "./location"

const Bounded = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const Connection = Schema.Struct({
  id: Bounded,
  label: Bounded,
  directory: Schema.String.check(Schema.isMaxLength(4096)),
  hostId: Schema.optional(Bounded),
  screenshotVerified: Schema.optional(Schema.Boolean),
})

export function connections(raw = process.env.TANDEM_CHROME_CONNECTIONS): ToolConnection[] {
  if (raw === undefined || raw === "") return []
  if (raw.length > 32768) throw new Error("Invalid TANDEM_CHROME_CONNECTIONS")
  try {
    const value = Schema.decodeUnknownSync(
      Schema.Array(Connection).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    )(Schema.decodeUnknownSync(Schema.UnknownFromJsonString)(raw))
    if (
      value.some((item) => !isAbsolute(item.directory)) ||
      new Set(value.map((item) => item.id)).size !== value.length
    )
      throw new Error("Invalid browser configuration")
    return value.map((item) => ({ ...item }))
  } catch {
    throw new Error("Invalid TANDEM_CHROME_CONNECTIONS")
  }
}

export class Service extends Context.Service<Service, { readonly owner: BrowserToolOwner | undefined }>()(
  "@tandem/Browser",
) {}

const resourceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configured = connections()
    if (!configured.length) return { owner: undefined }
    const owner = new BrowserToolOwner({ connections: configured })
    yield* Effect.addFinalizer(() =>
      Effect.promise(() => owner.close()).pipe(
        Effect.tap((reports) =>
          reports.some((report) => !report.confirmed)
            ? Effect.logWarning("Browser shutdown cleanup_unconfirmed")
            : Effect.void,
        ),
      ),
    )
    return { owner }
  }),
)

// Explicit memo-map lease also shares the owner with legacy runtimes and fresh Location graphs.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const context = yield* Layer.buildWithMemoMap(resourceLayer, memoMap, yield* Effect.scope)
    return Context.get(context, Service)
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })

// A Location graph expiring must not dispose an active legacy execution in the same directory.
export const locationKey = (location: { directory: string; workspaceID?: string }, runtime: "legacy" | "v2") =>
  JSON.stringify([runtime, location.workspaceID ?? null, location.directory])

export const beginExecution = (
  owner: BrowserToolOwner | undefined,
  input: Parameters<BrowserToolOwner["begin"]>[0],
  publish: (text: string) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    if (!owner) return undefined
    const context = yield* Effect.context<never>()
    return yield* Effect.acquireRelease(
      Effect.sync(() => owner.begin(input)),
      (execution) =>
        // Keep publication inside the awaited cleanup boundary, outside the interrupted source fiber.
        Effect.promise(async () => {
          const reports = await execution.end()
          const text = cleanupText(reports)
          if (text) await Effect.runPromiseWith(context)(Effect.uninterruptible(publish(text)))
        }).pipe(Effect.uninterruptible),
    )
  })

export const locationNode = makeLocationNode({
  name: "browser/location",
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const { owner } = yield* Service
      const location = locationKey(yield* Location.Service, "v2")
      if (owner)
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => owner.closeLocation(location)).pipe(
            Effect.tap((reports) =>
              reports.some((report) => !report.confirmed)
                ? Effect.logWarning("Browser project cleanup_unconfirmed")
                : Effect.void,
            ),
            Effect.asVoid,
          ),
        )
    }),
  ),
  deps: [node, Location.node],
})

export const description =
  "Control configured Chromium with the original plugin engine. First load the chrome-browser skill and follow its bootstrap before interaction."
const Alias = Schema.optional(Bounded)
const StepArguments = Schema.Struct({
  frame: Alias,
  detail: Schema.optional(Schema.Literals(["visible", "page"])).annotate({ description: "Inspection detail: visible (default) returns bounded viewport controls with refs/view and no semantic page text; page returns full semantic page text with view/viewport metadata but no elements or refs. Prefer read for known text/attributes and use the cheapest observation that answers the next decision." }),
  ref: Alias,
  selector: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))).annotate({ description: "Original Playwright selector, required for read; optional instead of ref for click/dblclick/type/key. Not supported for move/drag. Use observed CSS or role/name selectors; frame traversal uses >> internal:control=enter-frame >>." }),
  read: Schema.optional(Schema.Literals(["innerText", "textContent", "getAttribute", "count", "isVisible", "isEnabled"])).annotate({ description: "Required for action=read: targeted locator observation, not page inspection." }),
  attribute: Alias.annotate({ description: "Required only for read=getAttribute: DOM attribute name, not a JavaScript property." }),
  view: Alias,
  url: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
  text: Schema.optional(Schema.String.check(Schema.isMaxLength(65536))),
  mode: Schema.optional(Schema.Literals(["replace", "append"])).annotate({ description: "Required for targeted type. Omit mode AND ref/selector for original focused typing at the current caret/selection; no implicit clearing or move to end." }),
  key: Schema.optional(Bounded).annotate({ description: "Original key/chord string. Omit ref/selector to send to current focus; otherwise focus the observed target first." }),
  shift: Schema.optional(Schema.Boolean),
  x: Schema.optional(Schema.Finite),
  y: Schema.optional(Schema.Finite),
  path: Schema.optional(Schema.Array(Schema.Struct({ x: Schema.Finite, y: Schema.Finite })).check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({ description: "Drag only: 1-256 ordered viewport CSS points grounded in the supplied current view. Original left-button press at first point, held movement through remaining points, release at last; no adapter interpolation." }),
  button: Schema.optional(Schema.Literals(["left", "middle", "right"])).annotate({ description: "Click: selector or coordinates only. Dblclick: selector only. Omit for refs; coordinate double-click and drag are left-button only." }),
  modifiers: Schema.optional(Schema.Array(Schema.Literals(["Alt", "Control", "ControlOrMeta", "Meta", "Shift"])).check(Schema.isMaxLength(5))).annotate({ description: "Mouse event modifiers for move/drag and selector/coordinate click/dblclick; not supported for ref clicks. ControlOrMeta uses the original platform mapping. Not keyboard input." }),
  deltaX: Schema.optional(Schema.Finite),
  deltaY: Schema.optional(Schema.Finite),
})
const ObservationActions = new Set(["read", "inspect", "screenshot"])
const BatchStep = Schema.Struct({
  action: Schema.Literals([
    "click",
    "dblclick",
    "move",
    "drag",
    "type",
    "key",
    "scroll",
    "navigate",
    "read",
    "inspect",
    "screenshot",
  ]),
  ...StepArguments.fields,
}).annotate({ parseOptions: { onExcessProperty: "error" } })
const BatchSteps = Schema.Array(BatchStep)
  .check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    Schema.makeFilter((steps) => {
      const observation = steps.findIndex((step) => ObservationActions.has(step.action))
      if (observation !== -1 && observation !== steps.length - 1)
        return "read, inspect, or screenshot may appear only once and only as the final batch step"
      return Buffer.byteLength(JSON.stringify(steps)) <= 65536
        ? undefined
        : "serialized batch steps must not exceed 65536 UTF-8 bytes"
    }),
  )
  .annotate({ description: "Execute only: 1-16 ordered steps on the outer tab/browser; no nested browser, tab, or steps. Optional read/inspect/screenshot must be last." })
export const Input = Schema.Struct({
  action: Schema.Literals([
    "browsers",
    "documentation",
    "discover",
    "create",
    "claim",
    "resume",
    "inspect",
    "read",
    "screenshot",
    "execute",
    "status",
    "keep",
    "finalize",
  ]),
  browser: Alias,
  topic: Alias.annotate({ description: "Named supplementary documentation topic; omit for the complete selected-browser document." }),
  offset: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))).annotate({ description: "Documentation only: zero-based character offset for explicit continuation after truncation." }),
  limit: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))).annotate({ description: "Documentation only: maximum characters in this chunk; omit to read the complete document." }),
  tab: Alias.annotate({ description: "Required for execute." }),
  descriptor: Alias,
  frame: StepArguments.fields.frame,
  detail: StepArguments.fields.detail,
  selector: StepArguments.fields.selector,
  read: StepArguments.fields.read,
  attribute: StepArguments.fields.attribute,
  url: StepArguments.fields.url,
  operation: Alias,
  steps: Schema.optional(BatchSteps),
  disposition: Schema.optional(Schema.Literals(["handoff", "deliverable"])),
}).check(
  Schema.makeFilter((input) => {
    if (input.action === "execute") {
      if (!input.tab) return "tab is required for execute"
      if (!input.steps) return "steps is required for execute"
      return undefined
    }
    return input.steps === undefined ? undefined : "steps is accepted only for execute"
  }),
)

export const Metadata = Schema.Struct({
  action: Schema.String,
  outcome: Schema.String,
  code: Schema.optional(Bounded),
  operation: Schema.optional(Bounded),
  browser: Schema.optional(Bounded),
  completed: Schema.optional(Schema.Number),
  failedStep: Schema.optional(Schema.Number),
  failedAction: Schema.optional(Schema.String),
})

export const failureText = (metadata: typeof Metadata.Type) =>
  `Browser action ${metadata.action}: ${metadata.code}; outcome=${metadata.outcome}` +
  (metadata.completed === undefined ? "" : `; completed=${metadata.completed}`) +
  (metadata.failedStep === undefined ? "" : `; failedStep=${metadata.failedStep}`) +
  (metadata.failedAction === undefined ? "" : `; failedAction=${metadata.failedAction}`) +
  (metadata.operation ? `; operation=${metadata.operation}` : "") +
  (metadata.browser ? `; browser=${metadata.browser}` : "") +
  (metadata.completed === undefined && metadata.failedStep === undefined && metadata.failedAction === undefined
    ? ". No automatic replay."
    : ". Outcome refers to the failed step; earlier completed batch steps were not rolled back. No automatic replay.")

export function permissionRequest(request: AuthorizationRequest) {
  const origin = request.destination ? new URL(request.destination).origin : (request.documentOrigin ?? "browser")
  const scope = [request.browserId, request.capability, origin, request.frameOrigin ?? origin]
    .map((value) => Buffer.from(value).toString("hex"))
    .join(":")
  const resource = request.capability === "claim" ? `${scope}:${request.operationId}` : scope
  return {
    action: "browser",
    resources: [resource],
    save: request.capability === "claim" ? [] : [resource],
    metadata: {
      browser: permissionDisplay(request.browserLabel),
      capability: request.capability === "site" ? "Control this site for this browser turn (read, click, type, navigate, screenshot)" :
        request.capability === "discovery" ? "List browser tabs for this turn" : request.capability,
      origin,
      tabOrigin: request.tabOrigin ?? "none",
      ...(request.tabScope ? { tabScope: permissionDisplay(request.tabScope) } : {}),
      ...(request.tabTitle ? { tabTitle: permissionDisplay(request.tabTitle) } : {}),
    },
  }
}

function permissionDisplay(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 256)
}

// Retain the original Effect Exit across the Promise controller's fail-closed callback boundary.
export const execute = <E>(
  execution: BrowserToolExecution,
  input: BrowserToolInput,
  invocation: {
    messageID: string
    callID: string
    vision: boolean
    signal?: AbortSignal
    authorize: (request: AuthorizationRequest) => Effect.Effect<void, E>
    metadata?: (result: BrowserToolResult) => Effect.Effect<void>
  },
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<never>()
      let denied: Exit.Exit<void, E> | undefined
      let pending: Promise<BrowserToolResult> | undefined
      const exit = yield* restore(
        Effect.promise(
          (signal) =>
            (pending = execution.execute(input, {
              messageID: invocation.messageID,
              callID: invocation.callID,
              vision: invocation.vision,
              signal: invocation.signal ? AbortSignal.any([signal, invocation.signal]) : signal,
              authorize: async (request) => {
                const exit = await Effect.runPromiseExitWith(context)(
                  Effect.suspend(() => invocation.authorize(request)),
                  { signal: request.signal },
                )
                if (Exit.isSuccess(exit)) return "allow"
                // An operation deadline cancels this approval fiber; preserve the controller's
                // structured timeout instead of presenting it as an interrupted tool.
                if (!request.signal.aborted) denied = exit
                return request.signal.aborted ? "cancel" : "deny"
              },
            })),
        ),
      ).pipe(Effect.exit)
      if (Exit.isFailure(exit)) {
        // The controller settles cancellation promptly. Record its actual dispatch outcome before unwinding.
        if (pending && invocation.metadata && Cause.hasInterrupts(exit.cause)) {
          const settlement = pending
          const result = yield* Effect.promise(() =>
            settlement.then(
              (value) => value,
              () => undefined,
            ),
          )
          if (result) return yield* Effect.failCause(exit.cause).pipe(Effect.ensuring(invocation.metadata(result)))
        }
        return yield* Effect.failCause(exit.cause)
      }
      const result = exit.value
      if (denied && Exit.isFailure(denied))
        return yield* Effect.failCause(denied.cause).pipe(
          Effect.ensuring(invocation.metadata ? invocation.metadata(result) : Effect.void),
        )
      if (invocation.metadata) yield* invocation.metadata(result)
      return result
    }),
  )

export function cleanupText(reports: readonly CleanupReport[]) {
  if (!reports.length) return undefined
  return (
    "Browser cleanup: " +
    reports
      .map(
        (report) =>
          `${report.confirmed ? "confirmed" : "cleanup_unconfirmed"}; tabs=${report.tabs}; retained=${report.retained}` +
          (report.stage ? `; stage=${report.stage}` : "") +
          (report.nativeConfirmed === undefined ? "" : `; nativeConfirmed=${report.nativeConfirmed}`),
      )
      .join(" | ")
  )
}
