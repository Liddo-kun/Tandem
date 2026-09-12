# Chrome Controller: Phase 2 Implementation Plan

Status: **Phase 2's supported baseline is implemented and verified**. The aggregate gate returned `phase2AcceptancePassed: true`: 158 deterministic tests, typecheck/formatting, three consecutive 32-assertion fresh core runs, a 37-assertion extended user-tab run, dedicated fault/disposition evidence and two-browser selection. The public API, fixed page driver, v2 IPC and lifecycle journal live in `packages/chrome-bridge/`. Background screenshots use Chromium's `CDPScreenshotNewSurface` flag without a foreground fallback. The package README records exact evidence paths, scope and recovery limitations; full OpenAI plugin parity and Phase 3/4 features are not implied.

Date: 2026-09-10.

Implementation decisions within this phase:

- Frame handles bind both the observed frame loader and URL, not just a reusable CDP frame ID. Same-URL reloads require fresh inspection.
- Chromium 149 background capture requires the explicitly prepared `--screenshot-new-surface` flag. Viewport changes invalidate coordinate tokens rather than silently retargeting input.
- Foreground preservation is verified for ordinary input/capture. Native turn completion can change Chrome's tab/group selection during disposal; cleanup is a separate lifecycle operation and is not advertised as preserving physical selection. No physical activation API or fallback was added.
- Native/browser identity probes justify exact-wire cleanup with a live host, but not adoption of unknown previous-host leases. Such recovery remains explicitly `cleanup_unconfirmed`, preserving tabs as allowed by the original recovery contract.
- Navigation reports HTTP status as `unavailable`; HTTP error documents remain distinct from browser navigation failures. Oversize PNG and viewport-race cases are tested deterministically, with live DPR/zoom/scroll evidence for browser semantics.
- No scope expansion into full Playwright/AX parity, arbitrary evaluation, file/clipboard capabilities, model tools, permission UI, or production installation.

Parent roadmap: [Codex-Free Chrome Integration Plan](chrome-extension-port-plan.md).

Verified foundation: [`packages/chrome-bridge/README.md`](../packages/chrome-bridge/README.md).

## Objective

Turn the Phase 1 transport proof into a reusable, model-independent browser controller. A trusted caller should be able to select a browser, own a session and turn, claim or create a tab, inspect it, act on it, and end the turn with predictable cleanup.

Success is not merely wrapping `bridge.call` in convenience functions. The controller must prevent cross-session access, order operations correctly, distinguish failures from uncertain outcomes, and recover without repeating side effects.

### Scope Decisions

- Keep the Codex-independent architecture and unmodified extension. No original native host, browser service/client, `node_repl`, app-server, or Codex config/auth dependency.
- Target the verified Linux ARM64 Chromium environment first. Test with isolated profiles and local pages; leave production native-host registration and existing `webfetch` untouched.
- **Internet access is expected. Offline operation and network-isolation experiments are out of scope and are not acceptance gates.** Network failures still need bounded, intelligible errors.
- Do not add model tools, a skill, Tandem permission UI, server routes, or mobile/desktop UI changes. Those are Phase 3.
- Provide an authorization interface now, but do not describe it as a complete security sandbox or a substitute for Phase 3 end-to-end permission tests.
- No full Playwright parity, arbitrary caller-supplied JavaScript, raw public CDP, clipboard access, uploads/downloads, history/bookmark search, credential storage, or sidepanel integration.
- Support top-level documents and same-origin frames. Cross-origin frame control, closed shadow roots, pop-up adoption, and unusual input widgets remain unsupported unless separately implemented and live-tested within this phase.

## Starting Point

Phase 1 verified Chromium `149.0.7827.102`, extension `1.26.901.11451`, and Bun `1.3.14`: 41 tests and three fresh-browser runs with 50 assertions each.

