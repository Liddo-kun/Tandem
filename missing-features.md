# Browser Plugin Parity Gaps

## Scope

This inventory compares Tandem's agent-facing browser tool with the pinned
original Codex Chrome plugin. It is a source/API comparison, not proof that every
original capability works on the current Chromium installation.

Tandem reuses the original page engine but exposes only a subset through its JSON
tool, permissions and lifecycle adapter. Many gaps below already have original
engine implementations; they need integration rather than reimplementation.
Shipping the engine does not establish parity if adapters discard its recovery
signals or make its observations unusable.

## Highest-Value Gaps

| Capability | Original functionality | Tandem gap and practical impact |
| --- | --- | --- |
| Complete mouse interaction | Mouse movement/hover, double-click, drag paths | move/dblclick/drag passed exercised workflows in four real legacy source sessions. Production deployment, V2 and remaining edge cases are pending; not a missing source API or a claim of full runtime parity. |
| Explicit form-control operations | `selectOption`, `check`, `uncheck`, `setChecked`, `pressSequentially` | Native dropdown selection, setting a checkbox to a known state, and per-keystroke input must otherwise be approximated. Clicking a checkbox is not equivalent to setting its state. |
| JavaScript dialog handling | `getJsDialog`, accept/dismiss, prompt-text responses | Native alert, confirm, prompt and leave-page dialogs can block automation. They are not ordinary HTML dialogs that DOM refs can handle. |
| Explicit readiness checks | Wait for URL, load state or locator state; `expectNavigation` around an action | Tandem relies on original actions' internal waiting and repeated inspection. It lacks direct state-based waiting for navigation or completion signals. This is not a claim that original implicit waiting is absent. |

## Other Useful Gaps

- **Back, forward, reload and individual-tab close:** Tandem has navigation and
  finalization, not the original's complete tab navigation/lifecycle surface.
  Navigating to the current URL only partially substitutes for reload.
- **Screenshot cropping and full-page capture:** Tandem exposes viewport capture.
  The original also offers coordinate-based element information and annotated
  element screenshots to help turn visual observations into grounded locators.
- **File uploads and downloads:** Original file-chooser and download/media
  workflows are not exposed. Integration requires explicit file-access and
  upload permissions, not merely adding action names.
- **Page console logs:** The original exposes tab-scoped console logs; Tandem
  lacks this diagnostic surface. Console logs are distinct from native transport
  errors and would not automatically explain every bridge failure.
- **Browser organization:** Original optional management capabilities cover
  tabs, groups, windows and bookmarks. Lower priority for ordinary website tasks;
  availability must be checked for the connected backend.

## Separate Design Work

These are not simple page-engine ports:

- **Secure login handoff and QR authentication** depend on the original secure
  credential-collection UI/runtime. Tandem would need its own equivalent that
  does not expose credentials to the model.
- **Clipboard, browsing history and read-only page evaluation** are deliberately
  excluded from Tandem's current tool surface. They need separately designed
  access boundaries before being enabled.
- **Native accessibility (`ax`) is not an established Chrome-extension parity
  gap:** the original marks it unsupported by default for the extension backend
  too. Do not count all APIs advertised for other backends as missing Chrome
  extension features.

## Already Addressed Or In Progress

- Source-faithful guidance recovery is complete for the six browser files lost
  in snapshot rollback. The execute-only surface is retained with original
  selected-Chrome API prose and a separately labeled JSON adaptation, without
  importing AX batching instructions. Fresh natural Python.org and Wikimedia
  agents each grouped four fields plus inspection; only Python.org completed
  visual verification and retained-form delivery (Wikimedia capture timed out).
  Guidance counts, source rationale, safety limits and cleanup evidence:
  `packages/chrome-bridge/README.md` and
  `/tmp/tandem/browser-guidance-recovery/results.md`. Source only, not installed.
