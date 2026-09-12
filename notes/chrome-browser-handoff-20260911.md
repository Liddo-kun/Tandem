# Chrome Browser Handoff

## Latest Checkpoint: Inspection Output Installed

Jon asked why Shopee session `ses_f6dfe3819ffeoB1I8TVvVoMDhs` launched a helper.
Recorded `inspect` returned 98,315 bytes of single-line JSON, then legacy's
50-KiB whole-line truncator discarded the entire preview and explicitly ordered
delegation. The main agent saw no controls. The saved result did contain the
signed-in account button among 47 refs. The helper's Grep hit the 65,536-byte
record limit and Read only showed the beginning of the line before interruption.

Original Codex comparison is now documented in bridge README's Inspection Delivery
section. Default inspection uses original bounded visible DOM only (20,000 chars /
200 elements); `detail: "page"` explicitly requests original semantic page text.
Both runtime leaves consume readable `modelText`, with controls/refs first and no
duplicated element array, while bridge JSON stays available internally. Unsupported
`max` command arguments were removed. Generic limits/storage remain; legacy browser
overflow uses direct Grep/Read guidance instead of compulsory delegation. Skill and
model schema describe the visible/page distinction and direct overflow reading.

Installed CLI: `0.0.0-dev-202609111958`, SHA256
`a30ea9b10c2a335622889da54b179bfa25159befc1b9d455a2c674bdc277d370`.
Rollback: `~/.local/share/tandem/chrome-rollout-20260911/inspection-output/tandem.before`
(`...1734`). Bridge/Core typechecks and embedded-web ARM64 build passed. No test
suites or synthetic browser workflows were run. Needs ONLY Jon's Tandem restart;
native host and Chromium need no restart/change. Real model-facing inspection
after activation is pending; do not claim the running server uses the new format
until confirmed. No browser/session/account operations were performed for this fix.

## Latest Result: Real Lazada Workflow Passed

After Jon restarted Tandem (`...1734`), desktop Chromium was not running.
Jon explicitly authorized the agent to launch it; the existing `chromium-x`
launcher was used without configuration changes. Normal browser calls then
created Lazada home, inspected its search field, typed `Logitech MX Master 3S`,
pressed Enter, successfully inspected actual catalog results, clicked the observed
Logitech product link, and captured the product page. This is the same transition
that previously failed with `Debugger unattached`. The resulting screenshot
showed the Logitech flagship-store product page and price, not a demo fixture.
No cart, purchase or account mutation occurred. Explicit finalization returned
`confirmed: true`, `tabs: 1`, `retained: 0`, `nativeConfirmed: true`.
Both post-search observation and cleanup now pass on this real-site workflow.
Historical blocked leases are not claimed recovered by this fresh-tab success.

## Latest Checkpoint: Actual Lazada Attachment Failure

Jon restarted both components: confirmed server `...1712` and native host
`80c33e...`. Real Lazada search still failed after typing/Enter. Passive,
timeout-bounded tracing of the Chromium parent's native response captured the
actual error: `{"code":1,"message":"Debugger unattached"}` in
`/tmp/tandem/browser-chromium-errors.log`. The trace parser retained only RPC error
code/message records, not page data or full traffic. `strace` was installed for
this diagnosis; no test suites or scripted browser tests were run.

Original reference: `/tmp/tandem/original-browser-service.mjs:30978-31034`
(`executeTargetCdp`) matches a literal STRING `Debugger unattached`, forgets the
attachment and reattaches/retries once. Tandem previously replaced that native
error with `native_error`, so original recovery could not run. The extension
rejects it before executing the requested CDP command (`extension-background-
readable.js:9561-9564`). The fix classifies that exact category at the native
boundary and converts only confirmed `executeCdp` failures into the original
string inside `original-page.ts`; no new input replay loop was introduced.
The outer controller reports the safe category if original recovery still fails.
The preceding destroyed-context fix was insufficient for this actual failure.

