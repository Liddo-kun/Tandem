# Chrome Extension Phase 3: Integration And Evidence

Status: **Phase 3 verified for the declared isolated baseline; all four
follow-up workstreams are complete**. Web, Electron development-wrapper and
physical Android workflows passed, as did real V2 placement/retry behavior,
whole-server signals, native V2-only onboarding and the coordinate/reload matrix.
The browser backend supports legacy and V2 execution; unsupported V2 `task`
delegation fails explicitly without browser effects. Scope limits below remain
explicit exclusions, not claims of universal platform or crash recovery support.
The Phase 4 rollout gate is closed: this work does not install into or switch
the user's production browser.

Date: 2026-09-10 (tablet local date).

## Implemented Surface

- `packages/chrome-bridge/src/tools.ts` is the reusable, pure adapter. It owns
  browser execution turns, bounded opaque aliases, invocation correlation,
  duplicate-call settlement, operation-status aliases and keep intent. It knows
  no Tandem service, database, permission UI or provider implementation.
- The legacy adapter is `packages/opencode/src/tool/browser.ts`; the canonical V2
  leaf is `packages/core/src/tool/browser.ts`. Both expose one bounded `browser`
  tool, not raw CDP, JavaScript evaluation or a second tool registry.
- Both runtimes share one process-scoped connection owner. Logical ownership is
  separated by runtime, Location/workspace and session. A controller connection
  is lazy and a failed connection is not silently adopted or retried.
- Runtime interruption, normal completion and failure leave the browser turn
  through an awaited finalizer. Cleanup reports are persisted as synthetic
  transcript output without replacing the primary execution failure.
- Screenshots are validated PNGs stored as session-owned opaque
  `tandem-browser-image:` references, limited to 8 MiB and retained for at most
  24 hours. Provider projection resolves real image content. The authenticated
  `/api/browser-media/...` path serves authorized UI reads; the shared UI fetches
  visible captures into bounded, revocable blob URLs rather than exposing local
  paths or credentials.
- Browser permission prompts show the configured browser label, capability,
  normalized origin and bounded tab label/scope instead of the encoded policy
  resource. Web UI offers Allow once, Allow always, Deny and Dismiss explicitly.
- The built-in `chrome-browser` skill is registered in both the legacy plugin
  skill path and V2 core skill plugin only when the integration is configured.
  It documents stale handles, trust, coordinates, image modality, keep and
  unknown-outcome recovery. `webfetch` remains unchanged and available.

Implemented model actions are `browsers`, `discover`, `create`, `claim`,
`resume`, `inspect`, `navigate`, `click`, `type`, `key`, `scroll`, `screenshot`,
`status` and `keep`.

## Stable Lifetime

```text
serving process
  BrowserToolOwner (one lazy controller; shared by legacy and V2)
    Location/workspace + runtime + Tandem session
      one runner execution / drain = one browser turn
        provider turn(s), continuation, steering and related tool calls
          invocation = assistant message ID + tool-call ID
            authorization source + bounded aliases
      awaited end: settle actions -> authorize keep -> turnEnded -> report
    session close: release retained handoffs
  process close: close all sessions, then controller
```

Legacy starts this scope around the actual `SessionPrompt` loop. V2 starts it
around the durable runner drain, after prompt admission and across queued/steered
continuations. It is not scoped to one provider chunk or one tool call. Copied,
forked, subagent, superseded and restart-era aliases are not reconstructed from
transcripts.

## Configuration And Permissions

The feature is absent when `TANDEM_CHROME_CONNECTIONS` is unset or empty. Its
value is a JSON array of one to eight connections with unique IDs and absolute
bridge run directories:

```sh
export TANDEM_CHROME_CONNECTIONS='[{"id":"fixture","label":"Isolated Chromium","directory":"/tmp/tandem/chrome-bridge/my-run","screenshotVerified":true}]'
```

`id`, `label` and `directory` are required. `hostId` is optional when an exact
prepared host must be selected. Set `screenshotVerified: true` only after that
binding was explicitly prepared and checked with
`--screenshot-new-surface`; otherwise screenshot calls fail closed as
`capture_unverified`. Labels are human configuration, not discovered profile
identity.

Permissions use action `browser` and an exact encoded resource derived from:

```text
configured browser + capability + actual/destination origin + frame origin
```

Claims append the one-time controller operation identity and cannot be saved as
a wildcard tab grant. Create/navigation approval does not authorize reading the
resulting page, and redirects are checked against the observed origin.

