# Tandem on OpenCode v2 — implementation plan

## Acceptance status

The port is complete; the final state is summarized in [v2-readiness.md](v2-readiness.md). A ticked
item was exercised through real sessions or the real app; its "Not verified" note lists sub-cases that
were not. An unticked item is open, skipped by Jon's decision, or could not be exercised, as its note
says. The per-feature evidence reports written during the port were removed after the port commit
(`bbd2f235e6`); Git history keeps them.

Build an Android-first Tandem on OpenCode v2, with the retained features specified below and less
divergence from upstream. This document defines the implementation scope and completion criteria;
the changelog is not a prerequisite. Reuse working Tandem-owned code where useful, adapting its
integration to v2 rather than replaying the old patches.

Source baseline: `upstream/v2` at `40679546d4` (2026-10-03, `@opencode/cli` 2.0.22).
References labelled **v1** mean Tandem at `e4cff28994`; other source paths are v2 candidates.
Those candidates come from source review, not live validation. Confirm their contracts when implementing.

## Scope and working rules

- Target **1–3 days**, starting with an isolated server and a working Android agent session. After that
  checkpoint, provider/tool work and Android refinement can proceed in parallel with clear ownership.
- Keep the Tauri/Kotlin Android wrapper. Trim unused code and measure performance; bring a wrapper
  replacement to Jon only if measured overhead warrants it.
- Prefer equivalent upstream behavior, then configuration and public plugins/extensions. Keep custom
  logic in Tandem-owned modules and shared-code changes narrow. This must preserve the specified
  functionality. Direct edits to the two GPT prompt files are explicitly accepted.
- Agents decide routine implementation details. Bring important feature, architecture, persistence or
  API tradeoffs to Jon before changing direction; a difficult integration is not permission to drop it.
- Mark an item complete after exercising its behavior through a real session/client workflow and
  recording a short result. First verification is a real agent session with actual tool calls. Build
  as needed to run it; builds/typechecks alone do not establish feature readiness. Do not add or run
  low-level tests unless Jon requests them.
- Deferred work is in [Todo after v2 implementation](todo-after-v2.md): custom subagent controls,
  file-discovery and provider-error investigations, iOS, interactive Chrome control, chat appearance,
  context/cache indicators, manual refresh, mobile title/tab customization and Claude narration.
- Excluded: RePrompt duplication, custom Android voice/microphone/speech-locale integration, LSP work
  and restoring `todowrite`. Ordinary keyboard/IME dictation remains supported.

## 1. Isolated server and first Android session

### Development environment and identity

- [x] Create a separate worktree/branch from `upstream/v2`. Give development its own server port,
  configuration, credentials, database, cache/state and service registration. Verify client spawning
  and connection discovery cannot attach to the daily v1 server by mistake. Keep v1 running throughout.
- [x] Establish v2 implementation guidance in that worktree before coding: reconcile `AGENTS.md`,
  Windows/Linux context and compatibility rules with this plan and current upstream instructions.
  Remove mandates to restore voice, forced layouts, review caps or other dropped/deferred patches.
  Use this plan to define retained features rather than requiring the v1 changelog. Preserve applicable
  build/environment guidance and document intentional shared-code seams as implementation proceeds.
- [x] Use v2's pinned Bun 1.4.2 for this work (the tablet currently has 1.3.14), and build a Linux ARM64
  CLI with `bun run --cwd packages/cli build --single`. Resolve actual toolchain blockers before
  depending on additional feature work.
- [x] Establish Tandem's CLI/product identity and filesystem roots. The production command is `tandem`;
  production config/data/cache/state use Tandem roots, separate from official OpenCode. Development
  overrides must also isolate them from Tandem v1. Centralize branding without renaming upstream
  package scopes, provider IDs, wire fields or configuration conventions unnecessarily.
- [x] Make updates manual: no upstream auto-update checks/installations; `tandem upgrade` directs the
  user to `https://github.com/Liddo-kun/Tandem/releases`.
- [x] Start the development server with `tandem serve --hostname 0.0.0.0 --port <unused-v2-port>`.
  `serve` hosts the UI; v2 has no `web` command. Configure a stable development password through
  `OPENCODE_SERVER_PASSWORD`; the Basic-auth username is `opencode`. Use a separate development
  launcher. Updating the daily `tandem-web` widget/port 4097 belongs to cut-over, not groundwork.

