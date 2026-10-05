# Tandem v2 implementation checkpoint

## Current build and runtime

- Source: `/home/jon/code/Tandem-v2`, branch `tandem-v2`, pinned upstream `40679546d4`.
- External Claude plugin: `/home/jon/code/opencode-anthropic-auth-v2`, branch `tandem-v2`.
- Version: **2.0.22-tandem-v2.0**. Bun **1.4.2**, isolated development roots.
- Current artifacts: **`/tmp/tandem/v2/release-stage-ready`** — 11 CLI variants, signed V2 APK and AAB, manifest and SHA-256 list. Strict/common packaging and every checksum passed. **These predate the 2026-10-05 review changes; regenerate before any release.**
- Staged ARM64 binary: `~/.local/share/tandem-v2/development/bin/tandem`; rebuilt 2026-10-05 with the review changes, running on **4098**, PID **21241**, with `TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps/integrated-2`.
- Installed Android: **Tandem V2**, `app.liddokun.tandem.v2`, version 2.0.22 / code 2000022, rebuilt and installed 2026-10-05 with the review changes. On the device: 4 Corrector prompts each hit the deleted-session 404 race with no error shown. Development signing is separate from production. `packages/android/src-tauri/Cargo.lock` is untracked and belongs in the commit with the app.
- Daily server **4097 / PID 23799** remained healthy. Both clients were run individually for the authorized benchmark; daily client settings and original drafts were restored.
- Changes remain uncommitted. Artifacts are development-signed; production publication/cut-over is a separate decision.

## Verified behavior

| Area | Evidence |
| --- | --- |
| Isolation, saved connections, manual updates | Separate roots/database/credentials/service election; private spawning; Android connection and text/image draft recovery; upgrade directs to Tandem releases |
| Provider requests | Real ChatGPT and Claude tools/children; HTTP/WS final-body captures, disabled/unwritable diagnostics, secret exclusion; generate and manual summary compaction with post-compaction Read |
| Claude presentation | Tool/schema/history mapping before validation; first-user instruction reminder; one skill list; billing hashes, one-hour caches, signed-thinking preservation, thinking-off omission and zero subscription costs |
| Bash search | Active Claude main/general use v2 ugrep/bfs shims; removed Glob/Grep schemas, descriptions, Code Mode paths and harness instructions; GPT and shell-denied explore retain working dedicated tools |
| Claude transport | Final Bearer/beta/user-agent/query checks; real self-signed custom endpoint through the plugin-only wrapper; normal TLS rejection and ordinary-process verification; another provider unaffected |
| OAuth refresh | OpenAI rotated naturally and completed a separate subsequent Read. Claude's same saved credential also rotated naturally; expiry advanced from 1791121290889 to 1791149798133, both token hashes changed, and subsequent Read sessions succeeded |
| Corrector | Authoritative corrected text/original metadata; bare zero-tool child requests; queue snapshots through edit/reorder/undo/resend/steer; attachments/mentions/suffixes; 600-character boundary; failure fallback and HTTP-abort cleanup |
| Auxiliary lifecycle | Fixed false toast when successful child cleanup overtook metadata refresh; packaged cleanup 404s produced no failure toast; genuinely missing sessions still show missing-session UI |
| Browser fetch | Rendered documentation, JS canvas/chart reading, PDF download/text, saved PNGs, bare readers, no parent image injection, invalid URL and capture/reader cancellation with tab/child cleanup |
| Images | Real generation, reference edits including spaced paths, genuine native alpha, masked route, explicit mask+transparent rejection; persisted compact text-only results; Android Blob/lightbox and missing-image tolerance; plain-HTTP web image attach/render/reload |
| Android editing/layout | Native and SwiftKey newlines, repeated/mid-text edits, caret delete-word, atomic mentions, zoom 80–150% with 2% volume steps; portrait/landscape keyboard geometry including long draft at 150% |
| Android workflows | Delete cancel/confirm, rewind/replacement, image picker/paste-handler/reopen, child question background/resume, disconnected-page recovery, real clipboard transfer to X11, Taobao item dispatch, first-use Exa selection and persisted real search |
| Review and terminal | Empty/large reviews, native touch inline comment; visible terminal through theme/reload, same-PTY continuation, native touch scrollback without outer-page panning; bounded retry instead of rejected-ticket shell cloning |
| Plain-HTTP auth | Fixed browser Basic challenge holding startup; packaged normal connection form, wrong-password rejection and successful saved login; real CORS preflight/allowlist checks and clipboard fallback |
| History | Read-only-source backup 4.18s; 432 sessions / 14,300 messages migrated in 23.24s; tool conversation continued. Approved optional created-event history flag fixes first-open imports without reload; ordinary new prompts and immediate continuation retained; two PDFs and one PNG preserved byte-for-byte |
| CLI/UI identity | Tandem copy/assets and T mark; packaged CLI version/help; real TUI startup/clean exit at 80/40/20 columns |

Detailed methods and per-case limits are linked from [v2-progress.md](v2-progress.md). No low-level tests were added or run. Focused Core, Client, App, UI, Plugin and terminal checks passed at their relevant checkpoints. External v2 auth typecheck passes after aligning its source-check compiler option with the host and preserving branded scalar types in the Promise plugin helper.

## Performance