Browser access defaults to **ask**. A generic wildcard `allow` does not grant
browser access; policy must explicitly allow `browser`. Wildcard and explicit
denies still fail closed. Page content cannot select resource keys, persistence,
browser identity or wildcard scope.

Permission outcomes remain distinct:

- **Allow once** settles only the pending request.
- **Allow always** saves only the exact supported non-claim resource.
- **Deny/reject** rejects that session's pending work under the runtime's normal
  semantics; **Dismiss** declines only that request.
- Stop, interruption or the controller's 15-second action deadline cancels the
  wait and removes its UI request. A later reply returns `NotFound` and cannot
  dispatch the expired action.

Legacy remembered grants are origin-scoped but **in-memory and instance-local**;
they last only until that OpenCode instance is disposed/restarted. V2 grants are
**durable, project-scoped database records** exposed by the saved-permission API;
removing the saved record revokes the grant and the next matching action asks
again. In both paths a configured deny takes precedence over remembered grants.

Both settings layouts expose **Browser grants** on V2 servers for the current
project. This lists decoded configured browser ID, capability and origin/frame
scope, and removes grants through the authenticated saved-permission API.
Unknown scopes are labeled as unknown rather than displayed as opaque policy
keys or misrepresented as exact grants. Authentication failures retain the
entry; project/server changes discard stale responses. New copy uses English
fallback keys; translated copy for this settings section is not yet supplied.

## Isolated Test Procedure

Use fresh directories under `/tmp/tandem/chrome-bridge`; preparation refuses a
reused directory. Repeat this once for legacy and once for V2:

```sh
bun run --cwd packages/chrome-bridge prepare:isolated -- \
  --run-dir /tmp/tandem/chrome-bridge/p3-legacy \
  --extension "/home/jon/.config/chromium/Profile 5/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0" \
  --production-manifest /home/jon/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json \
  --screenshot-new-surface --no-sandbox
bun packages/chrome-bridge/script/session-native-tap.ts --prepare \
  /tmp/tandem/chrome-bridge/p3-legacy
```

`--no-sandbox` is required only by this Android-kernel Ubuntu fixture; do not use
it for normal or untrusted browsing. Preparation creates an isolated HOME,
profile, native manifest and launcher, and loads only the unmodified extension.
It does not modify the production manifest or copy production cookies/auth.

For a deterministic scripted-provider run:

```sh
bun packages/chrome-bridge/script/session-acceptance.ts \
  /tmp/tandem/chrome-bridge/p3-legacy /tmp/tandem/chrome-bridge/p3-v2
```

For a genuine model run, start the credential-safe loopback proxy in a trusted
terminal. The helper reads the already configured OpenAI OAuth provider from its
own inherited OpenCode environment; do not pass, print or copy a token:

```sh
bun packages/opencode/test/session/browser-model-provider.ts \
  --directory /tmp/tandem/chrome-bridge/p3-provider \
  --model openai/gpt-6-astra
```

After `p3-provider/provider.json` appears, run in another terminal:

```sh
TANDEM_PHASE3_MODEL_PROVIDER=/tmp/tandem/chrome-bridge/p3-provider/provider.json \
  bun packages/chrome-bridge/script/session-acceptance.ts \
  /tmp/tandem/chrome-bridge/p3-legacy /tmp/tandem/chrome-bridge/p3-v2
```

The child test processes receive only the loopback URL and non-secret model
metadata. The proxy forwards through the configured OAuth transport and records
only bounded status/count evidence. Stop it with Ctrl-C in its terminal (or send
`SIGTERM` to that exact recorded process); never use a broad process kill.
`session-acceptance.ts` stops only its two isolated browsers in `finally` and
checks the production manifest hash.

## Evidence

The original runs below are historical verification. Their temporary artifact
paths were no longer available after the storage changes/interruptions. Current
retained client and scripted-runtime evidence was regenerated and verified;
its paths and scope are listed in the following sections. The earlier genuine
model runs were not repeated in this final evidence-regeneration pass.

Supported baseline: Ubuntu Linux ARM64 on the Android kernel, Chromium
`149.0.7827.102`, unmodified extension `1.26.901.11451`, Bun `1.3.14`.

