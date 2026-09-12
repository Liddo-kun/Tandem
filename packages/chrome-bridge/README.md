# Tandem Chrome Bridge

This private package combines Tandem's native-messaging host, reliable browser
controller and model-tool adapter with the pinned original Chrome plugin's page
engine. The Tandem server imports the original `browser-service.mjs` plus a
reviewed export shim; Tandem retains transport, authorization, operation
ownership and lifecycle recovery. The copied original `browser-client.mjs` and
WASM files are provenance/reference assets, not active runtime imports. The
opt-in `browser` tool is wired into legacy and V2 session runtimes. The repaired
page engine and close/reopen recovery are deployed and have passed their recorded
interaction/recovery checks. The latest explicit-finalization update is installed
as `0.0.0-dev-202609111612`, also verified running after Jon's manual restart.
The approval-reduction source has passed isolated real-site HTTP session checks;
see the current rollout checkpoint below for its deployment boundary. Personal client
scope is the web UI and Android; Electron, iOS and Android Chrome are not current
targets. See [installation](INSTALL.md).

No Codex executable, original native-host/`node_repl` binary, Codex config,
account service or replacement for `webfetch` is involved at runtime. OpenAI's
full host-plugin API is not exposed. See the detailed
[source comparison](../../notes/chrome-original-repair.md).

## Documentation

Inspection calls match the original client's timeout arguments: neither
`playwright_dom_snapshot` nor `dom_cua_get_visible_dom` receives a Tandem timeout
override. The unchanged original handlers own their defaults and clamping logic;
the semantic snapshot defaults to 3,000 ms. Tandem's outer operation, approval,
and cleanup budgets remain separate lifecycle safeguards, not replacement page
timeouts. Removing the former `timeout_ms: 10_000` does not establish the cause
of the recorded Codex Shopee timeout or promise a longer effective deadline.

Verified in isolated source session `ses_f69a74cfeffeYr8NTE146SkRcS`: a real
`gpt-6-astra` agent successfully requested visible and semantic inspections on
Python.org and docs.python.org, then finalized with native-confirmed cleanup and
zero retained tabs. Evidence: `/tmp/tandem/browser-timeout-parity/`. This confirms
the default inspection paths work, not the exact timeout duration under failure.
No production restart, installation, or synthetic tests were performed.

### Guidance Provenance

`src/documentation.ts` selects the pinned original Chrome documents and retains
compatible prose verbatim, including API Use's "After an interaction, obtain the
cheapest state check needed for the next decision" and "Do not request every
representation by default." Its exact replacements adapt unavailable JavaScript,
AX/history, and lifecycle APIs. The separate **Tandem JSON API Adaptation** section
documents the callable JSON contract, not purported original instructions.

The original `accessibility` document's "Batch as many actions as possible" rule
is AX-specific and is not selected for Chrome or imported here. Ordered execution
instead follows the original client's awaited `send` methods and actual Codex
CUA sequences (transcript lines 106/126/136/146/158: 5/2/3/3/2 actions per call).
The execute-only interface remains; duplicated known-form-field instructions are
removed from description/schema/docs, and the bootstrap skill no longer repeats
execution guidance. The existing 16-step/65,536-byte bounds are unchanged.

Measured against the recovered good tree and its delivered Python.org document:

| Model-facing text | Before characters | After characters |
| --- | ---: | ---: |
| Tool description | 1,064 | 141 |
| Schema descriptions, newline-joined | 2,127 | 1,913 |
| Skill | 2,635 | 2,020 |
| Complete delivered documentation | 17,751 | 15,570 |
| Sum (not tokens or serialized schema size) | 23,577 | 19,644 |

The explicitly inventoried grouping/new-state instructions fell from 8 occurrences
to 1: known-form-field grouping 3 to 0; new-state stopping 5 to 1. This is not a
count of every browser safety/API instruction. Exact wording, counting script,
source origins, fresh natural real-agent outcomes (including Wikimedia's capture
failure), and verified private-infrastructure shutdown are recorded in
`/tmp/tandem/browser-guidance-recovery/results.md`. Python.org verified all four
fields and retained the unsubmitted form; both agents naturally grouped four
entries plus inspection. No universal grouping or token-parity claim is made.

### Ordered Browser Execution

The model-facing page-input surface is `action: "execute"`, not optional batching
alongside single-action input tools. It has a required outer `tab`, optional `browser`, and 1-16
sequential `steps`. Steps use the ordinary arguments for `click`, `dblclick`,
`move`, `drag`, `type`, `key`, `scroll`, `navigate`, `read`, `inspect`, or
`screenshot`; they inherit the outer tab/browser and cannot contain `browser`,
`tab`, or nested `steps`. The aggregate serialized steps limit is 65,536 UTF-8
bytes.

The shared Core schema used by both runtime leaves exposes those input actions
only inside `steps`; bridge admission also rejects them at top level. Observations,
discovery, claim/create/resume, status, keep and finalize remain top-level actions.
No compatibility alias for `batch` is advertised or accepted. This changes the
agent's execution unit, not just a preference sentence. A one-step execution is
still legitimate at a new-state decision boundary.

Source rationale: the original client's CUA methods await `send`, and the recorded
Codex form interaction at transcript line 106 awaits click/type/click/type/click
in one REPL call without intervening observation. Tandem represents that straight-line
execution as data rather than introducing model JavaScript. It reuses the existing
sequential runner and original page handlers, including focused insertion versus
targeted replace semantics; the original native host/REPL binaries are not ported.

Fresh normal HTTP legacy sessions with genuine `openai/gpt-6-astra`, medium, filled
the real Python.org and Wikipedia/Wikimedia registration forms using fictitious
data without submission. Neither task prompt mentioned batching, execution steps,
tools, or efficiency. Both independently emitted one `execute` containing four
targeted field entries plus a final inspection, followed by a visual verification
screenshot. Sessions `ses_f6c321cc2ffePrk47W6PRnW21h` and
`ses_f6c300d69ffep9SuLQ69c9X37A` each used 9 browser calls / 11 model responses,
with input growth (including cached input) of 8,069 and 8,354 tokens respectively.
Both explicitly finalized with native-confirmed retention of the unsubmitted form.
The isolated harness's first Wikipedia attempt stopped at its missing
`auth.wikimedia.org` permission allowlist entry; after correcting the harness, the
fresh task above passed without replaying the interrupted session.

This proves natural grouping for these two multi-field workflows, not universal
model behavior, Codex token parity, or a matched before/after form benchmark.
V2 shares the schema but was not live-verified in this correction. Production was
not installed or restarted. Evidence, exact prompts/call IDs, screenshots and
provider usage: `/tmp/tandem/browser-efficiency-natural-results.md` and
`/tmp/tandem/browser-efficiency-natural-metrics.json`. Post-live bridge/Core
typechecks passed; no unit tests or synthetic fixtures were written or run.

Every step is validated before dispatch. Existing action handlers then run in
order with their authorization, native deadlines, cancellation, alias checks and
inspection invalidation unchanged. The first error or unknown outcome stops the
batch and reports the completed count plus the 1-based failed step and its
action/code/outcome/operation. There is no rollback, replay, parallel execution,
atomicity promise, or JavaScript API.

`read`, `inspect`, and `screenshot` are observations and may occur at most once,
only as the final step. Their result is delivered through the normal channel with
a compact batch prefix; screenshot retains the existing single managed-image
channel. Batch only independently grounded actions. UI, navigation, document, or
viewport-geometry changes require a fresh observation before dependent input.
Prefer `read` for known text/attributes and `detail: "page"` only when full
semantic page text is needed. A screenshot may precede the resulting paint; if it
appears visually stale, obtain the cheapest subsequent observation needed and
never replay the input.

As part of this contract, default `inspect` remains bounded visible controls with
refs/view only, while `detail: "page"` returns semantic page text with the current
view/viewport metadata but an empty elements/ref set. Inspection invalidation is
unchanged.

