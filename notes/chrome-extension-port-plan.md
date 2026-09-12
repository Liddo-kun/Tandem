# Codex-Free Chrome Integration Plan

Status: **source-reuse repair deployed; page-engine checks passed, but subsequent-session availability and restart recovery remain unresolved**.
The earlier custom page engine was deployed but failed the actual Shopee session
`ses_f72016fa1fferSoySJfxYJ0BAd` on live refs and capture. The repair now imports
the pinned original service engine into the Tandem server while retaining Tandem
host transport and trusted operation ownership. The copied original client and
WASM files are inactive provenance/reference assets. The repair has not been
deployed to production, and the Shopee task remains unfinished. Electron remains
outside Jon's personal-use scope. See [source comparison](chrome-original-repair.md) and
[Phase 4 evidence](chrome-extension-phase-4-evidence.md).

Date: 2026-09-10.

## Goal And Boundaries

Give Tandem browser control through the existing, unmodified ChatGPT Chrome
extension, with Tandem-owned transport, permissions and lifecycle around a
reviewed, source-pinned import of the original page engine.

Required:

- No Codex executable, app-server, authentication, configuration, or sandbox dependency.
- No original `node_repl`, bundled Node runtime or native-host binary dependency.
  Reuse the installed original `browser-service.mjs` in the Tandem server rather
  than continuing the failed custom page driver. Retain the copied original
  client/WASM only as reviewed provenance/reference assets unless a separately
  designed capability actually imports them.
- Tandem owns permissions, tool behavior, local transport security, and session/turn lifecycle.
- Use the existing browser and its logged-in tabs when the user grants access.
- Keep the current `webfetch` backend and working browser setup intact during development.
- First target: Linux ARM64 Chromium in the tablet's Ubuntu environment. Android Chrome is not the target; the Tandem Android app can later act as a client of the Ubuntu-hosted integration.

Not initial goals: the extension's ChatGPT/Codex sidepanel, full compatibility with the old `tab.playwright` API, secure credential brokerage, extension redistribution, or Windows/macOS support.

The extension remains third-party software with its own network behavior. Codex-free does not establish that the extension is telemetry-free or that every optional capability works offline.

## Architecture And Evidence

```text
Tandem browser tools and permissions
                |
Tandem browser controller + pinned original
service engine/export shim (server process)
                |
Private local IPC
                |
Tandem native-messaging host (launched by Chrome)
                |
Chrome native messaging
                |
Unmodified ChatGPT Chrome extension
                |
chrome.debugger / CDP and extension APIs
                |
Browser tabs
```

Static inspection of installed extension version `1.26.901.11451` found:

- The production native-host name is hard-coded as `com.openai.codexextension`. Tandem must register its own executable under this name to reuse the extension unchanged. The name is a compatibility identifier, not a Codex executable dependency.
- The automation dispatcher exposes JSON-RPC methods including `ping`, `getInfo`, `createTab`, `getUserTabs`, `claimUserTab`, `attach`, `executeCdp`, `finalizeTabs`, and `turnEnded`.
- Session-scoped calls carry `session_id`, `turn_id`, and `session_context`.
- The extension sends heartbeat requests that the host must answer.
- No mandatory Codex app-server handshake or ChatGPT account check was found on the basic direct automation path. Sidepanel integration has separate requirements.

These are source-inspection findings, not a proven public API. Phase 1 must validate them against the running extension. Do not implement the sidepanel protocol merely to make its UI appear connected.

References:

- Original architecture and evidence: `../codex/chrome-plugin-architecture-for-tandem.md`.
- Installed extension: `~/.config/chromium/Profile 5/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0/`.
- Existing Tandem CDP extraction/capture: `packages/opencode/src/plugin/browser-fetch/cdp-fetch.ts`.
- Existing plugin permission/attachment API: `packages/plugin/src/tool.ts`.
- New canonical tool registration constraints: `packages/core/src/tool/AGENTS.md`.
- Repair dependency/source inventory: `notes/chrome-original-repair.md`.

## Four Phases

### Phase 1: Prove The Independent Bridge

Build a minimal native-messaging host and deterministic command-line test controller. Run the unmodified extension in an isolated Chromium environment. Prove browser control without loading any Codex component or modifying the production registration.

Deliverables:

- Native framing, bidirectional JSON-RPC, heartbeat handling, and private local IPC.
- Minimal discovery, tab creation, CDP execution, and turn completion.
- Disposable local page fixture and automated verification runner.
- Protocol notes and redacted evidence from the live test.

Exit criteria:

- An isolated Chromium process launches the Tandem host; `ping` and `getInfo` succeed.
- The controller creates a tab, navigates to a local fixture, reads its content, replaces an input value, performs a coordinate click, and captures a valid screenshot.
- Assertions inspect final page state, not just successful RPC responses.
- Heartbeats keep the native connection alive through at least two expected intervals.
- `turnEnded` detaches automation and cleans up the disposable tab without closing an unrelated test tab.
- Process/config evidence shows no Codex or original plugin runtime dependency.
- Three consecutive fresh-start runs pass; framing and RPC failure tests pass.
- Production native-host registration is byte-for-byte unchanged.