Installed candidate: CLI `0.0.0-dev-202609111734`, SHA256
`b6041ab9d48e54c6344ed99ad0c805be2e2d7b4fb6250564491f2674ebe2097c`;
host `817ac031d2a1e010b7fe5b30ab3816eb9af3cf7841dcabd452e825b8efe3a193`.
Matching content-addressed host/launcher and registration are installed; binding,
IPC root, prior binaries and journals are preserved. Rollback files are under
`~/.local/share/tandem/chrome-rollout-20260911/attachment-recovery/`.
Builds passed. Needs Jon's full controlled desktop Chromium close/reopen and
Tandem restart; the agent has not restarted them. Real-site verification of this
candidate is still pending. Explicit handoff/finalize on the current old runtime
failed at `page_cleanup`; the Lazada tab remains protected, not verified released.

This supersedes the candidate/deployment boundary in older checkpoints below.

## Latest Checkpoint: Native Context Error Recovery

Installed candidate `0.0.0-dev-202609111712` plus native host SHA256
`80c33ea7ecdb48e325abc25c2ecb93b19cf2dff29fd9c5386650bd24ee224ac1`.
CLI SHA256: `7e0401d2021964c8f8e82c3e757a9999c7e9e76867f09f3f71d2da68d11117e1`.
Both builds completed; no suites/scripts were run for testing. Activation requires
Jon to fully close/reopen the controlled desktop Chromium and restart Tandem.
No process was restarted by the agent. Registration and installation record now
point to the new content-addressed launcher/host, with the same binding and IPC
directory. Prior binaries, manifest and installation record are preserved under
`~/.local/share/tandem/chrome-rollout-20260911/context-recovery/` and the existing
content-addressed host paths. All ownership journals remain untouched.

Actual GitHub search loaded repositories; sorting produced a visible site HTTP
429. Lazada home inspection, search typing and Enter succeeded, but subsequent
inspection returned `native_error`, screenshot returned `capture_failed`, and
automatic cleanup failed at `page_cleanup`. Next execution resume reports
`cleanup_unconfirmed`. We have NOT observed the Lazada results or established
the exact native cause; current error transport discarded it.

Jon requested original Codex implementation references on failures. Comparing
`/tmp/tandem/original-browser-service.mjs:25355-25365`, `25492-25496`, and
`36518-36535` reveals original context-cache recovery depends on recognizing
native destroyed/missing-context messages. Tandem `native.ts:rpcError` replaced
all such messages with `RPC handler failed`, and the host flattened these into
`native_error`, preventing those original branches from running. The narrow fix
classifies only the original context-error regex into `document_context_lost`
with a canonical, original-recognizable message; no raw native/page text crosses
the boundary. This repairs a proven source discrepancy, not yet a demonstrated
Lazada fix. Do not claim site recovery until real calls succeed after activation.

The older deployment checkpoints below are superseded by this candidate boundary.

## Latest Checkpoint: Approval Reduction Installed

Jon explicitly instructed: **stop writing and running tests**. Do not resume
test-suite work. Continue implementation/deployment work directly.

Approval reduction is installed and running as `0.0.0-dev-202609111651`, confirmed
through `/global/health` after Jon restarted it. Installed artifact SHA256:
`6a2cfe5e2d737848d224d5f63481a7f645e83eccd7197142ea645f70c15464ae`.
Rollback: `~/.local/share/tandem/chrome-rollout-20260911/approval-reduction/tandem.before`
(the `...1612` binary). Embedded-web ARM64 build succeeded. No production process
signals, browser registration changes, journal deletion or force-release occurred.

Post-restart normal browser calls in this chat successfully created an httpbin
form tab, inspected it, typed non-personal text, captured the visible result,
and explicitly finalized it. No form was submitted. Finalization reported
`confirmed: true`, `tabs: 1`, `retained: 0`, `nativeConfirmed: true`; this
execution left no diagnostic tab behind. No test scripts/suites were run.

The tool now groups routine actions into one site approval per execution/origin/frame;
discovery is once per browser turn; claim acquisition/attachment reuse approval only
within the exact claim operation/descriptor/origin. Blank creation and ownership
cleanup do not prompt. Denied/cancelled/rejected approvals are evicted, and waiting
operations observe their own cancellation. Saved-grant removal affects later turns;
stop the current execution to cancel its active turn authorization.