Starting points: `packages/util/src/global.ts`, a Tandem brand module,
`packages/client/src/effect/service.ts`, `packages/cli/script/build.ts`,
`packages/cli/src/commands/commands.ts`, `server-process.ts`, `services/updater.ts`,
`commands/handlers/upgrade.ts`.

### Android connection and persistence

- [x] Build a separately installable **Tandem V2** APK from the existing Android shell, with its own
  application ID and app data. Mount v2's shared app, update dependencies/imports to `@opencode/*`,
  and retain the native bridge/build infrastructure needed below.
- [x] Provide working manual server entry, LAN discovery and connection/setup help. Use `/api/info`
  and v2's password/pairing flow; distinguish a reachable server requiring credentials from an offline
  server. Support the chosen development port by manual URL, and retain discovery preference for
  4097 with 4096 fallback. Explain that this app requires a v2 server. Persist the selected/default
  server and its connection credentials so relaunch reconnects without onboarding again.
  - After the switch-over, discovery in the installed app found the daily server on 4097 and reported that it needs credentials; a pasted `tandem pair` link connected it, and a relaunch reconnected.
- [x] Connect shared persistence to Android's native async storage for settings and server state.
  Register v2's browser draft store for text/attachment drafts: image bytes must not be serialized
  into settings on every keystroke, and attachments must survive relaunch without dead `blob:` URLs.
  Preserve existing settings where practical when the production app is upgraded.
  - In the real upgrade from v1 (2026-10-05), v1's saved server and settings did not carry over (different storage format); the app was connected once.
- [x] Integrate the Android platform contract: native external-link opening, local notifications,
  haptics, sharing, page-zoom accessors and foreground/resume events. Keep platform APIs optional
  for other clients and use upstream equivalents where available.
  - Not verified: notifications, haptics and sharing on the device.
- [x] Give native safe-area and keyboard insets one owner. The composer and titlebar must remain
  visible without doubled status-bar padding, including after rotation and at non-default zoom.

V1 reuse: `packages/android/src/{entry-android.tsx,onboarding.tsx,storage.ts,bridge.ts}`,
`packages/android/src-tauri/`, `packages/android/install-y700-variant.ts`.
V2 integration: `packages/app/src/{index.ts,runtime/platform/platform.tsx,runtime/persistence/storage.ts}`,
`servers/connect/`, `shell/shell.tsx`, `shell/titlebar/titlebar.tsx`; export/register
`createBrowserDraftStore` if the wrapper cannot already access it.

**First checkpoint:** the side-by-side APK connects to the isolated server, completes a ChatGPT-authenticated
agent turn with real tools, and restores its server connection plus a text/image draft after relaunch.
Use built-in ChatGPT login (`packages/core/src/plugin/provider/chatgpt.ts`); do this before full Claude parity.

**Passed 2026-10-04:** signed `app.liddokun.tandem.v2` connected to isolated port 4098,
completed an Android-submitted ChatGPT shell call, and recovered its connection and text/image
draft after force-stop/relaunch.

### Optional history import

- [x] Quickly try v2's existing importer on a **copy** of `~/.local/share/tandem/opencode-dev.db` in
  isolated storage. Startup migrates the selected database in place. Open a few conversations with
  tool results/attachments and continue one. Report the result; take the straightforward import if
  it works. Importing history is optional and must not become a separate migration project or block release.

## 2. Android usability and performance

### Retained controls

- [x] Add persisted page zoom with a mobile settings control and hardware-volume-key stepping.
  Use the current 80–150% range, 2% steps and 100% default. Keep native pinch zoom disabled; scale
  viewport height and safe-area compensation with zoom so the editor stays aligned with the keyboard.
- [x] Make Enter insert a newline on Android; the send button submits. Native delete-word must edit
  at the caret without corrupting mentions or losing selection. Ordinary IME dictation must work.
  - Not verified: spoken IME dictation.
- [x] Make chat/tool copy actions use `navigator.clipboard.writeText` first, with hidden-textarea
  `execCommand("copy")` fallback when unavailable or rejected. Verify copying into a Termux:X11 app
  on the tablet, as well as copying from the web UI over plain-HTTP LAN.
