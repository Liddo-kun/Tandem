# Tandem v2 implementation progress

Scope: [v2-port.md](v2-port.md). Deferred work: [todo-after-v2.md](todo-after-v2.md).
This ledger records assignments, integration decisions and evidence; source changes alone are not acceptance.

## Current checkpoint — 2026-10-04

**Implementation and primary live verification complete. Current development artifacts are staged for Jon's trial/readiness decision.** See [v2-readiness.md](v2-readiness.md) for known limitations and unverified cases.

Latest runtime: packaged development ARM64 server **4098 / PID 27653**; daily 4097 healthy.
Installed V2 APK includes the final native fixes and approved import-event fix (`index-C69Cc6o8.js`,
PID 12165 at last device handoff). Current artifacts are **`/tmp/tandem/v2/release-stage-ready`**:
11 CLI variants, signed V2 APK/AAB, strict/common manifest and verified checksums.
All source is uncommitted; no publication or production cut-over.

## Current acceptance summary

| Area | Verified checkpoint | Evidence / remaining boundaries |
| --- | --- | --- |
| Claude | Saved Pro/Max login; real tools/children, caching/zero costs, signed thinking/off, natural refresh, final headers, generate/summary compaction and scoped self-signed endpoint | `v2-claude-live.md`, `v2-provider-final-acceptance.md`, `v2-claude-tls-live.md`; API-key/contended-refresh cases unverified |
| Bash search | Main/general own v2 shims; no Glob/Grep schemas/descriptions/harness references; Code Mode filtered; GPT and shell-denied explore retain tools; baseline relocation and durable updates correct | `v2-bash-search-live.md`; final Execute spelling fix built in packaged server |
| Imagegen | Persisted completed results; native generation/reference/alpha; text-only results and no image bytes in subsequent requests; Android Blob/lightbox and encoded-space path | `v2-imagegen-live.md`, `v2-imagegen-mask-investigation.md`; short mask prompt produced black fill, explicit full-region reconstruction succeeded; API-key mode unverified |
| Browser fetch | JS/chart reading, docs, PDF, bare reader context, no parent image bytes, invalid URL, capture/reader cancellation and tab/child cleanup | `v2-browser-live.md`; authenticated content, Android fallback and budget extremes unverified |
| Corrector | Android toggle/reload; queue on/off/edit/reorder/undo/resend/steer; images/mentions/suffixes; 600 boundary; child failure and HTTP-abort cleanup; 22 bare zero-tool requests | `v2-corrector-live.md`; fragment punctuation and pre-admission parent Stop limitations recorded |
| Auxiliary UI | Reproduced false deleted-child toast; deletion-aware typed-error fix; packaged 3/3 admissions with 3 cleanup404s and zero toasts | `v2-auxiliary-ui-fix.md`; `auxiliary-packaged-trace.json` |
| Android controls | Native/SwiftKey newline, caret delete-word, atomic mentions, persisted80–150% zoom; final landscape150 long-draft Send/caret visible | `v2-android-controls-live.md`, `v2-native-regressions-final.md`; spoken dictation unverified |
| Android workflows | Delete, rewind/replacement, image picker/paste-handler/reopen, child question background/resume, offline/reload recovery, X11 clipboard, Taobao, Exa picker/search/persistence, review and touch comment | `v2-android-workflows-live.md`; native-vs-injected paths and remaining cases recorded |
| Terminal | Theme visibility and rejected-ticket cloning fixed; native touch reveals rows030–075; same PTY survives APK/reload and continues commands | `v2-terminal-live.md`, `v2-native-regressions-final.md` |
| Plain-HTTP web | Basic-challenge startup fixed; packaged4098 wrong/right password form passes; source workflow passed images/Blob/reload, copy fallback and actual CORS | `v2-web-http-live.md`; `web-packaged-{reload,login}.log` |
| History copy | Backup 4.18s; 432/432 sessions and 14,300 messages migrated in 23.24s; first view without reload; real continuation and byte-identical PDFs/PNG | `v2-history-import.md`, `v2-import-ui-fix.md`; original read-only; copy runtime 4099 stopped |
| Release | 11 CLI variants + signed V2 APK/AAB; strict/common staging/checksums; packaged ARM64 version/server and real TUI starts | `tandem-release.md`, `/tmp/tandem/v2/release-stage-ready`; foreign-OS execution and production signing continuity pending |

