# Tandem v2 Changelog and OpenCode Differences

> **This file is only a log of Tandem's customizations to OpenCode, as they exist in the code — like v1's `log.md`.** It is never a place for decisions, approvals, proposals, open questions, pending work or to-dos. Deferred work goes in `notes/todo-after-v2.md`; port planning and evidence go in `notes/`. When a customization is removed or reverted, delete its entry here.

This file is the source for Tandem v2 GitHub release notes and the inventory of what Tandem v2 adds to, or changes in, official OpenCode v2. It starts fresh with the v2 port; v1 history and its divergence inventory stay in the v1 checkout's `log.md`.

- [Release history](#release-history): dated changes and published versions.
- [Tandem feature overview](#tandem-feature-overview): product summary.
- [Maintenance and GitHub releases](#maintenance-and-github-releases): how to keep this file and the code markers current.
- [Current OpenCode divergence](#current-opencode-divergence): technical inventory of shared-file edits and fork-owned files for upstream syncs.

## Release history

### Unreleased

Baseline: OpenCode `upstream/v2` at `40679546d4` (2026-10-03, `@opencode/cli` 2.0.22). Version `2.0.22-tandem-v2.0`, installed as the daily Tandem on Jon's tablet on 2026-10-05; no v2 GitHub release has been published. Source is on branch `tandem-v2`. Verified behavior and unverified cases are recorded in [notes/archive/v2-readiness.md](notes/archive/v2-readiness.md).

#### 2026-10-05

- **Android — Connection help:** the connect screen's help no longer tells users to start the development server on port 4098 or set `OPENCODE_SERVER_PASSWORD`; it mentions the daily port 4097 and pairing links from `tandem pair`. File: `packages/app/src/runtime/i18n/en.ts`.
- **Documentation — Divergence tracking:** every edit to an upstream-shared file now carries an `UPSTREAM-DIVERGENCE` code comment, with fixes for upstream bugs marked `UPSTREAM-DIVERGENCE(temporary)`. This log replaces the port-time seam list. Agent guidance now requires Jon's agreement before fixing OpenCode upstream bugs.

#### 2026-10-03 to 2026-10-05 — v2 port

Fresh port onto OpenCode v2, adapting working v1 Tandem code rather than replaying v1 patches. Scope: [notes/archive/v2-port.md](notes/archive/v2-port.md); deferred work: [notes/todo-after-v2.md](notes/todo-after-v2.md).

- **Added — Tandem identity and isolated installation:** `tandem` command, Tandem config/data/cache/state roots and local-service discovery, so Tandem runs alongside official OpenCode. Updates are manual; `tandem upgrade` points to GitHub releases. [Identity](#identity-cli-and-local-service).
- **Added — Android app on v2:** the Tauri/Kotlin shell mounts v2's shared app with native storage, image-safe drafts, LAN discovery (4097, then 4096), password/pairing connection help, page zoom (80–150%, volume keys), Enter-inserts-newline editing, one safe-area/keyboard inset owner, clipboard fallback and restricted Taobao links. A side-by-side **Tandem V2** development app has its own ID. [Android](#android-platform-and-persistence).
- **Added — Corrector:** default-on copy-editing of each prompt before the main turn, with a per-client composer toggle that is snapshotted into queued prompts. [Corrector](#prompt-corrector).
- **Added — Claude subscription support:** Claude Pro/Max login through the external auth plugin; Claude Code-shaped prompt, tool names, billing block, one-hour caching and thinking context management; optional shell-based search instead of Glob/Grep. [Claude](#claude-presentation).
- **Changed — Agent guidance:** GPT and Astra prompts carry Jon's context and communication preferences. Shared guidance adds the runtime scratchpad, saved-image presentation and tighter tool advice. [Guidance](#instructions-and-tool-guidance).
- **Added — Image generation:** `imagegen` tool, built-in skill and chat thumbnails. [Imagegen](#image-generation-imagegen).
- **Added — Browser-backed webfetch:** pages are read through a real Chrome session by a hidden reader session, with screenshots and document extraction. [Webfetch](#browser-backed-webfetch).
- **Added — Request diagnostics:** opt-in `TANDEM_DUMP_REQUEST` captures every final provider request body and WebSocket frame, including retries. [Diagnostics](#provider-requests-and-diagnostics).
- **Added — Release tooling:** Tandem-named CLI packaging, signed Android APK/AAB and the on-tablet APK build. [Tooling](#repository-docs-and-tooling).
- **Fixed — Upstream bugs (temporary):** no false "session not found" errors after sessions are deleted (frequent with the Corrector), plus a plugin typing fix. See [Temporary Upstream Bug Fixes](#temporary-upstream-bug-fixes).

### Published releases

None for v2 yet. v1 releases (through `v1.18.25-tandem.1`) are listed in the v1 checkout's `log.md`.

## Tandem feature overview

Current summary as of **2026-10-05**.

| Area | Tandem addition / difference | Reference |
| --- | --- | --- |
| Identity and installation | Separate branding, roots, local service, release packaging and manual updates alongside OpenCode | [Identity](#identity-cli-and-local-service) |
| Android app | Tandem-owned Tauri wrapper, connection/discovery, native storage, zoom, insets, editing and clipboard behavior | [Android](#android-platform-and-persistence) |
| Prompt assistance | Corrector with a per-client toggle | [Corrector](#prompt-corrector) |
| Agent behavior | Customized GPT/Astra prompts, scratchpad and tool guidance | [Guidance](#instructions-and-tool-guidance) |
| Claude integration | Subscription login, Claude Code-shaped presentation, caching/thinking policy, optional Bash search | [Claude](#claude-presentation), [Bash search](#claude-bash-search) |
| Image generation | Generation/editing, references, masks, native transparency, thumbnails | [Imagegen](#image-generation-imagegen) |
| Browser access | Browser-backed webfetch with a hidden reader session | [Webfetch](#browser-backed-webfetch) |
| Diagnostics | Final provider request dumps | [Diagnostics](#provider-requests-and-diagnostics) |

## Maintenance and GitHub releases

1. **Mark code:** every edit to an upstream-shared file gets an `UPSTREAM-DIVERGENCE: <why>` comment at the changed code. Files that cannot carry comments are inventoried here instead: JSON manifests, `bun.lock`, generated client output, model-facing prompt text and `AGENTS.md` files. Do not hand-edit generated client files; regenerate from `packages/client` after public contract changes.
2. **Upstream bugs need Jon's agreement:** do not fix behavior that is broken in pristine upstream without Jon's approval. Approved fixes use `UPSTREAM-DIVERGENCE(temporary)` and are listed in [Temporary Upstream Bug Fixes](#temporary-upstream-bug-fixes). Remove them, with their markers, when an upstream sync brings an equivalent fix.
3. **With each change:** add a dated Unreleased entry (Added, Changed, Fixed or Removed) describing the user-visible result, including platform/opt-in limits and a commit reference when available. Revise the matching divergence entry when shared-file behavior or fork-owned ownership changes.
4. **Prepare a release:** review the Git range since the previous v2 Tandem tag against Unreleased entries. Separate Tandem changes from the upstream-baseline note and describe only artifacts actually built.
5. **Record and publish:** move included entries under `### <tag> — YYYY-MM-DD`, recording the target commit, upstream baseline and GitHub URL, and leave a fresh Unreleased section. Publish only when requested: `gh release create <tag> --repo Liddo-kun/Tandem --target <commit> --notes-file <file>`. Always pass `--repo`, because this checkout also has the OpenCode remote.

## Current OpenCode divergence

Current-state inventory against pinned OpenCode v2 base **`40679546d4`**, as of **2026-10-05**. Each entry names upstream-shared files Tandem edits (carrying `UPSTREAM-DIVERGENCE` markers unless noted as inventory-only) and the fork-owned files a sync must account for. Reference files and symbols, not line numbers.

Fork-owned locations: `packages/android/`, `packages/core/src/plugin/tandem/`, `packages/ai/src/tandem/`, `packages/util/src/{brand,tandem-auxiliary}.ts`, `script/` Tandem scripts, `notes/`, and individually headed `Tandem-owned (not in upstream)` files inside upstream packages. The Claude auth plugin lives outside this repository, in `~/code/opencode-anthropic-auth-v2`.

### Repository, Docs And Tooling

- Root guidance replaces upstream's `AGENTS.md` with Tandem scope, isolation, verification, divergence-marking and upstream-bug rules plus a few practical code rules (client generation, dependency direction, test and typecheck location). Upstream's style guide, TUI, branch/PR and Session Core sections are not carried. Platform context lives in `contextL.md` and `contextW.md`. Files: `AGENTS.md`, `packages/app/AGENTS.md` (inventory-only), `contextL.md`, `contextW.md`.
- Working notes (setup guide, Corrector, to-do list, archived port plan) and the v2 upstream-sync skill. Files: `notes/**/*.md`, `.opencode/skills/tandem-opencode-sync/SKILL.md`, `logv2.md`.
- Isolated development launcher (`bun script/tandem-v2.ts <build|serve|cli|source|vite|paths>`) with separate roots, port 4098 and an external password file. Release build/packaging builds upstream CLI targets from `packages/cli`, stages `cli-<target>/bin/opencode` as Tandem-named artifacts (skipping duplicate `cli-darwin-x64-baseline`), and produces signed Android APK/AAB with checksums and a manifest. Also includes the on-tablet APK build, toolchain setup and signing helpers. Root scripts expose these. Files: `script/{tandem-v2,build-tandem-release,package-tandem-release,build-tablet-android,android-signing,android-toolchain-env}.ts`, `script/setup-tablet-android.sh`, `package.json` and `bun.lock` (inventory-only; adds the Android workspace, Tauri packages and the client→util dependency).
- LF line endings for build and mobile sources, and binary attributes for image/keystore assets. Files: `.gitattributes`.

### Identity, CLI And Local Service

- The fork-owned `Brand` module centralizes product name, command, roots and project/release URLs. Global roots and client service discovery/spawning use Tandem identity, so Tandem never selects official OpenCode's service. Files: `packages/util/src/brand.ts`, `packages/util/src/global.ts`, `packages/client/src/{effect/service,promise/service,service}.ts`, `packages/client/package.json` (inventory-only).
- CLI help uses Tandem identity, and compiled `OPENCODE_CLI_NAME` is `tandem`; the build keeps upstream's `bin/opencode` artifact layout for staging. ACP display/auth-command names and fallback errors say Tandem. Install detection, uninstall PATH cleanup, Windows retained-image recognition, service hints and stats footers use Tandem paths/commands. Files: `packages/cli/script/build.ts`, `packages/cli/src/commands/commands.ts`, `packages/cli/src/acp/{service,error,translate}.ts`, `packages/cli/src/commands/handlers/{default,uninstall,stats}.ts`, `packages/cli/src/services/{retained-image,update-preflight}.ts(x)`, `packages/cli/src/server-process.ts`.
- `pair --server` resolves an explicit server through existing `ServerParams`/`ServerConnection.resolve`, so pairing can target the isolated server without implicit service discovery. Files: `packages/cli/src/commands/commands.ts`, `packages/cli/src/commands/handlers/pair.ts`.
- **Manual updates:** `Updater.Service`'s public boundary is inert. `run` does nothing, `check` reports unavailable with download guidance, and `latest`/`apply`/`upgrade` fail with that guidance. The upgrade installer is replaced by a short handler pointing to `https://github.com/Liddo-kun/Tandem/releases`. Files: `packages/cli/src/services/updater.ts`, `packages/cli/src/commands/handlers/upgrade.ts`.
- **Unchanged by design:** `@opencode/*` package scopes, `OPENCODE_*` environment variables, provider IDs, wire fields, `opencode.json(c)` and `.opencode` conventions, the Basic-auth username `opencode`, ACP `AuthMethodID` and command IDs such as `opencode.update`.

### TUI, UI And App Branding

- The TUI logo, interactive home logo and session-epilogue art delegate to fork-owned Tandem art (gradient wordmark, product text or compact T by width), with Tandem resume commands. Title, attention, update, pairing, permission, error, stats and mini-mode copy, plus help/crash links, are branded in upstream presentation handlers. Files: `packages/tui/src/{logo.ts,app.tsx,attention.ts}`, `packages/tui/src/component/{logo,dialog-pair,dialog-update,error-component,terminal-pane}.tsx`, `packages/tui/src/feature-plugins/system/stats.tsx`, `packages/tui/src/mini/{footer.permission.tsx,footer.prompt.tsx,runtime.lifecycle.ts,splash.ts}`, `packages/tui/src/routes/session/permission.tsx`, `packages/tui/src/util/{error,error-details,presentation}.ts`; fork-owned `packages/tui/src/brand-logo.ts`, `packages/tui/src/component/tandem-logo.tsx`.
- Shared UI `Mark`/`Splash`/`Logo` and `Wordmark` keep their public entry points but delegate to fork-owned Tandem art. Fork-owned icon generation supplies PNG/ICO/ICNS and notification art. Files: `packages/ui/src/components/logo.tsx`, `packages/ui/src/typography/wordmark/wordmark.tsx`, `packages/ui/src/assets/favicon/site.webmanifest` (inventory-only); fork-owned `packages/ui/src/components/tandem-{logo,wordmark}.tsx`, `packages/ui/script/tandem-icons.py`, `packages/ui/src/assets/brand/*`.
- The shared app applies central Tandem product copy after locale loading. Product, help and issue links, page metadata, web icons and the notification identity are Tandem's. The About animation is replaced, because upstream's animates the letters of "opencode". Files: `packages/app/{index.html,vite.icons.ts}`, `packages/app/manifest.json` (inventory-only), `packages/app/src/runtime/i18n/{desktop-native.ts,language.tsx}`, `packages/app/src/runtime/platform/web.ts`, `packages/app/src/home/projects/controller.tsx`, `packages/app/src/settings/about/{about.tsx,animated-wordmark.tsx}`, `packages/app/src/shell/{commands/desktop-menu.ts,errors/error.tsx,titlebar/titlebar.tsx,titlebar/windows-menu.tsx}`; fork-owned `packages/app/src/runtime/i18n/product-copy.ts`.
- **Electron desktop is not a Tandem deliverable:** `packages/desktop` is unmodified upstream. It still picks up the shared UI's Tandem art, which upstream's desktop splash animation does not expect.

### Android Platform And Persistence

- `packages/android/` is the fork-owned Tauri 2 / Kotlin shell. Production ID is `app.liddokun.tandem`; `OPENCODE_ANDROID_VARIANT=v2` builds the separately signed **Tandem V2** development app (`app.liddokun.tandem.v2`). It includes the mobile-bridge plugin (LAN scan/cancel, share), the generated-project patcher, a MainActivity template (volume-key zoom stepping; WebView debugging only for the exact development ID), icon generation, and the entry that implements the shared `Platform`.
- The shared platform contract gains an Android discriminant and optional native zoom, haptics, sharing, LAN discovery, foreground callbacks and setup help. The extension adapter presents Android as the existing `web` SDK platform, and desktop-only file-manager lookup excludes Android. Files: `packages/app/src/runtime/platform/platform.tsx`, `packages/app/src/runtime/extension/services.tsx`, `packages/app/src/settings/workspaces/project-options.tsx`; fork-owned `packages/android/src/{entry-android.tsx,bridge.ts}`.
- Persistence and its migrations use any supplied native storage provider, not only desktop's. The app barrel exports `createBrowserDraftStore`, so Android keeps image attachments out of settings and drafts survive relaunch. Files: `packages/app/src/runtime/persistence/storage.ts`, `packages/app/src/index.ts`; fork-owned `packages/android/src/{entry-android.tsx,storage.ts}`.
- **Server connection:** native LAN discovery in onboarding and the add-server dialog, preferring 4097 then 4096; a scan cancelled before it starts stops cleanly. Also: pasted single-use pairing links, credential-required vs offline feedback, a v2-server requirement on Android, and onboarding connections saved as the default. Files: `packages/app/src/servers/connect/{dialog.tsx,screen.tsx}`, `packages/app/src/runtime/i18n/en.ts`; fork-owned `packages/app/src/servers/connect/native-discovery.tsx`, `packages/android/src/discovery.ts`.
- **Zoom and insets:** persisted page zoom (80–150%, 2% steps, default 100%), a General settings control and hardware volume-key stepping. Shell and titlebar honor wrapper-owned safe-area variables, so insets have one owner. Files: `packages/app/src/settings/{model.tsx,general/general.tsx}`, `packages/app/src/shell/shell.tsx`, `packages/app/src/shell/titlebar/titlebar.tsx`; fork-owned `packages/android/src/{viewport.ts,android.css}`.
- **Native editing:** with `view.nativeEditing`, Enter inserts a newline and the send button submits. Delete-word is atomic, IME composition is guarded, a presentation-only trailing BR keeps the caret line box (excluded from text/selection), the caret is revealed, and sizing waits for viewport readiness. Files: `packages/app/src/composer/editor/{dom.ts,editor.tsx,interaction.ts}`, `packages/app/src/composer/model.ts`.
- **Taobao links:** an opt-in Markdown protocol capability lets Android allow `taobao://` item-detail links only. Files: `packages/session-ui/src/components/markdown-cache.tsx`; fork-owned `packages/android/src/taobao.ts`.

### Clipboard

- Every shared copy action uses a fork-owned helper: `navigator.clipboard.writeText` first, then a selection-preserving hidden-textarea `execCommand("copy")` fallback. Covers chat, code blocks, errors, session IDs, authorization URLs, extensions, file paths, text fields and terminal selections, on Android and plain-HTTP LAN web. Files: `packages/ui/src/components/text-field.tsx`, `packages/session-ui/src/message/message-content.tsx`, `packages/session-ui/src/components/{markdown,tool-error-card}.tsx`, `packages/app/src/providers/connect/dialog.tsx`, `packages/app/src/runtime/extension/services.tsx`, `packages/app/src/session/commands/use-session-commands.tsx`, `packages/gui-extensions/src/file/open-in-app.tsx`, `packages/gui-extensions/src/terminal/terminal.tsx`; fork-owned `packages/ui/src/components/clipboard.tsx`.

### Terminal

- Touch-drag scrollback uses Ghostty's public `scrollLines` with canvas-scale accounting, and swipes do not focus the terminal or open the IME. Ghostty scrollback is not a DOM scroll container, so this lives in the shared terminal. Files: `packages/gui-extensions/src/terminal/terminal.tsx`.

### Prompt Corrector

- A fork-owned built-in plugin copy-edits nonempty, nonsynthetic text parts (≤600 trimmed characters by default) in a hidden auxiliary session before the main turn. Accepted corrections replace the stored text, and changed originals are kept in `tandemPromptCorrectorOriginal` metadata. Rejected, empty or failed corrections keep the original. The auxiliary session gets only correction instructions and the raw text, has no tools or project instructions, and is deleted afterward. Environment: `TANDEM_PROMPT_CORRECTOR` (default on), `_MAX` (600; 0 uncapped), `_MODEL`, `_VARIANT`, `_DEBUG`, `_DEBUG_KEEP` (2). Model selection: override, then the Corrector agent model (legacy `small_model` migrates there), then a cheap model for the session provider, then the session model. Files: fork-owned `packages/core/src/plugin/tandem/{prompt-corrector,auxiliary}.ts`, `packages/util/src/tandem-auxiliary.ts`, `notes/tandem-corrector.md`; shared `packages/core/src/config/normalize.ts` (migration), `packages/core/src/plugin/internal.ts` (registration).
- **Composer toggle:** a persisted per-client Corrector control. Its state is snapshotted into drafts, retries and queued prompts (`tandemCorrectorDisabled` when off) and kept through queue edit/reorder/undo/resend. Correction covers only authored text ranges. Old v1 `on`/`no-reprompt`/`off`/`reprompt:false` settings migrate; RePrompt itself is not restored. Files: `packages/app/src/composer/{model,request,schema,state,submit}.ts`, `packages/app/src/session/composer/queue.ts`, `packages/app/src/settings/{model.tsx,general/general.tsx}`, `packages/app/src/runtime/i18n/en.ts`.

### Instructions And Tool Guidance

- **Public plugin API:** the plugin `instructions` hook (`"default" | "agent-only"`) runs before ambient baseline discovery and before Read-triggered instruction injection. Bare auxiliary sessions (Corrector, web reader) therefore get no project instructions. Files: `packages/plugin/src/{effect,promise}/session.ts`, `packages/core/src/session/{context,instructions}.ts`.
- Fork-owned plugins are registered at upstream's built-in boundary. Order: auxiliary defaults first, then configured hooks, then policies, Bash search and Claude presentation last. Files: `packages/core/src/plugin/internal.ts`.
- The environment instruction names the actual runtime scratch directory as pre-approved for all temporary files. It also explains that saved-image Markdown links resolve against the session directory and that UI display does not give images to the model. Native-catalog guidance names only available tools. Files: `packages/core/src/instructions/builtins.ts`, `packages/core/src/session/system-prompt.ts`.
- **Tool descriptions:** a fork-owned plugin rewrites the Read, shell and patch descriptions through the public tool `transform` hook: targeted reads, no reread after one's own edit, workdir use, quoting, bounded output, and patch as combined create/edit/delete/rename. It runs before Bash search and Claude presentation, and refreshes the shell name per request like upstream. The upstream tool files are unmodified; on syncs, compare this wording with upstream's new descriptions. Files: fork-owned `packages/core/src/plugin/tandem/tool-guidance/plugin.ts`; shared `packages/core/src/plugin/internal.ts` (registration).
- **Prompt text (inventory-only):** GPT and Astra prompts add Jon's physician/off-label context and communication, completion, delegation and no-routine-tests preferences. On upstream merges, reapply these customizations onto the new upstream wording. Files: `packages/core/src/plugin/system-prompt/{gpt,gpt-astra}.txt`.

### Claude Presentation

- **Login and transport (external plugin):** `~/code/opencode-anthropic-auth-v2` (`src/v2.ts`), registered through `plugins: ["file://…"]` in config. It provides Claude Pro/Max PKCE browser login with manual code entry, credential persistence and refresh (`src/refresh.ts`), and zero subscription costs including cache. Requests use Bearer instead of `x-api-key`, Claude Code beta headers and user agent; API-key auth is unaffected. Insecure-TLS custom endpoints are handled inside the plugin (`src/insecure*.ts`), not through a core TLS API.
- **Presentation (fork-owned):** a Claude Code-shaped base prompt. The rendered instruction baseline moves into a first-user `<system-reminder>`, found by the `tandem.instruction-baseline` marker, while durable instruction updates stay chronological. Skills are listed once, and Skill tool text points to that list. Tool names and selected keys are mapped to Claude Code forms, with structured reverse mapping before validation, permissions and execution. Adds the billing block (`cc_version`/`cc_entrypoint`/`cch`). Applies to Claude models with OAuth or API key; bare auxiliary sessions are skipped. Files: fork-owned `packages/core/src/plugin/tandem/claude/{plugin,presentation,instructions}.ts`, `claude/anthropic.txt`; shared `packages/core/src/session/{context,model-request}.ts`.
- **Cache policy:** supported routes (Claude models other than Bedrock, OpenRouter, Alibaba) normalize manual and automatic cache hints to one-hour TTLs within the four-breakpoint cap. The volatile billing block never takes a breakpoint. Files: `packages/ai/src/cache-policy.ts`.
- **Thinking context management:** `clear_thinking_20251015` with `keep: "all"` and its beta are sent only when the resolved thinking mode is `enabled` or `adaptive`, separately from compaction edits. Files: `packages/ai/src/protocols/anthropic-messages.ts`.

### Claude Bash Search

- Opt-in `TANDEM_CLAUDE_BASH_SEARCH=1`. If `ugrep`, `bfs` and system `grep` are found and `bfs` supports a usable regex type, subprocess-local PATH shims are written (ugrep basic-regex/ignore-file/hidden/binary-skip/VCS-exclude, falling back to system grep; `bfs -S dfs`). Claude sessions then lose Glob/Grep and references to them, while other providers keep their catalogs. Otherwise the feature stays inert and tools remain. The catalog is filtered before Code Mode captures its inventory, carried in `Tool.Snapshot.bashSearch`. Files: fork-owned `packages/core/src/plugin/tandem/bash-search/{plugin,shims}.ts`; shared `packages/core/src/tool.ts`, `packages/core/src/session/{context,model-request}.ts`, `packages/core/src/session/system-prompt.ts`.

### Image Generation (imagegen)

- A fork-owned `imagegen` tool and built-in skill (user skills override it), gated together on credentials and `TANDEM_IMAGEGEN`. Credential priority: stored OpenAI API key, then `OPENAI_API_KEY`, then a separate `tandem-openai-images` ChatGPT OAuth integration (separate because the conversation token is rejected for image capabilities). OAuth exposes `prompt`, `image_paths` (≤10), `mask_path` and `transparent`. API-key mode adds validated `width`/`height` and `quality`, uses `gpt-image-2.5-sunburst`, and calls OpenCode's own image API (`@opencode/ai/promise` `image.generate` with the OpenAI provider) for generation and edits; that API reports no revised prompt, request ID or backend model, so API-key results have no changed-prompt caption. Ordinary OAuth uses native Codex Images; masked OAuth edits use the Responses image tool (`TANDEM_IMAGEGEN_OAUTH_MODEL`, default `gpt-5.5`). Originals are saved to `<session dir>/imagegen/<callID>.png`, with an optional same-size JPEG/WebP display copy (`TANDEM_IMAGEGEN_JPEG_QUALITY`, 90). Results are path-only text with observed metadata. Files: fork-owned `packages/core/src/plugin/tandem/imagegen/*`.
- **Renderer:** thumbnail, path, changed-prompt caption and lightbox, using v2's authenticated image reader. Registered with the public `registerTool` after the built-ins. Files: fork-owned `packages/session-ui/src/tools/{imagegen.tsx,tandem-tools.ts}`; shared `packages/session-ui/src/tools/tool-renderer.tsx` (one import and initialization call).

### Browser-Backed Webfetch

- Replaces upstream `webfetch` unless `TANDEM_BROWSER_FETCH=0`. Pages are fetched through the user's Chrome over CDP: desktop Chromium on Termux:X11 first, with Android Chrome fallback (`TANDEM_BROWSER_FETCH_{ENDPOINT,ANDROID_ENDPOINT,LAUNCHER}` override). The engine follows redirects, reports final URL/status/page state, refuses to retry rate-limit pages, captures up to four 1600px screenshot slices and extracts PDFs with `pdftotext -layout`. Initial content is capped at 100 KB, with overflow spilled to file. A hidden bare reader session (default `openai/gpt-5.6-sol`, medium variant and verbosity) answers through `fetch_page`/`read`, bounded to 12 follow-ups including 5 search-engine fetches. Browser fetches are currently serialized process-wide. Files: fork-owned `packages/core/src/plugin/tandem/browser-fetch/{plugin,cdp-fetch}.ts`, `web-fetcher.md`, `packages/core/src/plugin/tandem/auxiliary.ts`.
- **Renderer:** compact answer preview, expandable Markdown answer, source URL and saved paths. Registered after the built-ins, so it replaces upstream's webfetch card, whose registration is unmodified. Files: fork-owned `packages/session-ui/src/tools/{webfetch.tsx,tandem-tools.ts}`; shared `packages/session-ui/src/tools/tool-renderer.tsx`.

### Provider Requests And Diagnostics

- Opt-in `TANDEM_DUMP_REQUEST=<directory>` writes one JSON file per final provider-facing send, after every transformation (Claude presentation, cache policy, provider overlays, auth plugins, session HTTP hooks), with session/agent/model/request-kind attribution. Each retry and continuation is its own file. Coverage: native HTTP routes through a decorated injected HTTP client, WebSocket frames through a decorated connector (including reused sockets), and AI-SDK providers at the terminal global `fetch`, so custom-fetch rewrites are included. While enabled, a scoped global-`fetch` observer is installed for attributed AI-SDK calls only. A custom fetch that bypasses global `fetch` is recorded as `custom-fetch-input-unverified`, and streaming bodies are marked as omitted rather than consumed. Credentials are redacted and write failures never fail the request. Imagegen's own image API calls are not captured. Files: fork-owned `packages/core/src/plugin/tandem/request-dump/{record,transport,sdk-fetch}.ts`; shared `packages/core/src/effect/app-node-platform.ts`, `packages/core/src/session/{model-transport,model-request}.ts`, `packages/core/src/aisdk.ts` (marked one-line seams).

### Temporary Upstream Bug Fixes

Fixes for bugs present in pristine upstream, marked `UPSTREAM-DIVERGENCE(temporary)`. Remove each with its markers when upstream ships an equivalent fix. Neither was fixed in upstream v2 as of `0a46301e36` (2026-10-04).

- **Deleted-session refresh race:** a background metadata read that is still pending when a session is deleted shows a false "Request failed / Session not found" error, or brings the deleted session's metadata back. Ordinary clients can hit this; Tandem's short-lived auxiliary sessions (Corrector, web reader) make it frequent. The client keeps a set of sessions deleted while it runs, ignores missing-session errors for those IDs from background refreshes, and drops them from late metadata/family results. Explicit reads still reject. Files: `packages/client/src/solid/data.ts`.
- **Promise plugin `DeepMutable`:** branded IDs are mapped into object-like types, so IDs read from an editor cannot be passed back to editor methods. Type-only fix; the external auth plugin needs it to typecheck. Files: `packages/plugin/src/promise/types.ts`.

### Upstream Limitations Worked Around In Fork-Owned Code

No shared file changes; listed so a sync can simplify these if upstream changes.

- Core credential resolution (`packages/core/src/integration.ts`) reads, refreshes and persists without serialization. The Claude auth plugin keeps a process-wide rotation map (a failed refresh is dropped from it so the next request retries), and imagegen keeps a per-credential mutex.
- A tool is marked settled before its success event is validated and published. Public `Tool.Metadata` allows values that durable events reject, so imagegen omits undefined metadata values.
- An external provider loaded from source cannot pass its `LanguageModel` to a packaged host (class identity differs). The auth plugin's `src/insecure-provider.ts` rebuilds a host model before preparing requests.