- [x] Allow Android Markdown links to open Taobao item-detail URLs via `taobao://` and the native
  opener. Keep that protocol opt-in to Android and restricted to the existing item-detail capability.
- [x] Verify the upstream first-use web-search provider selection in both web UI and Android. The
  user can choose a provider, the choice persists and real searches use it. Fix integration gaps
  through that flow; do not seed Exa or another provider as the default.
  - Not verified: first-use selection in the web client (Android picked Exa, kept it and searched).
- [x] Supply English labels/help for the retained mobile controls and Corrector using the existing
  translation fallback mechanism. Do not recreate strings for removed/deferred controls.

V1 references: `packages/app/src/{context/settings.tsx,components/prompt-input-v2.tsx}`,
`components/prompt-input/editor-dom.ts`, Android's `MainActivity.kt` template and generated-code patcher,
`packages/android/src-tauri/capabilities/default.json`.
V2 candidates: app composer/settings, `runtime/i18n/`, `servers/connect/dialog.tsx`,
`packages/session-ui/src/message/message-content.tsx` and `components/markdown-cache.tsx`.
Check all copy entry points rather than assuming a single helper covers them.

### Manual device acceptance

Exercise these through the real Android app as soon as the first APK works. They specify outcomes,
not old fixes to transplant. Record what happened; change code only for demonstrated gaps.

- [x] Open session overflow → Delete; exercise cancel and confirm. The confirmation appears and
  deletion completes without a swallowed dialog.
- [x] Open ordinary, empty/error and large review/diff views. Results or errors are usable and the
  app remains responsive. Determine any needed fallback/limit from evidence; no automatic 100-file cap.
  - No limit was needed. Not verified: review-error presentation.
- [x] Add an inline file comment by touch and drag terminal scrollback to earlier output.
- [x] Type in a long conversation, open/close the keyboard, scroll the timeline and drag the attachment
  strip horizontally. Check caret position, composer visibility and scroll stability in both orientations.
  - Landscape at 150% hid Send under the keyboard; fixed and rechecked. Not verified: long-conversation
    scroll stability and dragging a multi-attachment strip.
- [x] Rewind a conversation and promptly send replacement text. Visible history and actual execution
  agree; the replaced turn must not reappear or run unexpectedly.
- [x] Background/resume while a child/nested session requests permission or asks a question. The prompt
  appears, accepts an answer and clears correctly. Reconnect after lost network/server restart and
  recover messages/status without stuck streams or duplicate optimistic messages, including clock skew.
  - Not verified: child permission prompts, deeper nesting and clock skew.
- [x] Attach images through supported picker/paste/drop paths, send them and reopen the session.
  Also exercise web attachments over plain-HTTP LAN; lack of `crypto.subtle` must not silently break them.
  - Not verified: native image paste from the clipboard and drag-and-drop.
- [x] Connect from web and Android with actual authentication/CORS preflight, load providers, and
  reopen the saved default server. Production Android must not show a misleading DEV/BETA badge.
  - The installed production app shows no DEV/BETA badge.
- [ ] Check that a provider safety-filter rejection appears as a visible error rather than an empty
  successful response when such a rejection can be exercised; record an unavailable case as unverified.
  - Not verified: no rejection could be triggered.

Likely investigation sites: app session timeline and synchronization, `packages/gui-extensions/src/review`,
`packages/gui-extensions/src/terminal/terminal.tsx`, and shared file/comment components.
Native v2 recovery can satisfy these checks without the deferred manual-refresh button.

### Speed and bundle size

- [x] Capture a small same-tablet comparison between the current app and first working v2 APK:
  cold start, session opening, long-transcript scrolling, composer responsiveness, APK size and JS
  bundle size. Use comparable conversations and record material differences.
- [ ] Inspect the Android import/build graph and remove unused desktop/Electron integrations,
  obsolete v1 adapters and duplicate UI paths from the mobile bundle. Lazy-load substantial optional
  views where measurements justify it.
  - Skipped by Jon's decision (2026-10-05): desktop-only extensions (browser/updater/ssh/wsl) are
    registered eagerly but their heavy views are already lazy (~17 KB at startup); trimming would only
    reduce APK size and needs an Android-only build alias.
