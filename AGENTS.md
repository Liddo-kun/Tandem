# Tandem guidance

- Read `contextL.md` on Linux or `contextW.md` on Windows once at session startup.
- This repository is Tandem: OpenCode v2 (`upstream/v2`, pinned at `40679546d4`) plus Tandem's customizations, on branch `tandem-v2`. It has been the daily Tandem since the 2026-10-05 switch-over. The previous Tandem (v1) checkout, `/home/jon/code/Tandem`, is kept as a fallback and reference: do not modify it, its runtime or its data.
- `logv2.md` inventories Tandem's customizations of OpenCode. `notes/todo-after-v2.md` holds deferred work.
- Prefer equivalent upstream behavior, then configuration/public plugins. Keep Tandem logic in owned modules and keep shared-code seams narrow. Direct GPT prompt-file edits are accepted.
- Mark every edit to an upstream-shared file with an `UPSTREAM-DIVERGENCE: <why>` comment at the changed code, and record it in `logv2.md`. Files that cannot carry comments (JSON, lockfiles, generated client output, model-facing prompt text, AGENTS.md) are listed in `logv2.md` only. Preserve existing markers.
- `logv2.md` is only a log of Tandem's current customizations to OpenCode, like v1's `log.md`. Never put decisions, proposals, open questions, pending work or to-dos in it; deferred work belongs in `notes/todo-after-v2.md`.
- Do not fix OpenCode upstream bugs (behavior broken in pristine upstream, independent of Tandem's additions) without Jon's agreement. Apparent bugs can be intended behavior or caused by Tandem's own integration: report the symptom, the pristine-upstream code path and whether newer upstream changed it, then wait. Approved fixes use `UPSTREAM-DIVERGENCE(temporary):` and belong in `logv2.md`'s temporary-fix section.
- Keep the existing Tauri/Kotlin Android shell. Do not restore excluded voice/microphone integration, RePrompt duplication, LSP work or todowrite. Deferred UI layouts, review caps, refresh controls, iOS and custom subagent controls are not requirements.
- Commit, push, publish, install to the daily setup or restart the daily server only on Jon's explicit instruction. Tandem's own commits use `personal: <summary>`, as in v1.
- Keep subagent assignments bounded. Start a fresh subagent for a new task rather than accumulating unrelated follow-ups; compaction is currently unreliable. Astra is appropriate for substantial, tightly related integration work that will need sustained follow-through.
- Bring important feature, architecture, persistence or API tradeoffs to Jon. Routine implementation details are agent-owned; difficulty is not permission to drop required behavior.
- Verify changes with a real agent session and actual tools on the development server (port 4098) before they are installed to the daily setup; build as necessary. Do not add, modify or run low-level tests unless Jon requests them. Focused post-change typechecks are useful only after live verification; builds/typechecks do not establish that a feature works.
- All temporary files belong under `/tmp/tandem` on this tablet. Use `/tmp/tandem/v2` for development logs and scratch work. Never log credentials in evidence.
- The official source branch is `upstream/v2`; use the pinned baseline for diffs. Advance the baseline only through the `tandem-opencode-sync` skill with Jon's approval.
- Test clients against the development server with an explicit `--server` URL. Implicit connections, upstream `dev:live` scripts and client commands such as `tandem debug ...` can discover, replace or spawn a managed service, including the daily one.

## Working in the code

- Match the style of the surrounding code. Read the nearest package `AGENTS.md` before editing a package.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit generated client files directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk` composes Client, Core, and Server.
- Tests cannot run from the repo root; run them from package directories such as `packages/core`.
- For a focused typecheck, run `bun typecheck` from the affected package directory. Never run `tsc` directly.