Branding/configuration docs: `v2-branding-handoff.md`, `tandem-v2-configuration.md`, root
`PromptEnhance.md`, project-local v2 sync skill. Matched one-client-at-a-time performance evidence
is in `v2-performance-live.md`; no overall speed winner is established. Final smoke, idle state,
artifact count and restored original watcher limits are in `/tmp/tandem/v2/ready-final-state.json`.

- Worktree: `/home/jon/code/Tandem-v2`, branch `tandem-v2`.
- Pinned upstream: `40679546d4db07ba9dfb17160051c9a3109c438f`, version 2.0.22, Bun 1.4.2.
- V1 reference/daily checkout: `/home/jon/code/Tandem`, `e4cff2899425b8c3290be3a6309b9c1da9a173fb`.
- Development port reserved: 4098 (unused at initial inspection); daily 4097 remains running.
- Source plan and deferred list copied from their untracked v1 originals; original files preserved.
- Root upstream instructions retained and reconciled with Tandem scope, isolation, real-workflow verification and current v2 session semantics. New Linux/Windows context excludes obsolete v1 mandates.

## Ownership and completed handoffs

| Owner | Assignment | Files / shared boundaries |
| --- | --- | --- |
| Master | Integration, request-dump live acceptance, build/device scheduling and evidence | Root guidance, dependency/lockfile changes, launcher and shared registration |
| Completed Android workers | Native controls, workflows, terminal and packaged import fix verified | `v2-android-controls-live.md`, `v2-android-workflows-live.md`, `v2-native-regressions-final.md`, `v2-import-ui-fix.md` |
| Completed diagnostics workers | Native HTTP/WS and auxiliary final-send acceptance passed; legacy SDK route unverified | `tandem-request-inspection.md`, `v2-provider-final-acceptance.md` |
| Completed auxiliary/Corrector workers | Approved instruction hook, queue/cancellation workflows and packaged cleanup fix verified | `tandem-auxiliary-sessions.md`, `v2-corrector-live.md`, `v2-auxiliary-ui-fix.md` |
| Completed browser worker | Public-site/document/cancellation/reader isolation workflows verified | `v2-browser-live.md`; remaining authenticated/fallback cases recorded |
| Completed auth workers | Login, natural refresh, native requests and scoped insecure-TLS adapter verified | `/home/jon/code/opencode-anthropic-auth-v2/{V2.md,V2-TRANSPORT.md}`, branch `tandem-v2` at `ab44f3c` |
| Completed Claude workers | Presentation/Bash-search/native transport workflows verified | `v2-claude-live.md`, `v2-bash-search-live.md`, `v2-claude-tls-live.md` |
| Completed image workers | Separate login and generation/edit/alpha/terminal metadata verified; mask limitation documented in bundled skill | `core/src/plugin/tandem/imagegen/README.md`, `v2-imagegen-live.md` |
| Completed release worker + master | Current full development CLI/APK/AAB set built, signed/staged and smoke-verified | `tandem-release.md`, `v2-readiness.md` |

Heavy builds and device/browser interactions are serialized. Agents coordinate before editing shared files.
Jon requested fresh subagents for new tasks, avoiding long chains of follow-ups because compaction is unreliable. Use Astra for substantial tightly related work where sustained follow-through is useful. The above workers are idle/completed; assign subsequent new work to fresh contexts using their handoffs.

## Integration decisions