Gate: stop if independent automation requires an unavailable host/account contract. Document the exact request and failure; do not quietly restore Codex as a dependency.

### Phase 2: Build A Reliable Browser Controller

Detailed implementation plan: [Chrome Controller: Phase 2](chrome-extension-phase-2-plan.md). Internet access is expected; offline operation is not a Phase 2 requirement or gate.

Turn the proof into a reusable browser backend independent of any model or UI. Define the supported operation set rather than promising compatibility with every old plugin API.

Deliverables:

- Browser/profile selection, explicit tab claims, session isolation, and per-tab execution ordering.
- Navigation, bounded page/DOM inspection, click, replace/append typing, keyboard input, scroll, screenshots, and handoff.
- Connection loss, timeout, cancellation, stale-handle, and cleanup handling.
- Capability detection and actionable diagnostics for missing extension, manifest, host, browser, or permission.
- Controller authorization boundary ready for Tandem permission decisions; no unrestricted model-facing CDP passthrough.

Exit criteria:

- Fixture suite covers ordinary DOM, SPA navigation, frames where supported, input replacement versus append, coordinate accuracy, and both scroll axes.
- Screenshots preserve MIME and documented viewport/coordinate mapping; large results are bounded.
- Two concurrent controller sessions cannot use each other's tab claims or receive each other's results/events.
- Browser restart, host restart, extension disconnect, closed tabs, cancellation, and delayed responses produce correct errors and bounded cleanup.
- A timed-out mutation is never automatically replayed; a fixture counter confirms no duplicate submission.
- User-owned tabs survive cleanup; handoff/deliverable tabs behave as documented.
- Unsupported capabilities fail explicitly rather than changing execution mode silently.
- Untrusted web pages cannot access the private IPC endpoint; socket permissions and malformed-client handling are tested.

Gate: no model integration until transport, ownership, and mutation semantics are dependable.

### Phase 3: Integrate Tandem Tools And Permissions

Expose the controller through Tandem's actual session/tool execution paths. Keep transport and browser behavior in the reusable backend, with small host-specific adapters.

Implementation update, 2026-09-10. The opt-in tool, permission, execution,
managed-image and skill paths described below are implemented for legacy and V2.
The acceptance list is deliberately retained: implementation is not proof that
every case has passed. See [Phase 3 evidence](chrome-extension-phase-3-evidence.md)
for tested versus pending scope, the [controller README](../packages/chrome-bridge/README.md)
for backend behavior, and the [Phase 2 plan](chrome-extension-phase-2-plan.md).

Deliverables:

- Browser tools and a focused skill with documented capability discovery and bounded output.
- Origin/tab access decisions over the existing Phase 2 capabilities. History, file transfer, clipboard, unrestricted evaluation, and other excluded features are not prerequisites for integration; exposing any later requires a separate capability and authorization design.
- Correct text/image model output and useful tool summaries through existing UI facilities.
- Stable session/turn context and awaited completion/interruption cleanup.
- Explicit support matrix for legacy and V2 session execution. The newer UI alone is not proof of V2 backend integration.

#### Verified Starting Point

| Phase 2 Finding                                                              | Phase 3 Consequence                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One IPC controller per native host; multiple logical sessions per controller | Share one browser-connection owner within the serving process. Do not create a controller per tool call, project, or Tandem session. Another server process must receive `controller_busy`, not steal ownership. |
| Controller handles are identity-bound objects stored in private maps         | They cannot be serialized to the model and reconstructed. Add a bounded server-side alias registry; never expose raw tab/CDP IDs as an alternative.                                                              |
| New inspections supersede refs; frame IDs survive reloads                    | Invalidate model aliases with their underlying observation. A same-URL frame reload still needs fresh handles; URL equality is not document identity.                                                            |
| Cancellation/timeout can follow partial native input                         | Preserve `not_dispatched`, `confirmed`, and `unknown` through tool results and transcripts. Neither a tool error nor `confirmed` means rollback.                                                                 |
| Keep intent is durable before authorization, but is not itself permission    | Await authorized completion and report its outcome. Failed/denied keep must never fall back to an empty keep list that could close a deliverable.                                                                |
| Background input/capture works without physical activation                   | Do not introduce a foreground fallback or a global input lock. Native cleanup can change tab/group selection; do not advertise cleanup as physically invisible.                                                  |
| Chromium 149 background capture needs `CDPScreenshotNewSurface`              | Phase 3 fixtures must prepare that flag explicitly. Report an unverified/unsupported capture setup instead of silently relaunching the user's browser or editing its flags.                                      |
| Unknown previous-host leases cannot be safely adopted                        | Reconnection is not transparent recovery. Invalidate adapter aliases, surface `cleanup_unconfirmed`, and preserve tabs; never clear journals to make a retry succeed.                                            |

