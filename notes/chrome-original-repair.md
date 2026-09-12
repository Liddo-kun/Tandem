# Original Chrome Engine Repair

Status: **page-engine repair deployed; close/reopen recovery implemented and
verified on isolated source and packaged servers, not deployed**. The earlier production HTTP interaction,
deny/cancel and real-site checks passed on 2026-09-11; they were insufficient for
an overall completion claim. This note compares source, process and
runtime dependencies. It is not a readiness claim, a license grant, or evidence that the
unfinished Shopee task works.

## Source Baseline

The import is pinned to the previously installed cache:

`/home/jon/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247`

The source `scripts/browser-service.mjs` SHA-256 is
`3027e8e47d3241f8fde99078a9ced4647ac1732b614b3704628405236f8ac18b`.
`script/import-original.ts` refuses any other service hash. It copies the entire
original service byte-for-byte to `vendor/original/browser-service.mjs`, then
appends `src/original-exports.js`. Comparing the first original-file-length bytes
against the cache succeeds exactly; the final vendored-file hash necessarily
differs because of that appended seam. `vendor/original/source.json` records the
source path, pin and adaptation.

The import also copies, without rewriting, provenance/reference artifacts that
the Tandem integration does not separately import or expose:

| Imported artifact                       | Installed-source SHA-256                                           | Purpose / availability                                                     |
| --------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `scripts/browser-client.mjs`            | `b9b9bc2319d5ee6aa0b1e481d63bb2130d28102fc7c9080803ab5552185d9037` | Original client source retained for comparison; it is not executed.        |
| `scripts/browser-accessibility.wasm.br` | `97d2773f1f0d3f890e2dc8bbf7da5745cfb9c2686d893579ffc35bb9608185ee` | Original accessibility payload retained for provenance; AX is not exposed. |
| `scripts/zxing_reader.wasm`             | `0e8d688d71932ebb6b8b33f700d43d3cb997f59ed9cab3c05102d7f10288a392` | Original QR payload retained for provenance; QR is not exposed.            |
| `PROVENANCE.md`                         | copied with the assets                                             | Original/local provenance and proprietary-code notice.                     |

No credentials, browser profile, account state, Codex config or private runtime
records are imported. The source is not presented as a public stable API.

## Process Boundary

The original service engine is imported by `original-page.ts`, reached through
`controller.ts` and `tools.ts`. `packages/core` and `packages/opencode` consume
that tool/controller dependency, so the compiled Tandem **server** contains the
service bundle and appended export shim.

The standalone native host has a separate build root:
`bun build src/host.ts --compile`. Its import graph reaches `client.ts`,
`errors.ts` and `native.ts`, not
`controller.ts`, `original-page.ts` or `vendor/original/`. It therefore embeds
none of the original service, copied client or WASM files. The host remains the
Tandem transport/journal/lifecycle process. Its repair-specific addition is only
a narrow validation path that permits the server-side original engine to perform
its bounded cleanup calls while a cleanup lease is active.

No Tandem module imports the copied `browser-client.mjs`, accessibility WASM or
ZXing WASM files. The service bundle retains its original dormant asset-loader
references, but the Tandem integration does not expose AX or QR and makes no
claim that those external files are bundled into the Tandem CLI. They are
retained to preserve the inspected source set and provenance for capabilities
that are not currently active.

## Reused Engine

The appended export seam instantiates and calls original bundle symbols rather
than reimplementing their behavior. Reused code includes:

- the original low-level browser context and CDP routing (`Km`/`nm` in the pinned
  minified bundle);
- original Playwright locator and bound-node machinery;
- original visible-DOM snapshot, node-reference and DOM action handlers;
- original CUA click, key, wheel/scroll and related input handlers;
- original page navigation and cleanup handlers; and
- original capture implementation, including its screencast fallback.

Tandem requests PNG from the original capture engine instead of its JPEG default
because Tandem's managed browser-media adapter accepts PNG. Tandem validates the
returned PNG dimensions/bytes and supplies its existing expiring authenticated
media reference. This format adapter is not a new screenshot engine.

`original-page.ts` is a narrow server-side transport/result adapter. Each engine
instance receives a synthetic internal safe numeric tab ID, translated to the
real native tab ID only at the transport boundary. This is required because
original module-global DOM/world/target caches are keyed by numeric tab ID, while two configured
browsers can independently issue the same native number. The synthetic ID is
internal and never becomes a model ref. Model-visible refs, frame aliases, views
and tabs remain opaque execution-owned Tandem aliases.

