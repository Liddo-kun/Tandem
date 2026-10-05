---
name: tandem-opencode-sync
description: Use ONLY when reviewing or syncing official OpenCode upstream/v2 into Tandem-v2, or adapting its pinned upstream baseline; obtain Jon's approval before advancing the baseline.
---

# Tandem v2 upstream sync

This project-owned skill applies to `/home/jon/code/Tandem-v2`, branch `tandem-v2`.
Read root `AGENTS.md`, the current platform's `contextL.md` or `contextW.md`,
`logv2.md` (every Tandem customization of OpenCode), `notes/todo-after-v2.md` and `notes/v2-port.md` before planning.
The port baseline is **`40679546d4db07ba9dfb17160051c9a3109c438f`**, official
**`upstream/v2`**. Read the nearest package instructions before editing.

## Approval and isolation

- Documenting this workflow does not advance the baseline. Retain the pin until Jon
  authorizes a baseline change. A request to discover upstream changes
  permits fetching; a fresh coding session alone does not authorize following its tip.
- Keep `/home/jon/code/Tandem` and the daily/global sync skill read-only. Preserve all
  uncommitted work; do not auto-stash, reset, restore or clean. A dirty worktree blocks
  a merge until its owners and Jon settle the integration plan.
- Verify on the development server first: port 4098, the isolated launcher and
  `app.liddokun.tandem.v2` (**Tandem V2**) with separate data/signing. The daily install
  (`/usr/local/bin/tandem`, port 4097, `app.liddokun.tandem`) changes only when Jon asks
  to install. Never copy daily credentials or run another server against the same database.
- Run builds and browser/device workflows one at a time. Installation,
  service restart, publication, commits and pushes each require applicable explicit
  authorization. A source sync is not production cut-over permission.

## Review before changing anything

Inspect Git from the v2 root:

```sh
git status --short --branch
git remote -v
git branch -vv
git log --oneline -10
git diff --stat
git diff --check
git rev-parse upstream/v2
```

Do not modify remotes/config to make assumptions true. Verify branch/worktree identity
and the baseline in the scope/context notes. If authorized to discover newer upstream:

```sh
git fetch --no-tags upstream v2
git rev-parse upstream/v2
git log --topo-order --reverse --oneline 40679546d4db07ba9dfb17160051c9a3109c438f..upstream/v2
```

Fetching only discovers a candidate. Present its full SHA, changes affecting retained
features and a batch plan. Confirm that Jon's request authorizes advancing the port pin;
ask only if that scope is unclear. For an already approved later baseline, use its
recorded SHA instead of the original pin.
Never use daily `dev`, `upstream/dev`, or `origin` tracking state as the v2 sync target.

## Narrow divergence inventory

Use the divergence inventory in `logv2.md` plus current source and its
`UPSTREAM-DIVERGENCE` comments. Drop `UPSTREAM-DIVERGENCE(temporary)` fixes that the new
baseline fixes itself. V1 `log.md` is historical reference, not scope.
For each affected retained feature identify:

1. Required observable behavior and its current evidence/unverified cases.
2. Tandem-owned module and exact shared integration seam.
3. Equivalent upstream behavior or configuration/public extension replacing that seam.
4. Proposed retained, reshaped or removed delta and the real workflow to check it.

Prefer upstream architecture, then configuration, then public **Effect v4** plugins
(`@opencode/plugin/effect/*`); use the Effect skill for Effect implementation work.
Respect an external plugin's established public API rather than rewriting it merely
for style. Do not copy v1 runners/middleware into v2 or preserve obsolete parallel paths.
Keep shared patches narrow; direct GPT prompt-file edits are an accepted exception.
Bring ambiguous feature removal, API/persistence changes and architecture tradeoffs to
Jon. Do not restore excluded voice, RePrompt, LSP/todowrite or deferred iOS/UI features.

Current boundaries:

- `packages/{schema,protocol,core,server,ai,plugin,client,cli}` own backend contracts,
  execution, providers and CLI. Preserve v2 durable admission/history/execution semantics.
- `packages/app` owns shared app/composer; `session-ui` owns message/tool rendering;
  `gui-extensions` owns optional views; `android` owns the native shell.
- `packages/core/src/plugin/tandem` owns retained provider/tool behavior; Claude OAuth
  transport is separately maintained in `opencode-anthropic-auth-v2`.
- After public Protocol/Server HttpApi changes, regenerate with
  `bun run --cwd packages/client generate`; never hand-merge generated client code.
- CLI build output is `packages/cli/dist/cli-<target>/bin/opencode`, staged/named Tandem
  by the development/release scripts. Do not use old `packages/opencode` build commands.

## Approved batch workflow

Pin the approved full target SHA in `SYNC_TARGET`; choose reviewed contiguous ancestor
boundaries in `BATCH_TARGET`. Inspect every pending subject and unclear diff, grouping
architectural changes with their fixes and isolating mobile/provider/shared seams.
Do not combine `--reverse` with `--max-count` when enumerating pending commits.

```sh
git log --topo-order --reverse --oneline tandem-v2.."$SYNC_TARGET"
git rev-list --count tandem-v2.."$BATCH_TARGET"
BASE=$(git merge-base tandem-v2 "$BATCH_TARGET")
git diff --name-status "$BASE" "$BATCH_TARGET"
git diff --check "$BASE" "$BATCH_TARGET"
git merge-tree --write-tree tandem-v2 "$BATCH_TARGET"
```

These commands require the approved SHA variables to be assigned first. Review upstream
changes from the merge base, not a tip-to-tip comparison that misreports fork-owned files
as deletions. Dry-run conflicts are a review gate. Adopt upstream structure and reapply
only justified retained behavior. Escalate uncertain mobile/API/persistence resolutions;
report every resolved conflict, including mechanical ones.

Once merging/committing this batch is explicitly authorized and the worktree is ready:

```sh
git merge --no-ff "$BATCH_TARGET" -m "chore(sync): merge approved upstream v2 batch"
git status --short --branch
git rev-list --count tandem-v2.."$SYNC_TARGET"
git log --oneline -6
```

Use merge, not rebase/force-push. Unexpected dirty state or architectural conflicts stop
the next batch. Update `logv2.md` and the baseline references with the integration outcome; record the
approved new pin only then, not merely because fetch succeeded.

## Verification and report

First verification is a **real agent session with actual tool calls through normal
admission/execution**, using the isolated launcher and an explicit development-server
URL. Build only when needed to load changes. Do not run upstream `dev:live` discovery
against an unspecified service; implicit version mismatch can replace a server.

No low-level tests, test-writing or fixture repairs unless Jon explicitly requests them.
Focused package `bun typecheck` is secondary and only useful after live verification;
build/typecheck success is not acceptance. For blocked live checks, report the concrete
blocker rather than substituting synthetic checks. Exercise affected retained workflows:
provider final requests/tool round trips, Corrector queue snapshots, browser cleanup,
image transport/preview isolation, and Android connection/draft/keyboard/zoom as relevant.
Keep credential values out of evidence. Preserve known unsupported/unverified cases,
including masked OAuth transparency, mask black-fill sensitivity and untested API-key mode.

After each batch report commits/theme, conflicts and resolutions, reshaped/removed seams,
actual workflows/results, blockers and remaining commits. At completion report the
approved baseline, worktree state and user-testable changes. Do not claim acceptance from
source review alone.