| Evidence                               | Established                                                                                                                                                                                                                                                 |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p3-model-legacy-final2`               | Genuine `openai/gpt-6-astra` drove the legacy prompt/tool path; 9 provider requests, one trusted replacement, one click, one PNG and confirmed cleanup.                                                                                                     |
| `p3-model-v2-final`                    | The same genuine model drove the V2 durable runner; 8 provider requests, the same exact native effects, real PNG projection and confirmed cleanup.                                                                                                          |
| `p3-rp-legacy-final`, `p3-rp-v2-final` | Deterministic six-call create/inspect/type/inspect/click/screenshot tasks passed both real runtime paths with one mutation each.                                                                                                                            |
| Scripted V2 permission scenarios       | Real V2 permission service covered allow-once during the task, reject, dismiss and deadline cancellation; each late reply returned `NotFound`, and native `createTab` remained at the single allowed task dispatch.                                         |
| Package checks                         | Chrome bridge: 183 tests across eight files and typecheck pass. Combined focused core runtime/permission/media/runner suite: 137 passed; legacy tool/permission/projection/server/runner/skill/webfetch suite: 183 passed. Core and bridge typechecks pass. |
| Phase 2 regression                     | `phase3-phase2-final.json` reports `phase2AcceptancePassed: true`: package tests/typecheck/formatting, three fresh core suites, extended user-tab suite, faults/dispositions and two-browser selection.                                                     |

All model runs verified one `createTab`, one `Input.insertText`, one mouse press
and release, one `Page.captureScreenshot`, one `turnEnded`, one browser turn,
trusted final page effects, persisted cleanup, process exit and unchanged
production registration. Evidence directories also contain private transcripts,
provider requests and images; these are diagnostic artifacts, not files to
commit. Counts come from redacted method-only native taps and trusted fixture
effects, not from raw credentials or screenshot interpretation.

The final-source genuine rerun is recorded under
`/tmp/tandem/chrome-bridge/final-source-genuine/`: both
`p3-final-source-legacy/phase3-legacy/` and `p3-final-source-v2/phase3-v2/`
passed with the same 9/8 provider-request counts and exactly one submission.
Both providers received a 1000x713 PNG (11,834 bytes). Before/after hashes of 703
runtime/fixture source files matched; production registration was unchanged.
Browser, host/tap, provider-proxy and Xvfb processes exited. Stale private
discovery/socket files remain in those isolated evidence directories and are
not usable live connections or evidence of transparent recovery.

Focused UI checks passed: 31 app permission/render/event/authenticated-media
tests and seven shared capture-residency/redacted-summary tests. Core, app,
session-ui, server and TUI typechecks pass. The app render tests require Bun's
`--conditions=browser` alongside `--preload ./happydom.ts`.

## Scope Limits

The four requested follow-up acceptance gaps are closed by the separate retained
runs below. The supported baseline does not include:

- V2 `task` delegation: the actual provider-issued call returns `Unknown tool:
task`, creates no child and dispatches no browser operation. No hidden legacy
  fallback or new delegation implementation was introduced.
- Durable post-crash recovery or SIGKILL recovery. Graceful-signal uncertainty
  can intentionally leave an owned tab/debugger attached and fenced, with a
  persisted `cleanup_unconfirmed` report; it is not claimed as successful cleanup.
- iOS, which is unavailable. Android manual-URL onboarding is now physically
  verified; LAN scan discovery and physical legacy onboarding are not part of
  that run (legacy health endpoints have unit regression coverage).
- Pinch zoom, transformed frames, or arbitrary browser/extension builds beyond
  the stated DPR and real browser-zoom matrix.
- Desktop evidence covers the actual development wrapper, not an installed
  release package. The standard build exhausted the default Node heap; the
  test build externalized the real freshly built Node server module and used
  a larger build heap. Runtime main/preload/renderer and sidecar remained real.
- The client suites use fixture-owned permission calls and seeded screenshot
  transcripts through real HTTP/SSE services. They establish client integration,
  not a single uninterrupted model-to-extension-to-client acceptance run.
- Broader real sites, additional extension/browser builds and all Phase 4
  install/repair, upgrade, rollback and ordinary-profile work remain outside
  this implementation.

Existing controller exclusions still apply: raw CDP/evaluation, cross-origin
frame contents, clipboard, files, history/bookmarks, arbitrary browser shortcuts,
full-page capture and broad Playwright parity are not exposed by Phase 3.

The full opencode package typecheck is blocked by a pre-existing worktree change
at `src/plugin/browser-fetch/plugin.ts:176` (permission-map indexing, TS7053).
That unrelated change was preserved. Focused browser-fetch regression tests pass.

## Retained Client Checks

All three actual clients passed Allow once, Allow always, Deny, Dismiss, SSE
cancellation, late approval rejection (`404`), visible authenticated PNG
retrieval, unauthenticated/foreign-session rejection (`401`/`404`), and settings
grant listing/removal followed by another permission prompt.

| Client  | Actual Platform                                                                       | Retained Evidence                                                                                                      |
| ------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Web     | Chromium 149, Linux ARM64                                                             | `/tmp/tandem/client-final/web-permissions/`, `web-grants/`                                                             |
| Desktop | Actual Electron 42.3.3 wrapper, Chromium 148, `oc://renderer`, native preload/IPC     | `/tmp/tandem/client-final/desktop-permissions/`, `desktop-grants/`                                                     |
| Android | Physical Y700, Android 15, WebView 151, `http://tauri.localhost`, native Tauri bridge | `/tmp/tandem/android-phase3-results.md`, `/tmp/tandem/browser-client-vX0RZb/`, `/tmp/tandem/browser-grants-ui-PS96z1/` |

