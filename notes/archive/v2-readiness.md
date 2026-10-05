# Tandem v2 status

## Installed (switch-over 2026-10-05)

- Source: `/home/jon/code/Tandem-v2`, branch `tandem-v2`, on upstream `40679546d4` (`@opencode/cli`
  2.0.22). Version **2.0.22-tandem-v2.0**, built with Bun 1.4.2. The Claude plugin is
  `/home/jon/code/opencode-anthropic-auth-v2`, branch `tandem-v2`.
- Daily: `/usr/local/bin/tandem`, server on **4097**, app **Tandem**
  (`app.liddokun.tandem`, production signing), standard Tandem folders. Release copies (CLI, APK,
  AAB, manifest, checksums) are in `~/.local/share/tandem-v2/releases/2.0.22-tandem-v2.0/`.
- Tandem v1 fallback: server on **4095**, app **Tandem v1**
  (`ai.opencode.android.v1`), folders under `~/.local/share/tandem-v1/`.
- Development: server on **4098**, app **Tandem V2** (`app.liddokun.tandem.v2`),
  folders under `~/.local/share/tandem-v2/development/`.
- Setup details: [tandem-v2-configuration.md](../tandem-v2-configuration.md). Build/install: `contextL.md`.

Switch-over checks on the installed daily server: a ChatGPT session with the Corrector on ran a shell
command, and a Claude session delegated to the `general-sol` helper (only `general-sol` and
`general-astra` were offered). In the installed app, LAN discovery found the 4097 server and reported
that it needs credentials; a `tandem pair` link connected it; a prompt got a Claude reply; and a
relaunch reconnected without setup. v1 on 4095 answered with Claude and ChatGPT, and the Tandem v1
app connected and listed its history. Test sessions were deleted.

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
| History | v2's built-in v1 migration converted all 467 v1 sessions / 16,237 messages in 22 s with no warnings; 108 agent-test sessions were removed; conversations continue normally and attachments survived byte-for-byte |
| CLI/UI identity | Tandem copy/assets and T mark; packaged CLI version/help; real TUI startup/clean exit at 80/40/20 columns |


No low-level tests were added or run.

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

## Known limitations and unverified cases

- Masked OAuth edits are prompt-sensitive: a short delta prompt produced black fill. Full-region reconstruction succeeded and is now advised by the bundled skill. Masked OAuth transparency is explicitly unsupported.
- Correcting isolated fragments around protected mentions can add awkward punctuation/capitalization. Meaning/mention ranges are preserved. Parent Stop before admission remains an idle no-op; aborting the admission operation cleans the child correctly.
- API-key image/Claude modes, some credential-availability transitions, and simultaneous expiry/refresh contention were not independently exercised. Concurrent valid calls are not claimed as refresh-contention proof.
- Authenticated browser content/documents, Android-browser fallback, budget/retention extremes and some failure variants remain unverified. Public JS/chart/PDF and cancellation paths passed.
- Spoken IME dictation, native image clipboard/drop, some permission/deeper-child/clock-skew variants, and first-use web search selection specifically in the web client remain unverified. Android selected Exa through the actual picker; that server choice remains saved.
- Native compaction and the legacy AI-SDK bridge were not exercised; the attempted recognized Anthropic SDK override normalized to native. Manual summary compaction passed.
- One Claude-generated title was a poor refusal-style title despite an intact title prompt; no title-quality fix is claimed.
- The historical first imagegen record remains stuck; new records pass after the metadata fix. The upstream publisher's failure-settlement weakness is documented in the imagegen README.
- API-key imagegen now uses OpenCode's image API; it has never run live (no OpenAI API key in the development environment). Its results no longer include a changed-prompt caption, request ID or backend model.
- Windows/macOS/musl executables were built but never run on those platforms.
- Upgrading the Android app from v1 kept none of v1's app settings (saved server, open projects, zoom); the app was connected once and projects are re-added as needed.