- No v1 patch replay. Prefer current upstream behavior, public extensions and Tandem-owned modules.
- Development must isolate all XDG roots, credentials, database, service election and implicit client spawning, not just the listen port.
- First Android checkpoint precedes broader provider/tool parallel implementation.
- Request diagnostics must capture final transformed provider payloads before provider/protocol acceptance.
- Corrector and browser-reader bare-context metadata/lifecycle conventions will be settled centrally before their implementation.
- API/persistence/feature tradeoffs go to Jon; routine implementation choices stay with agents.
- **Approved by Jon (2026-10-04):** optional `session.created.hasHistory` indicates imported settled history committed with creation. The client hydrates only that path; ordinary empty-session snapshot-race protection remains. Client generation and real import/new-session regression checks are required. **Reverted 2026-10-05 by Jon's decision.**
- **Approved by Jon (2026-10-04):** additive public `session.hook("instructions")` with `default | agent-only` selection before durable ambient instruction collection and automatic Read AGENTS.md injection. Implemented in both Effect and Promise surfaces; HTTP contract unchanged.
- **Claude custom endpoint:** preserve optional insecure-certificate behavior entirely in the external plugin through existing native-provider transport APIs. No additional public TLS hook approved or added. Fresh Astra worker completed the scoped provider wrapper; source typecheck passed. See auth plugin `V2-TRANSPORT.md`.
- **Image OAuth decision:** Jon first requested investigation with the existing conversation login. After normal provider execution refreshed it, real Responses returned `subscription_sharing_unsupported_capability` for `image_generation`, public Images returned `hardened_oauth_rule_missing`, and native Codex Images returned `no_matching_rule`/401. Jon then approved a separate saved image login. Keep primary token-sharing conversation credential active; implement a separate image integration via v2 credential APIs.
- Pinned Bun: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun`; global Bun stays 1.3.14. Official release asset SHA-256 verified against release metadata and SHASUMS256.txt.
- Development launcher: `bun script/tandem-v2.ts`; runtime base `~/.local/share/tandem-v2/development`, with separate `config`, `data`, `cache`, `state` XDG homes and staged `bin/tandem`. Password is in the mode-0600 `server-password` file, outside Git. Runtime scratch is `/tmp/tandem/v2/tandem`.
- Development server uses managed registration on 4098 (`serve --service --hostname 0.0.0.0 --port 4098`), so implicit clients share its isolated registration rather than creating an unrelated server. Source TUI uses an explicit URL.
- Android production config retains `app.liddokun.tandem`; `tauri.v2.conf.json` selects `app.liddokun.tandem.v2`. Development signing is separate under `~/.local/share/tandem-v2/android-signing`.

## Verification evidence

- 2026-10-03 — Git refs match the plan; new worktree created at the pinned upstream commit. Port inspection found daily v1 listening on 4097 and 4098 unused. No runtime/session acceptance claimed yet.
- 2026-10-04 — CLI with embedded UI built using Bun 1.4.2; staged version `2.0.22-tandem-v2.0`. Isolated `/api/info` reports port 4098 and scratch `/tmp/tandem/v2/tandem`. Registration is under development `state/tandem/service.json`; implicit `cli api GET /api/info` connects to the same PID as the explicit server. `debug paths` confirms all isolated roots/database. `upgrade --method curl` prints the manual Tandem releases URL. Daily v1 `/global/health` remains HTTP 200.
- 2026-10-04 — Jon authorized built-in ChatGPT token-sharing login; credential persisted through v2's normal integration flow. Session `ses_efd581482ffeXV5HSFJbDtRwC1` on `openai/gpt-5.6-sol` completed actual `read` and `shell` calls. Reported marker, 119-byte count and SHA-256 matched independent filesystem observation. Evidence: `/tmp/tandem/v2/first-session.jsonl`; stderr empty. No low-level tests preceded it or were run.
- 2026-10-04 — First signed Android release APK built: ID `app.liddokun.tandem.v2`, version 2.0.22 / code 2000022, arm64-v8a, 16,368,729 bytes. V2 signature verified with separate development key. Device behavior not yet accepted. Build logs: `/tmp/tandem/v2/android-build.log`, signature/badging logs in the same directory. Gradle installed SDK37; runnable-aapt2 selection fixed. Temporary inotify increases were restored.
- 2026-10-04 — Private-spawn session `ses_efd45a944ffeJm8rQB7TO8jZml` ran through `cli run --standalone` with saved ChatGPT credentials, completed real reads and returned the correct marker. Evidence: `/tmp/tandem/v2/standalone-session.jsonl`; stderr empty. Neither daily v1 nor the registered v2 server was replaced.
- 2026-10-04 — Updated signed APK installed side-by-side and opened. Manual LAN connection `http://192.168.1.85:4098` with actual Basic authentication succeeded through native WebView/shared connect flow. Android composer submitted a new prompt in `ses_efd581482ffeXV5HSFJbDtRwC1`; real shell `wc` completed and the rendered answer was `ANDROID_V2_TOOL_OK 119`.
- 2026-10-04 — Created text draft and `v2-draft-image.png` through the real composer/file input, force-stopped only `app.liddokun.tandem.v2`, and cold-relaunched. Saved connection restored without onboarding; reopening the session restored the exact draft text and 192×192 image. Image Blob URL changed from `0366527f-...` to `5bdb036e-...`, with nonzero natural dimensions. Evidence: `/tmp/tandem/v2/android-draft-{before,after,restored}.log`, `/tmp/tandem/v2/android-checkpoint.png`. Native activity launch measured 105 ms; this is not a full rendered-startup benchmark.
- 2026-10-04 — Request diagnostics: six actual Read+Shell sessions passed across HTTP/WebSocket × enabled/disabled/unwritable. Final main-request body and tool-description markers added by a normal final HTTP/WS plugin are present in captures; title auxiliary requests are separately attributed. Disabled emits zero dumps/warnings; unwritable emits one fixed warning and still completes. Eight enabled dumps compared against stored access/refresh/server credentials: zero matches; files mode0600. Evidence `/tmp/tandem/v2/request-*-summary.json`, `request-dumps/`. Child/generate/compaction and AI-SDK route acceptance remain pending.
- 2026-10-04 — Ordinary private-spawn session `ses_efaf20381ffecmyF8xq3MfwXa7` refreshed the existing ChatGPT authorization normally and completed a real Read. Refreshed credential enabled decisive image capability errors described above. Evidence `/tmp/tandem/v2/refreshed-session.jsonl`, `image-capability-{responses,images,codex}.json`; no image generated by those probes.
- 2026-10-04 — Separate `tandem-openai-images` authorization completed and persisted alongside the unchanged conversation login. Temporary callback-helper JSON parsing caused a false browser error after successful HTTP 204; helper fixed. No repeat authorization needed.
- 2026-10-04 — Corrector session `ses_efabdb2a9ffeeGlZmUt1W2KQVe` stored corrected text and original/range metadata, then returned the expected marker after Read. Child `ses_efabdaaeeffeasREu7mngsfrqo` final request contains only correction instructions/raw input and zero tools. Evidence `corrector-default-messages.json`, `corrector-default.jsonl`, `request-dumps/corrector-default/`. Initial failures inherited unavailable v1 DeepSeek/nothink overrides; development `environment.json` now clears them and registered servers have received the clean settings.
- 2026-10-04 — Image session `ses_efabb6299ffel3PDQvgz3Pg0mm` produced a valid1254×1254 PNG/JPEG but remained running in persistence. Imagegen now omits undefined backend metadata fields that violate durable event JSON encoding. Rebuilt session `ses_efa948758ffeCT7sSxxpfvTwNX` and subsequent edit/alpha/mask calls persist completed results; old record not rewritten. Evidence `imagegen-state-diagnosis.json`, `first-integrated-acceptance.json`; core-settlement finding in imagegen README.
- 2026-10-05 — Review round applied Jon's decisions. Reverted to upstream: web `credentials:"omit"`, both terminal fixes (reactive reveal, ticket-failure recovery), three queue-edit fixes (Corrector snapshot plumbing kept; cases recorded in `todo-after-v2.md`), all `packages/desktop` branding. Moved out of upstream files: request dump (`core/src/plugin/tandem/request-dump/`; `ai` executor/websocket pristine), Read/shell/patch wording (`tool-guidance` plugin via tool `transform`; tool files pristine), imagegen/webfetch card registration (`session-ui/src/tools/tandem-tools.ts`). Replaced the session-not-found fix with a deleted-session set (11 lines). Imagegen API-key mode now uses `@opencode/ai` `image.generate`. Claude refresh drops failed rotations. Crash-report link keeps the bug-report template; error page says "on GitHub" with the GitHub icon. aapt2 lookup consolidated (`findAndroidAapt2`), unused bridge `available`/`send` removed, LAN scan cancel-before-start fixed.
- 2026-10-05 — Verification: ai/core/client/app/tui/session-ui/gui-extensions/android typechecks pass; dev CLI rebuilt and server restarted (PID 21241); V2 APK rebuilt and installed. Real GPT (Corrector on) and Claude sessions with Read/shell succeeded; dumps in `request-dumps/integrated-2/` carry attribution, one file per send, and Read/shell/patch descriptions identical to the previous build's dumps. Repeated GPT sends were OpenAI `server_is_overloaded` retries (`session.retry.scheduled`), each captured. Web UI (headless Chromium, CDP): four Corrector prompts each produced a real child-session 404 with no error shown; webfetch card (answer preview) and imagegen card (thumbnail, image viewer) render. Tablet was locked, so on-device checks (LAN scan cancel, APK UI) were not run. Unrelated upstream crash observed: see `v2-readiness.md`.
- 2026-10-05 — Device check, V2 APK rebuilt twice: 4 Corrector prompts hit the deleted-session 404 race with no error shown. LAN scan cancel cases (same tick, after 1 s, dialog closed) return to idle. Fixed Tandem's Kotlin `scanNetwork` result (stringified list → `JSArray`), which made every scan show "Could not scan the local network"; verified after reinstall.
- 2026-10-05 — Jon's v1 history imported into the development server (4098) for daily v2 use. Read-only snapshot of `~/.local/share/tandem/opencode-dev.db` migrated by v2's built-in v1 migration (467/467 sessions, 16,237 messages, 22 s, no warnings) on a temporary 4099 runtime. 108 v1 agent-test sessions (`/tmp/tandem/*` and `chrome-rollout-*` folders) deleted from the copy; 105 top-level sessions (358 with sub-sessions) kept. Logins (`credential`) and `kv` settings copied from the previous development database; the old one is kept as `opencode.db.before-history-import`. ChatGPT and Claude prompts succeeded afterward. Per-session counts match v1 except compaction summaries (folded into compaction records) and messages written after the snapshot. Termux:Widget `tandem-v2` starts the server after a reboot (tested via the widget path).