The tested environment is Linux ARM64, Chromium `149.0.7827.102`, extension
`1.26.901.11451`, and Bun `1.3.14`. Browser labels are caller-configured and
profile identity remains `unverified`. `getInfo` capability names are not proof
that Tandem implements those features. Advertise the controller's tested
capabilities, not the extension's entire manifest or the original host plugin's API.

#### Integration Seams

These are the implemented seams; keep future changes within the same ownership
boundaries rather than introducing another tool registry or browser backend:

| Surface             | Current Reference / Constraint                                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy/plugin tools | `packages/plugin/src/tool.ts` exposes `ToolContext.ask`, abort, metadata and attachments. `packages/opencode/src/session/tools.ts` binds the real session, assistant message and tool-call context. Prefer supported plugin/config seams where they suffice.       |
| V2 tools            | Follow `packages/core/src/tool/AGENTS.md`: canonical `Tool.make`, scoped registration, leaf-owned permission checks, and registry-owned generic output bounding/retention. Tool visibility is not execution authorization.                                         |
| Plugin/V2 bridge    | Core guidance currently records that plugin boot is not yet redesigned to register canonical tools. Installing a legacy plugin is therefore not evidence of V2 coverage; identify the smallest valid V2 registration seam without building a second tool registry. |
| Run lifecycle       | Trace legacy execution plus `packages/core/src/session/execution.ts`, `execution/local.ts`, `runner/`, and `run-coordinator.ts`. Establish the actual execution boundary before mapping it to a browser turn.                                                      |
| Model/UI output     | Trace provider projection and attachment handling for both paths. Reuse existing tool summaries and permission/attachment UI; add shared API/UI changes only for a demonstrated gap.                                                                               |

Keep the reusable controller independent of Tandem services. The connection
owner needs process-level exclusivity, but authorization and logical sessions
remain bound to their trusted Location/project/session context. Disposing one
project releases only its browser sessions, not another project's connection.
Scope registration and shutdown deliberately; avoid an unmanaged global singleton.

#### Tool And Handle Contract

- Start with the existing operations: configured-browser discovery/status,
  authorized tab discovery/create/claim, inspect, navigate, click, type, key,
  scroll, screenshot, operation status, and explicit keep intent. Final tool
  names/grouping can be chosen during implementation; no generic RPC or JS tool.
- Session and execution-turn IDs come only from trusted runtime context. The
  model may select an explicitly configured browser binding, but may not supply
  socket directories, host epochs, wire IDs, caller identities, or CDP targets.
- Assign bounded opaque string aliases to tab descriptors, tabs, frames,
  elements and views. Resolve each against the current trusted session, browser
  epoch, turn and handle kind before dispatch. Knowing another session's alias
  must grant no access. Do not use labels, URLs or numeric IDs to reconstruct a
  missing handle.
- Keep aliases across tool calls in one browser turn, not just within one tool
  invocation. Repeated inspection, navigation, frame reload/removal, disconnect,
  and turn end invalidate the appropriate aliases. Prune superseded entries so
  repeated observations do not grow memory indefinitely.
- Transcript replay, compaction, session fork and server restart do not restore
  live capabilities. Stale aliases fail visibly; a resumed handoff is resolved
  through `resumeTabs()` and gets fresh aliases. Subagents have separate ownership
  unless an explicit delegation contract is implemented and tested.
- Filter browser/operation status by the caller's ownership. Do not expose the
  controller's whole transport/session diagnostic record to every model session.
- Make `replace` versus `append` explicit in the tool schema. Reject unsupported
  keys/widgets/frames rather than bypassing the controller with another backend.

#### Permission Adapter

1. Map `discovery`, `claim`, `create`, `read`, `input`, `navigation`, `screenshot`,
   and `handoff` deliberately into Tandem permissions. Listing existing tab
   titles/URLs is browsing-data access. Approval to create a tab or navigate is
   not implicit permission to read or act on a redirected document.
2. Bind approval persistence to the configured browser and normalized actual
   origin/capability, with the intended tab scope where applicable. Existing
   user-tab selection/claim must be explicit. Page text and model arguments
   cannot choose permission keys, wildcard scope, persistence, or caller identity.
3. Correlate every controller authorization request with the **correct current
   invocation's** permission source. The controller generates its own operation
   IDs; these are not Tandem tool-call IDs. Its callback currently carries caller
   session/turn and origins, not the full Tandem invocation context or a public
   tab handle. Establish a tested scoped routing mechanism, or a small explicit
   context extension if necessary. Never use a mutable global "current tool";
   parallel calls in the same session can request different permissions.
4. Use the canonical V2 permission source from the actual assistant message and
   tool call, and the equivalent bound legacy `ask` context. Finalization-time
   handoff requests also need a valid source tied to the recorded keep intent;
   do not fabricate an active tool call after it has settled.
5. Preserve allow/deny/cancel semantics. Determine the actual API representation
   of dismiss, abort and rejection in both execution paths. Unsupported cases,
   callback failures and missing context fail closed, not as approval.