Earlier optional-batch verification (not proof of natural multi-field grouping) used normal HTTP-admitted legacy sessions with genuine
`openai/gpt-6-astra` at `medium` on Python.org and Wikipedia, not fixtures or direct
controller calls. The exact Python workflow reduced context growth from 19,650 to
16,059 tokens and browser calls from 13 to 11 versus baseline. The exact Wikipedia
workflow reduced browser calls from 10 to 8, but context growth increased from
8,943 to 18,914 because the model chose a batch-final full-page observation whose
51,358-character semantic result was delivered successfully. Shorter documentation
and targeted-read guidance do not guarantee that the model will avoid a large page
inspection; callers still need to choose the cheapest sufficient final observation.

Real Wikipedia field acceptance confirmed strict nested-step schema rejection before
step 1, malformed-later-step whole-batch prevalidation, successful semantic/read
final observations, and stale-ref partial stop without replay. A deliberately denied
cross-origin navigation preserved bridge/tool metadata `completed=1`, `failedStep=2`,
and `failedAction=navigate`; a same-session `resume` and subsequent page observation
proved the preceding fill persisted. A final fresh real-agent denial run also verified
the durable synthetic model-facing history text: the continuing model recognized
`permission_denied`, `outcome=not_dispatched`, `completed=1`, `failedStep=2`,
`failedAction=navigate`, that the outcome referred to the failed step, and that the
earlier completed step was not rolled back or to be replayed. This text remained
distinct from the generic permission rejection.
Batch-final screenshot delivery also remains render-timing-sensitive: an immediate
screenshot after fill showed the prior field value, while a semantic inspection and
ordinary follow-up screenshot, without replaying input, showed the new value. All
completed workflows explicitly finalized with native-confirmed cleanup and zero
retained tabs. Evidence is in
`/tmp/tandem/browser-efficiency-final-candidate-results.md` and
`/tmp/tandem/browser-efficiency-denial-failuretext-results.md`; no unit tests were run.

Aliases remain opaque internal handles. Callers must use returned values exactly
and never invent, parse, reconstruct, or shorten them.

### Targeted Reads And Focused Input

Implemented in source and verified through real legacy agent sessions on Example
Domain, IANA, httpbin and Wikipedia. Installed as `0.0.0-dev-202609112229`,
with the installed SHA matching the build. Production was not restarted; runtime
activation and V2 live verification remain pending. Rollback:
`~/.local/share/tandem/rollbacks/browser-features-20260912-052943/tandem.before`.
Both legacy and V2 leaves consume the same `Browser.Input` schema from
`packages/core/src/browser.ts`. After the live runs, `bun typecheck` passed in
both `packages/chrome-bridge` and `packages/core` (`tsgo --noEmit`, no diagnostics).
No unit tests or production restart were performed for this update.

The additive tool API is:

```json
{"action":"read","tab":"<current tab alias>","selector":"<observed selector>","read":"innerText"}
{"action":"read","tab":"<current tab alias>","selector":"<observed selector>","read":"getAttribute","attribute":"href"}
{"action":"type","tab":"<current tab alias>","text":"insert at current focus"}
{"action":"key","tab":"<current tab alias>","key":"Enter"}
```

`read` supports `innerText`, `textContent`, `getAttribute`, `count`, `isVisible`
and `isEnabled`. `attribute` is required only for `getAttribute`; `ref`, `frame`,
`detail` and arbitrary JavaScript are not accepted. Use observed frame-traversing
selectors where needed. The structured result is `{ action, outcome, tab, read,
value, untrusted: true }`; both runtimes deliver strings as readable multiline
model text. Existing result byte limits remain; oversized results fail instead of
silently clipping. Reads neither replace inspection handles nor mint new ones.

Original handlers are called unchanged: `playwright_locator_inner_text`,
`playwright_locator_text_content`, `playwright_locator_get_attribute`,
`playwright_locator_count`, `playwright_locator_is_visible`, and
`playwright_locator_is_enabled`. The adapter normalizes `{count}` or `{value}` to
`value`, retaining string/null/number/boolean distinctions. Text and attribute
reads retain original single-element resolution/error behavior. Count includes
all matches; visibility/enabled inspect the original first match, returning false
when absent, not enforcing uniqueness. `getAttribute` returns attributes rather
than live properties and retains the original protected-credential `value` guard.

Focused `type` omits both target fields **and mode** and calls original
`dom_cua_type({text})`. It inserts at the caret/selection, potentially through the
original rich-text paste path; it is not append-to-end or replace-all. Empty text
does not clear. Targeted type still requires `mode: "replace" | "append"`.
Focused `key` omits both target fields and uses original `dom_cua_keypress`.
Supplying both ref and selector, or a mode for focused typing, is rejected before
connection/permission/native dispatch. Establish focus by observed interaction;
document checks cannot guarantee that page scripts or the user have not moved it.

The controller routes reads through existing `read` authorization and focused
input through existing `input` authorization, with unchanged session ownership,
document/revision checks, deadlines, duplicate settlement and uncertain-operation
quarantine. Reads check the document again before returning values. No vendor,
export-shim, native host, client protocol or cleanup allowlist changes are needed:
these original handlers use already-supported native calls. No blind input retries,
new grants, evaluation API or clipboard API are introduced. Static documentation
continues to require a complete read without treating it as execution permission.

#### Original Source Contract

Always reference the pinned Codex plugin before extending this adapter: preserve
its behavior and reuse its handlers rather than implementing a parallel engine.
The original service prefix is pinned by SHA256
`3027e8e47d3241f8fde99078a9ced4647ac1732b614b3704628405236f8ac18b`;
the appended export shim dispatches the existing `WB` command registry unchanged.
Exact locations below refer to `vendor/original/browser-service.mjs` (large
minified lines; handler names disambiguate them):

| Tool read/input | Original handler and line | Original return/behavior |
| --- | --- | --- |
| innerText | `s1`, `playwright_locator_inner_text`, 1013 | `{value: string}`; empty string if element has no innerText |
| textContent | `p1`, `playwright_locator_text_content`, 1013 | `{value: string or null}` |
| getAttribute | `i1`, `playwright_locator_get_attribute`, 1013 | Requires `name`; `{value: string or null}`; protected credential value returns null |
| count | `au`, `playwright_locator_count`, 983 | `{count: integer}` from all matched elements |
| isVisible | `lu`, `playwright_locator_is_visible`, 983 | `{value: boolean}` from `readElementState(..., "visible")` |
| isEnabled | `uu`, `playwright_locator_is_enabled`, 983 | `{value: boolean}` from `readElementState(..., "enabled")` |
| focused type | `tw`, `dom_cua_type`, 1006 | Calls `uo`, returns `{}` after original paste path |
| focused key | `Ek`, `dom_cua_keypress`, 1006 | Original `li` handling or `cua.dispatchKeyPress`, returns `{}` |

`readElementState` at line 1084 uses the first match, false for absent/disconnected
elements. `uo` at line 963 validates text, chooses original rich-text behavior,
and serializes paste through the original clipboard bridge. Single-element reads
use `evaluateOnPlaywrightSelector`/`evaluateOnPlaywrightSelectorWithTarget` at
1049, while count/state use `evaluateOnPlaywrightSelectorAll` at 1071. Their
original selector resolution, waiting and error behavior remain active; Tandem
does not add a catch-and-retry loop. The existing controller sanitizes engine
errors into categories such as `element_stale`, `element_ambiguous`,
`element_unavailable` and `engine_error`, preserving native uncertainty rather
than returning empty values on failure. Original client locator methods at
`vendor/original/browser-client.mjs:7` confirm `{value}`/`{count}` unwrapping;
that client remains reference-only, not a second runtime dependency.

#### Live Evidence

The fresh source HTTP server on `127.0.0.1:4117` loaded these changes through
normal legacy HTTP-admitted sessions using genuine `openai/gpt-5.6-sol` and the
isolated doc12 Chromium/native-host transport, without a substitute provider or
page engine. Each completed session followed skill/full-document bootstrap and
explicit finalization; all had `confirmed=true`, `nativeConfirmed=true`, and
`retained=0`. Existing user tabs were not claimed.