- [x] Resolve measured startup/rendering/resume regressions. Remove unnecessary listeners, polling
  and persisted payloads; verify attachment drafts remain efficient. Bring feature cuts or native-shell
  changes to Jon rather than using them as unreviewed performance shortcuts.
  - The matched benchmark found no overall regression (figures in v2-readiness.md), so nothing was cut.

## 3. Provider behavior and prompt correction

Implement these through v2's provider/plugin system. Candidate APIs are `integration.transform`,
`tool.transform`, `agent.transform`, `skill.transform`, session `prompt`/`context`/`generate`/request
hooks and shell hooks. Hook names alone are not proof of a complete integration: establish where
configuration resolves, history is assembled, tool calls are validated and provider requests are sent.

### Request inspection

This is a prerequisite for provider/tool protocol acceptance, including work assigned in parallel.
The first Android checkpoint can proceed without it.

- [x] Provide opt-in `TANDEM_DUMP_REQUEST=<directory>` diagnostics early enough to validate provider
  integration. Capture final provider-facing bodies/tool schemas after transformations, identify the
  session/agent/model and cover relevant HTTP/WebSocket auxiliary requests. Keep credentials out of
  dumps; diagnostic write failures must not fail the turn. Distinguish any earlier internal snapshot
  from what was actually sent. Unset means disabled.
  Exercise disabled mode, final transformed payload capture and a non-writable output location through
  real requests; confirm credential exclusion and nonfatal failure on applicable HTTP/WebSocket paths.
  - Not verified: the legacy AI-SDK bridge route.

### Claude subscription login

- [x] Adapt the separately maintained `~/code/opencode-anthropic-auth` plugin to v2 and load it through
  normal plugin registration. Offer Claude Pro/Max browser login with PKCE/state validation and manual
  callback/code entry. Persist tokens/expiry through v2's credential API, refresh expired credentials
  and coordinate concurrent refreshes so rotated tokens are not reused. Subscription costs display
  as zero, including cache costs. Verify login, persisted reuse, refresh and a real tool-using session.
  - Not verified: two refreshes racing for the same expired credential.
- [x] Keep OAuth transport in that plugin: Bearer authorization rather than `x-api-key`, required beta
  headers and Claude CLI user agent, with API-key authentication unaffected. Preserve its existing
  custom-endpoint configuration. Apply the transport to auxiliary Claude requests too; Tandem's
  prompt/tool/body customizations below remain Tandem-owned.
  - Not verified: Claude API-key sessions.

Reuse the plugin's `src/{auth,pkce,transform,constants}.ts`; v2 API starting points are
`packages/plugin/src/promise/{integration,session}.ts`. Authentication precedes live subscription checks.

### Claude prompt and request presentation

- [x] Assemble a Claude-only prompt using the Claude Code-shaped base body from v1
  `packages/opencode/src/session/prompt/anthropic.txt`. It requires concise, self-contained final
  answers and task completion rather than promises, while allowing assessment-only requests to stay
  assessments. Inject runtime environment/memory separately. Put resolved instruction-file content in
  a first-user `<system-reminder>` without duplicating it in the system body; preserve v2's durable
  instruction updates throughout the session. List skills once as Markdown `- name: description`
  entries, and have skill instructions/parameter descriptions point to that list.
- [x] Present Claude Code-style tool names and selected parameter keys to Claude while preserving
  v2's internal tool contracts. Map definitions, schema properties/required keys and historical calls;
  reverse structured responses before internal lookup, validation, permissions and execution. Preserve
  call IDs/results, text, thinking and signatures. Rewrite specific tool-name references in descriptions,
  not arbitrary prose or raw SSE. Inspect v2's actual catalog, including Code Mode, before choosing the seam.
- [x] Add the separate first billing system block containing `cc_version=2.1.280.<suffix>`,
  `cc_entrypoint=cli` and `cch=<hash>`, using the established first-user-text hashing algorithm from v1
  `session/llm/request.ts`. Use the environment introduction `Environment context you are running in:`.
  Apply Claude request presentation to both OAuth and API-key sessions, not unrelated providers.
  These version constants are the starting baseline; revise them if live protocol evidence requires it.
  - Not verified: Claude API-key sessions.