6. Forward abort/deadline signals to approval waits and cancel the corresponding
   UI request when the operation expires. Phase 2's 15-second default / 30-second
   maximum deadline includes approval time. Test a human approval arriving after
   expiry: it must not dispatch the old action. If this budget needs different
   approval UX, design an explicit preapproval/action-budget boundary rather than
   silently extending controller deadlines or replaying expired work.
7. Recheck revocation, document origin and ownership after permission waits and
   queueing. Do not hold a tab/connection execution lock while a user decides.
   These controls are not a network firewall: redirects/subresources can contact
   other origins before the controller observes them.

#### Execution And Cleanup

- Define a browser turn as the host's actual bounded model execution, spanning
  its related tool calls, not a single tool call or provider stream chunk. V2
  durable prompt admission/wake is not execution start. Resolve steering,
  queued inputs, compaction and continuation semantics against the real runner;
  do not infer them from a UI status event or reuse an assistant message ID
  without proving it has the required lifetime.
- Own cleanup in an awaited execution finalizer. `tool.execute.after` is a
  successful-tool hook, not a guaranteed whole-turn completion hook. Normal
  completion, user stop, provider failure, tool failure, execution interruption,
  session disposal and server shutdown must converge on deduplicated cleanup.
- Translate runtime interruption into `AbortSignal` without converting an
  interruption/defect into an ordinary success. Settle the cancelled tool
  promptly; use the separate bounded cleanup budget (currently at most 40 seconds)
  so the aborted action signal does not prevent its lifecycle reconciliation.
- Record keep intent while the relevant handles/invocation still exist, then
  finalize it once at the execution boundary. Preserve the default disposition
  matrix: unmarked agent tabs close, user tabs survive, handoff remains with the
  session, deliverables are released. Session close releases retained handoffs
  where that can be confirmed.
- Preserve both the primary execution error and the cleanup report. Surface
  `nativeConfirmed`, cleanup stage and safe diagnostics when available; do not
  turn "native acknowledged" into "tabs verified cleaned up".
- No automatic browser mutation replay through provider retries, tool retries,
  durable execution recovery or reconstructed conversation history. Repeated
  delivery of an already-admitted tool call needs deduplicated settlement or an
  explicit uncertain result. A later request with a new ID is not proof that the
  previous action had no effect.
- Unknown operations stay associated with their original status ID and blocked
  ownership scope. A "check status" action must not redispatch the mutation or
  implicitly lift controller quarantine. Healthy sessions remain usable.

#### Model Output And Skill

- Return bounded structured observations with explicit truncation and stable
  alias fields. Preserve native outcome/error codes in a model-readable envelope;
  `confirmed` on a failure can still mean partial focus, scroll or input effects.
- Carry screenshots as real image content through each supported provider path,
  with actual MIME and encoded dimensions. A local path or base64 text alone is
  not an image delivered to the model. Text-only models need an explicit
  capability result, not a fabricated visual success.
- Choose one documented model-facing coordinate space. If image pixels are
  exposed, convert them to the controller's viewport CSS pixels using the
  matching image's measured mapping and view token. Any provider-side resize or
  crop must update that mapping; UI thumbnail dimensions are not model-image
  dimensions. Reject coordinate actions from `viewValid: false` captures and
  stale/superseded images. Do not guess with raw DPR or a fixed scale.
- Integrate screenshot storage with existing authenticated attachment and
  managed-retention facilities. The controller returns bytes and owns no image
  files; do not add public arbitrary-path serving or keep captures indefinitely
  in transcripts/log metadata. Keep producer capture limits separate from the
  tool registry's generic output bounds.
- Treat page text, labels and screenshots as untrusted task data, not instructions
  that can change permissions, select another browser, or authorize new actions.
  Test this boundary; a safety paragraph in the skill is not enforcement.
- The focused skill should teach discovery -> claim/create -> inspect -> act,
  stale-ref refresh, explicit typing modes, image coordinates, keep dispositions,
  and unknown-outcome recovery. Explain that `target_changed` is not permission
  to blindly repeat an action. Use explicit bounded read-only readiness checks;
  do not add blanket DOM retries or fixed sleeps to hide races.
- Summaries should identify the operation, safe target context, outcome and
  cleanup warning without dumping typed text, page bodies, raw protocol payloads
  or sensitive URL query strings. Raw wire traces remain test-only diagnostics.

#### Implementation And Evidence

1. Trace and record legacy/V2 registration, permission sources, execution
   lifetime and output projection. Resolve the callback-to-invocation routing
   and browser-turn mapping before writing tool wrappers. Keep any shared-code
   changes minimal and update the existing divergence inventory if needed.
2. Implement the scoped connection/session owner, alias registry and thin
   canonical/legacy adapters. Test forged/stale/foreign aliases, invocation
   correlation, project disposal, admission limits and cancellation without
   launching a browser.
3. Wire actual permission and lifecycle paths, then provider image projection
   and existing UI summaries. Exercise tool results, persisted transcripts and
   provider inputs, not only an adapter's direct return value.