- Ordered page execution is implemented in source and **naturally grouped in two
  real multi-field legacy agent tasks**. The shared schema now exposes page input
  only as `action: "execute"` with `steps`; individual input actions and the old
  optional `batch` action are rejected at public admission. Python.org and
  Wikipedia/Wikimedia registration tasks, with no tool/batching instructions in
  their prompts, each filled four fictitious fields plus inspected in one call.
  Screenshots confirmed populated fields; neither form was submitted. Both had
  native-confirmed deliverable retention before isolated infrastructure shutdown.
  Exact prompts, sessions, calls and measured usage are recorded in
  `/tmp/tandem/browser-efficiency-natural-results.md`. This correction is source
  only, not installed; V2 live behavior and universal/Codex token parity are not
  established. The reused runner executes 1-16 prevalidated existing actions in
  order on one inherited tab/browser, stopping on the first error or unknown
  outcome and reporting partial completion without rollback or replay. Only a
  final `read`, `inspect`, or `screenshot` observation is allowed; the aggregate
  serialized steps limit is 65,536 UTF-8 bytes. This is a round-trip reduction
  for independently grounded work, not an explicit readiness/wait primitive or
  atomic transaction. Changed UI/navigation/geometry still requires a fresh
  observation. Default inspect remains visible refs/view only; `detail: "page"`
  returns semantic text plus view/viewport metadata with no elements/refs. Normal
  inspection invalidation is unchanged. Fresh `openai/gpt-6-astra` medium sessions
  on Python.org and Wikipedia previously exercised successful, stopped, denied, and malformed
  batches through normal browser tools. Nested `tab` override was rejected by the
  tool schema before step 1; malformed later-step prevalidation left the field
  unchanged; a stale observed ref stopped after one completed edit; and a deliberately
  denied step-2 cross-origin navigation preserved `completed=1`, `failedStep=2`, and
  `failedAction=navigate`. Same-session resume proved the preceding fill persisted,
  with no replay. A final fresh denial session verified durable synthetic model-facing
  history separately from the generic permission rejection: the continuing model
  recognized the code/outcome, partial count, failed step/action, failed-step outcome
  semantics, no rollback, and no automatic replay. A
  batch-final screenshot can capture before the immediately preceding fill paints;
  semantic inspection and a later screenshot verified the value without replay.
  The exact Python rerun reduced context growth and calls, while Wikipedia reduced
  calls but doubled growth because the model requested a delivered 51,358-character
  final page observation. Those earlier optional-batch runs established runner
  behavior, not natural grouping; the new form tasks establish the latter for
  their exercised workflows. Observation
  choice, screenshot freshness, V2, and
  production deployment remain limitations. All verification tabs received explicit
  native-confirmed cleanup with zero retained; no unit tests were run. Evidence:
  `/tmp/tandem/browser-efficiency-final-candidate-results.md` and
  `/tmp/tandem/browser-efficiency-denial-failuretext-results.md`.
- Complete mouse interaction is implemented and **live-verified in legacy source
  sessions for the exercised workflows**, not installed in production. `move` uses x/y/view for hover; `dblclick` uses
  ref, selector or x/y/view; `drag` uses view plus 1-256 ordered finite viewport
  points. Original native handlers are reused unchanged. Supported click buttons
  and mouse modifiers are exposed only on the original compatible target paths;
  no invented selector/ref movement, selector drag, arbitrary click counts or
  separate held-button API. Existing ownership, site approval, view checks,
  deadlines and uncertain-operation handling remain. Four independent normal
  HTTP-admitted `openai/gpt-5.6-sol` sessions on isolated source port 4117 verified:
  - `ses_f6d5b1d6bffe0G6M0ZkQU7osZN`: Python.org hover menus, ControlOrMeta hover
    acceptance, and ref double-click selection verified by focused replacement.
  - `ses_f6d577b5fffeTn9w4jcm8XQDnx`: Wikipedia selector and coordinate double-click
    selected the intended words, verified by replacement; invalid options rejected.
  - `ses_f6d58bf14ffe6u9h66to4h68qD`: OpenStreetMap six-point pan visibly changed
    center from `13/51.50740/-0.12780` to `13/51.49667/-0.15776`.
  - `ses_f6d53dd8dffeTv0YWVSRfMlJX3`: Shift drag zoomed from level 13 to 14;
    one-point drag accepted without pan, with identical saved RGB pixels before
    and after that drag and invalid calls.
  All explicitly finalized with nativeConfirmed=true and retained=0. No user tabs
  were claimed. Superseded views returned stale_handle/not_dispatched. Incompatible
  options and missing view returned unsupported/not_dispatched; empty path failed
  schema validation. Bounds errors returned **unsupported/confirmed**, not
  not_dispatched, because native metadata had been read; status settled with
  unsupported and images/URL stayed unchanged. No unknown outcome or replay.
  Post-live `bun typecheck` passed in chrome-bridge and Core (`tsgo --noEmit`,
  exit 0, no diagnostics); source review found no new concrete adapter defect.
  No unit tests were written, modified or run; no mouse build/install/production
  restart. Exact source contracts, coordinate review and outcomes are in the
  README's **Complete Mouse Interaction** section; scratch evidence is at
  `/tmp/tandem/browser-mouse-results.md` and `/tmp/tandem/browser-mouse-evidence.json`.
  V2, middle/right buttons, all modifier variants/exact event telemetry, cross-frame
  actions, 256/257-point boundary, nonzero viewport offsets/zoom and interrupted
  drag remain unverified. Original release-on-error is best-effort, not guaranteed
  release or rollback under cancellation; no new retries were added.
