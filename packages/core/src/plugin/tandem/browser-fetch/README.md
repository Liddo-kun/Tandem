# Browser-backed webfetch — integration and acceptance

## Master registration

In `packages/core/src/plugin/internal.ts`, import:

```ts
import { BrowserFetchPlugin } from "./tandem/browser-fetch/plugin.js"
```

Append `BrowserFetchPlugin.Plugin` to **pre**, after `WebFetchTool.Plugin` and
`TandemAuxiliaryPlugin.Defaults`, before configuration in post. The exact plugin
ID is `tandem.browser-fetch`. This worker has not edited internal registration.
`Global.Service` and `Permission.Service` are already internal requirements.
No package dependency, lockfile, public protocol or generated-client changes are
required. The build must retain the text import of `web-fetcher.md`, like other
bundled prompt imports.

The renderer is registered as `webfetch` in session-ui's existing registry and
exported as `WebFetchRenderer` from `src/tools/tool-renderer.tsx`. It uses the
existing `ui.tool.webfetch` translation and authenticated Markdown infrastructure.

## Runtime prerequisites and controls

- `TANDEM_BROWSER_FETCH=0`: no browser plugin tools/defaults/hooks; upstream
  HTTP webfetch remains installed.
- Regular Chrome/Chromium CDP first, `127.0.0.1:9223`. On the tablet, desktop
  display :0 and `~/.local/bin/chromium-x` launch the user's existing profile.
  An existing profile owner is never killed or unlocked automatically.
- `TANDEM_BROWSER_FETCH_ENDPOINT=host:port`: existing regular CDP endpoint;
  disables automatic Android fallback and bootstrap for that endpoint.
- `TANDEM_BROWSER_FETCH_LAUNCHER=/absolute/executable`: desktop launcher override.
- Android fallback: `adb-reconnect`, `adb`, stock Chrome, CDP forwarding on 9222.
  `TANDEM_BROWSER_FETCH_ANDROID_ENDPOINT=host:port` uses an existing endpoint.
- `pdftotext` (`poppler-utils`) for PDF extraction. Missing extractor returns
  the downloaded path plus an explicit prerequisite note to the reader.
- Configured `agents["web-fetcher"]` model/system/request overrides remain in
  effect. Auxiliary defaults supply `openai/gpt-5.6-sol#medium`; this feature
  supplies medium text verbosity before configuration. Agent is hidden primary.

## Bounds and lifecycle

- Every successful page fetch saves up to four 1600px CSS-height slices, width
  capped at 2560px, up to 12 MiB per PNG. Headers report uncaptured vertical height.
- Page capture: 2 MiB UTF-16 characters. PDF extraction: 2 MiB UTF-8 bytes and
  15 seconds. Initial and follow-up inline capture: 100,000 UTF-8 bytes, with
  excess captured text saved to an overflow file.
- Documents: 50 MiB streamed download ceiling, five redirects, HTTP(S) only.
  Cookies are recomputed per redirect rather than forwarded between origins.
- Each webfetch call has a 128 MiB cumulative artifact budget, including failed
  attempts. Files use non-colliding `bf-<timestamp>-<uuid>` prefixes.
- Idle retention: newest 300 owned files, 512 MiB total, seven-day age limit;
  active calls pin their files and may temporarily exceed idle directory bounds.
  Pruning runs at call entry and release, not on a background timer. Only `bf-`
  files in `<Global.tmp>/webfetch/` are eligible, including downloaded documents.
- Twelve follow-ups, at most five search-engine-host fetches, counted before
  capture; failed calls spend budget. Refusing hosts are blocked for that call.
- Browser operations serialize process-wide, from bootstrap through tab cleanup.
  A timed-out attempt gets one 120-second retry only if the original timeout was
  shorter. Desktop unavailability or an unresolved placeholder can fall back to
  Android; network rate-limit pages never get a browser retry.
- Reader uses normal create → prompt → wait → outcome/context → remove.
  Explicit bare/owner/Corrector metadata and tool permissions are supplied at
  creation. Read is allowed only inside runtime webfetch scratch. Raw fetch also
  checks durable role/agent/parent/owner plus a live operation budget.
- Effect operation finalizers abort and await native capture cleanup, then remove
  the child on completion, failure, timeout or cancellation. Owned tabs close;
  existing user tabs remain. A close-target failure is logged, not hidden.
- Reader wait budget: ten minutes. Initial capture failures create no reader.
  Parent receives the final answer and source/saved paths, never child transcript
  or screenshot bytes. All successful follow-up artifact paths are included.