- [x] Exclude that billing block from cache breakpoints. Use one-hour TTLs for supported
  Anthropic-shaped cache hints (including the retained OpenRouter/Alibaba behavior), within provider
  breakpoint limits. Only if the final resolved thinking mode is `enabled` or `adaptive`, send
  `context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] }` with the matching
  context-management beta. Thinking-off auxiliary calls must omit it. Preserve thinking/signature and
  opaque redacted-thinking content through history round trips.
  - Not verified: OpenRouter/Alibaba cache hints.
- [x] Verify final requests and tool round trips in main and auxiliary/child sessions, including
  thinking-on/off, an instruction update and a subsequent cached turn. Coordinate the tool catalog
  with Bash-search filtering before provider-facing mapping.

Mapping contract, adapted to the tools v2 actually exposes:

| Internal role/key | Claude-facing form |
| --- | --- |
| Question tool / task tool | `AskUserQuestion` / `Agent` |
| Shell, read, edit, write, skill, webfetch, websearch; glob/grep when present | Corresponding Claude-style names (`Bash`, `Read`, `Edit`, `Write`, `Skill`, `WebFetch`, `WebSearch`, `Glob`, `Grep`) |
| Other tool names | Existing initial-capitalization fallback; `StructuredOutput` unchanged |
| Read/write/edit `filePath` | `file_path` |
| Edit `oldString`, `newString`, `replaceAll` | `old_string`, `new_string`, `replace_all` |
| Grep `include`; Skill `name`; Task `background` | `glob`; `skill`; `run_in_background` |

Do not rename nested `questions[].multiple`, websearch's `numResults`/`contextMaxCharacters`, or ordinary
prose words such as “name” and “background”. The reusable mapping algorithm is in v1
`packages/opencode/src/provider/claude-code-tool-disguise.ts`; its AI-SDK middleware is not the v2 integration.
Other v1 references: `session/{system.ts,llm/request.ts}`, `provider/transform.ts`, `skill/index.ts`.
V2 candidates: `packages/core/src/skill/instructions.ts`, `tool/plugin/skill.ts`,
`packages/ai/src/{cache-policy.ts,protocols/anthropic-messages.ts}`. At the assessed revision, the latter
types only compaction context-management edits; correct `clear_thinking` serialization **and beta selection**
need validation. An execution hook is insufficient if reverse tool mapping happens after validation.

### GPT and shared instructions

- [x] Edit `packages/core/src/plugin/system-prompt/{gpt,gpt-astra}.txt` directly. Include Jon's physician
  context and understanding of off-label/non-approved treatments; communicate plainly and substantively,
  without filler, unsolicited caveats or invented contrasts. Treat action requests as instructions to
  finish the work. Keep commentary useful and brief, final answers self-contained, changes focused and
  delegation selective. Retain the default against routine test-writing and preference for real-workflow
  verification. Reuse the corresponding v1 prompt text, adapting tool references/routing to v2.
- [x] Inject shared scratchpad guidance using the actual runtime temporary directory: **ALL temporary
  files** belong there, it exists and is pre-approved, and plain `/tmp` is used only on explicit request.
  Also explain saved-image presentation: Markdown image links resolve against the session directory,
  use forward slashes/URL-encoded spaces, and UI display does not itself give images to the model.
- [x] Keep tool guidance short and actionable: targeted Read ranges and no reread after one's own
  successful edit; prefer dedicated tools but allow shell when requested, necessary or more efficient;
  use workdir, quote spaced paths and limit long output while retaining useful logs. Keep shell-specific
  chaining rules and describe apply_patch as combined write/edit/delete/rename. Refer only to tools
  actually available, including when Claude Bash-search is active.
- [x] Inspect a real outgoing request for each applicable GPT prompt family and complete an ordinary
  tool-using session. Confirm the intended prompt preferences, actual scratchpad path, image guidance
  and tool descriptions, with no instructions referring to unavailable tools.

Starting points: `packages/core/src/instructions/builtins.ts` and `tool.transform`.
V1 prompt/tool text lives under `packages/opencode/src/session/prompt/` and `src/tool/`.

### Corrector

- [x] Implement automatic text correction before the main turn, default on. Correct spelling,
  punctuation, capitalization, wrong-word autocorrect, dictation artifacts and clear technical
  symbols/paths without answering the message or elaborating its intent. Correct nonempty,
  nonsynthetic text parts up to 600 trimmed characters each by default; leave attachments/context
  parts intact. Store/display accepted corrected text and retain changed originals in
  `tandemPromptCorrectorOriginal` metadata.