| Session | Observed result |
| --- | --- |
| `ses_f6d8e18d2ffer2RLU5dOsc43y5` | All six reads on Example Domain; missing title attribute null, paragraph count 2 and first-match booleans; IANA navigation, heading and RFC href reads |
| `ses_f6d8d1b32ffeFpcOpGPn7wKxDp` | httpbin caret insertion ABCD -> ABCxD, selection replacement -> ABCYD; empty focused text unchanged, targeted empty replace cleared; Wikipedia focused capybara search navigated to article and targeted reads succeeded |
| `ses_f6d895b1bffe4PkpnVtcCu6bnT` | Invalid innerText+attribute, getAttribute without attribute, and focused type+mode each returned unsupported/not_dispatched; semantic snapshots proved SAFE unchanged |

Evidence and transcript paths are indexed in
`/tmp/tandem/browser-features-results.md`, including an earlier validation run
and a bootstrap cancelled before interaction. The parent stopped only the
isolated source/browser processes after confirmed cleanup; production native-host
registration was unchanged. This is legacy evidence, not V2 acceptance. Credential
suppression, rich-text/contenteditable, absent-locator false/zero, oversized reads,
and ambiguous text rejection remain source-backed but not exercised by these runs.

### Complete Mouse Interaction

Implemented and verified for the exercised workflows in four independent real
legacy agent sessions on Python.org, Wikipedia and OpenStreetMap. Post-live
source review found no new concrete adapter defect; focused `bun typecheck` in
`packages/chrome-bridge` and `packages/core` both passed (`$ tsgo --noEmit`, exit 0,
no diagnostics). This mouse update has not been built, installed or activated in
production. No unit tests were written, modified or run; no production restart.
The reads/focused-input installation checkpoint above is separate. V2 and the
remaining mouse edge cases below are not covered by this acceptance.

Both runtime leaves inherit the shared `Browser.Input` additions without leaf
changes. The JSON API adds:

```json
{"action":"move","tab":"<tab>","view":"<current view>","x":120,"y":80}
{"action":"dblclick","tab":"<tab>","ref":"<observed ref>"}
{"action":"dblclick","tab":"<tab>","selector":"<observed selector>","modifiers":["Shift"]}
{"action":"drag","tab":"<tab>","view":"<current view>","path":[{"x":120,"y":80},{"x":160,"y":100},{"x":200,"y":100}]}
```

Coordinates above illustrate argument shape, not reusable page targets. `move`
means native movement/hover, with no click. `dblclick` accepts exactly one of ref,
selector, or x/y/view. `move` and `drag` are coordinate-only because the original
Chrome API has no locator/ref hover or selector drag method. No custom page JS,
geometry-derived substitute, added path interpolation, or separate mouse-down/up
API is introduced. Original drag presses left at the first point, moves held
through the remaining points, and releases at the last. A one-point path is legal
in the original and performs a press/release with no travel.

`button: "left" | "middle" | "right"` is exposed for selector/coordinate click
and selector dblclick only. Ref click/dblclick reject button/modifiers; coordinate
dblclick rejects button, and drag is always left-button. Optional `modifiers`
accepts up to five original names: Alt, Control, ControlOrMeta, Meta, Shift, for
selector/coordinate click/dblclick and move/drag. CUA receives these as `keys`,
Playwright as `modifiers`; coordinate click maps buttons to the original numeric
1/2/3 contract. The original platform mapping resolves ControlOrMeta to Control
on Linux. These are event flags, not synthetic key-down/up calls. Click counts
remain the original fixed 1 or 2 per action; arbitrary clickCount belongs to the
separate AX API and is not exposed here. Force/timeouts are not newly exposed.

#### Mouse Source Contract

Source traced back to the installed plugin named in `vendor/original/source.json`:
`~/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247/`.
Its `PROVENANCE.md` identifies OpenAI desktop 26.901.51231, extracted from the
official ARM64 Debian package, with the already-documented local scroll patch.
During source inspection the installed service hash matched the pin above, the
vendor service prefix matched those installed bytes, and the client matched
byte-for-byte. No vendor/importer/export-shim edits were needed.

Exact locations in `vendor/original/browser-service.mjs` (minified lines):

| JSON action / target | Original registry export, handler, command | Line / behavior |
| --- | --- | --- |
| move | `CuaMoveCommand`, `Cx`, `cua_move` | 948: finite x/y via `Ct`; `cua.dispatchMouseMove` with `rr(keys, platform)` |
| drag | `CuaDragCommand`, `hx`, `cua_drag` | 908: nonempty path, finite points via `Ct`; `cua.dragPath` |
| dblclick coordinates | `CuaDoubleClickCommand`, `fx`, `cua_double_click` | 908: `cua.clickPoint` with clickCount 2, left button, modifiers |
| dblclick ref | `DomCuaDoubleClickCommand`, `Tk`, `dom_cua_double_click` | 1006: `Yp(node_id)`, `cua.clickDomCuaNode` with clickCount 2 |
| dblclick selector | `PlaywrightLocatorDblclickCommand`, `n1`, `playwright_locator_dblclick` | 1013: `playwright.clickLocator(params, 2)` |
| click coordinate options | `CuaClickCommand`, `mx`, `cua_click` | 908: `px(button)` maps 1=left, 2=middle, 3=right; `rr(keys, platform)` |

All these command handlers return `{}` after awaited native steps; the original
browser-client methods return void. The existing `Tm` exports (908) feed `WB`
(4160), which the pinned appended `createBrowserEngine.execute` dispatcher reuses.
Original parameter/result schemas are at service line 963. `browser-client.mjs:8`
confirms `cua.move({x,y,keys})`, `cua.drag({path,keys})`,
`cua.double_click({x,y,keypress})`, `cua.click({x,y,button,keypress})`, and
`dom_cua.double_click({node_id})`; locator `dblclick({button,modifiers,force,timeoutMs})`
is at client line 7. The reference-only client adds diagnostic reads on locator
errors (`actionError`); Tandem does not run that client or claim those diagnostics.

Service `clickLocator` / `performPointerAction` (1084) retain original locator
resolution, visible/enabled checks, stable geometry, scrolling, frame traversal
and obstruction checks before native dispatch. Ref double-click retains original
live-node resolution (`Lw`) and frame handling, not a selector approximation.
The CUA methods at 4132 (`dispatchMouseMove`, `clickDomCuaNode`, `dragPath`,
`clickPoint`, `dispatchPressedMouseMove`) perform the actual native movement,
CDP input and count-1/count-2 press/release sequence. `dragPath` retains its own
best-effort release on a failed held move: initial movement and mouse-down are
outside its try/finally; a failure during the held-move loop attempts release at
the last assigned point and suppresses that cleanup error. The completion flag
is set before the normal final mouse-up, so a failed final release is not retried.
This is not a guaranteed rollback: cancellation/deadline/disconnection may prevent
release, and an uncertain drag must not be replayed. The 256-point cap is a resource
bound, not a guarantee a
long path will finish within the existing native deadline. No new retries or
cleanup permission bypasses were added.

#### Boundaries And Source Review

Tandem adds a bounded 1-256-point path and finite coordinate validation. All
coordinate clicks, moves, double-clicks and drag points require the existing
execution/tab-owned view token, unchanged document/origin/viewport, and bounds
`offsetX <= x < offsetX + width`, likewise Y. The same image-to-CSS mapping used
by existing captures grounds these coordinates. Every drag point is checked
before the original handler starts. Schema/argument failures are rejected before
connection. In the live runs, superseded view aliases failed locally with
`stale_handle/not_dispatched`; out-of-bounds move and drag returned
`unsupported/confirmed` because authorized native metadata reads had already
occurred. Their operation status was settled/unsupported, not successful input.
All drag points are checked before mouse dispatch; unchanged images and URL
support no visible mouse effect, without claiming raw input telemetry. A matching
view is not proof that animated content
has remained at the same position; inspect changed menus/results before acting.