Before Jon's stop-testing instruction, an isolated source server at `:4107` with
the existing `original-repair-b` Chromium passed real Wikipedia/httpbin workflows
through normal HTTP sessions and browser tools using a scripted provider:
approval counts **2 / 1 / 3** over three turns (two sites; fresh-turn expiry;
discovery/claim/site). All explicit finalizations were native-confirmed. Evidence:
`/tmp/tandem/browser-reduction-live.log`, session `ses_f6e9fc575ffeJS2SUDYFQlv0ws`.
This is real-browser/session-path evidence, not autonomous-model planning evidence.
The isolated server/browser timeout processes were stopped afterward.

Supporting test edits migrated source-attribution scenarios from auto-approved
blank creation to gated user-tab claims; the existing runtime fixture now supports
user claims and preserves user tabs. Do not pursue more fixture work. Earlier
production browser calls in this continuation used the old policy; their agent
tab was automatically retained for handoff when that execution ended. Historical
blocked leases remain unresolved. The older checkpoint below is preserved for
context and is superseded by this deployment boundary.

## Mandatory Starting Point

Jon corrected the testing instructions again after a new session immediately ran
`bun test`, wrote tests and ran typechecks. **Do not repeat that sequence.**

- After necessary source/context inspection, start a real agent session and make
  actual browser tool calls. Observe approval prompts and user-visible results.
- Do not write, modify or run low-level tests unless Jon explicitly requests them.
  "Small targeted regression" and "concrete payoff" are not exceptions.
- Do not start by running typechecks. Build only if needed to load changes for
  live testing; use a focused post-change typecheck only when needed.
- The old test failures and commands below are historical reference, **not the
  next session's work queue**. Do not repair their fixtures as the first task.
- If real-session testing is blocked or unsafe, state the exact blocker instead
  of falling back to synthetic tests. Test multiple real websites, not just Shopee.

## Read This First

Jon requested this checkpoint because the conversation context was nearly full.
Continue personally, **no subagents**. Read `contextL.md`, `log.md` and applicable
nested `AGENTS.md`. The worktree has extensive pre-existing dirty/untracked work;
do not revert it or commit anything without instruction.

Jon's current priorities:

Follow **Mandatory Starting Point** above. Jon wants real-session evidence, not
another cycle of low-level test-writing and fixture maintenance.

1. Reduce browser permission prompts to the important access boundaries.
2. Test other websites; do not optimize specifically for Shopee.
3. Agent-triggered finalization should be the normal path, with less aggressive
   automatic fallback.
4. Continue working when Jon sends suggestions; those messages are not a request
   to stop. This handoff, however, was explicitly requested.

Install verified binaries without restarting production. Let Jon restart them.
Do not introduce automatic handover/restart scripts. Never erase journals or
force-release uncertain ownership to make a test pass. Browser debugging should
start with the original plugin implementation/caller behavior.

## Deployment Boundary

**Running and installed:** `0.0.0-dev-202609111612`, confirmed after Jon restarted:

```sh
curl -fsS --max-time 5 http://127.0.0.1:4097/global/health
```

- Binary: `/usr/local/bin/tandem`
- SHA256: `6cf80a495285a66045baa0a193fcb4927b024aef1c44535d640897ed83721000`
- Built artifact: `packages/opencode/dist/opencode-linux-arm64/bin/opencode`
- Rollback: `~/.local/share/tandem/chrome-rollout-20260911/explicit-finalize/tandem.before`
- Rollback is the previous `...1513` binary, SHA256
  `92caed186154aafb476cdfb2e16182184ecd1517b2f1c746d3b495fd71affeec`.
- Browser binding: `personal-chromium-original`
- Native root: `~/.local/share/tandem/chrome-original`, IPC in its `ipc` directory.
- Native host/registration were not changed for this update.

**The newer approval-reduction changes described below are UNFINISHED SOURCE
ONLY. They have not been built or installed.** Do not confuse the current
worktree with the running binary or its passing pre-approval test baseline.

