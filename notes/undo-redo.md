# Undo / redo (session revert)

How it works today (pristine upstream, investigated 2026-10-11): undo *stages* a revert (`packages/core/src/session/revert.ts`):
messages from the chosen user message on are hidden, files touched by later assistant steps are restored from
per-step whole-tree snapshots, and the pre-undo tree is kept for redo. Redo (`clear`) restores that tree. The next
prompt or compaction *commits* it: hidden messages and later queued prompts are deleted and redo is gone.

- [x] App: show a pending-revert indicator, like the TUI's `RevertMessage` (`packages/tui/src/routes/session/index.tsx`),
  saying the rewind is not locked in until the next prompt and offering redo. Done: strip above the composer
  (`packages/app/src/session/composer/tandem-revert-panel.tsx`).
- [ ] Approved, from Claude Code (app and TUI only, no server changes):
  - [ ] Conversation-only rewind that leaves files alone. The server already accepts `files: false` on
    `session.revert.stage`; neither client uses it.
  - [ ] Confirm before rewinding: offer "conversation and files" / "conversation only", preview the files that will be
    reverted (from later assistant messages' `snapshot.files`), drop the files option when no file changed, and say
    what is not covered (gitignored files, files outside the project, commits and other side effects).
  - [ ] Mark which prompts changed files, so it is clear which rewinds will touch code.
- [ ] Decide how to handle the file-revert limits: only the session directory inside a git repo is covered; gitignored
  files, untracked files over 2 MB, files outside the project and non-file side effects (commits, installs) are not.
  Restore is whole-file, so Jon's own edits, or another session's, made during a reverted step are undone too; redo
  overwrites edits to the reverted files made after the undo.
- [x] Study how Claude Code's rewind offers undo with and without rewinding the conversation, and where it disables
  history to avoid conflicting or bad restores (e.g. code-only undo, more edits, undo again). Also how it treats files
  outside the project and user edits between turns. Jon dislikes that Tandem's undo reverts user edits.
  Findings below.
- [ ] Design an undo that keeps user edits: e.g. restore a file only if its current content still matches what the
  agent left (or reverse only the agent's own hunks), with a defined policy for conflicts. Claude Code does not do this.
- [ ] Stop undo deleting files that existed before the step but were left out of its start snapshot (untracked file
  that shrank below 2 MB, file un-ignored by a `.gitignore` edit). Upstream bug, still in latest `upstream/v2`. Options:
  record the start capture's skipped large files and treat a path as created only if it is not among them; for other
  "added" paths check the file's creation time against the step start; and/or never hard-delete on undo (keep
  removed files recoverable after the revert is committed). Moot if undo moves to per-edit backups like Claude Code.
- [ ] Align app and TUI behavior: the app's message button interrupts a running agent first, while the TUI's message
  "Revert" action fails with a busy error.
- [ ] More difficult, from Claude Code (need server/core changes):
  - [ ] Make undo touch only what the session itself edited, not everything that changed in the folder during its
    steps (Jon's or other sessions' edits). Claude Code tracks only files its edit tools touch, which misses shell
    changes; Tandem should keep catching those.
  - [ ] Cover files outside the project and gitignored files (Claude Code backs up any file its edit tools touch, with
    no Git, gitignore or size filter). Today snapshots cover only the session directory inside a Git repo.

## Claude Code's rewind (2.1.291, code reading and live experiments 2026-10-11)

- Options per prompt: restore code and conversation, conversation only, code only, summarize from here / up to here.
  Code options are hidden when restoring would change nothing on disk or checkpointing is off.
- Tracks only files its own Write/Edit/NotebookEdit tools touch, backed up whole just before the first edit, plus a
  re-snapshot of every tracked file at the start of each turn. Shell changes are not tracked, except to files already
  tracked. A simple `sed -i` is shown as `Update(file)` but is still not backed up. Absolute paths outside the
  project are tracked (e.g. `~/.claude/settings.json`); no gitignore or size filter.
- Restore overwrites or deletes tracked files whole: user and other-session edits to those files are lost, untracked
  files are never touched. No conflict check or merge; only symlink/hard-link/path-safety refusals.
- Mixed sequences: no invalidation rule. Code-only restore keeps all checkpoints; later turns snapshot the new disk state.
  No redo and no snapshot of the state just before a restore. Conversation rewind drops later prompts from the picker.
- Restore is per-file, not all-or-nothing, and a partial failure shows no warning; "code and conversation" still cuts the
  conversation when every file fails. History is capped at 100 checkpoints and kept about 30 days. `/compact` removes
  every earlier prompt from the rewind list; after a conversation-only rewind, resuming can lose code restore for
  earlier prompts. Parent rewind does not restore normal subagents' edits.
- Bugs seen live: a same-size edit with an older modification time is silently not restored; byte differences that
  are not valid UTF-8 hide the code-restore options.
- Report and experiment log: `/tmp/tandem/v2/cc-rewind/{report,experiments}.md`.