Coordinate review: `metadata` uses `Page.getLayoutMetrics.cssVisualViewport`
client width/height and offsetX/Y. Existing screenshot mapping scales image pixels
into this CSS rectangle and adds its offset once; `view` checks the same rectangle.
No document scrollX/Y is added to input coordinates, and the original CUA handlers
receive them unchanged. Original visible-DOM clipping (service line 983) likewise
uses visualViewport.offsetLeft/Top plus width/height; original capture uses
pageX/pageY for its document-space clip, not as input coordinates. No speculative
offset conversion was added. Live coordinate selection exercised a non-unit
image-to-CSS Y scale (713/702) on a scrolled page (scrollY=138), but all captured
visual offsets were zero and browser zoom/viewport scale were 1. Nonzero-offset
and zoom input behavior remains unverified, not established by this source review.

Mouse-option review confirmed the original numeric coordinate-button mapping,
selector button strings, CUA `keys` versus Playwright `modifiers`, and original
ControlOrMeta platform resolution. Ref clicks remain optionless, coordinate
double-click and drag remain left-only, and no non-original retries were added.

The controller uses the existing input/site approval, per-tab lock, owned aliases,
native deadline, cancellation, operation settlement and quarantine. It retains
the existing engine-error classification and unknown-operation reporting rather
than swallowing failures or returning false success. Successful tool results use
the existing confirmed envelope, not a page mutation result or business-success
assertion. No host protocol, native registration, permissions, grant scope,
recovery loop, or ownership logic changed.

#### Live Mouse Evidence

Four normal HTTP-admitted legacy sessions used genuine `openai/gpt-5.6-sol` on
the fresh source server at `127.0.0.1:4117`, with the private doc12 Chromium/native
transport. No scripted provider, synthetic page, direct controller execution or
substitute browser engine was used. Each session loaded the skill, read complete
documentation and its end marker (version `5758f45ee70f50ce`, 15051 characters),
read the screenshots topic, discovered tabs, and created only its own temporary
tab. Discovery and the respective website were approved; no user tab was claimed.

| Session | Actual outcome |
| --- | --- |
| `ses_f6d5b1d6bffe0G6M0ZkQU7osZN` | Python.org Downloads hover menu opened without click and closed on moving away; ControlOrMeta hover opened Documentation. Ref double-click selected capybara, and focused replacement produced wombat. Two superseded view aliases were rejected before fresh observations. |
| `ses_f6d58bf14ffe6u9h66to4h68qD` | Six-point OpenStreetMap drag visibly panned London; center changed from `13/51.50740/-0.12780` to `13/51.49667/-0.15776`. |
| `ses_f6d577b5fffeTn9w4jcm8XQDnx` | Wikipedia selector double-click (button=left, modifiers=[]) selected kangaroo; focused replacement produced wombat. Coordinate double-click selected only bravo in alpha bravo charlie; replacement produced alpha delta charlie. No search was submitted. |
| `ses_f6d53dd8dffeTv0YWVSRfMlJX3` | Shift drag box-zoomed OpenStreetMap from level 13 to `14/51.50671/-0.11398` (1 km scale to 500 m). One-point drag was accepted without pan; saved RGB pixels after zoom, after one-point drag, and after invalid calls were identical. |

Intentional validation checks: ref/coordinate dblclick with unsupported button,
move without view, and drag with button returned `unsupported/not_dispatched`.
Empty path failed the tool schema's minimum-length check. Negative-X move and a
drag with an in-bounds start but out-of-bounds endpoint returned
`unsupported/confirmed` as explained above; the agent queried operation status.
No unknown outcome occurred and no unknown mutation was replayed. Modifier hover
proves acceptance and menu behavior, not independent telemetry of the Control bit;
Shift drag has visible modifier-dependent zoom evidence.

All four explicitly finalized with `confirmed=true`, `nativeConfirmed=true`,
`tabs=1`, `retained=0`. Only isolated source/private Chromium processes were stopped
after cleanup; production registration was unchanged. All 24 actual agent captures
and their view/mapping metadata are indexed in `/tmp/tandem/browser-mouse-evidence.json`.
Full outcomes, artifact paths, approvals and transcript references are in
`/tmp/tandem/browser-mouse-results.md` and
`/tmp/tandem/browser-mouse-{hover,map,selection,map-options}-transcript.json`.

Still unverified: V2, accepted middle/right-button behavior, every modifier variant
and exact event flags, 256/257-point boundary, cross-frame mouse actions, nonzero
visual viewport offsets/browser zoom, and cancellation/disconnection during held
drag. Successful source workflows and typechecks are not deployment evidence.

### Inspection Delivery

Installed candidate `0.0.0-dev-202609111958`, pending manual Tandem restart only.
No native-host/Chromium update is required. Bridge/Core typechecks and the full
embedded-web ARM64 build passed; live delivery after activation remains pending.

Default `inspect` uses the pinned original `dom_cua.get_visible_dom()` path, with
its own viewport filtering and 20,000-character/200-element budget. It no longer
automatically requests a full ARIA page snapshot too. `detail: "page"` explicitly
returns that semantic content when prices, notices or non-control text are needed.
It retains view/viewport metadata but returns no elements or refs. Default
inspection presents readable multiline controls with execution-owned refs, while
page detail presents semantic text. The duplicated structured `elements` array
stays out of model text. Bridge JSON remains available to internal callers.
Original commands do not accept the old `max: 10000` arguments; those ineffective
arguments are gone.

The original `playwright.domSnapshot()` returns a string, separately from visible
DOM. Its `lG`/`Qk` filter removes ref/cursor decorations, flattens empty generic,
listitem and group wrappers, and drops unnamed images. Tandem already reused that
filter through the original command; it did not solve output delivery. The native
client lets the caller choose which string to emit through `nodeRepl.write`, with
optional display character truncation. Tandem previously concatenated both reads,
duplicated controls and serialized everything as a single JSON line. A recorded
98,315-byte Shopee result therefore lost its entire preview at legacy's 50-KiB
whole-line boundary, which then explicitly instructed delegation.

Generic output limits and retained overflow files are unchanged. Browser overflow
now tells the owning agent to use Grep/Read directly, not launch a helper. Saved
model output is multiline and searchable. This does not add another summarizer,
raise the output limit, or expose page evaluation. Original source references:
`browser-client.mjs` methods `domSnapshot`, `get_visible_dom`, display helper `Qo`;
`browser-service.mjs` handlers `OI`/`FI`, `Yk`, filters `lG`/`Qk`.

### Pending Context Recovery Update

**Activated and verified on Lazada:** `...1734` completed the real homepage search
workflow, read catalog results after Enter, opened an observed product, captured
the product page, and explicitly finalized with native-confirmed cleanup and zero
retained tabs. This verifies the previously failing transition on that workflow;
it does not establish recovery of historical blocked leases.

Latest candidate: `0.0.0-dev-202609111734` with matching host, pending manual
Chromium/Tandem restart. Real Lazada tracing identified `Debugger unattached`,
not a destroyed-context error. Original `executeTargetCdp` recognizes that exact
string to reattach/retry once; Tandem's native error flattening prevented recovery.
The native boundary now preserves the category and the original-page adapter
restores only that confirmed CDP rejection to the original string shape. No
arbitrary native text or new input retry loop is exposed. Real-site acceptance
after activation is pending; `...1712` did not resolve the observed failure.

The earlier `0.0.0-dev-202609111712` update was activated but was insufficient.
Its retained `native.ts:rpcError` change preserves the original
engine's missing/destroyed execution-context error category as a canonical
`document_context_lost` message instead of flattening it into a generic RPC error.
This restores the original engine's ability to recognize dead context caches
without exposing raw native/page messages. Reference: original `nu`/`SW` and
Playwright `pD` recovery branches. Actual Lazada search input succeeded before
inspection/capture/cleanup failed; the original error was discarded, so this is
not yet proof of that site's root cause or recovery. See the latest
`notes/chrome-browser-handoff-20260911.md` checkpoint for artifacts and rollback.

### Runtime Documentation Delivery

Installed candidate `0.0.0-dev-202609112131`, awaiting Jon's manual Tandem restart.
The full embedded-web build and installed checksum/version checks passed; rollback
is retained as documented in the linked results. No Chromium/native-host update
or restart is needed. The shared `chrome-browser` skill is now
a short bootstrap directing the model to list configured browsers and read
`browser({ action: "documentation", browser: "<id>" })` before interacting.
The action returns actual model-visible text: selected configured binding,
applicable original guidance, named supplementary catalog, and the effective
Tandem JSON-tool reference. `topic` selects a supplementary document; optional
`offset`/`limit` read explicit character-range continuations after truncation.