The earlier custom HELPER `PageDriver` implementation is removed. `page.ts`
contains shared page types, errors and bounded PNG decoding only; it no longer
implements DOM inspection/input/capture behavior.

## Dependency Inventory

| Original dependency                                             | Source available in installed package?                                                   | Repair treatment                                                                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-service.mjs`                                           | Yes, bundled JS                                                                          | Imported whole, hash-pinned, byte-exact prefix; reviewed export seam appended.                                                                |
| `browser-client.mjs`                                            | Yes, bundled JS                                                                          | Copied byte-for-byte for provenance/reference; not imported or executed.                                                                      |
| Accessibility / ZXing WASM                                      | Binary payloads only, but present as discrete installed assets                           | Copied byte-for-byte for provenance/reference; AX/QR are not exposed and no CLI bundling is claimed.                                          |
| Playwright/DOM/CUA handlers                                     | Yes inside the bundled service/runtime JS                                                | Called through original contexts and commands; not reimplemented by Tandem.                                                                   |
| `extension-host/linux/arm64/extension-host`                     | **No source found**; installed file is an ARM64 ELF executable                           | Not copied or executed. Tandem's reviewed native-messaging host and framing remain.                                                           |
| `runtime/linux-arm64/bin/node_repl`                             | **No source found**; installed file is a statically linked ARM64 ELF executable          | Not copied or executed. No generic REPL/MCP surface is exposed.                                                                               |
| `runtime/linux-arm64/bin/node` and packaged `node_modules`      | Node is an ELF binary; modules are present but belong to the full runtime                | Not runtime dependencies of the compiled Tandem host.                                                                                         |
| Codex configuration and MCP/plugin metadata                     | Files exist, but are integration configuration rather than page-engine requirements      | Replaced by `TANDEM_CHROME_CONNECTIONS`, trusted runtime identity and Tandem tool registration.                                               |
| Codex auth/account metadata, site-status and telemetry services | Referenced by the full original runtime, not required by the selected local command path | Disabled/not supplied to the server engine; its network-service stub fails closed. Tandem does **not** claim original site-policy checks run. |
| Original REPL callbacks, Stop hook and turn callback plumbing   | Available only as part of the MCP/REPL integration around the engine                     | Replaced by Tandem's browser-turn owner, awaited finalizers, operation settlement and cleanup journals.                                       |

Runtime-directory inspection found `runtime/linux-arm64/bin/node_repl` and
`extension-host/linux/arm64/extension-host` as ELF executables and no
corresponding host or REPL source tree. That establishes source unavailability
in this installed package; it does not claim source is unavailable everywhere.
Keeping Tandem transport is therefore both the reviewable path and a concrete
source-availability boundary, not a claim that every original runtime layer was
reproduced.

## Exposed Contract

The repaired engine does not expose the full original `tab.playwright`,
`node_repl`, sidepanel or host-plugin API. Tandem keeps its existing actions:
configured browsers/status, discover/create/claim/resume, inspect, navigate,
click, type, key, scroll, screenshot, operation status and keep disposition.
Click/type/key additionally accept a bounded `selector` alternative to a fresh
returned `ref`.

Inspection output is translated into bounded untrusted text plus opaque refs and
frame/view aliases. A ref belongs to the original snapshot that produced it and
must be refreshed after relevant page changes. Selectors may use observed CSS or
role/name locators; embedded-frame traversal uses
`>> internal:control=enter-frame >>`. A selector is page targeting data, not
authorization, browser identity or permission scope. Ref and selector actions
both pass through Tandem's capability/origin permission checks.

Model operations have a bounded aggregate five-minute allowance for permission
waiting. Once a decision arrives, the extra allowance is removed and ordinary
native operation deadlines apply to queueing/preparation/dispatch. Permission
waits hold no native execution lock; cancellation is immediate, a late decision
cannot dispatch expired work, and uncertain mutations are never replayed.

## Evidence And Limits

### Shopee Inspection Timeout

The subsequent Shopee failure was reproduced personally through the production
HTTP/browser path: creation succeeded, inspection failed with `native_error`,
capture failed, and cleanup was unconfirmed. Temporary extension-worker diagnostic
wrappers (restored afterward) identified the underlying sequence: a Playwright
`Runtime.evaluate` ran into the three-second budget, the extension detached its
debugger, and later commands received `Debugger unattached`.

The pinned original client was checked, not just the adapter: its
`PlaywrightAPI.domSnapshot()` sends browser/tab IDs with no timeout override. The
service's `Me()` defaults and caps that command at 3000 ms; the original
Playwright evaluator passes the budget to both CDP execution and Chromium's
`Runtime.evaluate.timeout`. The extension's `executeCdp()` detaches on its command
timeout. No longer timeout or extra readiness wait was found in that client path.

On the actual production Shopee page, temporarily increasing the evaluation
budget to 10000 ms and its diagnostic native timer to 12000 ms let the evaluation
finish in 4365 ms. Durable tool metadata confirmed successful inspection and
screenshot; the large inspection was saved by the normal tool-output truncation
mechanism. This was a real page read, not a fixture or account mutation. The
unmodified anonymous/headless fixture browser instead hit Shopee's traffic-error
page; that result is not counted as verification of the real homepage.

`original-page.ts` now supplies `timeout_ms: 10000, max: 10000` to the two original
DOM-inspection commands. This is a deliberate bounded adapter adjustment, not
original-client parity or a replacement snapshot implementation. Existing
controller deadlines still cap the overall operation and native calls; mutation
budgets, permissions and replay rules are unchanged. The regression test runs the
actual original snapshot handler and verifies that 10000 reaches Chromium's
evaluation parameters, as well as the visible-DOM command.

Verification: 175 bridge tests passed, 0 failed, 2083 assertions; bridge typecheck
and the full ARM64 build with embedded web UI passed. The production diagnostic
report is `/tmp/tandem/shopee-read-probe-GjRBG1/results.json`; because its inspection
was truncated, its simplistic local JSON parser recorded that result as unparsed.
The session's durable `inspect` metadata, not that parser flag, establishes its
confirmed result. That diagnostic alone was not a post-install production run.

Installed server version `0.0.0-dev-202609111513`, SHA-256
`92caed186154aafb476cdfb2e16182184ecd1517b2f1c746d3b495fd71affeec`.
The prior executable and installation receipt are retained under
`/home/jon/.local/share/tandem/chrome-rollout-20260911/shopee-timeout/`.
No production process was restarted and the native host was not changed.

After Jon restarted Tandem, health confirmed version `0.0.0-dev-202609111513`.
The unmodified production HTTP read-only probe passed against the actual
`https://shopee.vn/` homepage, with no temporary diagnostic overrides: confirmed
inspection (67,938 snapshot characters, 49 element refs), a 937 x 1162 PNG with
one managed attachment, and `Browser cleanup: confirmed; tabs=1; retained=1;
stage=verification; nativeConfirmed=true`. The inspection's normal large-output
file was parsed to verify its result, rather than treating truncation as failure.
Evidence: `/tmp/tandem/shopee-read-probe-WHfbKE/verified.json`. One test deliverable
was retained; no account changes were performed. This verifies the reported
read/capture failure after installation, not completion of the address workflow.

