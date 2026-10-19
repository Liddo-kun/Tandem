# Upstream sync — 2026-10-20

Merged 62 commits from `bc5ebf00a4c169ece10f276e6ce02eaf18c326e6` through the fetched target `ba06ff9e0bf2dcefbbbc3a1d6094f3572d77c84e` (`upstream/dev`, OpenCode 2.0.32), in 19 approved merge batches. No merge conflicts; all existing divergence markers were preserved. No Tandem customization or temporary upstream fix was dropped.

## Compatibility adjustments

- Corrector debug-session cleanup follows all pages instead of only the first 50 sessions, then uses the newly available public plugin session-list API instead of accessing Core's Session service directly.
- Android uses upstream's TypeScript 7 compiler package and command. Its `rootDir` includes the root-level build helper imported by the Android project patcher.
- Bun initially rejected Android's stale compiler name in the merged lockfile and regenerated unrelated dependencies. With Jon's approval, that generated file was restored and only the Android workspace entry changed. Frozen installation then passed. CLI/APK builds, live verification, and all affected typechecks were repeated against the pinned dependencies.

## Verification by batch

Live checks used the development server at `http://127.0.0.1:4098`. CLI builds and Tandem Dev APK builds/installations were serialized. No daily server installation/restart or push was performed.

| Batch | Commits / endpoint | Verification |
| --- | --- | --- |
| 1 | 2 / `d4a6223d01` | Real GPT shell round trip; voice API validation and missing-key responses; 103 focused AI/Core/Server/Client tests; five package typechecks. |
| 2 | 1 / `c77e748dbf` | Cursor/schema tests (16), client regeneration, six typechecks. New agent session skipped: code relocation preserves cursor behavior. |
| 3 | 3 / `543b42ec2c` | Frozen installation and 31 available package typechecks. Agent/build skipped: release metadata and maintenance only. |
| 4 | 3 / `65932e870c` | Real GPT tool call; rebuilt/installed Tandem Dev; free-model picker and worktree search inspected; native touch moved a missing-location session to a selected worktree. Five-run session-opening median: 32.4 ms before, 33.3 ms after. App/Core typechecks passed. |
| 5 | 2 / `ae6a706156` | 34 TUI dialog tests and TUI typecheck. Agent session skipped: presentation-only listener optimization and docs. |
| 6 | 1 / `1cb7bcadb1` | Real agent/tool call; live pagination across 181 root sessions and invalid-cursor rejection; three pagination tests; Core/Server typechecks. |
| 7 | 1 / `4a5302817b` | Real OpenAI and Claude shell calls; 254 of 256 provider tests passed; AI typecheck. Two pre-existing cache-hint assertion failures reproduced at the pre-batch revision. |
| 8 | 2 / `22e771f589` | Live Corrector opt-in corrected a typo and the main agent executed shell; debug pruning exercised with retention set high enough to preserve prior debug sessions. Temporary development settings restored. Both plugin pagination tests and three typechecks passed. |
| 9 | 3 / `8c173a8f38` | Frozen installation, rebuilt development CLI, live agent/tool call, Core/Console typechecks. |
| 10 | 1 / `86c7f7c840` | Live buffered-generation API and agent/tool call; 17 generation/retry tests; Core typecheck. |
| 11 | 2 / `594af423e8` | Rebuilt CLI and Tandem Dev APK on pinned dependencies, live agent/tool call, 33 available package typechecks including Android. |
| 12 | 21 / `3099ec2c05` | Rebuilt CLI and live agent/tool call for the model refresh; four Console language tests; four typechecks. Mobile scroll changes are test-harness-only; no new timeline runtime change. |
| 13 | 3 / `49e9786bb7` | Live Claude loaded a scratch skill, captured 1,000,017 bytes including the final marker, and retained Bash cwd across separate calls. Live idle-message filter; 18 shell/skill/watch tests; client regeneration; six typechecks. |
| 14 | 1 / `63c1a27af5` | Live agent started with an unreadable scratch AGENTS.md and completed a shell call. Sixteen tests passed, one skipped; three typechecks. |
| 15 | 1 / `60a5a6ca7c` | Real OpenAI tool call, 73 Responses tests, AI typecheck. |
| 16 | 7 / `8c9c85c263` | Rebuilt CLI, real agent/tool call, Core/docs typechecks. |
| 17 | 4 / `18f4363d2f` | Live saved-permission creation through approval, edit, identity preservation, no-op, duplicate rejection, missing-ID error, and cleanup; real agent/tool call; endpoint test; client regeneration; five available typechecks. |
| 18 | 1 / `fa9da987be` | Live archive/unarchive, filtering, idempotence, and preserved messages; real agent/tool call; rebuilt/installed Tandem Dev and inspected restored session DOM; five tests, regeneration, five typechecks. |
| 19 | 3 / `ba06ff9e0b` | Reviewed Nix and legacy cloud-share removal; clean merge. Agent/build skipped: no daily-runtime changes. Function package has no typecheck command. |

## Verification limits and observations

- Voice transport was not connected to a real provider: the development server has ChatGPT login but no voice API key. Validation and the expected missing-key error were verified live; upstream transport tests passed.
- The two Anthropic test failures expect cache hints without Tandem's one-hour TTL. Both fail at pre-batch commit `a61dc30b3f` as well; no assertion or product code was changed to hide them.
- Jon observed the keyboard rapidly opening/dismissing during automated menu/input testing. This was not an intended behavior. With input automation idle, a six-second check showed no focus or viewport changes. The cause is not established; subsequent checks avoided repeated focus-driven actions. No keyboard workaround was added.
- During the initial inspector attachment, the daily WebView was briefly selected and navigated to Home. Its session route was restored, then subsequent inspection used the verified Tandem Dev PID and development URL.
- Scratch test scripts, detailed logs, API results and benchmark samples are under `/tmp/tandem/sync-*` and `/tmp/tandem/upstream-sync*`; they are disposable.