`src/documentation.ts` reuses embedded prose and the original manifest selector
from the byte-pinned service via the appended export shim. It does not connect,
inspect tabs, start a native turn, ask permission, fetch remote overrides, or
advertise the original JavaScript API as callable. Configured identity is clearly
distinguished from verified profile identity. The original bytes remain unchanged.

There is no server-side already-read flag. Like the original's ordinary browser
operations, reading before interaction is an agent instruction, not a hard tool
guard. Full text is reused while present in model context; compaction/pruning or
genuine reconnection requires rereading. Static guidance is never replaced with
a receipt based on another session's read. Generic output budgets stay unchanged.

Real legacy model sessions verified bootstrap -> full-document -> interaction,
Wikipedia/httpbin input workflows, same-context reuse, named lookup/rejection,
stale-alias recovery, compaction reread, 8-KB continuation, and isolated Chromium
close/reopen recovery. Provider-bound capture matched the complete tool result.
V2 reached provider setup but could not run browser tools: its available catalog
lacks the working OpenAI model, and an advertised free fallback was rejected by
the provider. No production restart was performed. See
[results and limitations](../../notes/chrome-documentation-delivery-results.md).

Shopee's City/District typing failure was reproduced as stale semantic targeting:
selecting a city changes the textbox's accessible name. A fresh inspection and
returned ref successfully typed into the renamed control, verified by screenshot.
No saved address was changed. That checkpoint used the original locator fill
handler with a ref or selector; focused typing is now implemented in source as
described above, not established by that earlier live evidence.

### Explicit Finalization And Fallback

The source now exposes `finalize` (explicit `browser` required). First mark tabs
with `keep`, then call `finalize` before replying. It awaits permission, original
engine cleanup and native disposition verification, returning the cleanup report
to the model. Unmarked agent tabs close only on this explicit path. Finalization
ends this binding for the execution; repeated calls return its cached result,
including failures, without repeating native cleanup. Resume handoffs in the next
execution with fresh aliases.

If the agent omits finalization or is interrupted, the tool's automatic finalizer
requests handoff for unmarked agent tabs rather than closing them. Failed/denied
handoffs remain protected. Low-level controller callers retain explicit control:
`end({ preserveUnmarked: true })` opts into this fallback, while ordinary `end()`
keeps its original close-unmarked semantics. Closing a Location/session releases
confirmed retained handoffs to the user rather than deleting those tabs.

Blocked prior turns now report `cleanup_unconfirmed` instead of claiming another
session owns the tab. Controller-side failures report their stage (preservation,
settlement, page cleanup, authorization or completion) and a sanitized bridge
reason code when available. This improves diagnosis; it does **not** reconcile an
already-blocked lease or authorize replay. The lifecycle/skill update is installed
and running. Pre-approval-reduction verification: 179 bridge tests (2117
assertions), 13 Core runtime tests, 3 legacy tests, bridge/Core typechecks, and the
full embedded-web ARM64 build/version smoke test passed. Subsequent live Shopee
explicit finalization passed; historical blocked-lease recovery remains unverified.

Installed SHA256: `6cf80a495285a66045baa0a193fcb4927b024aef1c44535d640897ed83721000`.
Rollback binary: `~/.local/share/tandem/chrome-rollout-20260911/explicit-finalize/tandem.before`.
No browser/server restart, journal deletion or native-host registration change
was performed by the agent for this update; Jon restarted the server manually.
The existing historical blocked production lease remains unresolved.

### Approval Reduction

Installed and running: `0.0.0-dev-202609111651`, confirmed after Jon's manual
production restart. Normal browser calls subsequently verified form inspection,
typing, screenshot delivery and explicit native-confirmed cleanup. SHA256:
`6a2cfe5e2d737848d224d5f63481a7f645e83eccd7197142ea645f70c15464ae`.
Rollback: `~/.local/share/tandem/chrome-rollout-20260911/approval-reduction/tandem.before`.
The embedded-web ARM64 build passed; production was not restarted by the agent.

The tool adapter groups read/input/navigation/screenshot into `site` approval,
cached by browser, document origin and frame origin for one execution only.
Discovery is browser-wide for that turn, not re-prompted with a tab's origin
during claim verification. Claim approval is shared only within the exact
operation/descriptor/origin, so acquisition and attachment do not double-prompt;
another tab, operation or changed origin is separately gated. Resume without
descriptor scopes retains per-tab claim checks. Blank agent-tab creation and
ownership handoff/cleanup auto-allow after trusted-source/lifecycle validation.
Native creation is actually blank; requested-URL navigation remains site-gated.

Concurrent matching approvals join. Denial, cancellation and rejected approvals
are evicted; each waiting operation observes its own abort signal. Turn grants
expire at execution end. Removing a saved grant affects later turns, not an
already-approved current turn: stop that execution for immediate cancellation.
Site approval never authorizes purchases, sensitive submissions or other
consequential actions outside the user's task.

Isolated source verification on 2026-09-11 used a scripted provider through the
normal legacy HTTP session runner, real browser tools and the original engine in
real Chromium, not direct controller calls or mocked page results. Wikipedia
search typing/capture followed by httpbin form typing/radio selection needed
exactly **two** site prompts across **11** tool calls including finalization.
The next turn required Wikipedia approval again (**one** prompt); a subsequent
deliverable claim needed **three** prompts: discovery, claim, site. Every explicit
finalization returned native-confirmed cleanup. No form was submitted.
Evidence: `/tmp/tandem/browser-reduction-live.log` and its recorded session/project.
This verifies the session/tool path with deterministic provider output, not an
autonomous model's planning. Cross-origin frame checks remain supporting
regressions rather than fresh live frame evidence.

- [Personal installation and manual recovery](INSTALL.md)
- [Original source comparison and dependency inventory](../../notes/chrome-original-repair.md)
- [Phase 4 verification and rollout limits](../../notes/chrome-extension-phase-4-evidence.md)

- [Phase 3 implementation and evidence](../../notes/chrome-extension-phase-3-evidence.md)
- [Phase 2 controller plan](../../notes/chrome-extension-phase-2-plan.md)
- [Four-phase integration plan and current status](../../notes/chrome-extension-port-plan.md)

## Controller API

The package root exports `BrowserController`, `BrowserError`,
`CONTROLLER_LIMITS`, and public TypeScript types. Raw transport and CDP are not
package exports. The controller requires a trusted authorization callback;
there is no default allow-all policy.

The server-side page path is an adapter over the original low-level context,
Playwright, visible-DOM and CUA handlers, not Tandem's earlier custom HELPER
driver. Each page-engine instance receives a synthetic internal numeric tab ID;
the adapter translates it to the native tab ID at the transport edge. This
prevents the original bundle's module-global tab/world caches from colliding
when separate browsers happen to use the same Chrome tab number.

Trusted-caller happy path (the callback and fixture URL come from your harness):

```ts
import { BrowserController, type Authorize } from "@tandem/chrome-bridge"

async function example(directory: string, fixtureURL: string, authorize: Authorize) {
  const controller = await BrowserController.create({
    connections: [{ id: "fixture", label: "Isolated Chromium", directory }],
    authorize,
  })
  try {
    const session = await controller.openSession({
      browserId: "fixture",
      callerSessionId: "trusted-session",
    })
    const turn = await session.beginTurn({ callerTurnId: "trusted-turn" })
    const tab = await turn.createTab({ url: fixtureURL })
    let page = await turn.inspect(tab)
    const input = page.elements.find((element) => element.label === "Name")!
    await turn.type(tab, { target: input.ref, text: "Replacement", mode: "replace" })
    page = await turn.inspect(tab) // Fresh refs after the page changes.
    const button = page.elements.find((element) => element.label === "Submit once")!
    await turn.click(tab, { target: button.ref })
    const image = await turn.screenshot(tab)
    const cleanup = await turn.end({ keep: [] })
    if (!cleanup.confirmed) console.warn(cleanup)
    await session.close()
    return image
  } finally {
    // Does not replay failed actions. Inspect cleanup independently of the original error.
    await controller.close().then(
      (cleanup) => {
        if (!cleanup.confirmed) console.warn(cleanup)
      },
      () => console.warn("Controller cleanup could not be confirmed"),
    )
  }
}
```