The scratch filesystem is nearly full (about 146 MB free at one check).
An attempted backup under `/tmp/tandem` failed before installation; only that
incomplete backup was removed. The successful durable backup is above. Do not
bulk-delete scratch directories: many contain historical failure evidence.

## Completed And Deployed

### Original Guidance

Expanded `packages/core/src/plugin/skill/chrome-browser.md` using the pinned
original plugin's canonical `control-chrome/SKILL.md` and runtime documentation:
`api-use-behavior`, `browser-safety`, `browser-troubleshooting`, and
`browser-control-interruption`.

Added economical observation, grounded targeting, dialog inspection, saved-state
verification, login handoffs, and recovery rules, adapted to supported Tandem
actions. It is still a static skill, not Codex's dynamic `chrome.documentation()`
mechanism. The historical successful Shopee session did load the skill: its
recorded call was `skill({name:"chrome-browser"})`, status `completed`.

### Explicit Finalization And Gentle Fallback

Files:

- `packages/chrome-bridge/src/tools.ts`
- `packages/chrome-bridge/src/controller.ts`
- `packages/chrome-bridge/src/errors.ts`
- `packages/core/src/browser.ts`
- Shared skill above
- Bridge `test/tools.test.ts`, `test/controller.test.ts`
- Core `test/browser.test.ts`
- Legacy `packages/opencode/test/tool/browser.test.ts`

Behavior:

- New `browser` action `finalize`, explicit `browser` required.
- Agent calls `keep` for handoff/deliverables, then `finalize` before responding.
- It awaits permission, original page-engine cleanup and native verification.
- Explicit finalization closes unmarked agent tabs; user tabs survive.
- The binding is finished for that execution. Repeated finalization returns the
  cached report, including failures, without retrying cleanup. Further browser
  actions on that binding require a subsequent execution.
- Automatic execution-end fallback uses `preserveUnmarked: true` to hand off
  unfinished agent tabs instead of closing them.
- Low-level `BrowserTurn.end()` retains its original explicit close-unmarked
  default; only the tool fallback opts into preservation.
- Closing a Location/session releases confirmed retained handoffs to the user.
- Blocked prior turns report `cleanup_unconfirmed`, including after a failed
  close, rather than misleading `tab_owned`/`disconnected` messages.
- Controller cleanup reports have stages: preservation, settlement, page cleanup,
  authorization, completion, verification. A sanitized bridge `reasonCode` is
  included when available; raw page/native errors are not exposed.

Pre-approval-change verification: **179 bridge tests / 2117 assertions, 13 Core
tests, 3 legacy tests, bridge/Core typechecks, full embedded-web ARM64 build and
version smoke test passed**. Logs: `/tmp/tandem/browser-finalize-*.log`.

### Live Verification After Restart

The new server passed discovery, creation, inspection, typing, screenshot,
semantic click and explicit finalization on the real signed-in Shopee site.

**Typing finding, now established:**

1. The initial input is exposed as textbox `City, District`.
2. After selecting the city, its placeholder/accessibility name becomes the
   selected city name (in this test, `Thành phố Hồ Chí Minh`).
3. Reusing `internal:role=textbox[name="City, District"s]` then fails. That exact
   failure was reproduced before the restart.
4. After the restart, a fresh `inspect` exposed the renamed textbox and its ref.
   Typing `Bình` through that fresh ref succeeded, and a screenshot verified the
   text and filtered search results. This searches locations globally; it is not
   evidence that typing only filters the currently selected city's wards.

Thus the observed failure is stale semantic targeting, not proof that the field
is non-editable or that Tandem cannot type into it. No site-specific workaround
or typing-engine patch was added. The agent should inspect after state changes.

Only a fresh New Address dialog was used. No personal fields were filled, no
Submit was clicked, and no saved/default addresses were modified. Cancel was
clicked after diagnosis. The fresh diagnostic tab was then explicitly finalized:

```json
{"action":"finalize","outcome":"confirmed","cleanup":{"confirmed":true,"tabs":1,"retained":0,"nativeConfirmed":true,"stage":"verification"}}
```

There are **no unfinished tabs from this last diagnostic execution**. Earlier
blocked tabs/journals remain separate. Do not reuse any alias from this transcript.