| Existing Component                           | Keep                                                                                                       | Required Phase 2 Work                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native.ts`                              | Framing, bounded writes, bidirectional RPC, heartbeat replies, distinct request IDs                        | Add dispatch/outcome tracking and cancellation support without changing native framing                                                         |
| `src/host.ts`                                | One controller socket per native connection, caller-origin check, private discovery, late-response cleanup | Explicit lifecycle registration, structured errors/status, recovery journal, session-scoped uncertainty instead of unnecessary global shutdown |
| `src/client.ts`                              | Unix-socket connection, validation, basic discovery                                                        | Explicit host selection, disconnect events, abort/deadline propagation, structured lifecycle calls                                             |
| `script/prepare.ts`                          | Fresh HOME/profile, own host, extension hashes, production-manifest baseline                               | Support selecting multiple prepared connections without touching production registration                                                       |
| `script/smoke.ts`, `script/evidence.ts`      | Independent low-level browser and provenance proof                                                         | Keep their guarantees; add separate controller-level verification rather than making raw smoke the controller test                             |
| `test/native.test.ts`, `test/bridge.test.ts` | Real streams and subprocess tests                                                                          | Add cancellation, concurrency, recovery, and lifecycle-race regressions                                                                        |

Important constraints from the current code:

- `connect(runDir)` currently rejects multiple discovery files; it does not select a browser or profile.
- One host accepts one IPC controller. This is useful exclusivity, not a reason to create a socket for every Tandem session.
- Host turn tracking currently infers ownership from arbitrary RPC parameters. That is insufficient for a stable controller lifecycle contract.
- A caller timeout can occur before the wire request settles. The host retains wire requests for 30-35 seconds, then treats unresolved ownership as uncertain.
- Notifications are forwarded to the single controller without per-session routing.
- The live click proof passed after both `Page.bringToFront` and a wait for the click counter were added. These changes were not tested independently, so Phase 1 did not establish that physical foregrounding was necessary. Screenshot dimensions were physical pixels, while input coordinates were CSS pixels.
- Graceful host restart is verified. Controller crashes, host `SIGKILL`, extension-worker loss, and browser crashes need explicit recovery behavior, not claims of guaranteed cleanup.

### Background Tab Behavior

Read-only inspection of the original `chrome-standalone-plugin/scripts/browser-service.mjs` and installed extension shows that ordinary clicks target a specific debugger target using `Input.dispatchMouseEvent`, without calling `Page.bringToFront` or the extension's separate `focusTab` method. The original service also enables `Emulation.setFocusEmulationEnabled` after attachment; renderer focus emulation is distinct from selecting a browser tab or focusing an OS window.

The extension creates agent tabs with physical `active: false`, while reporting session-logical `active: true`. Its animated cursor is presentation, not the OS pointer. These facts support background operation by design, but are not a new live proof of the Tandem controller.

**Default Phase 2 actions must target background tabs without stealing foreground selection.** Probe focus emulation and result-observation timing independently. Do not turn the Phase 1 workaround into a mandatory browser-wide input lock or a requirement to activate every tab.

## Architecture

```text
Trusted caller (fixture runner now; Tandem execution adapter in Phase 3)
                         |
             BrowserController + authorization callback
                         |
            Bound sessions, turns, tab/frame handles
                         |
       Ownership registry / queues / page operations / recovery
                         |
          One IPC connection per selected native host
                         |
            Tandem native host and recovery journal
                         |
              Unmodified extension -> Chromium tabs
```

### Ownership Of State

- One `BrowserController` instance multiplexes multiple logical sessions through each selected host connection. A second independent controller process must receive `controller_busy`, not steal the first connection.
- The controller owns public handles, operation queues, permission decisions, document revisions, and event routing.
- The host owns wire dispatch status and a minimal durable record sufficient to attempt lifecycle cleanup after controller/host failure. Do not duplicate the entire controller in the host.
- The extension remains the authority for actual tab existence and its session leases. Local state is reconciled against it, never assumed to be browser truth.
- No persistent daemon or new transport protocol is needed beyond extending the existing private IPC contract.

### Connection Identity

Distinguish three identities:

1. **Configured browser binding:** a trusted caller-supplied ID and label associated with an explicitly prepared connection directory.
2. **Native connection epoch:** a new opaque generation for every host connection/reconnection. Public handles carry this epoch.
3. **Extension/browser identity:** observed `getInfo` identity fields, extension generation where available, and verified process/profile provenance.

Do not equate PID, native-host UUID, extension installation UUID, and browser profile. Probe identity behavior across native restart, worker restart, and browser restart before using a field for recovery.

Never silently select the first Chromium profile, first tab, or first discovery file. When profile identity cannot be established, expose a caller-provided label and an explicit unknown/unverified field rather than inventing a profile name. Multiple-profile selection must be tested; multiple-profile auto-discovery inside one Chromium process is not promised.

## Proposed Public Contract

Keep public types with `controller.ts` initially. Export a controller entrypoint, not a barrel exposing the raw transport.

```ts
const controller = await BrowserController.create({
  connections: [{ id: "fixture-browser", label: "Isolated Chromium", directory: preparedRunDir }],
  authorize: async (request) => fixturePolicy.decide(request),
})

const session = await controller.openSession({
  browserId: "fixture-browser",
  callerSessionId: "trusted-fixture-session",
})
const turn = await session.beginTurn({ callerTurnId: "trusted-fixture-turn" })

