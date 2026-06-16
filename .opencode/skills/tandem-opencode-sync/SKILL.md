---
name: tandem-opencode-sync
description: Use when syncing official OpenCode upstream/dev into the Tandem repo, especially when the user says get us up to date from opencode upstream, upstream sync, opencode update, fresh pull, batch merge, or remaining commits.
---

# Tandem OpenCode Sync

Use this skill to update the Tandem repo (`~/code/Tandem` on Ubuntu, `C:\Users\Jon\Tandem` on Windows) from official OpenCode while preserving Tandem's documented mobile and personal deltas. Run the git commands below in the current environment's native shell; `<sync-target>`, `<target>`, and `<base>` are SHAs you carry between commands.

## Fresh Session Contract

When the user says "get us up to date from opencode upstream", do not rely on previous chat history or remembered SHAs. Recompute the sync state from Git.

- Resume point: `git merge-base dev upstream/dev`
- End target: current `upstream/dev` after `git fetch --no-tags upstream dev`
- Pending commits: `git rev-list --topo-order --reverse dev..upstream/dev`
- If the user asks to get up to date, process all pending commits, broken into logical batches and worked batch by batch, unless review or dry-run finds risk.
- Only use an older pinned target if the user explicitly asks to continue that older target.

Read the environment context file (`contextL.md` on Ubuntu/Linux/proot, `context.md` on Windows) and `log.md` in full before syncing. Use `log.md` as the authoritative inventory of intentional Tandem differences from official OpenCode.

## Hard Rules

- Read `log.md` in full before any merge or conflict resolution.
- Use `dev` as the default Tandem branch unless the user says otherwise.
- Use `upstream/dev` as official OpenCode.
- Use merge, not rebase, for normal sync work.
- Do not use `origin/dev` to choose the next upstream batch; it may be stale.
- Do not run tests or typechecks from the repo root.

## Preflight

Start in the Tandem repo root:

```sh
git status --short --branch
git remote -v
git branch -vv
```

If the worktree is dirty, stop and ask before syncing.

If `upstream` is missing, configure it as:

```sh
git remote add upstream https://github.com/sst/opencode.git
```

Fetch and pin the sync target for this session:

```sh
git fetch --no-tags upstream dev
git rev-parse upstream/dev   # pin this SHA as <sync-target>
```

The pin is session-local. A future fresh session should fetch again and recompute from `dev..upstream/dev` unless the user asks for a specific older target.

## Plan Logical Batches

Before merging anything, FIRST, break the full pending range into logical batches and work them batch by batch.

First list all pending commits in apply order:

```sh
git log --oneline --reverse dev..<sync-target>
```

If the list is empty, report that no upstream commits are pending and stop. Never combine `--reverse` with `--max-count`; Git applies `--max-count` before `--reverse`.

Read every subject line (and `git show --stat` for anything unclear) and group the commits into logical batches:

- Each batch is a contiguous run of commits in topo order; a batch is defined by its last commit (`<target>`), since merging through `<target>` brings in everything before it.
- Group by theme/subsystem: server/core refactors, TUI, shared web UI, providers, SDK/codegen, docs/chore runs, release/version bumps.
- Keep an architectural refactor together with its immediate follow-up fixes in one batch; never split a refactor from its fixups.
- Cut a batch boundary where the theme changes, before and after large refactors, and before any commit that touches areas with known Tandem divergence (mobile, shared web UI, composer, platform contract) so those merge in their own reviewable batch.
- Prefer several focused batches over one giant one; trivial chore/docs runs can be one batch.

Present the batch plan to the user before starting the first merge: for each batch, the commit count, a one-line theme, and whether it touches known Tandem-divergent areas. Adjust if the user redirects.

Before working a batch, confirm its slice:

```sh
git log --oneline --reverse dev..<target>
git rev-list --count dev..<target>
```

The count must equal the batch size. If it does not, stop and inspect.

## Work Batch By Batch

Process one batch at a time, in order. For each batch run the full cycle: Review And Dry Run → Merge → Post-Merge Gate → Verification → brief batch report. Do not start the next batch until the current one is merged, verified, and the worktree is clean.

If a batch turns out to be riskier than planned (unexpected conflicts, surprise architectural change), pause and tell the user before proceeding; offer to split the batch further.

## Review And Dry Run

Review upstream changes from the merge base to the batch target:

```sh
git merge-base dev <target>          # use as <base>
git show --stat --oneline --find-renames <batch commits>
git diff --name-status <base> <target>
git diff --check <base> <target>
```

Do not review with `git diff dev..<target>`; Tandem has fork-only files, so that comparison creates false deletion noise.

Use these priorities:

- Core OpenCode/server behavior: prefer current upstream unless Tandem has a documented compatibility reason.
- Upstream architectural changes, simplifications, and refactors must be incorporated. Adopt the upstream structure first, then reapply Tandem customizations only where they still make sense. if you are not absolutly sure, consult the user.
- Do not preserve an old Tandem implementation shape just because it is already in the fork. Understand the original intent, preserve documented behavior that is still needed, and drop obsolete code paths instead of keeping needless parallel implementations.
- If upstream makes a significant UI or behavior change, reassess Tandem customizations against that new design. Some Tandem changes may no longer fit and can be removed, but only after understanding why they existed and confirming they are no longer useful.
- Use judgment. If it is unclear whether a Tandem customization should survive an upstream refactor, simplification, or UI change, stop and ask the user before deciding.
- Tandem includes a dedicated Android and iOS app that uses a version of the webui. be extra careful in the comtext of merging webui changes, review what special customizations Tandem has to the webui relative to the mobile apps.
- Shared web UI conflicts: manually produce the smallest combined final state.
- Preserve `UPSTREAM-DIVERGENCE` comments. remove UPSTREAM-DIVERGENCE comments when we fully adopt upstream

Dry-run before merging:

```sh
git merge-tree --write-tree dev <target>
```

If it reports conflicts or exits nonzero, stop and follow Conflict Resolution before merging.

## Conflict Resolution

Default stance: incoming upstream architecture wins; Tandem customizations are reapplied on top only where they still make sense.

For each conflicted file:

1. Understand both sides: what upstream changed and why, and what the Tandem delta was for (check `log.md` and `UPSTREAM-DIVERGENCE` comments).
2. Adopt the upstream structure first, then reapply the Tandem customization in the new shape only if its documented purpose still applies.
3. If the Tandem customization no longer fits the new upstream design, drop it — but only after understanding why it existed.

Keep the user in the loop. Resolve silently only when absolutely sure, meaning all of these hold:

- The Tandem side is documented (in `log.md` or an `UPSTREAM-DIVERGENCE` comment) and clearly still applies, or the conflict is mechanical (adjacent-line noise, lockfiles, version bumps, generated files).
- The resolution does not change behavior on either side beyond what upstream intends.
- No mobile/compatibility-contract surface is affected (API shapes, platform contract, WebView/keyboard behavior).

For everything else — ambiguous intent, overlapping behavior changes, a Tandem customization that may be obsolete, or any judgment call about dropping fork behavior — stop and present the conflict to the user before resolving: the file, both sides' intent, and a recommended resolution with reasoning.

Even for silently resolved conflicts, list each conflicted file and the chosen resolution in the batch report so nothing is resolved invisibly.

## Merge

Use a merge commit:

```sh
git merge --no-ff <target> -m "opencode-sync: merge upstream batch through <short-sha>"
```

If committer identity is missing, prefix the command with the one-shot `-c user.name=... -c user.email=...` flags from Hard Rules.

## Post-Merge Gate

Immediately after the merge:

```sh
git status --porcelain=v2
git rev-list --count dev..<sync-target>
git log --oneline --decorate --max-count=6
```

If the worktree is dirty after a successful merge, stop before testing or continuing. Classify the dirty state first:

```sh
git diff --name-status HEAD
git diff --numstat HEAD
git reflog --date=iso --max-count=12
```

Only restore dirty files after explicit user approval.

## Verification

Run only package-local checks. Never run tests or typecheck from repo root.

Common command from a package directory:

```sh
bun typecheck
```

Use `packages/opencode` when the batch touches server, Effect, CLI, tests, providers, LSP, sync, tools, or generated SDK/server code. Use `packages/plugin` when `packages/plugin` changes. Use app/ui/android/ios package checks when those packages change.

## Final Report

After each batch, report briefly: the batch theme and commits, every conflicted file with its resolution, and remaining commits against `<sync-target>`.

After the last batch, summarize the whole sync: batches merged, all conflict resolutions, any Tandem customizations dropped or reshaped, and whether the worktree is clean.

Finally, give a summary of the updates. What functional changes to opencode were made that are user testable?