## Shared-code seams

Historical port-time summary; several items below were later reverted or moved (see the 2026-10-05 entries above). The current, canonical divergence inventory is [`logv2.md`](../logv2.md).

- `AGENTS.md`: Tandem implementation scope/isolation/verification guidance overrides upstream daily-service discovery and blanket static-check instructions; upstream architecture/style guidance retained.
- Util `brand.ts`/global roots and client service variants: centralized product identity and Tandem local-service discovery/spawn; provider/package/wire conventions unchanged.
- CLI command/build/update/install detection: Tandem command/help, manual-only update public boundary, upstream `cli-<target>/bin/opencode` artifact layout retained and staged as `tandem`.
- CLI `pair`: explicit `--server` support so pairing can target the isolated server without implicit service discovery.
- App platform/storage/connect/shell: optional Android capabilities, native persistence, browser draft-store export, discovery/auth help and one inset owner. Desktop-only file-manager typing narrowed for Android platform branch.
- App extension adapter presents Android's web renderer as the existing `web` SDK platform; desktop native extensions remain desktop-only.
- Android template enables WebView debugging only for exact development ID `app.liddokun.tandem.v2`; production release behavior unchanged. Master uses forwarded CDP port 9224 for real WebView workflows and ADB screenshots.
- Context/instructions: additive instructions hook before baseline discovery/Read injection; owned Claude/Bash-search presentation at request/catalog seams; internal baseline marker relocates only the rendered baseline, preserving durable epochs.
- Client `solid/data.ts`: background refresh ignores only a matching typed missing-session error when deletion was observed; late deleted metadata cannot repopulate stores. Explicit missing-session reads remain errors.
- Web platform fetch omits ambient browser credentials while retaining explicit connection Authorization, allowing HTTP401 to reach the connection form.
- Composer: native newline line-box placeholder, atomic delete-word, caret reveal and viewport-readiness sizing. Terminal: reactive visibility, bounded ticket-failure retry and native touch via public `scrollLines`.
- Session creation: approved optional `hasHistory` in the event schema, set by nonempty imports atomically with their rows; only that client path hydrates history. Generated client updated; packaged first-view/new-session/continuation checks passed. **Reverted 2026-10-05 by Jon's decision.**
- Promise plugin `DeepMutable` preserves branded scalar identity rather than mapping it into a string-like object. Type-only compatibility fix; external v2 auth source check aligns `noUncheckedIndexedAccess` with the host and passes.

## Blockers / unverified

- Remaining credential/platform/edge-case boundaries and model-quality limitations are explicit in `v2-readiness.md`; they are not blanket pass claims.
- Inotify limits are restored to the original **128 instances / 77,755 watches**. Fresh-location real Read passed after restoration. Some later TLS checks logged subscription warnings without blocking restarted workflows. No persistent sysctl file added.
- Installed v1 APK is 18,114,186 bytes; current V2 APK is 16,373,697 bytes (~9.61% smaller). Matched runtime samples do not establish an overall speed winner. JS measurements use actual dist/chunk graphs, not empty APK `.js` entry counts.