The joined HTTP acceptance report
`/tmp/tandem/original-session-oSLVDb/acceptance.json` passed. It records confirmed
create/inspect/click/type/key/screenshot/navigate outcomes, a 22-second held
approval, a 45,898-byte PNG, expected main/same-origin/cross-origin frame values,
one click and confirmed cleanup. The direct original-engine fixture also worked.

That early report excludes decline/cancel, real sites and UI rendering; later
production evidence below supersedes those particular gaps, not its exclusions.
No test establishes every original command, universal capture reliability,
full clipboard descriptor restoration, or the Shopee address workflow.

### Production Deployment

- Server: `http://127.0.0.1:4097`, `/usr/local/bin/tandem`, version
  `0.0.0-dev-202609110350` (embedded web bundle included).
- Binding: `personal-chromium-original`, private root
  `/home/jon/.local/share/tandem/chrome-original`. The login profile sources its
  `connections.sh`; `screenshotVerified` is true after a measured original-engine
  capture and the joined production screenshot check.
- Native host digest:
  `8c0d2a5111e20875f0c113e870bf3a0ed6f1caeaf34b3c56ef201059621d3a95`.
  Chromium runs through `/home/jon/.local/bin/chromium-x` with
  `--restore-last-session`; the launcher supplies the tablet display/audio/GPU
  environment. No unrelated browser profile was restarted.