- [x] Run correction with only its correction instructions and raw text: no tools or inherited project
  instructions, and no recursive correction. Reuse the existing correction prompt and bounded-edit/
  expansion acceptance checks; rejected, empty or failed corrections retain the original text.
  Clean up hidden auxiliary sessions on completion/cancellation; debug mode may retain visible sessions.
- [x] Add a persisted per-client **Corrector** on/off composer control. Snapshot its state into each
  submitted/queued prompt (`tandemCorrectorDisabled` when off) and retain it through queue editing/resend;
  later toggles must not change already queued prompts. Migrate old `on`/`no-reprompt` to on and `off`
  to off if old settings are read; the older boolean `reprompt:false` also means correction stays on.
  Do not duplicate prompts or inject `Read it again:`.
- [ ] Support `TANDEM_PROMPT_CORRECTOR` (default on), `_MAX` (600; 0 uncapped), `_MODEL`, `_VARIANT`,
  `_DEBUG` (off) and `_DEBUG_KEEP` (2; 0 unlimited), with suffixes on the same base name. Select model
  by corrector override → `small_model` → available cheap model for the session provider → session model.
  Reevaluate the old `tandem run` disablement against v2 rather than preserving a workaround by default.
  - Implemented (default model selection and the 600 limit passed live; `tandem run` is no longer
    disabled). Not verified: the model/variant overrides, `small_model`, debug retention and `tandem run`.
- [x] Exercise on/off, correction rejection/failure, attachments and two queued prompts with different
  toggle states. Inspect the stored message and main request; verify correction stays isolated from
  normal tools and from the browser reader's internal prompts.

Reuse v1 `packages/opencode/src/plugin/prompt-corrector.ts` for correction/model-selection logic,
excluding RePrompt. V2 candidates: session `prompt`/`context` hooks, bundled registration in
`packages/core/src/plugin/internal.ts`, and `packages/app/src/composer/`. Confirm that the prompt hook
updates authoritative stored text, not just transient model context.

## 4. Tools and media

### Image generation and editing

- [x] Provide an `imagegen` tool and built-in skill, sharing credential availability and the
  `TANDEM_IMAGEGEN` opt-out. Use v2's integration API for credentials/refresh. Preserve credential
  preference: stored OpenAI API key, `OPENAI_API_KEY`, then ChatGPT OAuth. User skills can override
  the bundled skill. Credentials must determine the exposed controls, with no silently stale schema.
  - Not verified: API-key mode (no OpenAI API key available).
- [x] Generate one image per call. OAuth exposes `prompt`, up to 10 local `image_paths`, a PNG alpha
  `mask_path` for the first input (transparent areas editable), and `transparent` (default false).
  Resolve inputs against the session directory. API-key mode additionally exposes required width/height
  (multiples of 16, ≤3840 per edge, ≤3:1 ratio, 655,360–8,294,400 pixels) and quality
  `medium|high|xhigh|max` (default high).
  - Not verified: API-key mode (no OpenAI API key available).
- [x] Use native Codex Images for ordinary OAuth generation/edits, with backend-managed size/quality;
  preserve the Responses image-tool route for OAuth masks. Use public Images generation/edit endpoints
  for API keys (`gpt-image-2.5-sunburst`). Send prompts directly where supported; report changed returned
  prompts. Do not advertise a verified OAuth model/size/quality selection. Surface unsupported masked
  transparency honestly; validate actual alpha when native transparency is requested.
  - Not verified: API-key mode, which since the 2026-10-05 review uses OpenCode's image API and no longer reports a changed prompt, request ID or backend model.
- [x] Save the original PNG under `<session directory>/imagegen/<callID>.png`, with non-destructive
  naming and an optional smaller same-dimension JPEG/WebP copy for display. Return paths and small
  observed metadata, never image attachments/base64. Report actual dimensions/quality and available
  request/model/route identifiers; distinguish requested settings from observed values.
- [x] Show the saved image as a thumbnail with path, changed-prompt caption and lightbox. Use v2's
  authenticated local-image reader/Blob/preview infrastructure. Loading images must not suspend or
  repeatedly remount the conversation. Ordinary local Markdown images must also work, including paths
  with spaces, reload and a streamed follow-up. Missing images must not break the timeline.
  - The changed-prompt caption has nothing to show in OAuth mode, and API-key mode no longer returns one.