| Surface                                  | Behavior                                                                                                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browsers()`, `status()`                 | Explicit configured bindings, host epoch/health and bounded extension identity. Profile identity remains `unverified`; caller labels are not discovered profile names.                                  |
| `openSession()`, `beginTurn()`           | Trusted caller IDs mapped to separate opaque wire IDs; one active turn/session and one controller/host.                                                                                                 |
| `discoverTabs()`, `claimTab()`           | Separately authorized browsing-data discovery; claim an opaque descriptor, never an arbitrary numeric tab ID. Atomic ownership precedes debugger attachment.                                            |
| `createTab()`, `navigate()`              | Background agent tab; HTTP(S) navigation to DOM readiness. Returns final identity and `httpStatus: "unavailable"`, not an invented status. A failed create-with-navigation remains tracked for cleanup. |
| `inspect()`                              | Original Playwright/visible-DOM snapshot with bounded text, interactive ref aliases and frame information. A fresh inspection supersedes old refs.                                                      |
| `click()`, `type()`, `key()`, `scroll()` | Original locator/DOM/CUA handlers, explicit replace/append and allowed page keys. Click/type/key accept either a fresh returned `ref` or a bounded original Playwright `selector`; no mutation retry.   |
| `screenshot()`                           | Original capture path and screencast fallback, requested as PNG for Tandem's PNG-only media adapter; validated dimensions, mapping and opaque view token. No controller-created file.                   |
| `end()`, `resumeTabs()`, `close()`       | Deduplicated, bounded lifecycle completion; verified dispositions or explicit `cleanup_unconfirmed`.                                                                                                    |
| `events()`, `operationStatus()`          | Normalized owner-scoped events and original-operation settlement status, not raw page/event payloads.                                                                                                   |

Controller actions accept `{ signal, timeoutMs, permissionTimeoutMs }`. Model
operations allow at most five aggregate minutes for human permission waits; once
permission settles, the unused authorization allowance is removed and the
normal bounded native deadline covers queueing, preparation and dispatch. A late
permission reply cannot dispatch an expired operation, and no mutation is
replayed. Independent tabs/sessions can proceed concurrently; one tab's compound
operations cannot overtake each other. No native execution lock is held while
waiting for a permission decision.

Authorization capabilities are `discovery`, `claim`, `create`, `read`, `input`,
`navigation`, `screenshot`, and `handoff`. Requests carry the trusted browser,
caller session/turn, operation ID, tab origin, current document/frame origin,
optional navigation destination, and cancellation signal. Return `allow`,
`deny`, or `cancel`; exceptions and invalid decisions fail closed. Revalidate
after queueing or navigation. This is not a network firewall: redirects and
subresources can make network requests before a changed origin is observed.

### Input And Capture

- Supported editors are the ordinary inputs, textareas and contenteditable
  surfaces accepted by the original handlers. Password/file and specialized
  inputs remain outside Tandem's exposed contract.
- A returned `ref` is valid only for its original DOM observation. `selector`
  is an alternative for click/type/key and may use observed CSS or role/name
  selectors; frame traversal uses
  `>> internal:control=enter-frame >>`. Refs and selectors are not model-owned
  authorization or browser identities.
- Keys: Enter, Tab, Escape, Backspace, Delete, arrows, Home, End, PageUp and
  PageDown; optional Shift only. The intended element must already have focus.
  Clipboard and browser-global shortcuts are not exposed.
- Coordinate clicks take **viewport CSS pixels** and a current view token.
  Convert image pixels with `cssX = pixelX * mapping.scaleX + mapping.offsetX`
  (and the corresponding Y fields). Scroll deltas are CSS pixels as well.
- Capture uses the original engine's capture/screencast path but requests PNG
  rather than its JPEG default because Tandem's managed media channel is PNG-only.
  Coordinate mapping is measured, not assumed from raw DPR alone.
- `viewValid: false` means the image still represents its measured viewport,
  but that token cannot authorize coordinate actions. Obtain a new observation
  rather than reusing or silently rescaling it.
- Chromium 149 needs `--enable-features=CDPScreenshotNewSurface`, exposed by
  preparation as `--screenshot-new-surface`, for reliable background capture.
  Unflagged capture was unreliable. There is no `Page.bringToFront` fallback.
- Focus emulation is target-local renderer focus, not physical tab/window
  activation. The independent observer verifies physical selection throughout
  ordinary input/capture. **Tab/group disposal can change Chrome selection**;
  lifecycle cleanup is tested separately, not claimed to preserve foreground.

### Completion And Recovery

| Tab origin    | Default end                  | `handoff`                             | `deliverable`                |
| ------------- | ---------------------------- | ------------------------------------- | ---------------------------- |
| Agent-created | Close and detach             | Preserve for this session's next turn | Preserve and release to user |
| User-claimed  | Preserve, detach and release | Preserve for this session's next turn | Preserve and release to user |

Pass `{ keep: [{ tab, status: "handoff" }] }` to `end()`, then call
`resumeTabs()` in the same session's next turn. Resumption requires current
authorization and returns fresh handles. Session close releases retained tabs
as deliverables where that can be verified. Conflicting repeated end intents
are rejected. Keep intent is journaled **before** its authorization wait, but
only a matching authorized completion may finalize it; denial/crash never
falls back to destructive ordinary cleanup.

`BrowserError` includes `code`, `operationId`, and `outcome`:

- `not_dispatched`: no native step was submitted.
- `confirmed`: native responses established the submitted steps' outcomes;
  failure does not imply rollback of focus, scroll, or partial input.
- `unknown`: a submitted step may have taken effect. Query
  `operationStatus(error.operationId)`; never replay a mutation automatically.

Cleanup reports include `confirmed`, tab/retention counts and, when available,
`nativeConfirmed`, `stage` (`settlement`, `completion`, `verification`) and a
bounded numeric diagnostic code. A native acknowledgement alone is not a
verified disposition.

Controller loss with a live host permits exact-wire lifecycle reconciliation.
Host/worker/browser loss invalidates handles. The private, bounded write-ahead
journal uses atomic replacement and boot/process-start identity checks, but
does not claim power-loss durability. If prior-host ownership cannot be proven,
the replacement host preserves tabs and reports `cleanup_unconfirmed`; it does
not adopt recycled tab IDs or guess by URL. Inspect the isolated browser and
journal before any manual recovery. A fresh socket is not proof of cleanup;
do not delete recovery records merely to make discovery succeed.

Ordinary full Chromium close/reopen permits fresh actions in a later turn of the
same chat without restarting Tandem. The host uses kernel boot/start ordering:
a native parent born after an old host cannot own that host's leases. Historical
journals remain unchanged, with their original uncertainty, while new sessions
receive fresh wire IDs and handles. Native-host-only restart within the same
browser remains blocked for unresolved leases. Invalid evidence and resource
limits also remain fail-closed. Discovery skips provably dead process-identified
manifests without deleting them; ambiguous live hosts are not selected silently.

The tool owner retries failed initial connections and reconnects only disconnected
bindings. Direct controller callers can use `reconnect(browserId)` and open a
new session; existing sessions expose `connected` and never migrate. Old operation
status stays attached to its original transport/history. No input is replayed and
no old alias, ownership or grant is transferred. This is fresh-work recovery, not
automatic continuation of a failed action or restoration of an old handoff lease.
See the [candidate evidence](../../notes/chrome-original-repair.md#closereopen-candidate).

### Bounds And Exclusions

Limits: 8 sessions/browser, 16 tabs/session, 16 pending actions/tab, 128 pending
actions/connection, 15-second default / 30-second maximum action deadline,
40-second close budget, 100 discovery descriptors, 256 buffered owner events,
and 8192 UTF-8 bytes/URL. Inspection visits at most 2000 nodes, returns at most
200 refs, 64 KiB text and 128 KiB serialized output. PNG limits are 8 MiB encoded
and 64 MiB decoded; journal limit is 1 MiB. Oversize results fail explicitly.

The original snapshot/selector engine can traverse frames represented in its
output, including the tested same- and cross-origin fixture selectors. Tandem
does not expose the original plugin's full API. Arbitrary evaluation, public CDP,
general Playwright objects, full-page capture, clipboard, file transfers, pop-up adoption,
history/bookmarks, credential storage and sidepanel integration are excluded.
Screenshots containing unsupported foreign frames are rejected rather than
capturing unauthorized content. HTTP status is not observed by this driver.
Multi-step CDP input is not atomic against page scripts; document/geometry
changes can conservatively produce `target_changed` with partial effects.

## Historical Phase 2 Evidence

Phase 2's supported baseline passed on 2026-09-10 (tablet local date), using
Chromium `149.0.7827.102`, extension `1.26.901.11451`, and Bun `1.3.14`.
The aggregate gate returned **`phase2AcceptancePassed: true`** with 158 tests
across seven files, typecheck and formatting passing.

Final artifacts under `/tmp/tandem/chrome-bridge/`:

| Run                           | Result                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `p2-final4-a`                 | 32 assertions; DPR 2, zoom 1.25                                                                                              |
| `p2-final4-b`                 | 32 assertions; DPR 1, zoom 1                                                                                                 |
| `p2-final4-c`                 | 32 assertions; DPR 2, zoom 1                                                                                                 |
| `p2-final-user-g`             | 37 assertions; user-origin claims, frame reload, standalone click, wheel boundaries, nonzero scroll and never-ready deadline |
| `p2-final-fault-b`            | 12 recorded fault/disposition outcomes, including six tab dispositions and separate controller/host/worker/browser faults    |
| `p2-select-a` / `p2-select-b` | Four assertions over two independently prepared browsers                                                                     |
| `phase2-evidence.json`        | Combined package, browser, fault, selection, PNG/mapping, trace/hash and process-exit verification                           |

The final core series comprises three consecutive fresh passing runs. Earlier
diagnostic failures are not counted; reports/images remain available even where
bulky stopped profiles were pruned. Final DPR 1/2 and zoom screenshots were
visually inspected, as was `p2-final-user-g/controller-scrolled.png`. All owned
test browser/host processes were confirmed exited. Production registration
remained unchanged. These results establish the superseded custom page driver's
Phase 2 boundary, not readiness of the repaired original-engine build or
compatibility with other extension/browser builds.

Package tests use real streams and host subprocesses, plus a deterministic DOM
fixture executing the fixed helper. Only the live suites establish Chromium
compatibility; a synthetic peer is not browser evidence. The acceptance command
combines typecheck, formatting, deterministic tests, three fresh core suites,
an extended user-tab suite, dedicated faults and separate two-browser selection.
Individual evidence commands deliberately do not certify the whole phase.

| Area                                           | Evidence                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Selection, policy, ownership, lifecycle queues | `controller.test.ts`, `bridge.test.ts`; live two-browser probe and overlapping controller sessions                                                           |
| Navigation, DOM, input, frames                 | `page.test.ts`, `controller.test.ts`; live trusted events/final values, SPA/redirect/error/never-ready pages, shadow/nested frames, frame reload/removal     |
| Screenshot/scroll                              | Deterministic resize, stale mapping and encoded/decoded bounds; live DPR 1/2, zoom 1.25, viewport-change invalidation, nonzero scroll, wheel axes/boundaries |
| Cancellation/uncertainty                       | Queued/permission/compound/wire cancellation, late success/error and limits; live delayed mutation settles exactly once before end                           |
| Dispositions/process faults                    | Six agent/user dispositions, next-turn handoff; controller SIGKILL, host SIGTERM/SIGKILL, extension disable/enable worker restart, browser SIGKILL/restart   |
| Journal/IPC/resources                          | Real subprocess fault injection, invalid journal/owner/boot identity, bounded queues/results/events/churn, unsafe discovery and malformed clients            |
| Independence                                   | Prepared-host hashes, unmodified extension/production manifest, process traces, exact browser/host exits and no remaining owned process                      |

Prepare each core run with the command in "Prepare An Isolated Run", adding
`--observer --screenshot-new-surface --device-scale-factor 2 --zoom 1`.
Use DPR 1 / zoom 1 for the second run, DPR 2 / zoom 1.25 for the third.
Run sequentially, with fresh directories:

```sh
bun run --cwd packages/chrome-bridge smoke:controller -- --run-dir /tmp/tandem/chrome-bridge/core-a --launch
```

Prepare a fourth observer-enabled run and add `--claim-fixtures` to its smoke
command. This starts independent user-origin fixtures and adds standalone
background click, scroll boundary, scrolled screenshot, frame reload and
never-ready cases. The observer is a read-only, test-only extension; its
physical `tabs.query`/activation history is independent of session-logical
`active` flags. Input telemetry is deferred past the browser's editing task so
the harness does not inspect contenteditable halfway through normalization.

For dedicated faults, prepare another run with `--fault-control`, then run:

```sh
bun packages/chrome-bridge/test/fixtures/identity-probe.ts /tmp/tandem/chrome-bridge/faults
```

That separate fixed-purpose extension disables/re-enables only the test ChatGPT
extension; it is not part of the observer or production controller. For
selection, prepare two fresh traced runs and run:

```sh
bun packages/chrome-bridge/test/fixtures/selection-probe.ts /tmp/tandem/chrome-bridge/select-a /tmp/tandem/chrome-bridge/select-b
```

After all owned processes exit, run the complete gate from the repository root:

```sh
bun run --cwd packages/chrome-bridge verify:phase2 -- \
  /tmp/tandem/chrome-bridge/core-a /tmp/tandem/chrome-bridge/core-b /tmp/tandem/chrome-bridge/core-c \
  /tmp/tandem/chrome-bridge/extended /tmp/tandem/chrome-bridge/faults /tmp/tandem/chrome-bridge/select-a \
  > /tmp/tandem/chrome-bridge/phase2-evidence.json