No live tests on other websites were completed in this checkpoint. Jon explicitly
requested those next; use general form/search sites and cross-origin fixtures.

## Unfinished Approval Reduction

Current source changes, **not deployed**:

- `Capability` in `chrome-bridge/src/controller.ts` now also allows `site`.
- `BrowserToolOwner` authorization in `chrome-bridge/src/tools.ts` still validates
  trusted source identity, browser/session, signal and execution/lifecycle first.
- Empty agent-tab creation and ownership cleanup/handoff are auto-approved after
  those checks. Cleanup-only discovery is auto-approved for automatic lifecycle
  or a source whose action is `finalize`.
- Routine `read`, `input`, `navigation`, `screenshot` requests become a `site`
  approval. Navigation normalizes the destination origin/frame origin.
- `BrowserToolExecution.authorize()` caches promises for approvals by browser,
  capability, document origin and frame origin **within the execution only**.
  Concurrent matching requests join. Denied, cancelled and rejected approvals
  are removed. Signals are rechecked. Claims deliberately bypass this cache.
- `Source` now records the tool action so explicit-finalization discovery is
  distinguishable from model-requested tab discovery.
- `packages/core/src/browser.ts:permissionRequest()` describes site access as
  control for this browser turn (read/click/type/navigate/screenshot) and tab
  discovery as listing for this turn. Resource scopes use new capability `site`.
- `packages/app/src/utils/browser-grant.ts` and its test recognize saved `site`
  grants. Existing per-capability grants are not automatically converted.

Review this design before finishing, particularly:

- Keep first site access, cross-origin/frame access and each user-tab claim gated.
- Site access is not blanket user authorization to purchase, send, delete, change
  access, or submit sensitive data. Model/task-level confirmation rules remain.
- Check cancellation of a shared pending approval, per-turn expiry, revocation
  expectations, denied approval eviction, source attribution and cross-runtime
  isolation. Do not weaken those tests to reduce prompt counts.
- Check that creation is genuinely blank-agent-tab creation; navigation to the
  requested URL remains site-gated.
- The new claim test reveals additional prompts inside the real claim path.
  Trace their origin/scope before deciding whether they are redundant. Do not
  deduplicate genuinely different tab/origin approvals merely to match a count.
- Update skill/feature documentation for the finalized new policy. The currently
  deployed skill's permission section still describes the granular policy.

### Current Checkpoint Test Results

Run tests from package directories, not repo root.

| Check | Result | Log under `/tmp/tandem/` |
| --- | --- | --- |
| Bridge `bun test test` | **181 pass, 1 fail**, 2119 assertions | `browser-approval-handoff-bridge.log` |
| Core `bun test test/browser.test.ts test/tool-browser.test.ts` | **11 pass, 2 fail** | `browser-approval-handoff-core.log` |
| Legacy `bun test test/tool/browser.test.ts` | **2 pass, 1 fail** | `browser-approval-handoff-legacy.log` |
| Bridge `bun run typecheck` | Pass | `browser-approval-handoff-types.log` |
| App `bun test --preload ./happydom.ts ./src/utils/browser-grant.test.ts` | **2 pass** | `browser-approval-handoff-app.log` |
| `git diff --check` | Pass | Tool output |

Failing checks:

1. Bridge new test `one real tool approval covers inspection, input and capture;
   claims stay separate`, around `test/tools.test.ts:430`: expected
   `[discovery, claim, site]`; actual has an extra `discovery, claim` before `site`.
   Capture itself now passes. Earlier the test forgot `screenshotVerified`; that
   fixture setup was fixed with `fixture.owner(fixture.directory, true)`.
2. Core `browser.test.ts:96`: typed permission failure after dispatch expectation
   no longer sees the intended failure, because the tested granular capability
   has become a grouped `site` request. Adapt the scenario while preserving the
   original Effect cause and operation-alias assertions.
3. Core `tool-browser.test.ts` parallel-source/permission-defect test times out.
4. Legacy `test/tool/browser.test.ts` invocation-ask/permission-defect test times
   out. These tests wait for permission during `create`, which now auto-approves;
   move their synchronization to a genuinely permission-gated operation. Maintain
   coverage for separate source invocations and a denial after actual dispatch.