- The old `chrome-active` root and its blocked/kept leases and journals remain
  preserved. No old aliases or grants were transferred into the fresh binding.
- Rollback binary, prior registration/profile, private environment snapshots and
  copied reports live under
  `/home/jon/.local/share/tandem/chrome-rollout-20260911/source-repair/`.
  Restoring the previous registration does not resolve its historical leases;
  never delete those journals to make an old host appear healthy.

Production joined interaction evidence:
`/tmp/tandem/original-session-UTigD6/acceptance.json`: passed with a 22,140 ms
approval wait during DOM churn; live-ref click and key; append, empty clear and
replace independently checked against fixture values and snapshots; same- and
cross-origin frame selectors; navigation; a 51,430-byte PNG reaching the provider;
and native-confirmed retained-tab cleanup plus clipboard bridge removal. One
local fixture deliverable remains intentionally retained.

Production permission evidence:
`/tmp/tandem/original-permission-oT62UH/acceptance.json`: deny and cancel both
passed after 22,001/22,097 ms waits, with zero clicks/input events, unchanged
values, late approval HTTP 404, settled tools and confirmed cleanup.

The real model-driven browser tool in the production chat also created Selenium's
public `web-form.html`, inspected it, filled its text input by ref, delivered a
952 x 1125 PNG to the model, verified the complete value, then cleared by observed
selector and verified the empty field. No submit or account action was performed.
The test tab was not marked for retention; its normal turn finalizer is responsible
for closing it. This is real-site and model-media evidence, not an independent
visual review of every Android/web permission or message component.

Final offline suite: 172 tests passed, 0 failed, 2,051 assertions.

### Restart Discipline

After the successful checks, Jon reported `disconnected` and
`cleanup_unconfirmed; tabs=1` in the historical Shopee chat. Live investigation
found neither the production Chromium process nor its native host running.
The host journal remains intact with one blocked, preservation-pending session.
Its 256 retained operations are all settled/confirmed; that is rolling history,
not proof of operation-cap exhaustion. The browser exit cause is not established.

Source review found independent recovery blockers in the deployed build: `BrowserToolOwner` caches a
dead controller, failed binding cleanup can retain a closed browser session after
unconfirmed cleanup, and a replacement host globally blocks on dead-host journals
containing sessions. Ordinary browser restart therefore is not a demonstrated
recovery path. Preserve these records; do not work around the issue with another
fresh installation root or repeated production-server restarts. Further lifecycle
fixes and cross-session/disconnect/restart regression coverage are required before
calling the deployed integration complete. The candidate recovery below addresses
these blockers without changing production.

### Close/Reopen Candidate

The host compares the current native parent's kernel boot/start identity with
each old host's already-recorded boot/start identity. A browser born strictly
after an old host, or on a different boot, cannot own that old host's leases.
Those journals remain untouched and uncertain; they no longer quarantine fresh
sessions. A new host inside the same browser does **not** establish this fact and
still blocks unresolved recovery. Invalid/missing evidence and existing journal
resource limits remain fail-closed. No extension identity migration or extra
journal schema is needed for the existing v2 records.

Discovery now publishes host process-start identity and ignores provably dead
identity-bearing manifests without deleting them. Ambiguous live hosts still
fail. The tool owner can retry an initially unavailable connection; subsequent
turns reconnect a disconnected browser independently and replace only its dead
session. Old handles, grants, wire IDs and operations are not transferred. Old
operation status retains its recorded outcome without querying a replacement
host. An in-flight failed action is never automatically retried; fresh work is
admitted by a later chat turn. Normal handoff and preservation-pending behavior
remain distinct from a retired browser incarnation.

`packages/chrome-bridge/script/reopen-acceptance.ts` reuses the scripted-provider
HTTP approach, restricted to server4107 and the existing `original-repair-b`
fixture. It verifies the exact server process and isolated-only binding before
launching through the private timeout-wrapped launcher. It closes Chromium using
the browser-level `Browser.close` command on that fixture's private debugging
endpoint, awaits browser/native-host exit, and reopens the same profile/root.
It does not use CDP for tool actions or connect to the production host.

Verified on 2026-09-11:

- Source HTTP report: `/tmp/tandem/reopen-acceptance-fhW0dI/acceptance.json`,
  passed; server PID 27277 remained unchanged through the complete sequence.
