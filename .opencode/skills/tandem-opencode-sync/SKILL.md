---
name: tandem-opencode-sync
description: Use when syncing official OpenCode upstream/v2 into Tandem-v2, especially when the user says get us up to date from opencode upstream, upstream sync, opencode update, fresh pull, batch merge, or remaining commits.
---

# Tandem OpenCode Sync

Use this skill to update the Tandem repo (`~/code/Tandem-v2` on Ubuntu) from official OpenCode v2 while preserving Tandem's documented customizations. Run the git commands below in the current environment's native shell; `<sync-target>`, `<target>`, and `<base>` are SHAs you carry between commands.

## Fresh Session Contract

When the user says "get us up to date from opencode upstream", do not rely on previous chat history or remembered SHAs. Recompute the sync state from Git.

- Resume point: `git merge-base tandem-v2 upstream/v2` (the pinned baseline recorded in `AGENTS.md`; if they differ, stop and inspect)
- End target: current `upstream/v2` after `git fetch --no-tags upstream v2`
- Pending commits: `git rev-list --topo-order --reverse tandem-v2..upstream/v2`
- If the user asks to get up to date, process all pending commits, broken into logical batches and worked batch by batch, unless review or dry-run finds risk.
- Only use an older pinned target if the user explicitly asks to continue that older target.

Read `contextL.md` (or `contextW.md` on Windows), `logv2.md` and `notes/todo-after-v2.md` in full before syncing. Use `logv2.md` as the authoritative inventory of intentional Tandem differences from official OpenCode.

## Hard Rules