Web/desktop manifests, screenshots, source provenance and cleanup records are
under `/tmp/tandem/client-final/`. The credential/profile-free archive is
`/tmp/tandem/client-final-evidence.tar.gz`. Eleven relevant desktop bundled
modules were checked against current source through sourcemaps before rerunning.

Android used a freshly compiled UI/Rust APK installed separately as
`app.liddokun.tandem.phase3`, version `1.2.6`/`1002006`. The final suites used
physical ADB taps, not DOM click bypasses. The installed APK hash matches
`/tmp/tandem/tandem-phase3.apk`; the physical framebuffer proof is
`/tmp/tandem/android-physical-authenticated-image.png`. Production app data was
not replaced or cleared. Temporary generated Gradle changes were restored.
This initial run left a test APK in generated release output. Subsequent native
builds produced the separately named onboarding variant described below; always
check the package identity/rebuild before using generated output for production.
The separate test apps remain installed but stopped, with test data preserved.

The reusable web/desktop fixtures and tests are in `packages/app/script/`:
`browser-live-fixture.ts`, `browser-live-server.ts`, `browser-live-client.ts`,
`browser-live-client.test.ts` and `browser-grants-live.test.ts`. Their private
connection metadata must never be committed. Android driver adaptations and
commands are recorded in its handoff/evidence files.

Test services, isolated browsers, sidecars, Xvfb and ADB forwarding were cleaned
up without restarting production. Electron required a targeted final SIGKILL
after graceful shutdown stopped the sidecar but left its CDP listener alive;
this is recorded, not counted as graceful shutdown proof.

## Retained Lifecycle Checks

Fresh scripted providers drove both real runtimes through the native host and
isolated Chromium. **17 legacy and 15 V2 scenario reports passed**, plus both
original runtime/PNG baselines. The final report is
`/tmp/tandem/chrome-bridge/fr-1789048135556/runtime-final-status.json`; exact
commands and before/after hashes of 773 unchanged source files are alongside it.
Detailed transcripts, per-case native counts and fixture effects are in the
sibling `fr-1789048135556-legacy/` and `fr-1789048135556-v2/` directories.

| Scenario                                                        | Legacy                                     | V2                                              |
| --------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Normal / provider failure / tool failure                        | Passed                                     | Passed                                          |
| Stop with awaited cleanup                                       | `SessionPrompt.cancel`                     | Actual coordinator interruption                 |
| Steering across one browser turn                                | Passed                                     | Passed                                          |
| Runtime shutdown                                                | Instance disposal                          | Coordinator-scope closure                       |
| Provider failure after handoff intent / denied keep             | Passed, no destructive fallback            | Passed, no destructive fallback                 |
| Another instance/project runs and disposes while approval waits | Passed                                     | Passed                                          |
| Copied aliases                                                  | Rejected                                   | Rejected                                        |
| Actual transcript fork / foreground task subagent aliases       | Rejected                                   | Not exercised                                   |
| Duplicate tool-call delivery                                    | One native create                          | Rejected before dispatch; pending input settled |
| Actual 503 provider retry after a click                         | One click, no replay                       | Not exercised                                   |
| Exact durable prompt retry and concurrent coordinator join      | Not applicable                             | One execution                                   |
| Lost native click result                                        | One submission, unknown outcome, no replay | Same                                            |
| Text-only model / superseded screenshot coordinates             | Rejected without input dispatch            | Same                                            |

