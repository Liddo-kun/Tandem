> **Reverted 2026-10-05 by Jon's decision:** not worth the upstream divergence for a rare case that a refresh clears. The `hasHistory` change below is historical.

# First-import empty transcript: approved fix verified in packaged Android client

2026-10-04. Initial diagnosis approximately 21:02–21:10; packaged verification approximately 22:44–22:53 tablet local time.

**PASS on the newly packaged server and Android APK:** first import renders without reload, the live event includes `hasHistory: true`, and the app performs the message read. Ordinary New-session prompting and immediate imported-history continuation both complete real Read calls without observed message loss. Jon approved the narrow contract addition and master implemented/generated/built/installed it before this verification. This worker made no product-source changes. The auxiliary-deletion guard remains preserved.

## Original cause (before the approved fix)

1. `packages/core/src/session/transfer.ts:89–145` imports by publishing `SessionEvent.Created`. Its commit callback inserts the settled historical messages directly into `SessionMessageTable` and restores imported session metadata. It does not replay the historical inbox/message events to connected clients.
2. `packages/schema/src/session-event.ts:48–67` defines `session.created` without any indication that the new session already contains history. The observed import event used that ordinary shape; it contained session ID, slug, version, placement, title, agent, model and permissions.
3. `packages/client/src/solid/data.ts:643–653` refreshes session **info**, then unconditionally calls `sync.complete` for both `session.pending:<id>` and `session.message:<id>`. This marks the reads satisfied without loading their collections.
4. `createSync.run` at lines 169–174 immediately resolves a completed key without calling its loader. The first-open timeline calls both sync operations (`packages/app/src/session/timeline/model.ts:12–33`) and consequently becomes ready with an empty transcript. The Home prefetch and session-resolution reads use the same cache.
5. Reload discards those in-memory completion flags. Normal message/inbox reads then run and render the imported history. This is a client hydration/cache error; the reproduction showed intact server history.

The shortcut has an explicit purpose: independently reading pending input and projected messages can straddle inbox delivery. Both reads can miss a prompt that moved from one collection to the other, replacing state already assembled from events. Ordinary optimistic creation also marks those collections complete at `data.ts:1485–1489`.

## Installed-client baseline and reproduction

- Runtime: existing 4098 server **PID 14283**, existing native-regression APK, Android **PID 22533**, CDP **9224**. No build, install, server restart or source Vite instance.
- `agent-browser` was unavailable (`command not found`); used the existing Playwright dependency over CDP, plus native ADB screenshots.
- First verification was a normal **New session → composer → Send** workflow using ChatGPT-backed **GPT-5.6-Sol**, with a real `read` tool call against `packages/app/AGENTS.md`. The external-directory permission was answered **Allow once**. The original prompt, completed tool and final answer “Stability.” remained visible. Export before cleanup contained one user message, two assistant messages (one completed read), and one idle marker. This is an unchanged-code baseline, **not post-fix regression acceptance**.
- That owned session was `ses_ef8c5cbbdffd6KzgNvbjwYbTYx`. A CDP screenshot attempt timed out during the permission wait; text/DOM and exported-message evidence established completion. Do not claim a reliable early-prompt latency measurement from that driver.
- Created a separate SQLite backup of the already-migrated history copy, then temporarily served that backup on **4099** using fresh isolated XDG roots and generated server password, with no copied provider credentials. Exporter stopped in `finally` before reproduction. The original history copy and daily database were not modified or queried by this worker.
- Selected a different genuine historical coding conversation: **`ses_f37c8ab9affecm04TMmUJsCPKG`**, “Upstream sync smoke”, **five messages, two completed tools (`read`, `bash`)**. Confirmed it did not exist on 4098 before import. The previous three-message smoke and performance conversation were not reused.
- Imported through the ordinary `/api/experimental/session/import` API into `/tmp/tandem/v2/import-ui-fix`, with a temporary title and deny-all permissions. No prompt or execution was requested for the imported history.
- A read-only event subscriber observed **one `session.created`** for this session. No synthetic events were injected. Client request capture showed session-info/family/permission/form reads, **zero message or inbox reads** on first opening.
- Home-row click → composer-visible: **296 ms**, a single driver-observed upper bound. The transcript was still empty after the additional **3-second observation window**, despite `GET /api/session/<id>/message` returning **five messages**. A subsequent native screenshot visibly confirmed the blank transcript. This is a failed usable-open baseline, not a 296 ms usable conversation opening.
- One WebView reload then issued `/message?limit=40&order=desc` and `/inbox` at **299 ms after reload invocation**. The genuine historical prompt, two tools and final answer rendered. Text and native screenshot are retained. No reliable first-paint timing is claimed.

