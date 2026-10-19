# Upstream sync follow-up — 2026-10-20

Merged all 14 fetched commits from `ba06ff9e0bf2dcefbbbc3a1d6094f3572d77c84e`
through `157ad7f22a44f5184557680998aee25769ea3b65` in eight approved batches.
The source version remains OpenCode 2.0.32. Starting Tandem HEAD was `5c6c7d6312`.
No push, publication, daily installation, or daily-server restart was performed.

## Batches and verification

All batches had their commit count checked, an upstream-range review, `git diff --check`,
a merge-tree dry run, and a clean-worktree post-merge gate. Builds used pinned Bun 1.4.2.
Agent/client checks explicitly targeted the isolated development server on port 4098.

| Batch | Commits / target | Merge | Verification |
| --- | --- | --- | --- |
| 1 | 2 / `cec70f3ed6` | `cbdb171dfa` | Console/model naming and worker-RPC tests: 29 tests and five package typechecks passed. No agent/build needed. |
| 2 | 1 / `f394d9d410` | `8f6ad91b9b` | Rebuilt CLI/server; live GPT shell calculation returned 899. Model API included MiniMax M3.1 Flash Free and excluded sampled retired IDs. Core typecheck passed. |
| 3 | 1 / `a15de38eef` | `93c2b3277d` | Flowchart parser: 182 tests and Merman typecheck passed. No agent check needed for this terminal-only parser change. |
| 4 | 2 / `815de9950b` | `3b0d2c9510` | Frozen dependency install, CLI build, live agent/tool and terminal-client Unicode output passed. Nine package typechecks passed, including Android. Full TUI suite: 1,495 pass, two skip, 34 fail; classification below. Simulation/LaTeX/Merman: another 54 tests passed. |
| 5 | 2 / `367c8fbec7` | `90757b55a3` | Rebuilt CLI/server. A real agent started a background shell; removing it emitted exactly one `shell.exited` with `status: killed` before `shell.deleted`. Seventeen shell/retention/plugin-reload tests and Core typecheck passed. |
| 6 | 1 / `fd6589239e` | `5cd53990e2` | Rebuilt CLI/server. Live upstream-summary and Tandem-Claude compaction both preserved two exact codes and supported tool-assisted recall afterward. 247 tests passed; three pre-existing failures reproduced on pre-batch sources. Core and docs typechecks passed. |
| 7 | 3 / `52a10f573f` | `b2e5ecd944` | Rebuilt CLI/server. Real terminal client waited for a foreground shell and displayed its result. All 74 transport/deadline/shell-failure tests and CLI/TUI/Util typechecks passed. |
| 8 | 2 / `157ad7f22a` | `9722b7cd45` | Desktop development-state preservation and course docs: Desktop/docs typechecks passed. No agent/build needed; Electron is not a Tandem deliverable. |

## Conflict resolutions and customizations

Only batch 4 conflicted:

- `packages/tui/src/app.tsx`: adopted upstream's suspension-aware `setTerminalTitle(renderer, ...)`
  helper while preserving Tandem home/fallback titles and divergence comments.
- `packages/tui/src/mini/runtime.lifecycle.ts`: same title-helper adaptation; adopted upstream's
  asynchronous renderer shutdown.
- `packages/tui/src/routes/session/index.tsx`: kept Tandem's rewind-confirmation hook and used
  upstream's earlier renderer declaration, removing the duplicate at the old location.

No customization or temporary fix was removed. All pre-sync divergence markers in changed files
survived. No new runtime divergence was introduced. The compaction merge retained the existing
Claude delegation; automatic-compaction eligibility still follows upstream's shared ceiling,
whose default reserve changed in this sync. Existing explicit `buffer` settings still apply.

## Test limitations and diagnostics

- Full TUI run: 33 failures are upstream assertions tied to OpenCode branding rather than Tandem
  (titles, epilogues, stats, Mini splash/footer, permission guidance, investigation prompts).
  This includes the SIGHUP test waiting for the literal title `OpenCode`, which never arrives.
  These expectations were not rewritten as part of the sync.
- The remaining failure was the narrow shell-output mouse-wheel frame wait. Both width cases passed
  on the focused rerun. It remains a suite-level flake observation, not a proven product regression.
- Core runner failures reproduced using archived pre-batch sources at `90757b55a3`: manual and
  automatic Anthropic prefix tests expect upstream's summary prompt instead of Tandem's Claude
  prompt; the overflow-preparation test expects one model resolution but observes two. The dedicated
  upstream compaction and Tandem Claude-compaction test files passed.
- `packages/gui-extensions/AGENTS.md` requires `lint:changed`, but the package has no such script;
  that command could not run. Its changed worker tests and package typecheck passed.
- `termctrl` is unavailable, so no interactive terminal screenshot was captured. Terminal rendering
  was exercised by the existing TUI suite; real client checks used `tandem run --server ...`.
- No shared app/Android runtime source changed, so no APK build or device-driving check was needed.
  Merman is consumed by the TUI, not the shared web app. This sync did not investigate or fix the
  previously reported Android keyboard oscillation.
- Batch 2's first CLI build was interrupted during the user's guidance question, then rebuilt
  successfully. The compaction probe initially selected the oldest assistant message because the API
  lists messages newest-first; correcting the probe confirmed the already-successful summary recall.

Scratch evidence is under `/tmp/tandem/sync-followup*` and `/tmp/tandem/upstream-sync/followup*.json`.
The latest development binary contains batch 7; batch 8 changes only desktop development and docs.