The lost-result tap drops a successful mouse-release response after the real
click: the trusted page records exactly one submission, provider/status stay
`unknown`, and cleanup remains unconfirmed. This is deliberately not reported
as confirmed success or transparently retried.

Testing found and fixed a V2 publisher failure path that left tool inputs
pending. Non-LLM, non-interruption stream failures now settle outstanding tools
and the active assistant before rethrowing; a duplicate-input regression covers
the defect in `packages/core/test/session-runner.test.ts`.

The source entrypoints remain `prepare:isolated`,
`session-native-tap.ts --prepare` and `session-acceptance.ts` (optionally
`--runtime=legacy|v2`). The final run recorded unchanged production registration
and verified browser/native-host/tap/Xvfb process exit.

Final focused reruns passed: 183 bridge tests, 120 core runtime/permission/media
tests, 51 app tests (including protocol detection, grant state/decoding and i18n
parity), and seven shared-UI tests. Core and app typechecks pass; the full
opencode typecheck still reports the unrelated TS7053 described above.

## Serving Signal Shutdown

**16/16 real native subprocess scenarios passed**, eight for each runtime. This
is Phase 3 OS-signal evidence, not a deferred Phase 4 claim. The new test starts
`packages/opencode/src/index.ts serve` for legacy and
`packages/cli/src/index.ts serve` for V2. Actual authenticated HTTP session/prompt
endpoints admit and schedule provider-driven browser work. No test calls an
instance disposer or closes a coordinator in place of delivering the OS signal.

The legacy CLI previously had no serving signal handler. Its `serve` and `web`
commands now acquire/release the HTTP listener and opt into signal interruption
that awaits instance disposal and `AppRuntime.dispose()` before `index.ts` exits.
The V2 CLI's existing `NodeRuntime.runMain` handles both signals and exits 130
after awaited scoped teardown; legacy exits 0. The V2 launch was not a synthetic
server graph or the legacy CLI's diagnostic `debug v2` command.

| Runtime | Case                                                       | Signal  | Native Create | Native End | HTTP Stop / Process Exit (ms) |
| ------- | ---------------------------------------------------------- | ------- | ------------: | ---------: | ----------------------------: |
| Legacy  | Held provider continuation after native create/navigation  | SIGTERM |             1 |          1 |                       1 / 274 |
| Legacy  | Held provider continuation after native create/navigation  | SIGINT  |             1 |          1 |                       6 / 251 |
| Legacy  | Pending human read approval after native create/navigation | SIGTERM |             1 |          1 |                       1 / 493 |
| Legacy  | Pending human read approval after native create/navigation | SIGINT  |             1 |          1 |                      37 / 560 |
| Legacy  | Deliverable keep intent                                    | SIGTERM |             1 |          1 |                       5 / 249 |
| Legacy  | Deliverable keep intent                                    | SIGINT  |             1 |          1 |                       4 / 250 |
| Legacy  | Active native read, successful response dropped by tap     | SIGTERM |             1 |          0 |                     2 / 30336 |
| Legacy  | Active native read, successful response dropped by tap     | SIGINT  |             1 |          0 |                     1 / 30281 |
| V2      | Held provider continuation after native create/navigation  | SIGTERM |             1 |          1 |                        1 / 93 |
| V2      | Held provider continuation after native create/navigation  | SIGINT  |             1 |          1 |                        1 / 93 |
| V2      | Pending human read approval after native create/navigation | SIGTERM |             1 |          1 |                       2 / 125 |
| V2      | Pending human read approval after native create/navigation | SIGINT  |             1 |          1 |                      39 / 100 |
| V2      | Deliverable keep intent                                    | SIGTERM |             1 |          1 |                       1 / 124 |
| V2      | Deliverable keep intent                                    | SIGINT  |             1 |          1 |                       8 / 130 |
| V2      | Active native read, successful response dropped by tap     | SIGTERM |             1 |          0 |                     1 / 30124 |
| V2      | Active native read, successful response dropped by tap     | SIGINT  |             1 |          0 |                     2 / 30134 |

In all 12 confirmed cases, the finalizer persisted `Browser cleanup: confirmed`
before process exit. Disposable fixture tabs disappeared; all four explicit
deliverables remained, detached. Pending approval tools persisted
`cancelled`/`not_dispatched`; a late HTTP approval could not reach the stopped
endpoint. This is not a claim of receiving a 404 from an exited server. Releasing
the held provider after exit caused no late native dispatch.