## Original contract tradeoff and approved resolution

The original create event lacked an explicit discriminator on which to base an import-only cache exception.

- Removing the two `sync.complete` calls broadly would reopen the documented promotion/snapshot race.
- Keeping the shortcut only for locally optimistic creates would protect the initiating UI but expose ordinary sessions created and promptly used by another connected client to that same race.
- Inferring import from timestamps, legacy ID shape, title, nonzero cost, or absence of a local create request is not a reliable contract.
- General snapshot/event reconciliation or atomic pending-plus-message hydration could replace the shortcut, but is broader than an import-specific fix.

Jon approved the narrow public-event fix. Master implemented:

- `packages/schema/src/session-event.ts`: optional `hasHistory` boolean on `SessionEvent.Created`.
- `packages/core/src/session/transfer.ts`: includes `hasHistory: true` only when the filtered settled-message collection is nonempty; existing atomic commit behavior retained.
- `packages/client/src/solid/data.ts:643–657`: still completes the pending-input key; when `hasHistory` is true, invalidates the message key and returns instead of marking it empty. Ordinary creation retains the previous empty-session protection.
- Generated Effect/promise client surfaces with `bun run generate`; master reported Core/Client typechecks passing and final CLI/APK/AAB packaging complete.

The subsequent instruction explicitly requested verification of those **actual packaged artifacts**, replacing the earlier pending source-Vite check. That compiled verification passed below. No additional build, install, dev-server restart or Vite instance was used by this worker. This verifies the isolated development installation, not daily-v1 production cut-over.

## Packaged verification results

Runtime identity: server **4098 PID 10164**, version **2.0.22-tandem-v2.0**, started Oct 4 22:08:12; Android **PID 12165**; actual loaded bundle **`/index-C69Cc6o8.js`**. The old PID 14283 was not used. All browser interaction used CDP 9224; desktop 9223 was not accessed during this follow-up.

### Ordinary new-session regression

- First check used the normal New-session/composer/Send UI with **GPT-5.6-Sol**, Corrector enabled, and a real Read of a scratch marker file. The prompt was visible in the early snapshot and remained visible alongside the completed Read and correct final answer.
- Owned session: `ses_ef868b5a7ffeLqE7fbj9XrKb0S`. The observed ordinary `session.created` event **omitted `hasHistory`**, as did its Corrector child creation. The main session reached `session.execution.succeeded`; export confirmed the user/tool/answer/idle records before cleanup.
- This exercises the preserved ordinary-creation path; it is not a claim to have exhaustively enumerated network races.

### First import and immediate continuation

- Reused the retained genuine five-message/two-tool export for `ses_f37c8ab9affecm04TMmUJsCPKG`, after confirming the previously deleted ID returned 404. Imported via the public API, with only Read permitted for the bounded continuation.
- A real read-only SSE subscriber observed **`session.created` with `hasHistory: true`**. No injected events or mocks.
- The connected WebView issued **`GET /api/session/<id>/message?limit=40&order=desc`**, receiving **200**. Its leading-page enrichment issued a second message read. It did not issue an inbox read on this path, consistent with retaining the pending-key shortcut.
- **No reload/navigation reset occurred between import and first view.** The Home-row click exposed the historical prompt, grouped Read/bash calls, historical answer and composer.

| Single observed opening | Old installed baseline | Fixed packaged client |
| --- | ---: | ---: |
| Composer visible | 296 ms | 330 ms |
| Transcript plus composer visible | Failed: still blank after another 3 seconds | **336 ms** |

These are driver-observed upper bounds from single samples, not paint timing or a statistically meaningful speed comparison. The original 296 ms was never a usable-transcript result.

- Submitted a bounded continuation through the UI **543 ms after the opening invocation**. Corrector remained enabled; its preparation delayed actual main prompt admission. A real Read completed and the marker answer rendered without reload.
- Export after completion contained **nine messages**. The original **five-message prefix was exactly JSON-equal** to the retained export, including IDs and contents. Both owned prompted sessions were idle before deletion. The historical text in the UI mentions an old daily-checkout command; that was displayed history only—the new continuation read only the scratch marker.

### Optional genuine historical attachments