try {
  const tab = await turn.createTab({ url: fixtureURL })
  const page = await turn.inspect(tab)
  await turn.type(tab, { target: page.refs.input, text: "replacement", mode: "replace" })
  await turn.click(tab, { target: page.refs.button })
  const image = await turn.screenshot(tab)
  // image includes bytes, MIME, viewport metadata, and pixel-to-CSS mapping.
} finally {
  await turn.end({ keep: [] })
  await session.close()
  await controller.close()
}
```

The example shows the happy path; cancellation and incomplete cleanup return explicit outcomes. Do not let a cleanup error silently replace the original operation error.

| Surface           | Contract                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Controller        | List configured browsers and connection diagnostics; connect explicitly; open a bound session; close with bounded cleanup          |
| Session           | Bind trusted caller identity; create one active turn at a time; retain confirmed handoff state between turns; close explicitly     |
| Turn              | Authorized tab discovery, create/claim, inspect, navigate, click, type, key, scroll, screenshot, and end with keep dispositions    |
| Tab handle        | Opaque controller-owned reference to browser epoch, session, lease, and numeric extension tab ID; reject forged or foreign handles |
| Frame/reference   | Document-scoped opaque reference; never a caller-selected CDP target/session ID                                                    |
| Operation options | `signal` and bounded `timeoutMs`; deadline includes queueing and pre-dispatch work                                                 |
| Events            | Session-filtered normalized events and connection-wide health events; no public unfiltered extension event feed                    |

Caller session/turn IDs come from trusted execution context, not model arguments. Generate separate opaque wire session/turn IDs so caller collisions cannot adopt an unrelated extension lease. Reject duplicate active session ownership rather than manufacturing two owners.

### Errors And Outcomes

Use one structured error type with a stable code, operation ID, safe message, and outcome:

- `not_dispatched`: no native action was submitted; safe for the caller to decide on a new attempt.
- `confirmed`: the browser returned an outcome; success or failure does not by itself imply rollback.
- `unknown`: dispatch may have occurred but completion/effects are not established.

Initial error codes: `browser_unavailable`, `ambiguous_browser`, `controller_busy`, `permission_denied`, `permission_cancelled`, `unsupported`, `tab_owned`, `stale_handle`, `target_changed`, `deadline_exceeded`, `cancelled`, `disconnected`, `operation_uncertain`, `cleanup_unconfirmed`, `result_too_large`, and `protocol_error`.

Preserve native/extension error codes as bounded diagnostic causes. The current forwarding path can flatten errors into generic RPC failures; fix that before relying on typed recovery decisions. Do not put page contents, input text, cookies, or raw CDP payloads in default errors/logs.

## Authorization Boundary

Authorization is required at controller creation. There is no default allow-all policy. The fixture runner supplies a narrowly scoped policy for its own browser, tabs, and loopback origins.

The callback receives the bound caller session/turn, browser binding, requested capability, tab origin (`user` or `agent`), current document/frame origin, and intended navigation destination when applicable. Return explicit allow, deny, or cancel. Callback errors and unsupported decisions fail closed.

Capabilities initially distinguish tab discovery, tab claim/create, content read, input, navigation, screenshot, and handoff. A supplied callback can deliberately map capabilities to one approval; Phase 2 must not silently merge them itself.

Rules:

- Listing tab titles/URLs is browsing-data access and needs its own authorization. Merely listing configured browser labels need not enumerate tabs.
- Request authorization before debugger attachment or acting on an existing user tab. Never use unapproved page content as the basis for automatically granting access.
- Permissions are scoped to the actual browser/session/origin and operation class, not to a mutable URL string alone.
- Revalidate origin, lease, document, and permit after queue waits and immediately before dispatch. If reauthorization is needed, release execution locks before waiting on the callback.
- Redirects, manual navigation, frame navigation, and SPA URL changes invalidate the relevant cached decisions/references. New-origin content cannot be read or acted on without authorization.
- This is an automation authorization boundary, **not a network firewall**: following a redirect or loading a subresource can contact another origin before the controller observes it. Do not claim prevention of all unauthorized network requests.
- Reject unsupported schemes and targets explicitly. Initially permit authorized HTTP/HTTPS and controller-owned `about:blank` initialization; reject privileged browser pages, `file:`, `javascript:`, and opaque-origin interaction.
- Export no arbitrary evaluation/CDP escape hatch from the public controller API. Internal fixed inspection scripts and test-only raw transport access remain separate.

## Operations

### Discovery, Claims, And Navigation

- Return bounded tab descriptors only after authorized discovery. Claim by a descriptor bound to a browser epoch, not by an unvalidated numeric ID supplied to a public action.
- Reserve a tab claim atomically in the controller before awaiting extension adoption; release it only after a confirmed failure or cleanup. Two sessions racing for one tab must produce one owner and one `tab_owned` result.
- Creating a tab records agent ownership before navigation. If navigation fails, retain a handle/operation record so the disposable tab can still be cleaned up.
- Navigation completion means the requested document reached a defined readiness condition, not that the site is idle forever. Use DOM/content readiness plus bounded document checks; do not use indefinite network-idle waits.
- Return final URL, document identity, and any observed HTTP status. Distinguish an HTTP error page, a browser navigation error, and a navigation whose final outcome is unknown.
- Pop-ups are not implicitly claimed. Report a bounded event and require explicit adoption support; otherwise leave them alone and advertise the limitation.

### Inspection And Element References

Build a bounded visible-text/interactive-element view, not a claim of a full accessibility snapshot or old Playwright locator parity.

- Use a fixed script in an isolated execution world where supported, with structured arguments. Never concatenate caller text into executable JavaScript.
- Return page URL/title, document revision, frame descriptors, bounded visible text, and interactive elements with opaque refs, role/type, best-effort accessible label, state, and CSS bounds.
- Use a small bounded per-document map from refs to actual elements in the isolated world. This is an inspection helper, not an agent JavaScript execution runtime. Avoid mutating the page with synthetic selector attributes.
- Replace the map when a new inspection supersedes it. Invalidate it on navigation, context loss, frame removal, or connection epoch change.
- Before an element action, check that the referenced element remains connected in the same document, still matches its observed identity/state, and is interactable. Do not silently resolve a stale ref to a different element with the same text.
- Support top-level documents, explicit same-origin child frames, and ordinary open shadow-root traversal. Cross-origin frame contents and closed shadow roots return an explicit unsupported boundary, not fabricated empty content.
- Do not return password values, hidden form values, cookies, storage contents, or uncontrolled HTML dumps. Ordinary visible editable values may be returned within output bounds.
- Avoid reading the entire page and truncating afterward. Bound traversal and serialization in the browser so huge DOMs cannot overflow native messaging first.

### Input And Scrolling

- Element clicks use fresh geometry and hit testing; scroll the element into view if needed, then dispatch native CDP pointer input once to the intended tab/frame target. Do not physically activate the tab as part of ordinary input.
- Probe and use target-local focus emulation where needed and supported. Keep DOM element focus, renderer focus emulation, session-logical active tab, and physical foreground selection separate in the implementation and tests.
- Coordinate clicks accept viewport CSS coordinates plus a current view token. Reject stale viewport/document tokens and out-of-bounds coordinates.
- `type` requires explicit `replace` or `append`. Focus/select using the controlled helper and insert text through CDP, preserving input events expected by frameworks. Do not assign `.value` as a substitute for real input.
- Initial typing supports ordinary text inputs, textareas, and explicitly tested contenteditable elements. Unsupported input types fail clearly; do not accidentally operate a file picker or password field.
- Keyboard input uses a documented allowlist of page-oriented keys/modifiers. Exclude clipboard and browser-global shortcuts initially. Confirm the intended focus target before dispatch.
- Scroll using wheel events with separate horizontal and vertical deltas in CSS-pixel units. Do not use horizontal swipe gestures that can trigger browser Back/Forward.
- No fixed click offsets, blanket DOM retries, or automatic second typing/click attempt after a failed assertion or timeout.

### Screenshots

- Start with viewport screenshots only. Full-page capture is a separate later capability, not an implicit fallback.
- Return actual image bytes and MIME, encoded dimensions, viewport CSS dimensions, device scale, visual viewport offsets/scale when applicable, and a view token.
- Derive image-to-CSS mapping from measured capture/viewport data; never assume DPR 1, or that raw DPR alone accounts for zoom and clipping.
- Refuse capture if dimensions change during the measurement/capture interval, or return an explicitly invalidated view token. Do not silently rescale images without updating mapping.
- No temporary file is required by the controller API. Test runners can persist images under `/tmp/tandem`; Phase 3 decides attachment storage and model presentation.

## Ordering, Cancellation, And Recovery

### Scheduling

Use these scopes, without holding locks during permission dialogs:

1. Session/turn lifecycle ordering: only one active turn per session; ending a turn blocks new admission.
2. Tab queues: mutations and inspections of one tab cannot overtake each other. A snapshot cannot run halfway through a multi-command typing action.
3. Browser-wide coordination only for explicitly requested physical activation or another operation proven to affect shared browser state. Ordinary target-scoped CDP input must not take a foreground lock merely because it uses the words "mouse" or "focus". If an operation genuinely requires foregrounding, surface that requirement and obtain explicit authorization; do not introduce a silent fallback.

Use a consistent acquisition order and abortable waits. Do not hold a global controller lock across slow operations on unrelated browsers. The extension may serialize more broadly within one wire session; measure that rather than assuming per-tab parallelism inside it.

### Dispatch State

Track operations as `queued -> preparing -> dispatched -> settled`, with an explicit unresolved branch after dispatch. Internal multi-command actions also record which steps were dispatched; an input sequence is not an atomic transaction.

| Failure Point                     | Caller Result                                                                | Subsequent Actions                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Cancelled/expired before dispatch | `not_dispatched`                                                             | Remove queued work; no browser effect; unrelated work continues                           |
| Cancelled during preparation      | Classify any already-dispatched focus/scroll steps; no remaining input steps | Do not claim that preparatory effects were rolled back                                    |
| Timeout/cancel after dispatch     | `unknown` until settled                                                      | Retain wire tracking and quarantine the affected tab/session scope                        |
| Late successful/error response    | Update the original operation record only                                    | No replay; do not resolve another operation or automatically continue dependent mutations |
| Native disconnect                 | Reject pending callers with their actual dispatch outcome                    | Invalidate public handles; begin bounded reconciliation, not transparent operation replay |
| Browser/worker generation changes | `stale_handle` / `disconnected`                                              | Require fresh discovery/claim; no adoption by recycled numeric tab ID                     |

The caller should receive cancellation promptly; cleanup can continue within its separate recovery budget. Expose operation/recovery status so the caller can distinguish waiting, settled, and manual intervention required.

A timeout on one tab must not close a healthy host or end another session merely because the current Phase 1 code has a global `uncertain` flag. Quarantine the narrowest scope whose ordering is uncertain. If protocol corruption or native-port loss invalidates the whole connection, mark every affected session explicitly.

Read-only polling is allowed only for declared readiness/reconciliation conditions within one deadline. Reconnection may retry discovery and health checks. Neither permission nor the label "read" authorizes replay of a compound action that has already dispatched focus, scroll, or navigation.

### Turn Completion And Handoff

`turn.end({ keep })` is an awaited, deduplicated lifecycle operation:

1. Reject new work for that turn and cancel work not yet dispatched.
2. Settle or classify outstanding wire actions within the recovery budget.
3. Persist the intended keep dispositions before dispatching completion.
4. Send `turnEnded` for ordinary cleanup, or the observed `finalizeTabs` contract for explicit handoff/deliverable retention.
5. Verify tab existence, debugger state, and remaining ownership where observable. Return a cleanup report, not unconditional success.

Expected dispositions, to be verified at controller level:

- Unmarked agent-created tab: close and detach.
- Unmarked user-origin tab: preserve, detach, release the claim.
- `deliverable`: preserve and release to the user.
- `handoff`: preserve for a later turn of the same session; reacquire valid document handles and authorization when resuming.

Do not remove tracking merely because a local promise resolved. A native method's reported success must mean the lifecycle semantics expected by this controller; probe `finalizeTabs` rather than treating its name as proof.

If a keep operation is uncertain, never fall back to bare `turnEnded` and risk closing a requested deliverable. Session close should release retained handoff tabs to the user when that can be confirmed; otherwise return `cleanup_unconfirmed` and preserve them. Do not close user tabs to force a clean status.

### Minimal Recovery Journal

To survive host failure, add an owner-only, bounded journal under the explicitly configured connection directory. Keep persistence code in `host.ts` until it has a concrete reason to be separate.

Persist before dispatching lease-affecting operations:

- Journal version, controller ownership token, connection/browser identity evidence.
- Opaque wire session/turn IDs and known tab lease IDs/origins.
- Pending create/claim intents, operation identity/state, and requested keep dispositions.

Do not persist URLs, titles, page content, input text, screenshots, cookies, or complete CDP requests. Publish atomic replacements; document the durability level. Phase 2 tests process crashes, not guaranteed recovery after device power loss.

On recovery:

- Acquire exclusive controller ownership; do not reconcile a live controller's journal.
- Validate journal schema, bounds, owner/mode, symlink safety, and current connection identity.
- If the same extension session can be identified, use exact wire IDs for bounded lifecycle reconciliation. Verify what happened before clearing records.
- Replay only cleanup operations proven idempotent for the same session/turn and keep intent. Never replay navigation, create, claim, typing, click, or submission from a journal.
- If a create response was lost, use the wire session's lifecycle when safe; do not guess the new tab by URL or close every unfamiliar tab.
- If browser identity, lease state, or completion ordering cannot be proven, preserve tabs, invalidate handles, and return `cleanup_unconfirmed` with a recovery instruction.
- A reconnected socket alone is not proof that the old session was cleaned up. Unknown work cannot be declared ready and silently reused.

## Initial Bounds

Implement named defaults and test boundary values; changing them requires a documented reason, not a silent cap increase to pass a fixture.

| Resource                     | Initial Limit / Behavior                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Native messages              | Preserve 1 MiB host-to-extension and 16 MiB extension-to-host limits                                                      |
| Native peer                  | Preserve 64 pending requests and 32 MiB write queue                                                                       |
| Logical sessions             | 8 active per browser connection                                                                                           |
| Claimed/created tabs         | 16 per session; fail before new acquisition exceeds the bound                                                             |
| Pending controller actions   | 16 per tab and 128 per connection, including queued actions                                                               |
| Host wire calls              | Preserve 32 in flight; include lifecycle/recovery capacity in admission so cleanup cannot starve                          |
| Ordinary action deadline     | 15 seconds by default, configurable up to 30 seconds initially, including queueing                                        |
| Caller cancellation delivery | Settle within 250 ms in deterministic tests, independent of the wire cleanup window                                       |
| Recovery/close budget        | At most 40 seconds total with current 30-35 second wire tracking; report unresolved state afterward                       |
| Tab discovery                | At most 100 descriptors per response with explicit truncation                                                             |
| Inspection                   | At most 2,000 visited nodes, 200 interactive refs, 64 KiB visible text, and 128 KiB serialized result                     |
| Screenshot                   | 8 MiB encoded bytes and 64 MiB decoded data; explicit oversize error, no MIME-changing fallback                           |
| Event buffering              | 256 events per connection; coalesce replaceable updates, but never silently drop disconnect/ownership-invalidating events |
| Journal                      | 1 MiB maximum; reject corrupt/oversized records and report recovery blocked                                               |

Frame the performance assertions as deterministic harness checks, not guarantees under a frozen browser or suspended Android process. Suspended timers must not cause actions to execute after their absolute deadline on resume.

## Files And Implementation Order

Stay inside `packages/chrome-bridge/`. No Effect migration, new browser automation dependency, or second executable tool registry is needed.

Proposed additions:

```text
src/controller.ts          # Public types/API, ownership, scheduling, lifecycle
src/page.ts                # Fixed page helpers, refs, input, capture metadata
test/controller.test.ts    # Real IPC peer + controller policy/state tests
test/page.test.ts          # Pure mapping/validation helpers where meaningful
test/fixtures/            # DOM, SPA, frames, focus, scroll, and fault pages
script/controller-smoke.ts # Explicitly selected isolated-browser suite
```

Extend `native.ts`, `client.ts`, and `host.ts` at their current boundaries. If `controller.ts` becomes difficult to follow, extract a cohesive scheduler or ownership registry, not a framework of one-function abstractions.

### Step 1: Pin Protocol And Lifecycle Assumptions

- Re-run Phase 1 tests and a fresh live proof before changing behavior.
- Run a separate background-input probe: keep an unrelated user tab physically selected, dispatch click/type to an inactive controlled tab, and wait for final state without repeating input. Compare target-local focus emulation enabled/disabled separately from result polling. Verify the physical selection through a browser-level observer, not the extension's session-logical `active` field or emulated document focus/visibility alone. A test-only read-only observer extension or inspected browser UI can supply that evidence without modifying the ChatGPT extension.
- Probe identity across host/browser/worker restart; `getUserTabs` descriptors; `Target.getTargets` visibility; notification target identity; frame/context APIs; `finalizeTabs`; and handoff resumption.
- Confirm extension-side ordering of late create/claim and completion. Determine whether controller reconciliation can safely end a turn whose response was lost.
- Record capabilities as verified, unsupported, or unknown; no readiness claim based only on method names in source.

Gate: protocol notes distinguish live facts from assumptions, and uncertain cases have explicit safe outcomes. No production registration changes.

### Step 2: Establish The Controller And IPC Contracts

- Add explicit connection selection and one multiplexing controller per host.
- Implement bound session/turn/tab types, structured errors, status/disconnect events, and required authorization callback.
- Add explicit host lifecycle registration and operation status; retain `bridge.call` only as an internal/test transport seam.
- Negotiate the private bridge contract version. Mismatched compiled hosts fail with a clear rebuild/reprepare instruction; do not maintain an unused legacy adapter.
- Test the public import surface so raw RPC/CDP is not accidentally the supported controller API.

Gate: two sessions can coexist and be addressed independently; foreign handles, unsupported methods, missing policy, and ambiguous selection fail before privileged dispatch.

### Step 3: Implement Ownership And Scheduling

- Add atomic claims, session/turn transitions, and tab queues. Add browser-wide coordination only at verified shared-state operations; keep independent background-tab actions concurrent.
- Route events by browser epoch, tab/frame ownership, and wire session when present. Connection health can be shared; page/download data cannot be broadcast to all sessions.
- Unknown event targets invalidate/reconcile affected local state instead of being assigned to whichever session is active.
- Add queue limits, absolute deadlines, abortable waits, and invalidation on tab closure/navigation.

Gate: concurrent-session and background-target fixtures pass without stealing foreground selection; denied/cancelled/expired queued requests cause no target action; slow work does not starve healthy sessions or heartbeat handling.

### Step 4: Implement Inspection And Browser Actions

- Implement create/claim/navigation, followed by bounded inspection and frame/ref validation.
- Add element/coordinate click, explicit typing modes, key allowlist, wheel scrolling, and viewport screenshots.
- Add measured coordinate mapping and same-origin frame transforms, including nested scrolling and DPR/zoom cases.
- Return explicit unsupported results for excluded capabilities instead of silently falling back to arbitrary script execution or another backend.

Gate: deterministic page assertions prove final values, trusted events, exactly one submission, correct scroll axes, correct frame target, valid PNG/MIME, and stale-reference rejection.

### Step 5: Implement Completion And Crash Recovery

- Add the minimal write-ahead lifecycle journal and exclusive recovery ownership.
- Implement deduplicated end/close, handoff/deliverable dispositions, narrow quarantine, and late-response reconciliation.
- Inject failures at acquisition, action dispatch, response delivery, keep finalization, journal publication, and cleanup.
- Verify controller crash, native host `SIGTERM`/`SIGKILL`, worker disconnect/restart, and browser restart separately. Do not substitute three clean starts for these fault tests.

Gate: no mutation replay or accidental user-tab closure; recoverable same-instance cases clean up; irreconcilable cases produce bounded `cleanup_unconfirmed` and never admit actions through stale handles.

### Step 6: Integrate The Test Harness And Document The Boundary

- Add proposed package scripts `test:controller` and `smoke:controller`. The live runner connects only to explicitly prepared browsers and never installs or changes production registration.
- Keep the independent raw Phase 1 smoke usable; update its IPC expectations only where the versioned contract deliberately changes.
- Extend evidence verification with named controller assertions, fault outcomes, capability matrix, cleanup reports, and unchanged-registration/process-trace checks.
- Update the package README with the supported API, verified limitations, operation outcome meanings, and recovery instructions.
- If new files change the fork-owned divergence inventory, revise the existing `log.md` bridge entry, preserving unrelated edits. Do not add a chronological changelog for each internal change.

Gate: the final Phase 2 matrix below passes and can be reproduced without any Tandem model/UI integration.

## Acceptance Matrix

Use real streams and host subprocesses for deterministic transport faults, the real extension for browser semantics, and local pages for observable effects. Synthetic peers are not evidence of browser compatibility.

| Area                 | Required Cases                                                                                                                          | Pass Condition                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Selection            | Two prepared browser bindings; missing host; stale/ambiguous discovery; busy host; unverified profile metadata                          | Explicit correct selection or precise error; no silent fallback or production access                                           |
| Permissions          | Missing callback; allow/deny/cancel/throw; revocation while queued; navigation to a new origin                                          | No privileged action after denial; no content from a newly unauthorized document                                               |
| Ownership            | Two sessions race to claim one tab; forged/foreign handle; reused tab ID after restart                                                  | Exactly one owner; other requests rejected; no cross-session results/events                                                    |
| Lifecycle ordering   | Duplicate begin/end; new action during end; one session cancelled while another acts                                                    | One active turn; deduplicated cleanup; healthy session remains usable                                                          |
| Background targeting | Two sessions type/click on inactive tabs while an unrelated user tab remains selected; target-local focus emulation; screenshot capture | Text/click counters appear only in intended targets exactly once; physical selection is unchanged; no stale coordinate mapping |
| Navigation           | Ordinary load, SPA route, redirect, HTTP error, navigation failure, manual navigation, page never ready                                 | Bounded readiness/error; correct final identity; old refs and permits invalidated                                              |
| Inspection           | Large DOM, hidden fields, password input, open shadow root, detached/replaced element                                                   | Bounded output/traversal; no excluded values; no stale ref silently retargeted                                                 |
| Frames               | Same-origin nested frame and scroll offsets; frame removal/navigation; cross-origin frame                                               | Supported frame acts on correct document; unsupported/unauthorized frame fails explicitly                                      |
| Typing/key           | Replace/append into populated input, textarea, framework-controlled input, tested contenteditable, Unicode, key allowlist               | Exact final text and expected events; no duplicate text or clipboard/browser-global action                                     |
| Pointer/scroll       | Element and coordinate click, overlay obstruction, DOM movement, horizontal/vertical/diagonal wheel, scroll boundary                    | Trusted hit on intended target or `target_changed`; no fixed offset or unintended browser Back                                 |
| Screenshot           | DPR 1/2, browser zoom, viewport resize, nonzero scroll, oversize image                                                                  | Valid bytes/MIME and correct image-to-CSS mapping; stale view rejected                                                         |
| Cancellation         | Queued, permission wait, between compound-action steps, after wire dispatch                                                             | Prompt caller settlement; accurate outcome; no remaining steps or replay                                                       |
| Uncertainty          | Delayed mutation beyond caller deadline, lost reply, late error, operation budget exhausted                                             | Original operation retained/reconciled; duplicate-submit counter stays one; quarantine is explicit                             |
| Dispositions         | Agent/user origin crossed with default/handoff/deliverable; next turn; session close; failed keep response                              | Correct preserved/closed tabs and leases; no destructive fallback for uncertain keep                                           |
| Process faults       | Controller exit, host graceful stop, host kill, worker restart, browser kill/restart                                                    | Bounded pending failures, identity-safe recovery, no stale-handle adoption; explicit unresolved cleanup when necessary         |
| Journal              | Crash before/after intent/result publication; missing/corrupt/oversized file; stale identity; another live owner                        | No replay or guessed tab closure; safe exclusive reconciliation or recovery-blocked error                                      |
| IPC/resources        | Malformed client, unsafe permissions, symlinks, queue/result/event limits, repeated session churn                                       | No public listener, bounded memory/work, no silent loss of invalidating events, no resource growth after cleanup               |
| Independence         | Traced fresh starts and host reconnect with the compiled Tandem host                                                                    | No Codex/original-runtime access; production native manifest unchanged                                                         |

A required case may not be recorded as a passing skip. If a browser capability proves unavailable, mark it unsupported in the API and document whether the scope still satisfies the required baseline; do not count an unsupported mandatory capability as completed.

## Verification And Exit Gate

Existing commands remain valid:

```sh
bun run --cwd packages/chrome-bridge typecheck
bun run --cwd packages/chrome-bridge test
```

Controller commands now available:

```sh
bun run --cwd packages/chrome-bridge test:controller
bun run --cwd packages/chrome-bridge smoke:controller -- --run-dir /tmp/tandem/chrome-bridge/<fresh-run>
```

`verify:phase2` combines the package checks, three fresh core runs, the extended
user-tab run, and dedicated fault/selection evidence. See the README for its six
explicit run-directory arguments. Individual `verify:controller` results do not
certify the whole phase.

Use a separate multi-browser fixture configuration for selection/session isolation. Never make the default unit test launch Chromium or run root-level `bun test`.

Final verification requires:

1. Package typecheck, formatting, transport regressions, and deterministic controller/fault tests pass.
2. Three consecutive fresh, traced controller-suite runs pass with the real extension; include meaningful two-session overlap and a separate two-browser selection test.
3. Dedicated live fault cases pass or return the specifically permitted unresolved outcome with evidence. Clean starts do not replace crash tests.
4. Saved reports include browser/extension versions, bridge contract version, capability statuses, assertion/fault outcomes, session isolation, dispatch counts, cleanup reports, and process/registration checks. Page payloads are excluded from default logs.
5. The first successful screenshot for each new coordinate mode is visually checked against the fixture; numeric mapping assertions remain the automated gate.
6. All test browsers/hosts and artifacts under their ownership are cleaned up or explicitly accounted for. Never use broad process kills on the shared Android/Linux kernel.
7. The README accurately separates supported behavior, unsupported features, and recovery limitations. Offline behavior is not required or implied.

**Phase 2 is complete when a deterministic trusted caller can reliably use the controller API across the supported operations and fault cases, without raw-CDP escape hatches, cross-session leakage, or duplicate mutations.** Only then start Phase 3's model tools, permissions UI, and Tandem execution integration.