The four lost-response cases exercised a real in-flight `Runtime.callFunctionOn`
read with its successful native result withheld. They waited approximately 30
seconds for bounded settlement and persisted `cleanup_unconfirmed` before exit.
**The browser tab and debugger attachment actually remained**; no `turnEnded`
or destructive speculative cleanup was sent. This is verified uncertainty, not
successful cleanup. Native controller reconnection remains fenced in that state.
The separate test observer uses read-only `chrome.debugger.getTargets`, never
attaches a debugger, and is gated until the serving child has exited. It can
measure this outcome without bypassing the native host's controller fence.

Each scenario used a fresh isolated profile and native registration. The browser
outlived the server for inspection, then only the owned browser PID was stopped;
host/tap exit and the unchanged production-manifest hash were checked. The
production listener on `:4097` remained PID 9490. Xvfb `:96` was used exclusively.
Bulky stopped profiles/compiled host assets were pruned after recording evidence;
transcripts, databases, preparation metadata, reports and logs remain. Early
fixture failures and a disk-capacity-limited matrix are not counted as passes.

Reproduction, with an isolated Xvfb `:96` already running:

```sh
# From packages/opencode; prepares fresh browsers for every case.
TANDEM_SHUTDOWN_NATIVE=1 TMPDIR=/tmp/tandem \
  bun test test/server/browser-shutdown.test.ts --timeout 180000
# Single case, from repo root:
bun packages/chrome-bridge/script/shutdown-acceptance.ts v2 uncertain SIGINT
```

Final test log: `/tmp/tandem/shutdown-matrix-verified.log` (16 passed, zero failed).
Full per-case native counts, timings and exact evidence directory paths:
`/tmp/tandem/chrome-bridge/shutdown-matrix-summary.json`. Final evidence directories
range from `os-1789051275127` through `os-1789051548586`; each contains
`shutdown-report.json`, `shutdown-transcript.json`, `shutdown-processes.json`, and
method-only native dispatch logs. Focused CLI/listener/browser-tool regressions
passed 16 tests; bridge model-adapter regressions passed 22 tests. `git diff
--check` passed. Chrome-bridge typecheck passes; opencode's full
typecheck remains blocked only by the unrelated browser-fetch TS7053 above.

Limits: these are deterministic local-provider tests, not genuine-model reruns;
the keep case uses deliverable intent, not a second independent handoff matrix.
The shared legacy `web` lifecycle uses the same fix but was not launched (which
would open a browser window). SIGKILL/crash recovery and ordinary-profile rollout
are not established by these graceful-signal scenarios. No-late-dispatch checks
use a bounded 750 ms observation after releasing the provider, followed by the
independent browser observation; they are not an indefinite liveness claim.

## V2 Placement And Retry

The follow-up uses actual `SessionExecutionLocal`, `LocationServiceMap`, config,
catalog, permissions, provider resolution and native Chromium, without mocks
for those services. Public `prompt`, `resume`, `wake` and `interrupt` exercise
the production local execution path. Two initialized Git projects receive
distinct Location graphs; equivalent implicit-workspace references share one.

**34 live assertions passed.** A 503 after an earlier successful click produced
provider statuses `200, 200, 200, 503, 200`. The retried request body matched and
the trusted page recorded only one click. Foreign-project aliases were rejected;
a second session's generic wildcard grant did not authorize browser access, and
it created its own tab only after a real Allow once reply. Public interruption
awaited persisted cleanup; an idle wake did not replay native work.

An actual V2 provider-issued `task` call was tested: `Unknown tool: task`, zero
children and zero native dispatch. This establishes visible unsupported behavior,
not successful delegation. Across the test there were three native creates and
one mouse press/release pair.

The test found two production defects, now fixed:

- `packages/core/src/plugin/internal.ts` awaits the existing batched bootstrap,
  so cold placement cannot observe a partially populated model catalog.
- `packages/core/src/location-services.ts` canonicalizes omitted/undefined
  `workspaceID` cache keys, so execution and HTTP permission replies cannot use
  different services for the same implicit Location.

Regressions live in `packages/core/test/location-layer.test.ts`. Its invalidation
test releases borrowed contexts before reacquisition; the combined suite exposed
and fixed an initial leaked-test-lease issue rather than hiding it with separate
test processes. Production hashes still match the live placement report.

