# Tandem guidance

- Read `contextL.md` on Linux or `contextW.md` on Windows once at session startup.
- This repository is Tandem: OpenCode v2 (`upstream/dev`, pinned at `4617210822`) plus Tandem's customizations, on branch `tandem-v2`, with its own `.git` directory. It has been the daily Tandem since the 2026-10-05 switch-over. V1 source is preserved on Tandem's own `dev` branch (not upstream's); its old `/home/jon/code/Tandem` checkout was removed. Keep the installed v1 fallback, widget, Android app and data unless Jon asks to retire them. Backup locations are in `notes/tandem-setup.md`.
- `logv2.md` inventories Tandem's customizations of OpenCode. `notes/todo-after-v2.md` holds deferred work.
- Avoid adding upstream divergence wherever possible, whether adding features or fixing bugs. Before editing upstream-shared code, actively look for alternative ways to accomplish the same task through existing upstream behavior, configuration, public plugins/extensions, or Tandem-owned modules. Only change shared code when those alternatives cannot reasonably satisfy the request, and keep the remaining seams minimal. Direct GPT prompt-file edits are accepted.
- Stay strictly within the user's requested scope. Do not add unrequested features or behaviors, especially when they introduce additional upstream divergence.
- Mark every edit to an upstream-shared file with an `UPSTREAM-DIVERGENCE: <why>` comment at the changed code, and record it in `logv2.md`. Files that cannot carry comments (JSON, lockfiles, generated client output, model-facing prompt text, AGENTS.md) are listed in `logv2.md` only. Preserve existing markers.
- `logv2.md` is only a log of Tandem's current customizations to OpenCode, like v1's `log.md`. Never put decisions, proposals, open questions, pending work or to-dos in it; deferred work belongs in `notes/todo-after-v2.md`.
- Do not fix OpenCode upstream bugs (behavior broken in pristine upstream, independent of Tandem's additions) without Jon's agreement. Apparent bugs can be intended behavior or caused by Tandem's own integration: report the symptom, the pristine-upstream code path and whether newer upstream changed it, then wait. Approved fixes use `UPSTREAM-DIVERGENCE(temporary):` and belong in `logv2.md`'s temporary-fix section.
- Commit, push, publish, install to the daily setup or restart the daily server only on Jon's explicit instruction. Tandem's own commits use `personal: <summary>`, as in v1.
- Verify changes with a real agent session and actual tools on the development server (port 4098) before they are installed to the daily setup; build as necessary. Focused post-change typechecks are useful only after live verification; builds/typechecks do not establish that a feature works.
- All temporary files belong under `/tmp/tandem` on this tablet. Use `/tmp/tandem/v2` for development logs and scratch work.
- The official source branch is `upstream/dev`, where upstream promoted v2 on 2026-10-10; `upstream/v2` is frozen and `upstream/v1` is OpenCode 1. Use the pinned baseline for diffs. Advance the baseline only through the `tandem-opencode-sync` skill with Jon's approval.
- Test clients against the development server with an explicit `--server` URL. Implicit connections, upstream `dev:live` scripts and client commands such as `tandem debug ...` can discover, replace or spawn a managed service, including the daily one.

## Working in the code

- Match the style of the surrounding code. Read the nearest package `AGENTS.md` before editing a package.
- After changing the public Protocol or Server `HttpApi`, run `bun run generate` from `packages/client`. Do not edit generated client files directly.
- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk` composes Client, Core, and Server.
- Tests cannot run from the repo root; run them from package directories such as `packages/core`.
- For a focused typecheck, run `bun typecheck` from the affected package directory. Never run `tsc` directly.