- [x] Exercise real generation, reference editing, masked editing and native transparency; inspect files
  and UI on web/Android. Verify from the next model request that displaying a preview did not inject
  image bytes; explicit image reading may do so. Cover both credential modes when available and report
  any untested mode rather than treating source review as live verification.
  - A short masked-edit prompt produced black fill; asking to reconstruct the whole region works and the bundled skill says so. Not verified: API-key mode (no OpenAI API key available).

Reuse v1 `packages/opencode/src/plugin/openai/imagegen/`, including its transport/output algorithms
and skill. Retain `TANDEM_IMAGEGEN_OAUTH_MODEL` for masked OAuth edits (default `gpt-5.5`) and
`TANDEM_IMAGEGEN_JPEG_QUALITY` (90). V2 supplies `/api/fs/read/*`,
`packages/app/src/runtime/server/image.ts`, `useMarkdown().readImage` and image preview support;
add only the needed tool-renderer integration, not the old `DataProvider.readFile`/Markdown loader.

### Claude shell-based search

- [x] Implement opt-in `TANDEM_CLAUDE_BASH_SEARCH=1` (default off). In active Claude sessions, remove
  dedicated glob/grep tools and harness-injected references directing the model to them. Plain shell
  `grep`/`find` must perform the searches instead; other providers keep their tool catalogs.
- [x] Supply subprocess-local PATH shims: `grep` uses ugrep with basic-regex, ignore-file, hidden-file,
  binary-skip and VCS-directory defaults, falling back to system grep for incompatible flags; `find`
  uses bfs with depth-first order and a supported GNU-find-compatible regex mode. Reuse the validated
  shim logic rather than changing the user's global shell environment.
- [ ] Install `ugrep`/`bfs` through an appropriate platform setup path or prompt for their installation.
  Confirm working binaries/shims before removing tools. Give setup guidance for missing dependencies
  on supported platforms and a clear unsupported status elsewhere; retain working search tools in
  either case. This does not require adding shim support for currently unsupported Windows shells.
  - Setup guidance is in tandem-v2-configuration.md, and installed binaries are checked before tools are
    removed. Not verified: the missing-dependency and unsupported-shell fallbacks.
- [x] Exercise shell file/content searches and inspect final main/subagent Claude requests for absent
  tools and stale guidance. Filter the catalog before Claude name mapping, and verify disabled mode.

V1 reuse: `packages/opencode/src/plugin/bash-search/`. V2 candidates: `shell.hook("create.before")`
and session/tool transformations; validate against the actual catalog rather than assuming v1 names.

### Browser-backed webfetch

- [x] Provide `webfetch(url, format?, timeout?, prompt?, screenshot?)` using the user's real Chrome
  session for logged-in/JS-rendered pages. Formats are markdown (default), text or HTML; timeout is
  at most 120 seconds. No prompt means main page content; a prompt asks the reader for specific
  information. `TANDEM_BROWSER_FETCH=0` restores upstream webfetch.
  - Not verified: logged-in pages.
- [x] Reuse the CDP engine: desktop Chromium/Termux:X11 first, Android Chrome fallback where applicable.
  Serialize browser startup, follow page redirects/loading, report final URL/HTTP/page state, and
  close owned tabs on success, error, timeout or cancellation. Keep bounded retries (one longer-timeout
  retry, Android fallback for unresolved desktop placeholders); do not retry network rate-limit pages.
  - Not verified: the Android Chrome fallback.
- [x] Fetch the initial page in code, then create a hidden `web-fetcher` child session through v2's
  normal create → prompt → wait flow. Give it only its reader instructions, page and extraction request;
  omit project instructions and Corrector. Its raw `fetch_page`/Read tools support follow-ups without
  recursively calling webfetch. Keep the internal reader out of the general subagent/tool catalog.
  Preserve user overrides; default to `openai/gpt-5.6-sol`, medium variant and medium text verbosity.
- [x] Bound each reader to 12 follow-up fetches, including at most 5 search-engine fetches. Cap initial
  inline page content at 100 KB and spill excess to a file. Return the reader's answer, not the raw
  child transcript; initial fetch failures should fail before creating a reader.
  - Not verified: hitting the follow-up limits.
