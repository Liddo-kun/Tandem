# Phase 4: personal installation evidence

Verification date: 2026-09-11. Jon's supported personal-use clients are the web
UI and Android; Electron was explicitly removed from rollout scope. The earlier
custom page engine reached production, but browser-task readiness was **not
established** and that artifact is now superseded in source by the original-engine
repair. The repaired artifact has **not** been deployed to production.
The subsequent actual Shopee session `ses_f72016fa1fferSoySJfxYJ0BAd` failed:
inspection succeeded, a click rejected with `stale_handle`, reinspection allowed
the click, screenshot rejected with `unsupported`, and typing then rejected with
`stale_handle`. The assistant incorrectly described these as connection failures.
The screenshot is diagnostic evidence only, not authorization to change an account.
The separate intermittent capture `native_error` is still unexplained. Earlier
passing tests below are limited historical evidence, not acceptance of this workflow.

## Implementation

The current repair imports the original installed plugin's complete
`browser-service.mjs` byte-for-byte into the Tandem server and appends only the
reviewed `original-exports.js` seam. The original low-level context (`Km`/`nm`),
Playwright, visible-DOM and CUA handlers now perform server-side page work.
`browser-client.mjs` and two WASM assets are copied only for provenance/reference;
they have no active import, AX/QR are not exposed, and they are not claimed to be
bundled into the CLI. Tandem keeps the native-host transport, authorization,
operation ownership, bounded aliases, media storage and lifecycle recovery. The
host adds only narrow validation for engine cleanup calls; it does not embed the
service engine. This is not the full original `node_repl` API. See
[chrome-original-repair.md](chrome-original-repair.md).

`packages/chrome-bridge/INSTALL.md` documents the standalone host and manager,
XDG defaults, explicit connection environment, takeover/restore and manual
recovery. Installation writes content-addressed binaries and a launcher with
absolute paths, saves exact manifest bytes before registration changes, resumes
an interrupted setup, and refuses changed registrations/configuration. Private
storage and journals survive restore. Activation remains pending until the
extension launches the installed executable and the intended server verifies
its own browser connection. Capture remains unverified until measured.

Shared app compatibility fixes accept current V2 agent `request.body`, bound
message pages to 1–200, avoid a nonexistent V2 todo endpoint, and hydrate current
`session.next.*` durable message boundaries including authenticated image parts.
Hydrations coalesce per message and discard stale generations. V2 todos on a cold
load remain empty until an event arrives; this does not invent a todo endpoint.
The current-event adapter refreshes durable boundaries rather than promising
character-by-character streaming for that protocol shape.

Standalone V2 routes now use the existing restricted CORS origin policy. An
actual optimized Android build exposed missing preflight handling in the
compiled CLI: OPTIONS previously returned 404. The rebuilt backend returns 204
for the Android origin and retains authentication on real API requests. Embedded
routes retain the enclosing legacy server's middleware.

## Historical baseline and artifacts

- Ubuntu Linux ARM64 on the physical Y700 / Android 15; Bun 1.3.14.
- Extension 1.26.901.11451, Chromium 149.0.7827.102, native protocol 2.
- Compiled host SHA-256:
  `bf793d64f0eff2a51a9f1e97f1bcac49ecb5dca1b7dae4d3abf806e41db06e6a`.
- Production manifest SHA-256 remains
  `fe4852bc9c904567ae995d92333fe5ea062d6e3259870b4ef7ad6348a04f9c1c`;
  saved target is `/home/jon/.local/share/chrome-standalone/native-host/extension-host`.
- The optimized signed Android release is a parallel installation,
  `ai.opencode.android.chrome4`, built with `bun run install:y700 -- -Name chrome4`.
  It uses the normal release profile and signing. UI checks use physical Android
  input/accessibility and screenshots, not a debug WebView or dev-server APK.
- V2 packaged backend: `packages/cli/dist/cli-linux-arm64/bin/lildax`.
  Web assets: `packages/app/dist`. The joined web fixture serves those built
  assets with a loopback proxy to the compiled backend; it does not substitute
  model, permission or media APIs. Its scripted HTTP model asserts the actual
  PNG payload before producing the final response.

Compact, credential-free results are retained in
[chrome-extension-phase-4-results.json](chrome-extension-phase-4-results.json).

## Historical pre-repair results

