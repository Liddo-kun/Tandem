---
name: tandem-opencode-sync
description: Use when syncing official OpenCode upstream/dev into the Tandem repo, especially when the user says get us up to date from opencode upstream, upstream sync, opencode update, fresh pull, batch merge, or remaining commits.
---

# Tandem OpenCode Sync

Use this skill to update `C:\Users\Jon\Tandem` from official OpenCode while preserving Tandem's documented mobile and personal deltas.

## Fresh Session Contract

When the user says "get us up to date from opencode upstream", do not rely on previous chat history or remembered SHAs. Recompute the sync state from Git.

- Resume point: `git merge-base dev upstream/dev`
- End target: current `upstream/dev` after `git fetch --no-tags upstream dev`
- Pending commits: `git rev-list --topo-order --reverse dev..upstream/dev`
- If the user asks to get up to date, process all pending commits unless review or dry-run finds risk.
- Only use an older pinned target if the user explicitly asks to continue that older target.

Read `context.md` before syncing. Use `log.md` as the final-state inventory of intentional Tandem differences from official OpenCode.

## Hard Rules

- Use `dev` as the default Tandem branch unless the user says otherwise.
- Use `upstream/dev` as official OpenCode.
- Use merge, not rebase, for normal sync work.
- Do not use `origin/dev` to choose the next upstream batch; it may be stale.
- Do not run tests or typechecks from the repo root.
- Do not write git config. If Git lacks committer identity, use one-shot `git -c user.name=... -c user.email=...` only for that command.
- Never discard dirty worktree changes unless the user explicitly approves it.

## Preflight

Start in `C:\Users\Jon\Tandem`:

```powershell
git status --short --branch
git remote -v
git branch -vv
```

If the worktree is dirty, stop and ask before syncing. Do not assume the changes are related to the sync.

If `upstream` is missing, configure it as:

```powershell
git remote add upstream https://github.com/sst/opencode.git
```

Fetch and pin the sync target for this session:

```powershell
git fetch --no-tags upstream dev
$syncTarget = git rev-parse upstream/dev
```

The pin is session-local. A future fresh session should fetch again and recompute from `dev..upstream/dev` unless the user asks for a specific older target.

## Choose The Batch

Batch size is user-directed.

- Use small batches when the user wants careful review, learning, or risk control.
- Use all pending commits when the user wants to get fully up to date and dry-run looks safe.
- If the user says "get us up to date from opencode upstream", set `$requestedSize = $pending`.
- If unspecified and the range is large or risky, ask briefly or choose a conservative batch.

Do not use `git log --reverse --max-count=10`. Git applies `--max-count` before `--reverse`.

Use this pattern:

```powershell
$commits = @(git rev-list --topo-order --reverse dev..$syncTarget)
$pending = $commits.Count
if ($pending -eq 0) { "No upstream commits pending"; return }

# Examples:
# $requestedSize = 10       # next 10
# $requestedSize = $pending # all pending
$requestedSize = $pending
$batchSize = [Math]::Min($requestedSize, $pending)
$batch = $commits[0..($batchSize - 1)]
$target = $batch[-1]

$batch | ForEach-Object { git log -1 --oneline $_ }
git rev-list --count dev..$target
```

The final count must equal `$batchSize`. If it does not, stop and inspect.

## Review And Dry Run

Review upstream changes from the merge base to the batch target:

```powershell
$base = git merge-base dev $target
git show --stat --oneline --find-renames $batch
git diff --name-status $base $target
git diff --check $base $target
```

Do not review with `git diff dev..$target`; Tandem has fork-only files, so that comparison creates false deletion noise.

Use these priorities:

- Core OpenCode/server behavior: prefer current upstream unless Tandem has a documented compatibility reason.
- Upstream architectural changes, simplifications, and refactors must be incorporated. Adopt the upstream structure first, then reapply Tandem customizations only where they still make sense.
- Do not preserve an old Tandem implementation shape just because it is already in the fork. Understand the original intent, preserve documented behavior that is still needed, and drop obsolete code paths instead of keeping needless parallel implementations.
- If upstream makes a significant UI or behavior change, reassess Tandem customizations against that new design. Some Tandem changes may no longer fit and can be removed, but only after understanding why they existed and confirming they are no longer useful.
- Use judgment. If it is unclear whether a Tandem customization should survive an upstream refactor, simplification, or UI change, stop and ask the user before deciding.
- iOS/Android/mobile-specific behavior: preserve Tandem behavior documented in `context.md` and `log.md`.
- Shared web UI conflicts: manually produce the smallest combined final state.
- Preserve `UPSTREAM-DIVERGENCE` comments.

Dry-run before merging:

```powershell
git merge-tree --write-tree dev $target
```

If it reports conflicts or exits nonzero, stop and resolve deliberately.

## Merge

Use a merge commit:

```powershell
git merge --no-ff $target -m "opencode-sync: merge upstream batch through $($target.Substring(0, 9))"
```

If committer identity is missing:

```powershell
$name = git log -1 --format='%an'
$email = git log -1 --format='%ae'
git -c user.name="$name" -c user.email="$email" merge --no-ff $target -m "opencode-sync: merge upstream batch through $($target.Substring(0, 9))"
```

## Post-Merge Gate

Immediately after the merge:

```powershell
git status --porcelain=v2
git rev-list --count dev..$syncTarget
git log --oneline --decorate --max-count=6
```

If the worktree is dirty after a successful merge, stop before testing or continuing. Classify the dirty state first:

```powershell
git diff --name-status HEAD
git diff --numstat HEAD
git reflog --date=iso --max-count=12
```

Only restore dirty files after explicit user approval.

## Verification

Run only package-local checks. Never run tests or typecheck from repo root.

Common command from a package directory:

```powershell
C:\Program_Files\Bun\bin\bun.exe typecheck
```

Use `packages/opencode` when the batch touches server, Effect, CLI, tests, providers, LSP, sync, tools, or generated SDK/server code. Use `packages/plugin` when `packages/plugin` changes. Use app/ui/android/ios package checks when those packages change.

## Final Report

Report the batch commits, merge commit SHA, conflict status, verification results, remaining commits against `$syncTarget`, and whether the worktree is clean.