- Targeted locator reads are implemented in source through `action: "read"`,
  `tab`, an observed `selector`, and `read: "innerText" | "textContent" |
  "getAttribute" | "count" | "isVisible" | "isEnabled"`. Only `getAttribute`
  requires/accepts `attribute`. Original handlers supply scalar `value` results,
  preserving nulls, count zero, first-match boolean semantics and protected-field
  attribute suppression. Output remains bounded and untrusted; no evaluation API.
- Focused input is implemented in source: omit `ref` and `selector` for `type`
  or `key`; focused `type` also omits `mode`. Original `dom_cua_type` inserts at
  the current caret/selection (not append-to-end/replace-all), and
  `dom_cua_keypress` sends to current focus. Targeted typing retains explicit
  replace/append. Both runtime leaves use the shared updated schema and adapter;
  ownership, site authorization and no-replay rules remain unchanged. Real legacy
  source sessions verified all six reads on Example Domain/IANA, caret insertion,
  selection replacement and empty-text semantics on httpbin, focused Wikipedia
  search/navigation, and invalid-argument no-dispatch with unchanged form content.
  All completed sessions finalized with native confirmation and zero retained
  tabs. Post-live bridge/Core typechecks passed; no unit tests were run. Installed
  version is `0.0.0-dev-202609112229`, with installed SHA matching the build;
  production was not restarted, so activation and V2 live verification remain
  pending. Rollback is
  `~/.local/share/tandem/rollbacks/browser-features-20260912-052943/tandem.before`.
  Credential suppression, rich-text input,
  absent-locator false/zero, oversized reads and ambiguous text rejection remain
  unexercised. Exact original handler locations and session evidence are recorded
  in `packages/chrome-bridge/README.md`; scratch evidence is indexed at
  `/tmp/tandem/browser-features-results.md`.
- Inspection delivery was changed to use original bounded visible DOM by default
  (20,000 characters / 200 elements), with `detail: "page"` for full semantic
  content. Both runtime leaves deliver readable multiline controls and refs,
  rather than oversized single-line JSON with duplicated controls. Browser
  overflow no longer instructs compulsory subagent delegation. Installed as
  `0.0.0-dev-202609111958` at that checkpoint; post-activation live verification
  was still pending when this inventory was requested.
- Original destroyed-context error recognition and the exact
  `Debugger unattached` recovery signal were restored across the transport and
  original-engine adapter. The latter update (`...1734`) passed the previously
  failing real Lazada search, product navigation, screenshot and explicit cleanup
  workflow. This does not establish broad recovery parity or reconciliation of
  historical blocked leases.
- A `documentation` action and original-document adaptation are present in the
  current source. Do not describe runtime documentation as wholly missing;
  confirm its deployed availability separately.
- Site-scoped approval reduction and explicit finalization are implemented.
  They are not substitutes for the missing interaction/observation capabilities.

## Recommended Order

1. Complete V2 and remaining edge-case verification for targeted reads/focused input.
2. Verify remaining mouse edge cases/V2; deploy the legacy-live-verified source when requested.
3. JavaScript dialogs and explicit form controls.
4. State-based readiness checks.
5. Tab navigation and richer screenshots.
6. File workflows, diagnostics and browser management as needed.

For each capability, trace the original command, return/error contract, supported
backend and recovery behavior before adapting it. Preserve the original
implementation where practical. Do not introduce blind mutation retries,
ownership bypasses or broader permissions merely to achieve apparent parity.

Jon's verification preference is real agent sessions on real websites, not demo
forms or expanding synthetic suites. He explicitly instructed the agent to stop
writing and running test suites during this work. Do not treat builds or an API
inventory as evidence of a successful user workflow. Do not restart production
without authorization; retain rollback artifacts and ownership journals.

## References

- Pinned plugin:
  `~/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247/`
- Original source/provenance:
  `packages/chrome-bridge/vendor/original/browser-service.mjs` and
  `browser-client.mjs`.
- Tandem tool/action surface: `packages/chrome-bridge/src/tools.ts`.
- Original-engine adapter: `packages/chrome-bridge/src/original-page.ts` and
  `original-exports.js`.
- Runtime leaves: `packages/core/src/tool/browser.ts` and
  `packages/opencode/src/tool/browser.ts`.
- Documentation adaptation: `packages/chrome-bridge/src/documentation.ts`.
- Deployment and failure evidence:
  `notes/chrome-browser-handoff-20260911.md`,
  `packages/chrome-bridge/README.md`, and `notes/chrome-original-repair.md`.