| Check                                                                                                     | Result / retained evidence                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bridge regressions, including installer                                                                   | 204 passed, 0 failed; `/tmp/tp4-a/bridge-final.log`                                                                                                        |
| Affected shared-app tests                                                                                 | 87 passed, 0 failed; `/tmp/tp4-a/app-tests-final.log`                                                                                                      |
| Restricted CORS, preflight and retained authentication                                                    | 3 passed, 0 failed; `packages/server/src/cors.test.ts`                                                                                                     |
| Bridge, app and server typechecks                                                                         | Passed                                                                                                                                                     |
| Installed executable launched by real extension                                                           | 50 smoke assertions passed; `/tmp/tandem/chrome-bridge/p4-install-a/smoke-report.json`                                                                     |
| Install/reinstall/restore, missing target, interrupted setup, installer conflict and journal preservation | Passed; installer tests plus standalone manager exercise                                                                                                   |
| Installed host heartbeat and restart                                                                      | Smoke includes 65-second heartbeat, pending-call settlement, host restart and unrelated-tab survival                                                       |
| Lost-response manual recovery                                                                             | Passed; `/tmp/tandem/chrome-bridge/p4-recovery-d/install-recovery-report.json` and `recovery-targets.json`                                                 |
| Joined packaged web UI                                                                                    | Passed on final rebuilt backend; `/tmp/tandem/chrome-bridge/p4-web-final/packaged-session-report.json` and `packaged-web.png`                              |
| Joined signed Android release                                                                             | Passed; `/tmp/tandem/chrome-bridge/p4-android-f/packaged-session-report.json`, `android-result.png`, `android-grants-empty.png`, `android-asked-again.png` |

The recovery fixture performs one server-counted mutation, loses its response,
preserves `unknown`, kills only the discovered isolated host, then stops and
verifies absence of the exact old browser process. A new storage root and binding
reconnect after restart. The target list permits only the exact new inspection
tab to be attached. Old journal bytes remain identical and the mutation is never
replayed. Both registrations restore successfully. The unmodified extension's
`Target.getTargets` shim uses `id`/`tabId`; `Target.getTargetInfo` uses `targetId`.
The final assertion compares these correctly.

The web and physical Android workflows grant five permissions through the UI, replaces the fixture
input, clicks exactly once, supplies the PNG to the model and renders it in the
client, removes all five saved grants through Settings, observes a fresh approval,
and interrupts it without another mutation. Both interrupts use the real API;
this is not evidence of clicking the client's Stop button.

The final packaged backend SHA-256 is
`7ed9eeb36d5e3f1efbd56a2a8d11c1d4e62ea4334cbfb27d0a410b2c9d24f23c`.
The signed Android APK SHA-256 is
`1a0b304d524aff0f088f4e1ad8954033b3e42c8c276e9575f60ab09a8a949bbe`.
Final joined runs use an isolated headless Chromium host browser. Android itself
is the visible physical release app. Earlier Android runs timed out without
dispatch while the driver had not reliably reached/answered the active session;
these are failed runs, not successful recovery or quota errors. All provider
traffic in Phase 4 uses the local scripted fixture, not Jon's OpenAI account.

## Repair evidence and rollout gate

The joined HTTP fixture passed at
`/tmp/tandem/original-session-oSLVDb/acceptance.json`: create, inspect, ref click,
selector/ref typing, same- and cross-origin frame selectors, key input, a
22-second permission hold, PNG delivery, navigation and cleanup all settled
confirmed. A direct original-engine fixture also worked. The source engine's
capture and screencast fallback request PNG rather than its JPEG default for
Tandem's PNG-only media adapter. Synthetic per-engine numeric tab IDs isolate the
original module-global caches when browsers reuse native tab numbers.

These are local fixture results only. Decline/cancel, real sites and UI rendering
were excluded from the joined report. The original API is not fully exposed;
Tandem keeps its existing operations and adds selector targeting for
click/type/key. Original Codex metadata/config/auth, site-status telemetry and
REPL callback dependencies are replaced by Tandem's trusted operation ownership
and permission flow. No claim is made that the original site's policy checks are
evaluated; that path is not used.

Windows, macOS, iOS and Electron are not verified for this installation. The
isolated Chromium launch uses `CDPScreenshotNewSurface` and `--no-sandbox`;
production must not inherit `--no-sandbox`. Verify capture on the intended browser
launch before changing `screenshotVerified` to true. Profile labels are not
identity proofs. Installer status proves the installed host is reachable, not
which Tandem server owns it.