- Exported another genuine session from the already-isolated migrated-copy backup: `ses_fd1097576ffewP4ZVCSHjtkmTu`, **11 messages**, **two PDFs and one PNG**. A short-lived no-provider-credentials exporter on 4099 was stopped before UI verification. The original copied DB and daily DB were not changed.
- Compared decoded byte lengths and SHA-256 values from the migrated-copy rows, exported transfer, and re-exported 4098 import: **all matched exactly**. PDF sizes **85,418** and **87,210 bytes**; PNG **736,837 bytes**.
- Opened the imported session in the UI without reload. Its inline PNG loaded at **1253 × 2000**, then opened successfully in the image viewer (loaded full image and Close control observed, native screenshot retained). PDFs were verified for byte preservation, not opened in an external viewer. No prompt was sent to this attachment session.

### Packaged cleanup and ownership release

- Exported final evidence, confirmed the prompted sessions idle, closed only the three owned tabs and deleted only the three owned session copies via 4098. No PTY was created; native controls/terminal were not changed.
- Returned v2 to Home. **Eight-tab array exactly matches the original restoration**; persisted **100% display scale**, **Corrector on**, grouped/collapsed **Compact** timeline settings, and portrait rotation **0** verified. Last explicitly selected model restored to Claude Sonnet 5.5. Native Home screenshot reviewed.
- V2 remains **PID 12165**; server 4098 remains **PID 10164**; daily 4097 remains **PID 23799** with its original Oct 2 start time. Temporary exporter 4099 is closed.
- Cleanup discovered daily v1 app **PID 11198** running unexpectedly. This worker had not launched it. Force-stopped that exact package to honor the requested closed-client end state; verified no daily app PID afterward. Daily server/database/auth were untouched.
- No builds, installs, server restarts, low-level tests, commits, synthetic event injection, or product-source edits during this follow-up. **Android/CDP 9224 ownership released.**

## Evidence

Private scratch directory: `/tmp/tandem/v2/import-ui-fix` (owner-only directory; contains historical text, do not publish wholesale).

- `baseline-home.png`, `baseline-home.txt`: initial installed Home snapshot.
- `new-early.txt`, `owned-session-results.json`: original ordinary prompt/tool baseline and final exported message metadata.
- `transfer.json`, `export-copy.db`, `export-server.log`: genuine historical export provenance.
- `baseline-result.json`: first-open timing, API message count, client request paths and observed event shape.
- `baseline-import.txt`, `baseline-import-native.png`: blank first view.
- `reload-result.json`, `reload-import.txt`, `reload-import-native.png`: actual message/inbox reads and restored transcript.
- `restoration.json`, `restored-home.txt`, `restored-home-native.png`: cleanup and final state.
- Scratch drivers are `/tmp/tandem/v2/import-ui-*.{js,mjs,py}`; they are workflow drivers, not added low-level tests.

Packaged follow-up evidence in the same private scratch directory:

- `packaged-start.json`: loaded bundle identity.
- `packaged-new-{early,complete}.txt`, `packaged-new-trace.json`: ordinary UI prompt, real tool completion and absent history flag.
- `packaged-first-view.txt`, `packaged-import-result.json`: successful first view, timings, `hasHistory: true`, real message requests/responses and execution events.
- `packaged-continuation.txt`, `packaged-continuation-export.json`, `packaged-continuation-native.png`, `packaged-owned-results.json`: visible completion, preserved historical prefix and idle cleanup checks.
- `attachment-transfer.json`, `packaged-attachment-result.json`, `packaged-attachment-ui.txt`, `packaged-image-open.txt`, `packaged-image-open-native.png`: genuine attachment byte preservation and image-viewer check.
- `packaged-restoration.json`, `packaged-restored-home.txt`, `packaged-restored-native.png`: final settings, original tab array, server/exporter and client state.

## Initial diagnosis cleanup (historical, superseded by packaged cleanup above)

- Closed only the two owned tabs and deleted only the two owned sessions through 4098 after exporting their final message metadata. The new prompt was idle before deletion; the imported copy was never executed. No PTY was created.
- Restored the composer model selection to **Claude Sonnet 5.5** on the owned new session before closing it. Returned Android v2 to **Home**. Its **eight-tab array exactly matches the preceding performance-worker restoration**. Normal recency/closed-tab history may reflect the owned workflow; it was not manually rewritten.
- Android remains PID **22533**, CDP 9224 usable. Daily v1 remains force-stopped. Desktop Chrome was not navigated or modified; CDP 9223 was only enumerated.
- Temporary export server stopped; **4099 closed**. No temporary Vite server was started.
- Existing server identities/start times confirmed: **4098 PID 14283, Oct 4 16:09:12**; **4097 PID 23799, Oct 2 14:06:58**. No daily runtime/db/auth changes.
- No low-level tests, commits, builds, APK installs or service restarts. No credentials recorded in evidence.
- **Android/CDP 9224 and desktop Chrome/CDP 9223 ownership released at handoff.**
