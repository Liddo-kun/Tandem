# Tandem v2 Changelog

Dated user-visible changes and published releases of Tandem v2, and the source for its GitHub release notes. v1 history stays in the v1 checkout's `log.md`. The current list of Tandem's changes to OpenCode, for upstream syncs, is [logv2.md](logv2.md).

## Unreleased

Baseline: OpenCode `upstream/v2` at `80c4a6b7c8` (2026-10-06, `@opencode/cli` 2.0.24), synced on 2026-10-06 from `40679546d4` (2026-10-03, 2.0.22). Version `2.0.24-tandem-v2.2`, installed as the daily Tandem on Jon's tablet on 2026-10-07 (`2.0.24-tandem-v2.1`, `2.0.24-tandem-v2.0` and `2.0.22-tandem-v2.1` to `v2.3` earlier that day, `2.0.22-tandem-v2.0` on 2026-10-05); no v2 GitHub release has been published. Source is on branch `tandem-v2`. Verified behavior and unverified cases are recorded in [notes/archive/v2-readiness.md](notes/archive/v2-readiness.md).

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