Final APK is approximately **9.61% smaller** than installed v1. The matched benchmark used one
client at a time and 100% zoom, then restored daily v1 to its original 90% setting and verified all 14
original draft stores byte-identical.

| Median of three, unless noted | v1 | v2 |
| --- | ---: | ---: |
| Cold Activity launch | 82ms | 86ms |
| First-observed usable Home, visual upper bound | 1.964s | 1.432s |
| Matched conversation opening, one visual upper-bound sample | 795ms | 1,052ms |
| Native typing command | 120ms | 103ms |
| Complete typed text observed, visual upper bound | 385ms | 379ms |

Both scrolled the same 241-message coding conversation. Short frame samples were mixed; **no overall
speed/smoothness winner is established**. Screenshot/driver overhead makes visual timings upper
bounds. Native-regression JS static entry closure was 1.387MB raw; all optional/worker JS was
29.669MB raw. The available v1 dist is a dated snapshot, not an attested installed-v1 JS measurement.
The matched benchmark used the native-regression build immediately preceding the import fix.
See [performance measurements](v2-performance.md) and [matched workflow](v2-performance-live.md).

## Known limitations and unverified cases

- Masked OAuth edits are prompt-sensitive: a short delta prompt produced black fill. Full-region reconstruction succeeded and is now advised by the bundled skill. Masked OAuth transparency is explicitly unsupported.
- Correcting isolated fragments around protected mentions can add awkward punctuation/capitalization. Meaning/mention ranges are preserved. Parent Stop before admission remains an idle no-op; aborting the admission operation cleans the child correctly.
- API-key image/Claude modes, some credential-availability transitions, and simultaneous expiry/refresh contention were not independently exercised. Concurrent valid calls are not claimed as refresh-contention proof.
- Authenticated browser content/documents, Android-browser fallback, budget/retention extremes and some failure variants remain unverified. Public JS/chart/PDF and cancellation paths passed.
- Spoken IME dictation, native image clipboard/drop, some permission/deeper-child/clock-skew variants, and first-use web search selection specifically in the web client remain unverified. Android selected Exa through the actual picker; that server choice remains saved.
- Native compaction and the legacy AI-SDK bridge were not exercised; the attempted recognized Anthropic SDK override normalized to native. Manual summary compaction passed.
- Windows/macOS/musl executables built, but foreign-platform runtime execution was not verified. Production Android signing continuity and production application-data upgrade remain cut-over checks.
- One Claude-generated title was a poor refusal-style title despite an intact title prompt; no title-quality fix is claimed.
- The historical first imagegen record remains stuck; new records pass after the metadata fix. The upstream publisher's failure-settlement weakness is documented in the imagegen README.
- API-key imagegen now uses OpenCode's image API; it has never run live (no OpenAI API key in the development environment). Its results no longer include a changed-prompt caption, request ID or backend model.
- LAN scan on the device (2026-10-05): cancel in the same tick as start, cancel after 1 s, and closing the dialog mid-scan all return to idle, and later scans run. Every completed scan showed "Could not scan the local network": Tandem's Kotlin resolved `results` as a stringified list (`"[]"`), which the Rust bridge rejects (inherited from v1, which ignored the value). Fixed with `JSArray`; after rebuilding and reinstalling, the native scan returns a real list and completed scans no longer show the error. The cancel cases still pass. Discovery accepts only v2 servers on 4097/4096, so finding a server can't be checked until a v2 server runs on one of those ports.
- Upstream crash, not fixed (Jon's rule): in the web UI, the whole app can switch to "Something went wrong — The app interface is not mounted". OpenCode's review panel (`packages/gui-extensions/src/review/model.ts`, `layout.side.opened(view)` in a reactive check) asks the app layout about a session whose interface is not mounted, and `requireAttached` in `packages/app/src/runtime/extension/services.tsx` throws. Seen twice in headless Chromium with several session tabs open, when the viewport changed; Reload recovers. Newer upstream (`0a46301e36`, `host-apis.tsx`) returns `false` instead of throwing, so an upstream sync fixes it.
- Original inotify limits are restored to 128 instances / 77,755 watches. A fresh-location Read passed afterward; subscription warnings were seen during later TLS checks, without blocking those restarted workflows.

## Final evidence and follow-through

- `/tmp/tandem/v2/ready-final-state.json`: runtime, health, idle state, final Skill+Read smoke, mask guidance, limits, artifact count and credential-safe refresh comparison.
- `/tmp/tandem/v2/tui-smoke.json`: actual packaged TUI starts and clean exits.
- `/tmp/tandem/v2/release-stage-ready/{manifest.json,SHA256SUMS}`: current artifact inventory/checksums.
- No auxiliary/proxy/export/Vite task remains running. Temporary copy server 4099 and TLS proxy were stopped. The clean analysis reference clone was moved out of the project into scratch.

For cut-over, use a **fresh** consistent history backup—the trial copy is historical. Preserve the
original v1 database/config/app data and signing key for rollback. Explicitly select a new v2 database
path; an inherited `OPENCODE_DB` must not migrate the daily original. Adapt the production config to
the v2 auth-plugin entrypoint and model names, agree version/signing/artifacts, then follow
[release/install instructions](tandem-release.md). Production server restart, APK replacement,
commits and publication require Jon's instruction.