4. Run local model-driven fixtures through both declared execution paths using
   explicitly prepared isolated browsers. Preserve the Phase 2 regression gate;
   do not count its direct-controller tests as Phase 3 integration evidence.

Minimum additional acceptance cases:

| Area                  | End-To-End Proof Required                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context/registration  | Both supported runtimes see the tools and supply real invocation identity; parallel same-session calls do not borrow each other's approval source.                               |
| Approvals             | Allow, deny, dismiss, abort, late approval, persisted grants and revocation work through the real permission service/UI; newly unauthorized content stays unread.                |
| Handle lifetime       | Multi-call task succeeds; superseded refs, same-URL frame reload, copied/forked transcript IDs, subagent aliases and restart-era handles reject without fallback.                |
| Isolation             | Two sessions/projects share one browser connection safely; one approval/cancellation/disposal does not end the other's turn. A second server gets a clear busy result.           |
| Lifecycle             | Normal completion, stop, provider/tool failure, steering/continuation and shutdown follow the declared turn boundary; keep intent survives failure without destructive fallback. |
| Duplicate execution   | Delayed/lost result, repeated tool-call delivery and runtime retry cause no duplicate click/type/submit; unknown status and incomplete cleanup remain visible.                   |
| Images/coordinates    | Providers receive actual PNG content; DPR/zoom/scroll, output resize, stale views and unsupported model modality preserve correct coordinates or fail explicitly.                |
| Data/UI               | Page instructions cannot expand authorization; shared web/desktop/mobile permission and attachment paths work; summaries and stored metadata are appropriately bounded/redacted. |
| Regression/provenance | Existing `webfetch` and unrelated tools are unaffected; test registration is isolated, production manifest unchanged, and owned processes/attachments are accounted for.         |

Save run evidence separately from Phase 2: runtime path, model/provider,
trusted invocation correlation, permission decisions, native dispatch counts,
model image projection, observable page effects and final cleanup outcome.
Retain sensitive fixture artifacts privately rather than committing raw prompts,
images or payload traces. Keep model behavior evidence distinct from deterministic
adapter tests and independent observer/fixture measurements.

Phase 3 still uses deliberate isolated preparation. Native-host installation,
automatic repair, shared-registration ownership switching, ordinary real-profile
rollout, additional platforms and broad real-site testing remain Phase 4. Do not
change production registration or replace `webfetch` to make an integration demo
work. No new standalone MCP/REPL runtime or full original-plugin parity is required.

Exit criteria:

- Model-driven fixture tasks succeed through every declared supported session path.
- Allow, deny, dismiss, and cancel remain distinct; denial or unsupported approval requests cause no browser action.
- Origin changes and redirects cannot silently extend an approval; permission persistence and revocation are tested.
- Model providers receive real image content with correct MIME, not base64 text substituted for images.
- Stop, provider failure, tool failure, and normal completion all trigger bounded, deduplicated lifecycle cleanup.
- Parallel Tandem sessions remain isolated, including when one awaits approval.
- Existing `webfetch`, unrelated tools, and mobile client permission/attachment behavior have regression coverage.
- Unsupported execution paths fail visibly; full integration is not declared complete until both legacy and V2 paths are supported or one has been formally retired.

Gate: no everyday-use installation until permissions and lifecycle are verified end to end.

### Phase 4: Install For Personal Use

