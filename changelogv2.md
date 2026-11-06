# Tandem v2 Changelog

Dated user-visible changes and published releases of Tandem v2, and the source for its GitHub release notes. v1 history stays in the v1 checkout's `log.md`. The current list of Tandem's changes to OpenCode, for upstream syncs, is [logv2.md](logv2.md).

## Unreleased

Baseline: OpenCode `upstream/dev` at `f74b1416a8` (2026-10-29, `@opencode/cli` 2.2.1), synced on 2026-11-04; upstream promoted v2 to `dev` on 2026-10-10 and froze `v2`. Version `2.1.4-tandem-v2.2`, installed as the daily Tandem (CLI and Android app) on Jon's tablet on 2026-11-03 (`2.1.4-tandem-v2.1` earlier that day, `2.1.4-tandem-v2.0` before; `2.0.24-tandem-v2.2` on 2026-10-07, `2.0.24-tandem-v2.1`, `2.0.24-tandem-v2.0` and `2.0.22-tandem-v2.1` to `v2.3` earlier that day, `2.0.22-tandem-v2.0` on 2026-10-05); no v2 GitHub release has been published. Source is on branch `tandem-v2`. Verified behavior and unverified cases are recorded in [notes/archive/v2-readiness.md](notes/archive/v2-readiness.md).

### 2026-11-05

- **Changed - Claude's one-hour cache is a setting:** Tandem's code that forced one-hour prompt caching on Claude and the other supported routes was removed in favor of upstream's `cache.ttl` setting, which Jon's config sets to `1h` for Anthropic. Other providers keep their default lifetime unless configured. The context button's cache countdown now follows that setting and shows only for models that have one. [Divergence inventory](logv2.md).
- **Removed - Tandem's fix for following new messages on fractional-pixel screens:** upstream now resumes following when a scroll settles within 4px of the end. On the Y700 (pixel ratio 2.75), flings to the bottom stopped 0.636px short and the chat followed new output again; scrolling up still stops it. [Divergence inventory](logv2.md).

### 2026-11-04

- **Changed - Upstream sync to OpenCode 2.2.1:** merged 262 of 585 pending upstream commits (`be315b1db8`→`f74b1416a8`, upstream's v2.2.1 release) in eight batches. User-visible upstream changes include a configurable prompt-cache lifetime (`cache.ttl` in provider and model settings), image resizing in a worker that frees its memory when idle, `/goal`, scheduled prompts (`/schedule`, experimental), an opt-in `image_generate` tool (`experimental_image_generate`; Tandem's `imagegen` is unchanged), `/reload` for configuration, the new model picker by default, simpler composer model labels, user-message actions (fork, copy, sent time) in a ⋯ menu beside Rewind, a background shell's output from its pill, quote comments and browser annotations merged, prompt history search, a redesigned integrations dialog, project/worktree picker and session location menu refinements, searchable dialogs aligned, a desktop zoom setting, Code Mode explaining stalled programs and parse errors, webfetch URL rules applied to redirects, Kimi tool-argument fixes, 429 throttles no longer treated as context overflow, coordinated credential refreshes, and a new `session_part` table that history is read from (the database migrates on first start). Upstream's GUI extensions became GUI plugins (`packages/gui-plugins`, `runtime/plugin`); Tandem's Android, terminal, clipboard and context-button changes moved with them. Tandem keeps: its one-hour cache on Claude and the other supported routes, overriding any configured `cache.ttl` there; the model-only button; the per-prompt "files changed" mark (its leading dot now appears only after the agent and model). Fork-owned adjustments: the Claude plugin carries its own Claude version parser (upstream's is no longer exported), Claude compaction's restored context skips upstream's new image jobs, the Android app follows the app's Vite 8.2.4, and the development launcher writes `service.json`, which dev-channel builds read again. [Divergence inventory](logv2.md).

### 2026-11-03

- **Changed - Shorter model button:** the composer's model button shows just the model (`Opus 5.5`), dropping the provider name (`Anthropic /`) that the upstream sync added. [Composer controls](logv2.md#composer-footer).