## Real-site acceptance (master-owned; not yet run)

Use only the isolated v2 server/roots and serialize browser/device checks. Before
starting, record regular and Android tab IDs, runtime scratch path, and selected
reader model. Enable final-request diagnostics into isolated scratch if inspecting
requests; do not include cookies, tokens or other credentials in evidence.

1. **Plain/JS content:** ask a normal agent to webfetch a current documentation
   page (for example Effect documentation) with no prompt, then targeted extraction
   on a JS-rendered page. Compare the full main content and targeted answer with
   regular Chrome. Repeat `text` and `html`; inspect source/final URL, HTTP and
   page-state capture headers. Main session should receive only the reader answer.
2. **Authenticated content:** choose a read-only page already logged into Jon's
   regular Chromium profile. Ask for one visible field. Verify it matches Chrome's
   logged-in view without importing credentials or changing a global profile.
3. **Visual content:** choose a real product spec image/chart page, request
   `screenshot:true` and a value found only in the image. Verify four-or-fewer PNGs,
   slice order/dimensions, existing paths, and direct images in the initial reader
   request. With `screenshot:false`, confirm images are only paths until explicitly
   read; the parent request must not receive them from the tool/UI.
4. **Documents:** fetch a small real PDF, then an authenticated PDF when available.
   Confirm saved bytes are a PDF, `pdftotext -layout` text agrees with the answer,
   and main output includes the path. Check a scanned/no-text PDF honestly reports
   its missing text layer. Download-notice PNGs are not document-page renderings.
5. **Redirect/loading/fallback:** use a real redirecting site and a desktop
   placeholder that Android can resolve. Check final URL and browser provenance.
   Do not deliberately provoke production search-engine rate limits. If a natural
   refusal occurs, inspect that no retry/fallback is made and subsequent same-host
   follow-ups are denied. Unavailable fallback cases remain unverified.
6. **Isolation/overrides:** inspect the reader's outgoing request and durable
   instruction baseline while active: reader system only, supplied page/request,
   fetch_page and Read; no project AGENTS, skills, MCP guidance or Corrector
   request. Read an overflow file and confirm no nearby instructions are injected.
   Verify model/system/request overrides, hidden primary identity and no general
   subagent entry. A normal agent must not expose/execute fetch_page.
7. **Follow-up limits:** temporarily use an isolated reader system override to
   request sequential related real pages beyond 12, and search-host pages beyond
   5 using benign queries at a responsible pace. Inspect counters and rejected
   calls; failed calls count too. Remove the isolated override afterward. Never
   mark search-limit acceptance passed if those calls cannot safely be exercised.
8. **Overflow/retention:** fetch a naturally large real page. Confirm the initial
   reader prompt stays under 100 KB of inline capture and can Read the saved
   overflow. Inspect retention across enough real fetches or mark thresholds
   unverified; don't substitute low-level synthetic tests. Active artifacts must
   survive another call's pruning. All writes stay under runtime webfetch scratch.
9. **Failure/cancel/concurrency:** invalid URL fails before a child exists. Stop
   a slow navigation, document download, queued browser operation and active
   reader. After settlement, compare tabs and child sessions to the baseline;
   no owned target/reader should remain. Trigger simultaneous ordinary calls and
   verify one bootstrap/serial browser ownership, responsive cancellation and
   no user-tab closure. Close-target failures must remain visible in logs.
10. **UI and opt-out:** in web and Android, verify compact preview/source link,
    expandable Markdown answer, reload and following streamed conversation.
    Check normal upstream webfetch with opt-out enabled in an isolated restart.

## Evidence and limitations

One focused Core `bun typecheck` found browser-owned errors (JSON parsing schema
API and context output shape), fixed afterward by source inspection. It also
reported out-of-scope errors in Corrector and shared session hooks. No second
typecheck was run. The log is `/tmp/tandem/v2/browser-fetch-typecheck.log`.
No browser, device or model
requests, low-level tests, heavy builds or restarts were performed by this worker.
The feature is implemented, not real-workflow accepted.

Documents are retrieved with browser cookies and user agent using bounded HTTP,
not Chromium's network stack. Documents requiring extra authorization headers,
browser-only TLS/session state, POST bodies or client certificates may fail.
Document screenshots show the owned tab's download notice; use Read for actual
PDF visuals. Lazy-loaded below-fold content is not scrolled into view. Browser
processes/bootstrap ADB forwarding are retained; only owned tabs are disposed.
Process death cannot run finalizers; shared startup orphan cleanup is not supplied.