```

The gate does not count missing/skipped assertions or unsupported mandatory
cases as passes. Visual screenshot review remains a separate human/vision
check. Artifacts are temporary and uncommitted; preparation needs at least
256 MiB free. On this tablet `/tmp` is a 5.5 GiB tmpfs. Prune only stopped,
superseded diagnostic assets and retain their reports; do not prune artifact
sets still needed by the evidence gate.

## Historical Phase 1 Evidence

Phase 1 passed on 2026-09-10 (tablet local date): 41 package tests, package
typecheck, and three consecutive fresh-browser runs with 50 assertions each.
`verify:evidence` returned `liveProofPassed: true` after all browsers exited.

Verified with Chromium `149.0.7827.102`, extension `1.26.901.11451`, Bun
`1.3.14`, and Ubuntu Linux ARM64 on the Android kernel:

- `ping` and `getInfo` with extension `1.26.901.11451` on Chromium 149,
  Linux ARM64.
- Exact input replacement rather than append.
- A trusted coordinate click after bringing the fixture tab to the foreground.
- A decoded `1984x1306` PNG at device-pixel ratio 2. CDP input coordinates are
  CSS pixels; screenshot dimensions are physical pixels.
- A 65-second wait with two extension heartbeats and a successful later read.
- `turnEnded` closing unmarked agent-created tabs, preserving user tabs, and
  detaching claimed user tabs.
- Host `SIGTERM` rejecting pending work, awaiting cleanup, and the extension
  reconnecting to a fresh host in about five seconds.

Final evidence is in `/tmp/tandem/chrome-bridge/phase1-evidence.json`; the
individual `final-a`, `final-b`, and `final-c` directories contain reports,
screenshots, preparation hashes, and process traces. The first final screenshot
was also visually inspected. These temporary artifacts are not committed.

| Run       | Browser PID | Initial Host PID | Assertions | Heartbeats During 65s |
| --------- | ----------- | ---------------- | ---------- | --------------------- |
| `final-a` | 24368       | 24472            | 50 passed  | 2                     |
| `final-b` | 24911       | 25018            | 50 passed  | 2                     |
| `final-c` | 25234       | 25337            | 50 passed  | 2                     |

Each run also replaced its native host, verified pending-request rejection,
reconnected, and checked that only its disposable tab was closed. Traces show
the isolated native manifest being opened and only the expected Chromium,
system `env`, launcher, and compiled Tandem host executables. The production
manifest remained byte-for-byte unchanged, with SHA-256
`fe4852bc9c904567ae995d92333fe5ea062d6e3259870b4ef7ad6348a04f9c1c`.

The pinned extension background SHA-256 is
`83b7b7708ab82ecc9aa2ccad20a2167941a706b38a9467dee0bb124d13f0033e`.
The plan's optional offline check remains unverified; no broader browser,
extension-version, or production-readiness claim is implied.

## Historical Transport Scope

- Little-endian Chrome native-messaging framing and JSON-RPC routing.
- Prompt heartbeat replies while another request is outstanding.
- One local controller per Chrome-launched native-host instance.
- Forwarding for discovery, tab creation/claim/attach, CDP, and turn completion.
- A loopback fixture with assertions over final DOM, tab, and debugger state.
- Isolated preparation, hashes, traces, screenshots, reports, and a verifier for
  exactly three sequential fresh runs.

The Phase 1 transport proof had no Codex executable, config, auth, app-server,
bundled Node runtime, `node_repl`, `browser-client.mjs`, or
`browser-service.mjs`. That statement is historical for the server page layer:
the current Tandem server imports the pinned original service plus its export
shim while still excluding the original native host and REPL binaries. The
standalone host remains Tandem transport/lifecycle code. Raw CDP remains
non-model-facing.

## Native Transport

Frames use a four-byte little-endian unsigned payload length followed by UTF-8
JSON. Reads support fragmented and coalesced frames; malformed envelopes close
the peer. Writes are serialized and pending requests reject on EOF or errors.

Limits are conservative:

- Host to Chrome: 1 MiB per frame.
- Chrome to host: 16 MiB per frame.
- Pending JSON-RPC requests per peer: 64.
- Queued output: 32 MiB.
- Controller calls in flight at the host: 32.
- Tracked session/turn pairs: 64.

Chrome documents 1 MiB native-host-to-browser and 1 GiB
browser-to-native-host limits. This host deliberately lowers inbound to 16 MiB:
<https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>.
Frames are rejected rather than truncated.

Native-host stdout contains protocol frames only. Generic diagnostics go to
stderr and do not include page payloads, rejected origins, or RPC contents.

## Timeouts And Cleanup

A controller timeout is not proof that a mutation did not execute. There are no
automatic retries and no automatic side-effect replay.

Once written, a timed-out call remains tied to its wire ID for 30-35 seconds:
30 seconds minimum, or the caller deadline plus five seconds. Cleanup awaits the
late response, then sends `turnEnded` before admitting another controller. A
late response cannot satisfy a newer request.

If no wire response arrives, or native EOF prevents cleanup, the host reports
`cleanup_unconfirmed`. Phase 2 quarantines uncertain session state and preserves
durable keep intent; unrelated healthy sessions are not closed merely because
one operation timed out. See "Completion And Recovery" for crash behavior.

## Security Boundary

Discovery and the Unix socket use a same-user mode-0700 private directory; the
socket and discovery file are mode 0600. Discovery rejects symlinked, stale,
unsafe, or ambiguous instances, and only one controller is accepted. There is
no HTTP IPC server, remote-debugging port, or LAN listener. The smoke fixture
alone uses an ephemeral loopback HTTP server.

The extension origin check is an identity sanity check, **not** protection from
malicious code already running as the same OS user. The Phase 2 callback is an
automation authorization boundary, not a model permission UI or OS sandbox.

## Prepare An Isolated Run

Preparation compiles `src/host.ts` into a self-contained Bun executable under
the run directory. That host imports only Tandem's client transport, native
framing and error modules; it does not include the original service, copied
client or WASM assets. It retains transport/lifecycle behavior plus a narrow
allowlist for original-engine cleanup calls from the server controller. It
copies no original native-host, Node or `node_repl` binary. Preparation also
copies unpacked extension assets, excluding Web Store `_metadata`; the official
extension is not redistributed.

The production manifest is read and hashed but never edited. The compatibility
name `com.openai.codexextension` is registered only in the isolated HOME and
does not introduce a Codex dependency.

On this Android-kernel Ubuntu fixture, Chromium requires explicit
`--no-sandbox`. Use it only for this isolated fixture, never as a recommendation
for production or untrusted browsing. A `--trace <strace-executable>` argument
is required by the evidence gate. The command below uses the temporary extracted
Ubuntu `strace` binary from this verification; no system installation was changed.
Use `/usr/bin/strace` instead if it is installed normally.

From the repository root, prepare run 1:

```sh
bun run --cwd packages/chrome-bridge prepare:isolated -- \
  --run-dir /tmp/tandem/chrome-bridge/run-1 \
  --extension "/home/jon/.config/chromium/Profile 5/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0" \
  --production-manifest /home/jon/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json \
  --no-sandbox \
  --trace /tmp/tandem/chrome-bridge/tools/usr/bin/strace