New bridge tests cover distinct origins/frames/turns and concurrent sharing, real
tool approval counts, and denied-site retry. The origin test uses example.com,
wikipedia.org and an embedded.example.org frame as **synthetic scopes**, not live
site evidence. Tests updated for automatic cleanup no longer expect a handoff
approval; low-level controller granular-permission tests remain separate.

## Historical Blocked Lease

Before the restart, `resume` and even `discover` returned `tab_owned` because the
same session's prior turn remained blocked with `preservationPending:true` in the
native journal. A failed tools binding subsequently called `session.close()`,
also setting `closing`; the new diagnostic order avoids masking that as a
disconnect.

This has **not been reconciled**. Restart allowed fresh discovery/creation but
does not prove old handoff recovery. We did not claim or mutate the old tab.

Original extension source provides one concrete failure case:

- `finalizeTabs` calls `gg(keep, setOfCurrentSessionTabIds)`.
- It rejects a keep entry for a tab that no longer exists.
- Our controller likewise requires every selected keep tab to be observed and
  valid before completion. A user-closed retained CAPTCHA tab is a plausible
  explanation, but was not proven to be the exact cause of this old failure.

See `/tmp/tandem/extension-background-readable.js:9722` and `:10265`, and
`controller.ts:end/observe/closeSession`. Any recovery must independently verify
leases/targets and distinguish unfinished pre-finalization work from an unknown
already-dispatched completion. Never repeat browser input or clear journals.

## Sources And Evidence

- Canonical original skill:
  `~/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247/skills/control-chrome/SKILL.md`
- Formatted original service: `/tmp/tandem/original-browser-service.mjs`
  (`api-use-behavior` around 1876; original fill handler around 32585;
  runtime docs assembly around 44457).
- Formatted original client: `/tmp/tandem/original-client-readable.mjs`
  (locator fill/type around 4098; focused DOM/CUA typing around 4815/4880).
- `packages/chrome-bridge/src/original-page.ts` and `src/original-exports.js`:
  Tandem adapter over original engine. Targeted replacement uses original fill.
  Focused `cua.type`/`dom_cua.type` are still not exposed by Tandem's tool.
- Previous private successful Shopee transcript:
  `/tmp/tandem/shopee-session-review.json`, session
  `ses_f72016fa1fferSoySJfxYJ0BAd`. Contains personal data; do not dump or copy it
  into public docs. Saved review images `shopee-review-shot2.png` and `shot3.png`.
- Feature docs: `packages/chrome-bridge/README.md`,
  `notes/chrome-original-repair.md`, `notes/chrome-extension-phase-4-evidence.md`.
  README deployment/testing paragraphs predate this latest successful live test;
  update them once the approval work is finished, avoiding readiness overclaims.

Additional known issue from the earlier review: loading a built-in skill samples
unrelated project files because legacy skill registration uses `location:
"<built-in>"` and the skill tool resolves its directory as `.`. Not fixed here.
Do not accidentally present those sampled files as browser resources.

## Suggested Continuation

1. Inspect the unfinished authorization diff, then prioritize a real agent session
   making actual browser tool calls. Record the approval prompts and user-visible
   outcomes, especially claim duplication, site changes and finalization.
2. Finish and verify the general policy through that session flow on multiple
   real websites, not Shopee-specific selectors. Use a separate test server/browser
   where feasible. The production browser has a single native controller: do not
   open a competing raw-CDP/native control path against its protected tabs.
3. Verify the changed behavior with real agent/tool calls in session. Do not
   write or run low-level tests without Jon's explicit request. If a build or
   focused post-change typecheck is necessary, keep it subordinate to getting
   the real workflow working; it is not a substitute for that verification.
4. Build with `bun run script/build.ts --single --skip-install` from
   `packages/opencode` (includes embedded web UI), install verified binary with a
   durable rollback copy, and ask Jon to restart. No automatic process signals.
5. Continue safe historical-lease reconciliation separately; report it as pending
   until an actual recovery acceptance passes. Current explicit finalization's
   successful live test is not proof of historical recovery.