### 2026-11-02

- **Changed - Upstream sync, part 1 of the October beta merge:** merged 487 of 1,026 pending upstream commits (`ddd9e103fe`→`be315b1db8`) in two batches: 76 core, AI and server commits, then upstream's merge of its beta desktop/web interface (411 commits). User-visible upstream changes include Home as a session inbox with session search, a project-and-worktree location dialog, split side and bottom panes with draggable tabs (terminals and several files open as tabs), a background-activity pill and todo pill above the composer, questions and permissions that grow out of the composer, grouped queued and consecutive user messages, `@`-tagging other sessions, a searchable prompt history (Shift+↑), Fork from here and Rewind to here with an Undo toast, Delete in the session tab menu, Ctrl+R to rename a session, a session details menu, Focus/Pro interface and Reduce motion settings, settings searchable from the command palette, image and video zoom, Pele diagrams, a copy button on shell output, Code Mode calls listed in Execute rows, MCP sign-in links, the Anthropic fast-mode speed option and OpenAI Responses reasoning options. Tandem keeps: the composer in subagent sessions (instead of upstream's new subagent status bar) and their queue; the Tandem logo on the new-session screen (upstream's "opencode" letter pin-board easter egg is not shown); the touch-safe Delete in the tab menu, now on upstream's own Delete (Tandem's tab-delete module was removed); the shared copy fallback on two new copy actions. The development launcher writes `service-dev.json`, which dev-channel builds now read instead of `service.json`. [Divergence inventory](logv2.md).

### 2026-10-25

- **Changed - Upstream sync to OpenCode 2.1.4:** merged 277 upstream commits (`157ad7f22a`→`ddd9e103fe`) in eight batches, including upstream's v2.1 refactor (stored provider data is now `native`, and summary compaction refers to the kept messages instead of copying their text). User-visible upstream changes include code highlighting with `@pierre/highlights` instead of Shiki, MCP elicitation forms that finally appear, remote MCP calls that survive Bun's idle timeout, malformed MCP tools skipped instead of failing their server, `--server` and `--standalone` accepted anywhere on the command line, a `debug heap-dump` command, titles generated at the model's lowest variant, compaction summaries getting the normal output limit, a stable image budget cut that keeps the prompt cache, configured provider `baseURL`s overriding catalog endpoints, Bedrock throttling retried, video inputs on Claude and OpenAI Responses routes, the scrollbar drag no longer snapping to the newest message, plain-text paste when renaming tabs, lower memory use for background session transcripts, TUI dialog redesigns behind the new-designs experiment, and experimental `todowrite` and background compaction. Tandem's Claude compaction keeps using the main model and ignores background summaries. Two temporary fixes were dropped because upstream fixed them (linear base64 check, plugin `DeepMutable`). [Divergence inventory](logv2.md).
- **Tooling - Bun 1.4.4:** Tandem's pinned toolchain follows upstream to Bun 1.4.4 (`~/.local/share/tandem-v2/toolchain/bun-1.4.4`); the 1.4.2 toolchain was removed. Package typechecks use `bun check`, as upstream's do.
- **Fixed - Slow sessions with photos:** opening or reconnecting to a session with many photos no longer waits seconds on the server. The check of each photo's base64 text uses upstream's newer linear check instead of a pattern that backtracked for seconds, and responses of 1 MiB or more are gzipped on several threads: a 42 MB session page took 2.6 s to compress and now takes about 0.15 s, still 30% smaller. In the Android app it arrives in about 0.45 s instead of 4-5 s. [Base64 check](logv2.md#temporary-upstream-bug-fixes), [large responses](logv2.md#identity-cli-and-local-service).

### 2026-10-23

- **Fixed - Windows webfetch:** the browser fetcher starts its own Chrome when a fetch needs it, as on Linux, instead of relying on the Windows server script to open one at startup. Closing that window no longer breaks webfetch; the next fetch reopens it. [Webfetch](logv2.md#browser-backed-webfetch).

### 2026-10-20

- **Changed - Follow-up upstream sync:** merged 14 more commits (`ba06ff9e0b`→`157ad7f22a`) in eight batches. Adds MiniMax M3.1 Flash Free to the bundled catalog, fixes apostrophes in terminal flowcharts, upgrades OpenTUI to 0.6.6, reports removed running shells as killed, and keeps terminal clients waiting through transport failures and long requests. Upstream summary compaction now includes recent conversation too; its default automatic-compaction reserve rises to 15% of the context limit, at least 16k where the window permits. Tandem's Claude summary/checkpoint behavior is preserved. Three mechanical TUI conflicts retained Tandem branding and rewind confirmation while adopting upstream's APIs. [Verification and test limitations](notes/archive/upstream-sync-2026-10-20-followup.md).
- **Changed — Upstream sync to OpenCode 2.0.32:** merged all 62 fetched upstream commits (`bc5ebf00a4`→`ba06ff9e0b`) in 19 batches without conflicts. Free models remain visible alongside paid models in the picker; missing-location recovery shares the searchable worktree submenu; shell completion waits for output capture; provider streams tolerate new events and null Responses fields; buffered generations gain bounded retries; and skill discovery avoids dependency trees and stops at six directory levels. APIs now support session archiving/restoration and archive-state filtering, editing saved permissions, plugin session pagination, and experimental voice connections requiring an OpenAI or xAI API key. Also includes filesystem-denial handling, model catalog refreshes, a TUI resize-listener optimization, TypeScript 7, Nix fixes, and website/docs maintenance. [Verification and compatibility adjustments](notes/archive/upstream-sync-2026-10-20.md).
- **Tooling — Android typechecking:** follows upstream's TypeScript 7 compiler upgrade.
- **Tooling — Leaner agent guidance:** upstream's demo, RTL, `opencode-dev` and test-writing skills are hidden in this repository, and the app, UI, chat, GUI-extension and schema package guidance is trimmed, so agent sessions load less context. A Tandem `tandem-dev-debug` skill covers the development server's API, logs, database and profiling.

- **Compatibility — Corrector debug cleanup:** uses upstream's public plugin session-list API and follows every page, preserving the configured retention count beyond the first 50 sessions.

### 2026-10-17

- **Removed — Retired models:** the model list no longer offers Claude Haiku 4.5, Opus 4.7, Opus 5 and Sonnet 5; GPT-6 Sol, GPT-5.6 Terra, GPT-5.5 and GPT-5.3 Codex Spark; GLM 4.5, 4.6, 4.7, 5, 5.1, 5.2 and the GLM Turbo models; or Kimi K2.6, on any provider, including their fast and other variants. The Corrector uses Claude Haiku 5.5 for Claude sessions instead of Haiku 4.5.
- **Changed — Upstream sync to OpenCode 2.0.31:** merged 78 upstream commits (`654b79b27e`→`bc5ebf00a4`) in five batches. User-visible upstream changes include reworked TUI dialogs (shared headers, footers with the label first, one padding; a redesign behind the new-designs experiment), a TUI diff side panel that opens by default with responsive layouts, `/copy` copying the last assistant message, `/editor` explaining when no editor is set, session sharing removed, `OPENCODE_DISABLE_CLAUDE_CODE` honored, model reasoning settings read from config, numeric MCP timeouts accepted, configured limits applied before model transforms, the Anthropic cache format honored on Bedrock Converse, a steadier review pane when the side terminal toggles, long file names fading in the file tree, and the tool group count sliding when it changes. [Divergence inventory](logv2.md).

### 2026-10-16

- **Changed — Upstream sync to OpenCode 2.0.29:** merged 86 upstream commits (`c5aabae288`→`654b79b27e`) in four batches. User-visible upstream changes include an optional Changed files list after each turn (Settings → Timeline; it uses Tandem's compact patch rows), an unread dot on session tabs (on touch, the tab title now fades out just before it), configured `instructions` files and URLs being loaded again, replies continuing after hitting the output-token limit, user-message attachments shown above the text, session tokens and cost on the session view, provider account management, image previews with trackpad zoom, Option+arrow switching session tabs, plugins able to grant permissions, managed configuration taking priority, and compaction fitting its output limit to the request actually sent. [Divergence inventory](logv2.md).
- **Changed — Shared scratch directory:** development and daily Tandem use `/tmp/tandem` for runtime scratch files. Tablet builds, setup, release logs and build caches also use this root, without a `v2` subdirectory.
- **Added — Image attachment paths:** the agent receives an `Image location: …` note after each attached image, pointing to a saved server-side copy with a short 12-character filename, such as `/tmp/tandem/attachments/e02612854bf2.png`. Older conversation images work too, and cleared scratch copies are recreated when their images are sent again.
- **Changed — Agent and model on messages:** messages keep showing their agent and model on the tablet in portrait; only screens narrower than 692 CSS pixels hide them.
- **Changed — Upstream sync to OpenCode 2.0.28:** upstream moved v2 development to its `dev` branch, so Tandem now follows `upstream/dev`. Merged upstream's v2-to-`dev` merge and the next 79 commits (`4617210822`→`c5aabae288`) in six batches. User-visible upstream changes include `tandem pair --remote` asking before it first exposes the server to the internet (`--yes` skips it), projects whose folders are gone being archived, a submitted prompt showing in the same frame the composer clears, full-window video previews, images and audio in the review panel, per-project auto-accept permissions, unread state kept on the server, Home sessions grouped by day, the agent and model no longer repeated on each message on narrow screens, the edit tool keeping mixed line endings, a 500k context for gpt-6.1-sol over ChatGPT, and Claude on Databricks and Snowflake Cortex now getting cache breakpoints (one-hour, like other Claude routes). [Divergence inventory](logv2.md).

### 2026-10-13

- **Changed — Code Mode tool description:** the `execute` tool now tells the model where its tool list is (the "# Code Mode" section) and says plainly that its regular tools can't be called from inside the code.

### 2026-10-12

- **Changed — Upstream sync to OpenCode 2.0.26:** merged 139 upstream v2 commits (`80c4a6b7c8`→`4617210822`) in thirteen batches. User-visible upstream changes include a pairing-link-first Connect screen and Add server dialog (with a "Use password" switch), remote pairing through OpenTunnel (`tandem pair --remote`), Word/Excel/PowerPoint previews, a recently closed tabs menu on the new-tab button, recent sessions in the empty command palette, a narrower session column with nicer text wrapping, the full tool error text when an error row is expanded, clickable file links in the timeline, worktree tools in Code Mode, no more permission prompts for reading outside the project folder, and `tandem uninstall` keeping data, config and state. Effect moved to 4.0.1. [Divergence inventory](logv2.md).
- **Changed — Server connection:** choosing a LAN server found by discovery opens the password form with its address filled in. Tandem's own pairing-link pasting and the Android setup help under the Connect screen were dropped, since upstream now handles pairing links on both screens.
- **Removed — Default server on Android:** upstream removed the configurable default server, so the first server you connect to is no longer saved as the default.

### 2026-10-11

- **Changed — Composer plus button:** opens the image and file picker directly instead of a menu. Commands, context and shell commands are still available by typing `/`, `@` and `!`.
- **Fixed — Deleting mentions on Android:** Backspace right after an `@` mention now removes the whole mention, and the keyboard keeps working. Previously the Android keyboard could not delete it and editing stopped. Android app only.
- **Fixed — Missing history after an undo in a forked session:** after undoing back to a message in a fork, the chat (app and TUI) now shows every earlier message. Previously it hid most of them until the undo was redone or a new prompt was sent.

### 2026-10-10

- **Simplified — Mobile view navigation:** sort upstream's complete view list once instead of combining and re-sorting the tab and menu lists.
- **Removed — Cosmetic source rebranding:** restored upstream service comments except the actual `tandem serve --service` default, and restored the upstream update dialog's unreachable automatic-update strings. Runtime command/path changes and manual-update guidance remain.
- **Removed — Obsolete Android build switch:** removed v1's `OPENCODE_ANDROID_VARIANT=1` metadata-preservation branch. The generated-project patcher always applies the selected Tauri configuration's application ID and labels.
- **Removed — Unused Android capabilities:** removed uncalled haptics and sharing methods, dependencies, native registrations and bridge commands. Resume recovery now listens directly inside the Android wrapper instead of extending the shared app interface.
- **Removed — Obsolete Corrector model migration:** legacy `small_model` no longer sets the Corrector model. Restored `packages/core/src/config/normalize.ts` to upstream; explicit Corrector agent configuration remains supported.
- **Removed — Obsolete Corrector preference migration:** removed conversion of v1's RePrompt settings. The current Corrector toggle keeps its saved on/off preference and default-off behavior.
- **Guidance — Scope and upstream divergence:** explicitly require alternative approaches before changing upstream-shared code and prohibit unrequested features, especially those adding divergence. Recorded in `AGENTS.md`.
- **Changed — Subagent call labels:** initial and follow-up cards show the same child-session title. Later calls are marked Follow-up.
- **Added — Direct subagent chat:** open a child session to steer it or continue chatting, with its normal composer and context-token display. During an active delegated task, direct user prompts are quoted separately before the answers returned to the main agent. After that task ends, replies stay in the child session, as explained beside the composer.

### 2026-10-09

- **Added — Tandem subagent answer-delivery enhancement:** steering a running child preserves all completed final answers in order, instead of returning only its last answer. The first delegated prompt explains that final answers reach the main agent while commentary and intermediate tool steps do not.
- **Changed — Subagent tool has no model option:** the subagent tool no longer offers a `model` field, for GPT and Claude alike; a subagent runs on its agent's configured model (for example `general-sol` on GPT-6.1 Sol), or the parent session's model if it has none. This shortens the tool's description in every system prompt. [Tool descriptions](logv2.md#instructions-and-tool-guidance).

### 2026-10-07

- **Fixed — Mobile tab strip:** opening a session from Home (or anywhere outside the strip) now scrolls the strip to show its tab, and tab titles no longer go blank or show a stray fragment on Android once four or more tabs make the strip scroll.

### 2026-10-06

- **Changed — Mobile session views as tabs:** the view bar under the session tabs shows Session, Changes, Files, Terminal, Usage and Session details as six tabs instead of upstream's "More…" drawer; Session details opens its sheet in one tap. The bar scrolls sideways if the tabs don't fit.
- **Changed — Upstream sync to OpenCode 2.0.24:** merged 139 upstream v2 commits (`40679546d4`→`80c4a6b7c8`) in eight batches. User-visible upstream changes include the mobile session bar's "More…" drawer (Files, Terminal, Usage and Session details; Changes stays a tab), the keyboard closing after a send on narrow screens, running subagents and shells in the session header, model variants in message details, upstream's queue/steer/undo rework, a redesigned browser bar and new providers (Venice, Vercel AI Gateway, Anthropic on Bedrock Mantle). Tandem's queue-undo workaround for model-only context was dropped because upstream now restores comments and files itself; Claude's one-hour cache now also covers Bedrock Mantle and the Vercel AI Gateway. [Divergence inventory](logv2.md).
- **Changed — OpenAI login:** OpenAI is signed in with the Codex login, "ChatGPT Pro/Plus (browser)" (`chatgpt-browser`), as in v1, instead of "Sign in with ChatGPT" token sharing. This restores every GPT from 5.5 up (including GPT-6 Sol and GPT-6.1 Sol), WebSocket transport and native compaction. Upstream code; only the login changed. [Setup](notes/tandem-setup.md#logins).
- **Changed — Image generation uses the main OpenAI login:** the separate "OpenAI Images (ChatGPT)" login is gone; with no API key, `imagegen` uses the conversation's Codex login. API-key mode calls OpenAI's image endpoints directly again, so it reports the request ID and backend model as in v1. A revised prompt is shown whenever the backend returns one, even when unchanged; ordinary ChatGPT generations and edits get none, because Codex's direct image service never returns one. [Imagegen](logv2.md#image-generation-imagegen).
- **Changed — Models:** the `general-sol` helper and the webfetch reader use GPT-6.1 Sol (the reader was GPT-5.6 Sol). [Webfetch](logv2.md#browser-backed-webfetch).
- **Fixed — New sessions in a worktree project (temporary upstream fix):** a session started in `Tandem-v2` with the workspace set to "Local" now runs in `Tandem-v2`. Because `Tandem-v2` is a git worktree of the v1 checkout, upstream silently started it in `~/code/Tandem`. See [Temporary Upstream Bug Fixes](logv2.md#temporary-upstream-bug-fixes).
- **Changed — Native compaction for OpenAI by default:** OpenAI sessions compact with Codex's encrypted in-band compaction instead of a written summary, with no configuration needed. Setting `providers.openai.settings.compaction` to `{ "type": "summary" }` restores the summary. [Diagnostics](logv2.md#provider-requests-and-diagnostics).
- **Changed — Android tabs:** on the tablet and phone, every tab shows in a strip at the top, as in v1, instead of one current-tab button. Tabs keep a 150px minimum so titles stay readable, the strip scrolls sideways by swipe, and each tab has its close button; a menu button opens the tabs drawer (Home, Settings, Help) and a plus button starts a new session. Long-pressing a session tab offers Delete… alongside Rename and Close tab. [Android](logv2.md#android-platform-and-persistence).
- **Fixed — Delete from the session options menu on touch (temporary upstream fix):** tapping Delete… in a session's ⋯ menu now shows the confirmation; before, it opened and closed instantly. See [Temporary Upstream Bug Fixes](logv2.md#temporary-upstream-bug-fixes).

### 2026-10-05

- **Android — Connection help:** the connect screen's help no longer tells users to start the development server on port 4098 or set `OPENCODE_SERVER_PASSWORD`; it mentions the daily port 4097 and pairing links from `tandem pair`. File: `packages/app/src/runtime/i18n/en.ts`.
- **Fixed — Reading position (temporary upstream fix):** a session scrolled up from the newest messages returns to the same place after switching to another tab or session and back, instead of jumping to the top of the loaded history or to the newest messages. See [Temporary Upstream Bug Fixes](logv2.md#temporary-upstream-bug-fixes).
- **Fixed — Keyboard over the newest messages (temporary upstream fix):** at the newest messages, opening the Android keyboard keeps the last message just above the composer instead of hiding it; a scrolled-up chat stays where it is. See [Temporary Upstream Bug Fixes](logv2.md#temporary-upstream-bug-fixes).
- **Documentation — Divergence tracking:** every edit to an upstream-shared file now carries an `UPSTREAM-DIVERGENCE` code comment, with fixes for upstream bugs marked `UPSTREAM-DIVERGENCE(temporary)`. `logv2.md` replaces the port-time seam list. Agent guidance now requires Jon's agreement before fixing OpenCode upstream bugs.

### 2026-10-03 to 2026-10-05 — v2 port

Fresh port onto OpenCode v2, adapting working v1 Tandem code rather than replaying v1 patches. Scope: [notes/archive/v2-port.md](notes/archive/v2-port.md); deferred work: [notes/todo-after-v2.md](notes/todo-after-v2.md).

- **Added — Tandem identity and isolated installation:** `tandem` command, Tandem config/data/cache/state roots and local-service discovery, so Tandem runs alongside official OpenCode. Updates are manual; `tandem upgrade` points to GitHub releases. [Identity](logv2.md#identity-cli-and-local-service).
- **Added — Android app on v2:** the Tauri/Kotlin shell mounts v2's shared app with native storage, image-safe drafts, LAN discovery (4097, then 4096), password/pairing connection help, page zoom (80–150%, volume keys), Enter-inserts-newline editing, one safe-area/keyboard inset owner, clipboard fallback and restricted Taobao links. A side-by-side **Tandem V2** development app has its own ID. [Android](logv2.md#android-platform-and-persistence).
- **Added — Corrector:** default-on copy-editing of each prompt before the main turn, with a per-client composer toggle that is snapshotted into queued prompts. [Corrector](logv2.md#prompt-corrector).
- **Added — Claude subscription support:** Claude Pro/Max login through the external auth plugin; Claude Code-shaped prompt, tool names, billing block, one-hour caching and thinking context management; optional shell-based search instead of Glob/Grep. [Claude](logv2.md#claude-presentation).
- **Changed — Agent guidance:** GPT and Astra prompts carry Jon's context and communication preferences. Shared guidance adds the runtime scratchpad, saved-image presentation and tighter tool advice. [Guidance](logv2.md#instructions-and-tool-guidance).
- **Added — Image generation:** `imagegen` tool, built-in skill and chat thumbnails. [Imagegen](logv2.md#image-generation-imagegen).
- **Added — Browser-backed webfetch:** pages are read through a real Chrome session by a hidden reader session, with screenshots and document extraction. [Webfetch](logv2.md#browser-backed-webfetch).
- **Added — Request diagnostics:** opt-in `TANDEM_DUMP_REQUEST` captures every final provider request body and WebSocket frame, including retries. [Diagnostics](logv2.md#provider-requests-and-diagnostics).
- **Added — Release tooling:** Tandem-named CLI packaging, signed Android APK/AAB and the on-tablet APK build. [Tooling](logv2.md#repository-docs-and-tooling).
- **Fixed — Upstream bugs (temporary):** no false "session not found" errors after sessions are deleted (frequent with the Corrector), plus a plugin typing fix. See [Temporary Upstream Bug Fixes](logv2.md#temporary-upstream-bug-fixes).

## Published releases

None for v2 yet. v1 releases (through `v1.18.25-tandem.1`) are listed in the v1 checkout's `log.md`.

## Tandem feature overview

Current summary as of **2026-10-05**.

| Area | Tandem addition / difference | Reference |
| --- | --- | --- |
| Identity and installation | Separate branding, roots, local service, release packaging and manual updates alongside OpenCode | [Identity](logv2.md#identity-cli-and-local-service) |
| Android app | Tandem-owned Tauri wrapper, connection/discovery, native storage, zoom, insets, editing and clipboard behavior | [Android](logv2.md#android-platform-and-persistence) |
| Prompt assistance | Corrector with a per-client toggle | [Corrector](logv2.md#prompt-corrector) |
| Agent behavior | Customized GPT/Astra prompts, scratchpad and tool guidance | [Guidance](logv2.md#instructions-and-tool-guidance) |
| Claude integration | Subscription login, Claude Code-shaped presentation, caching/thinking policy, optional Bash search | [Claude](logv2.md#claude-presentation), [Bash search](logv2.md#claude-bash-search) |
| Image generation | Generation/editing, references, masks, native transparency, thumbnails | [Imagegen](logv2.md#image-generation-imagegen) |
| Browser access | Browser-backed webfetch with a hidden reader session | [Webfetch](logv2.md#browser-backed-webfetch) |
| Diagnostics | Final provider request dumps | [Diagnostics](logv2.md#provider-requests-and-diagnostics) |

## Keeping this file and publishing releases

1. **With each change:** add a dated Unreleased entry (Added, Changed, Fixed or Removed) describing the user-visible result, including platform/opt-in limits and a commit reference when available.
2. **Prepare a release:** review the Git range since the previous v2 Tandem tag against Unreleased entries. Separate Tandem changes from the upstream-baseline note and describe only artifacts actually built.
3. **Record and publish:** move included entries under `## <tag> — YYYY-MM-DD` above Published releases, recording the target commit, upstream baseline and GitHub URL, and leave a fresh Unreleased section. Publish only when requested: `gh release create <tag> --repo Liddo-kun/Tandem --target <commit> --notes-file <file>`. Always pass `--repo`, because this checkout also has the OpenCode remote.