Phase 3's legacy/V2 server shutdown and placement evidence remains applicable to
unchanged controller/runtime paths. The Phase 4 joined release-client check is
specifically the standalone V2 backend; do not claim that an older embedded web
bundle was retested from these results. The early built legacy CLI predates the
final app fixes and is not a rollout artifact.

Test profiles and staged copies may be pruned only after their exact processes
exit and their isolated registrations restore; compact reports, screenshots,
private journals and installation records are retained. Failed exploratory runs
are not counted as passes. The Electron experiment did not pass and was dropped
when Jon clarified that he does not use that app. No production service or
registration should be switched based on an Electron result.

The repaired artifact is now installed with binding `personal-chromium-original`.
Production joined interaction and deny/cancel tests passed; the production chat
also read Selenium's public form, filled and cleared an input, and received its
PNG without submitting anything. Exact deployment, failed-attempt records and
limits are in [the repair record](chrome-original-repair.md#production-deployment).
This does not establish universal readiness, every Android/web UI component, or
Shopee completion. See [INSTALL.md](../packages/chrome-bridge/INSTALL.md).

Subsequent production use failed with `disconnected` and unconfirmed cleanup.
Chromium and its native host were no longer running; the cause of exit is not
established. Cached dead/closed sessions and old-journal recovery blocking remain
unresolved. The successful checks above are not an overall completion claim; see
the repair record's restart section for the current blocker.

Final cleanup: all Phase 4 owned browser/server test processes exited; the final
web and Android isolated registrations were restored before profiles/staged
copies were pruned. Installed binary roots, journals and compact reports remain.
The production manifest was rehashed and is unchanged.

## Historical rollout of the superseded custom engine

Jon approved the switch on 2026-09-11. The normal `tandem web` server on port
4097 was rebuilt with the final embedded web assets and installed atomically at
`/usr/local/bin/tandem`; health reports `0.0.0-dev-202609110053`. The signed normal
Android package `app.liddokun.tandem` was updated with `adb install -r` through the
canonical tablet installer and opened successfully. App data was preserved.

The active host is installed under `~/.local/share/tandem/chrome-active`, binding
`personal-chromium-active`. `~/.profile` sourced its `connections.sh` for normal
widget/login launches. Capture was enabled after a measured PNG. The existing
`chromium-x` launcher gained `CDPScreenshotNewSurface`; its pre-existing sandbox,
GPU and CDP settings remained intact. At rollout time Chromium ran in the
persistent `tmux` session `tandem-chromium-active`.

A public Selenium test-form read, typing/clearing without submission, screenshot
and confirmed cleanup passed on the real browser. Wikipedia search triggered
`target_changed` and was not retried. A separate local scripted provider drove
the browser tool through the actual production server, receiving the real PNG;
the persisted transcript confirms cleanup. No OpenAI account was used.

Early launch-session termination left stale discovery records. Recovery retained
the initial `chrome` root and its journals, restored the original registration,
and installed the active root with a fresh binding. No grants were transferred.
The active installation's backup points directly to the original integration.

Private exact rollback copies, the old binary and a SQLite-consistent backup
are in `~/.local/share/tandem/chrome-rollout-20260911/`, alongside production
verification reports and `ROLLOUT.md`. Restore command:

```sh
~/.local/share/tandem/chrome/tandem-chrome restore \
  --root ~/.local/share/tandem/chrome-active
```

Also remove the Chrome source line from `.profile` before restarting Tandem to
roll back. Do not blindly restore the database backup over newer sessions.
Manager status may report `controller_busy` while the verified production server
owns the host; it conservatively labels capture unverified even though the server
configuration and production PNG report record the measured check.

Production artifact SHA-256:

- Host: `ba56707385fb6cca727fdfe54e4bc4adc1f5e2e31544220fe7a460a023f4f8bd`.
- Tandem: `366595ff67e75dc8c08386d6c99fb5011fb23c90fa6708bc1adb1b4c1a4273dd`.
- APK: `f2923e8b7a039b1ce0fcdc75256d88fa39370ec433e9dc01f0c376ec48bcb5ed`.

## Post-rollout registration conflict (2026-09-11)

Jon's first Shopee attempt returned `browser_unavailable` before dispatch. The
production registration had reverted at 08:02 to `chrome-standalone` although
Tandem's server environment still selected `personal-chromium-active`. Jon
confirmed he had not restored it manually. The installed personal plugin's
`start-node-repl.sh` unconditionally invokes `setup-native-host.mjs`, whose
installer overwrote another integration's registration on runtime startup.

Patched that installed plugin's setup to preserve an existing registration with
a different host path, requiring explicit takeover instead. Its original script
is saved in the private rollout backup. Re-executing the setup after reinstalling
Tandem confirmed that Tandem's registration survives. The browser was reopened
and the production server restarted to clear its deliberately cached failed
connection. No Shopee operation was replayed and no account changes were made.

This fix is in the installed `chrome-standalone` plugin cache (version
`26.901.51231-standalone.1+codex.20260909145247`), outside the Tandem repository.
A replacement plugin version must retain this ownership check; otherwise its
automatic setup can retake the registration. The initial isolated acceptance did
not exercise competing-plugin runtime startup. Do not describe those tests as
proof that registration cannot be changed by another installed integration.

### Production follow-up: omitted browser on tab actions (2026-09-11)

The 08:18 screenshot showed successful creation followed by `unsupported` on
`inspect` and `keep`. The persisted tool inputs supplied the returned tab alias
but omitted `browser`; the adapter required the field even though the skill's
workflow described inspection using the returned tab. This was an interface
mismatch, not evidence that Shopee itself was unsupported.

Tab actions now infer the browser only from a valid current-execution tab alias.
Explicit bindings still pass the existing binding-identity checks. Foreign,
forged, wrong-kind and expired aliases fail before native dispatch; operations
without a tab or explicit browser return actionable `browser_required`. The
shared tool description and skill document the rule.

Validation: 206 bridge tests passed (including the exact omitted-field inspect
and keep regression and negative ownership cases); bridge typecheck passed.
Normal embedded-web backend build and binary smoke test passed; installed and
restarted production port 4097 with its existing environment. No Android UI
change was needed. Through the actual production server, a local scripted
provider created a Selenium test page, inspected it, received a PNG and marked
it deliverable, omitting `browser` on all three tab actions. Final persisted
cleanup confirmed `tabs=1; retained=1; nativeConfirmed=true`. Keep first records
intent as `not_dispatched`; final cleanup confirms authorized retention.
No account tokens were used. This verifies the reported interface regression,
not completion or compatibility of Shopee's address-change workflow. Private
report: `~/.local/share/tandem/chrome-rollout-20260911/production-tab-binding-check.json`.

### Production follow-up: human approval deadline (2026-09-11)

Screenshot `Screenshot_20260911-082626.png` corresponds to an inspection that
settled after 15 seconds with `deadline_exceeded`, `not_dispatched`, and the
misleading tool error `All fibers interrupted without error`. A local scripted
provider reproduced precisely this failure through production by approving
creation but withholding the read permission reply. Earlier allow-all fixtures
did not exercise this normal interactive path. The screenshot alone does not
establish whether the user saw or answered the prompt.

Model operations now receive an additional bounded five-minute aggregate budget
used only during authorization. Unused allowance is removed before native work;
ordinary controller callers retain their existing deadlines. Cancellation still
interrupts pending permission requests, expired replies cannot dispatch, and
permission waits hold no native execution lock. The shared runtime preserves
the controller's structured deadline result when its approval fiber is aborted;
actual invocation interruption and typed permission failures retain their causes.
Lifecycle cleanup retains its separately bounded finalization deadline.

Validation: the existing 206 bridge tests and typecheck passed; the controller
suite with two additional deadline/cancellation regressions passed (51 tests).
All 13 core browser ownership/tool tests passed. Embedded-web build and binary
smoke passed; production backend was replaced and restarted with existing env.
A production local-provider run held read approval for 20 seconds, confirmed
it remained pending, approved it, and successfully inspected and received PNG.
One earlier capture returned `native_error`; it did not reproduce in the next
run and its cause remains unresolved. This is not evidence of universal capture
reliability or Shopee workflow completion. No account tokens were used.
Private script/report: `server-permission-verify.ts` and
`production-permission-check.json` under the private rollout directory.

The final rerun also kept the approval responder alive through finalization:
20-second delayed read, inspection, PNG delivery, keep intent, and persisted
`Browser cleanup: confirmed` all passed. A preceding verification-script run
stopped its responder before finalizer approval and correctly reported
`cleanup_unconfirmed`; the script now explicitly awaits cleanup as well.