Current repair status: installed server and host passed production joined HTTP
interaction at `/tmp/tandem/original-session-UTigD6/acceptance.json`, plus deny/cancel
at `/tmp/tandem/original-permission-oT62UH/acceptance.json`. The production chat
also completed a reversible public Selenium form input/capture check. These
extend the earlier isolated checks; they do not establish all UI rendering, the
full original API or the unfinished Shopee workflow. See
[the repair record](chrome-original-repair.md#production-deployment) for exact
artifacts, retained failure evidence, rollback and restart discipline.

**Goal:** make the existing browser integration straightforward to install and
use in Tandem. Reuse existing platform and build conventions rather than
hard-coding paths or behavior for one machine. Build on the current checkout,
including its uncommitted Phase 1-3 work. The
[Phase 3 evidence](chrome-extension-phase-3-evidence.md) records what already works.

Keep the implementation small: install, status and restore commands plus manual
recovery are enough initially. Add platform-specific handling where needed,
verify the environments being shipped, and state support gaps honestly. Do not
build automatic repair, crash continuation or a coexistence broker unless a
concrete need emerges.

#### 1. Package The Host

- Build the standalone host from `packages/chrome-bridge/src/host.ts` and install
  it at a stable absolute path, independent of the checkout or shell PATH.
- Keep configuration, manifest backups and recovery journals in private,
  persistent storage, not `/tmp`. Preserve existing socket and journal checks.
- Supply the matching `TANDEM_CHROME_CONNECTIONS` configuration and record the
  tested host, browser and extension versions. Keep existing tool permissions,
  capture limits and `webfetch` behavior unchanged.

#### 2. Add Install And Restore

- A small script or CLI command is enough. Back up the existing
  `com.openai.codexextension` manifest and relevant Tandem configuration, then
  replace the registration with Tandem's installed host when approved.
- Taking over another installation is supported; simultaneous operation is not
  required. Explain that the previous integration will stop receiving new host
  connections. Never overwrite a live executable in place.
- Verify that the extension actually launches the installed host and that the
  intended Tandem server connects. Report pending activation if a restart is
  still needed rather than claiming installation is complete.
- Provide a tested restore command. Restore the saved registration only if it
  has not since been changed by another installer and its target still exists.
  Reinstalling the same version should be harmless. Do not remove browser data
  or unresolved journals during install, restore or uninstall.

#### 3. Add Basic Status And Manual Recovery

- Show the selected browser connection, host/extension versions, capture
  readiness and useful errors: missing host, wrong registration, ambiguous
  selection, busy controller or `cleanup_unconfirmed`. Do not guess a profile
  from its label or transfer saved grants to a different browser binding.
- Document a short recovery procedure: stop new browser work, inspect what
  remains, resolve the old attachment (with an approved browser restart if
  necessary), verify it ended, then reconnect with fresh handles.
- Never automatically repeat a click/type/submit after a lost response or delete
  journals just to unblock discovery. Preserve the original unknown outcome.
  Manual recovery must be demonstrated on an isolated failure, not just described.
- Retain existing bounds and screenshot expiry. Check disk/memory headroom during
  tests, clean up owned test processes and avoid accumulating large profiles.

#### 4. Test The Install In Isolation

Jon clarified on 2026-09-11 that personal-use clients are the web UI and Android.
Electron desktop verification is outside this rollout scope; do not ship or
update that app for this phase.

Use separate registration, browser profile, server port and app ID; leave the
running production app/server untouched during development.

- Exercise install, reinstall and restore, including a missing executable and
  an interrupted setup. Reuse existing Phase 2/3 tests for affected code rather
  than building another acceptance framework.
- Run a joined task through the packaged backend and host for the web UI
  and Android client builds being shipped: approve, perform a fixture action,
  deliver the PNG to the model and client, revoke a saved grant and confirm the
  next request asks again. Test actual packaged artifacts, not only dev servers.
- Check cold startup, Stop, server shutdown, browser/host restart and manual
  recovery after a lost response. Confirm no duplicate mutation and no hidden
  leftover attachment. Keep a compact record of results and known limitations.
- Verify screenshot launch requirements on the intended browser. Do not silently
  copy the fixture's `--no-sandbox` setting into the real browser; discuss any
  required security tradeoff before deployment.

#### 5. Switch And Try It (Pending For The Repair)

Ask Jon before changing the real registration, restarting the production
browser/server or updating the production app. Present the install/restore
commands and any known limitations. After approval, switch the registration,
verify the intended browser, then try one real-site read and one approved
reversible interaction. Preserve app data and keep `webfetch` unchanged.

**Done when:** the installed host works through the supported Tandem clients,
the previous registration can be restored, failures give useful errors with a
tested manual recovery path, and Jon can use it without development launchers.
Update the existing evidence and change notes; broader hardening can follow
actual use rather than speculative requirements.

## Historical Detailed Phase 1 Implementation

This section preserves the original independence plan and its acceptance logic.
Its instructions not to copy the browser service describe the superseded Phase 1
design; they are not the current repair architecture or provenance policy.

### 1. Freeze Scope And Establish A Baseline

Record the Chromium version, extension version/ID, OS/architecture, and hashes of the relevant extension code. Record the production native manifest hash and current host target without copying browsing data or credentials.

Use the installed extension source only as protocol evidence. Do not copy OpenAI's browser service or native-host binary into Tandem. Establish a legitimate installation method for the unmodified extension in the test browser; do not silently switch to a patched extension if loading the official extension is blocked.

Create all disposable profiles, fixtures generated at runtime, logs, sockets, and screenshots beneath `/tmp/tandem/chrome-bridge/`. Use a unique run directory with restrictive permissions. Runtime socket paths must remain short enough for Unix-domain socket limits.

Acceptance: evidence identifies the exact tested extension build, and no production profile contents or credentials are copied into the test environment.

### 2. Add A Small Standalone Package

Proposed implementation location: `packages/chrome-bridge/`, a private TypeScript/Bun workspace package with no dependency on `packages/opencode` or any Codex package. This is proposed layout, not an existing package or command surface.

```text
packages/chrome-bridge/
  package.json
  tsconfig.json
  README.md
  src/
    native.ts          # Native framing and RPC routing
    host.ts            # Chrome-launched entrypoint and local IPC
    client.ts          # Test controller connection and request lifecycle
  test/
    native.test.ts
    bridge.test.ts
    fixture.html
  script/
    smoke.ts           # Local fixture server and live assertions
```

Keep modules small and separate only the genuinely reusable boundaries. Start with Bun and platform primitives; do not add MCP, a persistent JavaScript evaluator, a generic plugin framework, or a second agent runtime.

Provide package-local `typecheck`, `test`, and `smoke` scripts. Phase 1 may use an absolute Bun path plus a launcher under the test run directory; release binary packaging is deferred. Native stdout must contain protocol bytes only, including during startup failures.

Before implementing, recheck package guidance and worktree changes. Record the new fork-owned package surface in the existing `log.md` inventory when code is added; this planning document does not itself implement that surface.

Acceptance: package-local typecheck and unit tests run without launching Chrome; imports and launcher configuration reference no original plugin runtime.

### 3. Implement Native Framing And RPC

Implement Chrome native messaging: four-byte native-endian unsigned length followed by UTF-8 JSON. Linux ARM64 is little-endian; encode this explicitly for the initial platform and do not silently assume it for every future platform.

Requirements:

- Read partial headers/payloads and multiple frames in one read.
- Validate lengths before allocation and reject malformed JSON or invalid envelopes.
- Enforce documented Chromium directional message limits and conservative controller output limits. Verify the exact applicable limits before choosing constants; do not truncate a JSON frame.
- Serialize complete stdout frames and respect backpressure.
- Route responses by ID, incoming requests by method and ID, and notifications by method without ID.
- Give controller requests a distinct string-ID prefix; preserve extension request IDs in responses.
- Answer extension-originated `ping` promptly, independently of a long-running controller request.
- Reject unsupported incoming methods explicitly; do not pretend to implement `codexRuntime/hello` or sidepanel app-server operations.
- Reject pending requests on disconnect and ignore/report late responses without matching them to newer requests.
- Send diagnostics to stderr with payloads redacted by default.

Unit tests use real byte streams and pipes, including fragmentation, coalescing, multibyte UTF-8 lengths, malformed/oversized/truncated frames, duplicate or unknown response IDs, heartbeat/request overlap, and EOF.

Acceptance: all framing/RPC tests pass; a subprocess test confirms stdout is parseable exclusively as native frames even on an error path.

### 4. Connect A Local Test Controller

Chrome starts the host when the extension calls `connectNative`; the test controller must connect to that host rather than launching an unrelated process and assuming Chrome will use it.

For the proof:

- Permit one controller per native-host connection.
- Create a host-instance-specific Unix socket inside the mode-0700 run directory and restrict the socket to the owner.
- Write minimal discovery information atomically, with no page contents or secrets. Reject ambiguous host selection instead of taking the first socket found.
- Validate Chrome's supplied caller origin against the expected extension origin. This is an identity sanity check, not protection from arbitrary malicious code already running as the same OS user.
- Keep IPC local; no HTTP/WebSocket listener accessible to web pages, no remote-debugging port, and no LAN listener.
- Apply request deadlines and an explicit error when no extension is connected.
- Remove only this host's socket/discovery files on exit; never recursively delete a shared runtime directory.

Test against a subprocess peer to exercise real stdio and Unix-socket boundaries. A synthetic extension peer validates transport behavior but does not count as browser compatibility evidence.

Acceptance: the controller can exchange bidirectional RPC through the host; permissions, timeout, disconnect, and stale-discovery tests pass.

### 5. Isolate Browser Registration

Create a separate test HOME/config environment and Chromium user-data root beneath the run directory. Register the Tandem executable as `com.openai.codexextension` only within the test environment.

Do not assume that `--user-data-dir` alone isolates native-host manifest lookup: Chrome-family lookup behavior must be verified for this Chromium build. Use controlled configuration and, if needed, a narrowly scoped file/process trace of the test browser to confirm the manifest actually opened and executable actually launched.

Launch a visibly identifiable test Chromium instance with an explicit user-data directory. Use no production cookies, profile lock, remote-debugging endpoint, or live-account task. Install/enable the official extension in that environment and close the sidepanel if it produces unrelated app-server errors.

If isolated native-host lookup cannot be demonstrated, stop and resolve isolation. Do not fall back to overwriting the production registration without explicit approval.

Acceptance: the test browser launches the Tandem host from the isolated manifest, and the production manifest hash remains unchanged.

### 6. Verify The Smallest Live Protocol Sequence

First perform only `ping` and `getInfo`. Record extension identity/capabilities in the evidence report. Then try the observed session envelope with stable, test-generated IDs:

```json
{
  "jsonrpc": "2.0",
  "id": "tandem:1",
  "method": "createTab",
  "params": {
    "session_id": "phase1-session",
    "turn_id": "phase1-turn",
    "session_context": "live"
  }
}
```

Use the returned numeric tab ID for `attach`, then for CDP:

```json
{
  "jsonrpc": "2.0",
  "id": "tandem:2",
  "method": "executeCdp",
  "params": {
    "session_id": "phase1-session",
    "turn_id": "phase1-turn",
    "session_context": "live",
    "target": { "tabId": 123 },
    "method": "Page.navigate",
    "commandParams": { "url": "http://127.0.0.1:<fixture-port>/" },
    "timeoutMs": 10000
  }
}
```

These shapes come from static inspection and must be corrected only from observed protocol evidence. Do not spoof a Codex sidepanel handshake to get past a failure.

Acceptance: discovery and a session-owned tab work with only the Tandem host and controller running in the test environment.

### 7. Build And Verify The Local Fixture

Serve a deterministic page on an ephemeral loopback port. Include:

- A known heading and a readiness marker.
- An input initially containing `original`.
- A button with a known label, a visible click counter, and captured click coordinates.
- An unrelated manually created test tab to check cleanup isolation.

The smoke runner must:

1. Navigate the created tab and wait for the readiness marker with a bounded, read-only poll.
2. Read and assert the heading and initial input value through CDP.
3. Focus/select the input and send CDP input to replace its contents with `replacement`.
4. Assert the value equals `replacement`, not an appended or duplicated value.
5. Read the button bounds, click its center through CDP input, and assert the counter is exactly one and the recorded coordinates are within the button.
6. Capture a viewport screenshot through `Page.captureScreenshot`; decode and verify its actual MIME, dimensions, and nonempty image content. Save with the correct extension and visually inspect the first successful image.
7. Keep the connection open for at least 65 seconds and verify heartbeat responses and a subsequent successful read.
8. Send `turnEnded` with the exact session/turn IDs; verify the disposable agent-created tab closes, the unrelated test tab survives, and no debugger attachment remains for the ended session.

Raw CDP is internal to this deterministic harness, not an unrestricted model tool. Do not touch live sites or accounts. Never automatically repeat typing or clicking after a timeout; fail the run and inspect state.

Acceptance: every assertion above passes on the actual extension, not just against the synthetic peer.

### 8. Exercise Failure And Independence Checks

| Check                                         | Expected Result                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Unknown RPC method                            | Bounded, explicit error; host remains usable                                                         |
| Invalid tab target                            | Clear error; no action on another tab                                                                |
| Controller disconnect                         | Pending work settles as disconnected; owned test turn is ended where transport remains available     |
| Native port/host loss                         | No hung controller promises; a fresh connection can be selected and tested                           |
| Browser restart                               | Old handles are rejected; new discovery and a fresh session work                                     |
| Controller timeout with late response         | No automatic mutation replay and no result assigned to the wrong request                             |
| No Codex installation visible to test runtime | Normal fixture smoke still passes                                                                    |
| No ChatGPT login in the fresh test profile    | Basic automation smoke still passes, or the precise account gate is recorded as a failed requirement |
| Production registration comparison            | Unchanged before/after, including failure cleanup                                                    |

For independence, launch with `CODEX_CLI_PATH` unset, no copied Codex auth/config, no original plugin runtime paths, and an explicit restricted executable environment. Inspect the test process tree and, where supported, narrowly trace its executable/file access to detect absolute-path dependencies. PATH restriction alone is not proof. Do not uninstall Codex or kill unrelated processes on the tablet.

After extension installation, repeat a fixture run with external network access blocked for the test environment, if isolation permits. Record the outcome separately from Codex independence: third-party telemetry attempts do not by themselves mean browser control requires that network access. If this test cannot be performed, mark offline behavior unverified rather than claiming it.

Full cancellation/concurrency recovery is Phase 2 work. Phase 1 must nevertheless terminate its harness cleanly and explicitly document any browser cleanup limitation discovered in fault tests.

Acceptance: deterministic failure tests pass, no Codex dependency is observed, and all unverified behavior is labeled rather than counted as a pass.

### 9. Produce Evidence And Decide

Run three fresh browser/host/session cycles. Save a machine-readable report for each under the run directory with:

- Browser/extension versions and relevant hashes.
- Host executable and isolated manifest paths.
- Per-assertion pass/fail, durations, and redacted failure reasons.
- Screenshot paths, session/turn IDs, and before/after tab IDs.
- Heartbeat counts and reconnect results.
- Independence checks and production manifest comparison.

Summarize stable protocol findings and recovery instructions in the package README. Keep generated logs, screenshots, profiles, and raw browsing data out of git.

Proposed verification commands, once the package and scripts exist:

```sh
bun run --cwd packages/chrome-bridge typecheck
bun run --cwd packages/chrome-bridge test
bun run --cwd packages/chrome-bridge smoke -- --run-dir /tmp/tandem/chrome-bridge/<run>
```

The smoke command should connect to an explicitly prepared isolated browser, not silently install extensions or change native-host registration. Document preparation as a separate, deliberate step.

Phase 1 passes only when the live end-to-end fixture, unit/transport suite, cleanup/isolation checks, and Codex-independence checks pass. A successful arithmetic evaluation, synthetic-peer test, `ping`, or screenshot alone is insufficient.

If it fails, classify the blocker as registration, framing/RPC, unsupported protocol, host/account dependency, browser permission, lifecycle, or environment. Decide whether to fix the Tandem bridge or reconsider extension reuse. Introducing Codex or modifying the extension is a scope change requiring an explicit decision, not an implementation shortcut.