Reproduce from the repository root:

```sh
bun packages/core/script/browser-placement-acceptance.ts
```

Evidence: `/tmp/tandem/chrome-bridge/vp-1789049921544-e/acceptance.json`,
`checks.json`, `combined-regression-checks.json`; detailed transcripts/provider
requests: `/tmp/tandem/chrome-bridge/vp-1789049921544/placement/`. Browser,
host/tap and Xvfb `:94` exited; production registration remained unchanged.

## Native Onboarding

Android now validates `/api/health` with legacy `/global/health` and `/health`
fallback. Authentication/server errors and transport/timeouts stay terminal;
arbitrary HTML/invalid JSON does not prove health. Superseded credential checks
cannot enable Connect. Seventeen unit tests cover these cases and both legacy
endpoints; Android typecheck passes. Native product changes and build details
are recorded in `tandem-changelog.md`.

A freshly compiled separate app, `ai.opencode.android.onboarding`, completed
the actual onboarding UI on the Y700: wrong credentials kept Connect disabled
and returned 401; correct credentials and a physical tap connected successfully.
Relaunching only that test app restored its saved URL/auth, displayed the real
authenticated PNG and passed a physical Allow once smoke. No native-store
injection bypassed onboarding.

Handoff: `/tmp/tandem/android-onboarding-results.md`; APK:
`/tmp/tandem/tandem-onboarding-final.apk`. The installed APK hash matches the
recorded SHA-256. Production app/data/server were untouched, temporary generated
build changes were restored, test services/forwarding were removed, and the
separate test app remains installed but stopped.

## Coordinate And Reload Matrix

**390 live checks passed**, including 48 PNG-derived coordinate clicks, through
both the public controller and model adapter on the unmodified extension.
The matrix covers DPR **1, 1.25 and 2** crossed with real browser zoom
**80%, 100%, 125% and 150%**, at page top and nonzero horizontal/vertical scroll.
Zoom uses test-only `chrome.tabs.setZoom` and is verified with `getZoom`, measured
DPR and `visualViewport.scale === 1`; it is not mislabeled pinch/page scaling.

Same-URL child and top-level reloads invalidate prior views at every combination;
fresh reinspection and trusted clicks succeed. Cross-origin inspection/capture
fails closed. **264 stale/unsupported checks dispatched zero native input**;
guard metadata reads are still permitted. Native totals were 96 presses, 96
releases, 24 wheels and 180 captures, with no mutation replay.

This found a real bug: a parent screenshot token survived a same-URL child-frame
reload. `PageDriver.view()` now verifies the saved frame-tree document signature.
Deterministic page/controller regressions reproduce the defect. Model coordinates
remain viewport CSS pixels, using the matching capture's measured mapping for
image pixels; no public input contract changed.

Aggregate: `/tmp/tandem/chrome-bridge/coordinate-final.json`; detailed runs:
`coord-final1/`, `coord-final125/`, `coord-final2/`. The pre-fix failing dispatch
is preserved in `coord-child-bug/`. `script/coordinate-acceptance.ts` is the
repository fixture; reports record exact commands, PNG/source hashes, measured
geometry, dispatch counts and cleanup PIDs. These are controller/model-adapter
checks, not additional genuine-model runs.

## Final Regression Gate

The full Phase 2 gate passed again on the final controller source:

- Three fresh core suites: 32 assertions each.
- Extended user-tab suite: 37 assertions.
- Fault/disposition probe: 12 outcomes; two-browser selection: four assertions.
- All 196 deterministic bridge tests, bridge typecheck and formatting passed.

Evidence: `/tmp/tandem/chrome-bridge/p2-regate-aggregate.log` has
`phase2AcceptancePassed: true`; `p2-regate-final.json` records 43 unchanged
source hashes, 45 retained artifact hashes and 26 verified cleanup PIDs.
An initial extended run failed because extension first-install onboarding opened
a tab after the selection baseline. Its evidence was preserved; a fresh profile
completed installation-only warm-up before the unchanged suite passed.

Final combined regressions also passed: **125 core tests**, **51 app tests**,
**17 Android health tests** and **16 CLI/listener/browser-tool tests**. The 16
opt-in native shutdown tests skip in ordinary unit runs; their separate live
matrix passed all 16. Core, bridge and Android typechecks pass. Opencode's full
typecheck still has the unrelated browser-fetch TS7053 listed above.