- Read `logv2.md` in full before any merge or conflict resolution.
- Use `tandem-v2` as the Tandem branch unless the user says otherwise.
- Use `upstream/v2` as official OpenCode. Never use `dev`, `upstream/dev` or the v1 checkout (`~/code/Tandem`).
- Use merge, not rebase, for normal sync work.
- Do not use `origin/tandem-v2` to choose the next upstream batch; it may be stale.
- Do not run tests or typechecks from the repo root.
- Do not install to the daily setup, restart the daily server, or push without the user's explicit instruction.

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
git fetch --no-tags upstream v2
git rev-parse upstream/v2   # pin this SHA as <sync-target>
```

The pin is session-local. A future fresh session should fetch again and recompute from `tandem-v2..upstream/v2` unless the user asks for a specific older target.

## Plan Logical Batches

Before merging anything, FIRST, break the full pending range into logical batches and work them batch by batch.

First list all pending commits in apply order:

```sh
git log --oneline --reverse tandem-v2..<sync-target>
```

If the list is empty, report that no upstream commits are pending and stop. Never combine `--reverse` with `--max-count`; Git applies `--max-count` before `--reverse`.

Read every subject line (and `git show --stat` for anything unclear) and group the commits into logical batches:

- Each batch is a contiguous run of commits in topo order; a batch is defined by its last commit (`<target>`), since merging through `<target>` brings in everything before it.
- Group by theme/subsystem: core/server/protocol refactors, providers, CLI/TUI, shared web UI (`packages/app`, `packages/session-ui`), client/codegen, docs/chore runs, release/version bumps.
- Keep an architectural refactor together with its immediate follow-up fixes in one batch; never split a refactor from its fixups.
- Cut a batch boundary where the theme changes, before and after large refactors, and before any commit that touches areas with known Tandem divergence (see `logv2.md`: Android, shared web UI, composer, providers, plugin hooks) so those merge in their own reviewable batch.
- Prefer several focused batches over one giant one; trivial chore/docs runs can be one batch.

Present the batch plan to the user before starting the first merge: `<sync-target>`, and for each batch the commit count, a one-line theme, and whether it touches known Tandem-divergent areas. Wait for the user's go-ahead; it approves advancing the baseline and the batch merge commits. Adjust if the user redirects.

Before working a batch, confirm its slice:

```sh
git log --oneline --reverse tandem-v2..<target>
git rev-list --count tandem-v2..<target>
```

The count must equal the batch size. If it does not, stop and inspect.

## Work Batch By Batch

Process one batch at a time, in order. For each batch run the full cycle: Review And Dry Run → Merge → Post-Merge Gate → Verification → brief batch report. Do not start the next batch until the current one is merged, verified, and the worktree is clean.

If a batch turns out to be riskier than planned (unexpected conflicts, surprise architectural change), pause and tell the user before proceeding; offer to split the batch further.

## Review And Dry Run

Review upstream changes from the merge base to the batch target:

```sh
git merge-base tandem-v2 <target>          # use as <base>
git show --stat --oneline --find-renames <batch commits>
git diff --name-status <base> <target>
git diff --check <base> <target>
```

Do not review with `git diff tandem-v2..<target>`; Tandem has fork-only files, so that comparison creates false deletion noise.

Use these priorities:

- Core OpenCode/server behavior: prefer current upstream unless Tandem has a documented compatibility reason.
- Upstream architectural changes, simplifications, and refactors must be incorporated. Adopt the upstream structure first, then reapply Tandem customizations only where they still make sense. if you are not absolutly sure, consult the user.
- Do not preserve an old Tandem implementation shape just because it is already in the fork. Understand the original intent, preserve documented behavior that is still needed, and drop obsolete code paths instead of keeping needless parallel implementations.
- If upstream now offers a hook, setting or plugin API that can carry a Tandem customization, prefer moving the customization onto it over keeping an edit to shared code.
- If upstream makes a significant UI or behavior change, reassess Tandem customizations against that new design. Some Tandem changes may no longer fit and can be removed, but only after understanding why they existed and confirming they are no longer useful.
- Use judgment. If it is unclear whether a Tandem customization should survive an upstream refactor, simplification, or UI change, stop and ask the user before deciding.
- Tandem includes a dedicated Android app (`packages/android`) that uses the shared web UI. be extra careful in the context of merging web UI changes, review what special customizations Tandem has to the web UI relative to the mobile app.
- Shared web UI conflicts: manually produce the smallest combined final state.
- Preserve `UPSTREAM-DIVERGENCE` comments. Remove UPSTREAM-DIVERGENCE comments, and their `logv2.md` entries, when we fully adopt upstream. Drop `UPSTREAM-DIVERGENCE(temporary)` fixes once upstream ships an equivalent fix.

Dry-run before merging:

```sh
git merge-tree --write-tree tandem-v2 <target>
```

If it reports conflicts or exits nonzero, stop and follow Conflict Resolution before merging.

## Conflict Resolution

Default stance: incoming upstream architecture wins; Tandem customizations are reapplied on top only where they still make sense.

For each conflicted file:

1. Understand both sides: what upstream changed and why, and what the Tandem delta was for (check `logv2.md` and `UPSTREAM-DIVERGENCE` comments).
2. Adopt the upstream structure first, then reapply the Tandem customization in the new shape only if its documented purpose still applies.
3. If the Tandem customization no longer fits the new upstream design, drop it — but only after understanding why it existed.

Keep the user in the loop. Resolve silently only when absolutely sure, meaning all of these hold:

- The Tandem side is documented (in `logv2.md` or an `UPSTREAM-DIVERGENCE` comment) and clearly still applies, or the conflict is mechanical (adjacent-line noise, lockfiles, version bumps, generated files).
- The resolution does not change behavior on either side beyond what upstream intends.
- No mobile/compatibility-contract surface is affected (API shapes, platform contract, WebView/keyboard behavior).

Generated client/OpenAPI files (`packages/client/src/{effect,promise}/generated/*` and the protocol's OpenAPI output) are never hand-merged: take the upstream side, then regenerate with `bun run generate` from `packages/protocol` and `packages/client` so any Tandem-only endpoints are re-emitted.

For everything else — ambiguous intent, overlapping behavior changes, a Tandem customization that may be obsolete, or any judgment call about dropping fork behavior — stop and present the conflict to the user before resolving: the file, both sides' intent, and a recommended resolution with reasoning.

Even for silently resolved conflicts, list each conflicted file and the chosen resolution in the batch report so nothing is resolved invisibly.

## Merge

Use a merge commit:

```sh
git merge --no-ff <target> -m "opencode-sync: merge upstream v2 batch through <short-sha>"
```

## Post-Merge Gate

Immediately after the merge:

```sh
git status --porcelain=v2
git rev-list --count tandem-v2..<sync-target>
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

Verify on the development server (port 4098, app **Tandem Dev**), never the daily one. Commands are in `notes/tandem-setup.md`; use the pinned Bun from `contextL.md`.

- When a batch could change how an agent session behaves (session/runner, tools, prompts, providers, plugins, or Tandem features from `logv2.md`), rebuild the development CLI (`bun script/tandem-v2.ts build`), restart the development server, and run a real agent session against `http://127.0.0.1:4098`. Tailor it to what the batch touched: exercise those code paths and Tandem features, not a generic smoke test. Skip the session when the batch clearly cannot affect agent behavior or its only conflicts are obviously low-risk (imports, adjacent lines, branding strings); say in the batch report that it was skipped and why.
- When a batch changes the shared web UI or Android, rebuild and install **Tandem Dev** (`bun run tandem:tablet -- --install --dev`) and check the affected screens; ask the user for anything that needs hands on the tablet.
- Docs/chore-only batches need no build.
- Then run package-local `bun typecheck` in each changed package directory. Never run tests or typecheck from repo root.

Run builds and device checks one at a time.

## Final Report

After each batch, report briefly: the batch theme and commits, every conflicted file with its resolution, what was verified, and remaining commits against `<sync-target>`.

After the last batch, update the recorded baseline to `<sync-target>` in `AGENTS.md`, `logv2.md` and `changelogv2.md` (add a changelog entry for the sync), and keep `logv2.md` matching any customizations dropped or reshaped. Then summarize the whole sync: batches merged, all conflict resolutions, any Tandem customizations dropped or reshaped, and whether the worktree is clean.

Finally, give a summary of the updates. What functional changes to opencode were made that are user testable?
