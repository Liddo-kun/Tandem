# Tandem v2 Changelog

Dated user-visible changes and published releases of Tandem v2, and the source for its GitHub release notes. v1 history stays in the v1 checkout's `log.md`. The current list of Tandem's changes to OpenCode, for upstream syncs, is [logv2.md](logv2.md).

## Unreleased

Baseline: OpenCode `upstream/v2` at `40679546d4` (2026-10-03, `@opencode/cli` 2.0.22). Version `2.0.22-tandem-v2.0`, installed as the daily Tandem on Jon's tablet on 2026-10-05; no v2 GitHub release has been published. Source is on branch `tandem-v2`. Verified behavior and unverified cases are recorded in [notes/archive/v2-readiness.md](notes/archive/v2-readiness.md).

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