- Packaged HTTP report: `/tmp/tandem/reopen-acceptance-UgdL4h/acceptance.json`,
  passed; server PID 32726 remained unchanged, same historical session
  `ses_f71322c59ffetEjXTcPislujlY`; Chromium PID 429 -> 621 and native host
  PID 533 -> 722, with distinct host epochs.
- Both reports cover ordinary handoff/resume before close, explicit failure while
  closed, old-alias rejection after reopening, fresh create/inspect/click/PNG
  delivery, and native-confirmed final cleanup. Independent fixture counts are
  exactly one click before and one after reopen; PNG delivered to the provider is
  14,641 bytes. Historical uncertain journals are byte-for-byte preserved.
- Chrome bridge: **174 passed, 0 failed, 2,076 assertions**. The new same-chat
  subprocess regression also injects a lost mutation response, verifies duplicate
  delivery does not replay it, and keeps the old operation's `unknown` status
  after reconnection. Its parent-age boundary is synthetic; the HTTP reports
  supply the real Chromium incarnation evidence.
- Core browser/tool/media checks: **17 passed, 0 failed, 106 assertions**.
  Legacy browser adapter: **3 passed, 0 failed, 25 assertions**.
- Bridge and Core typechecks pass. Full opencode typecheck remains blocked by
  unrelated `src/plugin/browser-fetch/plugin.ts:176` TS7053; it was not changed.
- Full Linux ARM64 candidate build, embedded web UI and binary version smoke
  test pass: `0.0.0-dev-202609110448`.

Candidate binary: `packages/opencode/dist/opencode-linux-arm64/bin/opencode`,
SHA-256 `325c74d141080ba53b49a15fbc2c4883376934923342efdd58d176d0e44e5d69`.
Candidate host: `/tmp/tandem/recovery-native-host`, SHA-256
`4352038c68d3921461fbd23fe05a1692eb3f2927dd9d0b7c10983b7795945f2c`.
Only the isolated fixture host was replaced; its prior executable is retained at
`/tmp/tandem/recovery-prior-fixture-host`.

The first HTTP run is retained as failed at
`/tmp/tandem/reopen-acceptance-PpPXoR/acceptance.json`: the acceptance assertion
incorrectly expected `keep` intent itself to be `confirmed`, rather than
`not_dispatched` followed by awaited finalization. The corrected complete source
and packaged reruns above passed. This is not a production deployment, real-site
restart test, GUI-window-close test, or verification of the unfinished Shopee
workflow. Deploying requires an approved server/host switch and a full browser
close/reopen, retaining the current binding, profile and all recovery records.

The production switch is staged under
`/home/jon/.local/share/tandem/chrome-rollout-20260911/reopen-recovery/`.
The detached handover waits 90 seconds so the current reply can finish, verifies
the staged process identities and artifacts, checks for active sessions, then
restarts the exact server/browser with the known launcher. It preserves the
binding and historical journals, runs production HTTP acceptance, and writes
`applied.json` only on success. A failure writes `failure.txt` and attempts to
restore the prior runtime, recording `rollback.json`; the prior runtime retains
its known recovery defect. Staging alone is not deployment success.

The first production switch failed because Chromium's rewritten `/proc` process
title was treated as argv. A subsequent launch lacked `DISPLAY` because Chromium
had scrubbed its environment. Both failed attempts are retained as failures;
use the known `chromium-x` launcher, not reconstructed Chromium process state.
One intermediate cancel run lost HTTP connectivity after reporting zero mutations
and cleanup; only the complete later rerun is counted as a pass.

The agent runs on this same production server. Do not use repeated production
restarts as an edit/test loop: run candidate builds on a second loopback port with
an isolated fixture binding. For the final approved switch, start a detached
handover process first, with validated launch commands, private rollback artifacts,
health checks and evidence collection that survive the current session stopping.
The detached scripts used here survived shutdown, but cannot automatically resume
the interrupted conversation. Validate the full launch environment and persistent
binding (including the measured capture flag) before the single final switch.

Historical rollback journals, installation records and private reports remain
authoritative and must not be deleted to simplify recovery. They contain no
secrets in this repository. The separate original plugin startup source and
distributable were updated to the `.2` ownership-guard version; exact delivery,
rollback and install limits belong to
[chrome-registration-repair.md](chrome-registration-repair.md).