- [x] Capture full-page PNG slices on every fetch (up to four 1600px slices), append their paths, and
  give them directly to the reader when `screenshot:true`. Download documents with browser credentials,
  extract text (PDF via `pdftotext -layout`) and return the saved file path. Use the runtime scratchpad's
  `webfetch/` directory (`/tmp/tandem/webfetch/` in production on this tablet), with bounded screenshot/
  overflow-file retention. Ensure browser/document prerequisites are available or clearly reported.
  - Not verified: retention limits.
- [x] Render a compact answer preview, expandable Markdown answer and source URL in the tool card.
  This must work independently of deferred shell/patch card styling.
- [x] Exercise multiple real sites: authenticated/JS content, targeted extraction, visual content and
  a document download, plus failure/cancellation cleanup. Confirm bare reader context, follow-up limits,
  saved paths and the rendered answer in web/Android. This feature does not depend on the deferred
  interactive Chrome bridge or custom subagent-control enhancements.
  - Not verified: logged-in content.

Reuse v1 `packages/opencode/src/plugin/browser-fetch/{cdp-fetch.ts,plugin.ts,web-fetcher.md}`.
V2 candidates: `tool.transform`, `agent.transform`, session `context` hooks and a narrow renderer export
from `packages/session-ui/src/tools/tool-renderer.tsx`. Coordinate bare-context metadata and lifecycle
with Corrector; both must work under the existing v2 session engine.

## 5. Branding, release and cut-over

- [x] Apply the existing Tandem icon, T mark and terminal wordmark. Production launcher/window titles,
  web metadata, About/setup/error screens and CLI help identify **Tandem**; the separate development
  app remains **Tandem V2**. Use central product-copy overrides and narrow logo delegates.
  - The installed production app is labelled Tandem, with the T mark and wordmark. `packages/desktop` branding was reverted to upstream (the desktop app is unused).
- [x] Adapt the existing build/package workflow for Linux, Windows and macOS CLI targets, including
  existing architecture/baseline variants. Build from `packages/cli`, consume `packages/cli/dist/cli-<target>/`
  and publish Tandem-named artifacts. Skip duplicate `cli-darwin-x64-baseline`, retaining distinct
  Linux/Windows baselines. Produce signed Android APK/AAB and retain the on-tablet APK build path.
- [x] Preserve production Android signing/application identity and keep the development ID separate.
  Stage artifacts with checksums/manifest. Remove iOS assets/signing from initial-release requirements,
  including strict/common-artifact checks. GitHub upload and installation remain explicit actions.
  - The production APK/AAB were signed with the existing key (certificate unchanged) and staged with a manifest and checksums.
- [x] Reconcile generated/local-output ignores and LF/binary attributes with the v2 tree. Update build,
  install, connection, credential and feature configuration docs to match the implemented behavior.
  Rewrite `PromptEnhance.md` for Corrector alone and adapt the upstream-sync skill for the v2 branch.
- [x] Complete the real ChatGPT/Claude feature workflows and manual Android checks above, then smoke
  the packaged CLI/server and signed APK. Compare final performance with the baseline and report
  unresolved failures or unverified credential/platform cases to Jon for a readiness decision; unavailable
  cases remain unverified, not passed. History-import failure is not a blocker.
  - The installed CLI/server and signed APK passed real ChatGPT, Claude and in-app sessions; unverified cases are listed in v2-readiness.md.
- [x] Agree cut-over with Jon. Use staged binary/app replacement, verify installed versions, and update
  the production launcher to `tandem serve --hostname 0.0.0.0 --port 4097` with its configured password.
  Preserve a usable v1 rollback and its data; restart the running daily service only when requested.
  - Done 2026-10-05 at Jon's request. The daily server is `tandem serve --service --hostname 0.0.0.0 --port 4097`; its password is in `~/.config/tandem/service.json`. v1 keeps running on 4095 from its own folders with a Tandem v1 app, so rollback stays possible.

V1 packaging reuse: `script/{build-tandem-release,package-tandem-release,build-tablet-android,android-signing,android-toolchain-env}.ts`
and `script/setup-tablet-android.sh`. Branding starting points: `packages/tui/src/brand-logo.ts`,
TUI/UI logo components, Android metadata and `packages/app/src/runtime/i18n/language.tsx`.