```

Preparation refuses an existing run directory and never launches Chromium.

## Run The Probe

In the first terminal, launch only the prepared browser. Preserve this timeout:
the traced browser exit and native-host cleanup are evidence requirements.

```sh
timeout --kill-after=5s 240s /tmp/tandem/chrome-bridge/run-1/launch-browser
```

In a second terminal, after the extension launches the host:

```sh
bun run --cwd packages/chrome-bridge smoke -- \
  --run-dir /tmp/tandem/chrome-bridge/run-1
```

After smoke, stop **only** that test browser: Ctrl-C its launcher terminal or
stop the recorded isolated browser PID. Never use a broad Chromium/process kill.

Repeat sequentially as `run-2` and `run-3`; never overlap or reuse runs.
`smoke-report.json` and `screenshot.png` use exclusive `wx` creation, and every
run needs fresh browser, host, session, and turn IDs.

After all three launchers exit, verify in chronological order and redirect the
stdout JSON under `/tmp/tandem`:

```sh
bun run --cwd packages/chrome-bridge verify:evidence -- \
  /tmp/tandem/chrome-bridge/run-1 \
  /tmp/tandem/chrome-bridge/run-2 \
  /tmp/tandem/chrome-bridge/run-3 \
  > /tmp/tandem/chrome-bridge/evidence.json
```

The verifier checks assertions, unique IDs/PIDs, PNGs, hashes, exact isolated
manifest access, approved executables, traced browser/host exits, cleanup, and
that no process still uses a run profile. Evidence records no observed access to
Codex config, auth, code, or original runtime paths; this is not a filesystem
security denial claim.

## Package Checks

These do not launch Chromium:

```sh
bun run --cwd packages/chrome-bridge typecheck
bun run --cwd packages/chrome-bridge test
```

Do not run repository-root `bun test`; the monorepo intentionally rejects it.

## Network Notes

Offline behavior is unverified. On this kernel,
`unshare --user --map-root-user --net /bin/true` failed with `Invalid argument`.
Do not work around that by disabling global tablet networking.

The third-party extension has background network/telemetry behavior even in a
fresh isolated profile. No accounts, cookies, credentials, or browsing data are
imported. `--disable-background-networking` is not a network sandbox or offline
proof.

## Troubleshooting

- **Missing host:** ensure the prepared browser is running and use its exact run
  directory; otherwise stop only it and prepare a fresh run.
- **Ambiguous or stale discovery:** do not select or delete candidates
  automatically. Stop only the isolated browser and use a fresh directory.
- **Registration confusion:** inspect the isolated manifest and trace. Never
  remove, overwrite, or repair the shared production registration during tests.
- **Timeout or unconfirmed cleanup:** stop, inspect fixture/tab state, and
  reconnect fresh. Never automatically replay the side effect.

Generated profiles, traces, reports, and screenshots remain under
`/tmp/tandem/chrome-bridge/` and must not be committed.
