# Claude presentation and Bash search

Tandem presents Claude requests in a Claude Code-compatible shape. It selects a
Claude-specific base prompt, places the initial rendered instruction baseline as
Claude Code places its context (instruction files in the first user message, the rest
as a system message after it), maps local tool names and selected input keys, and maps
structured tool events back to canonical names before validation and execution.
Bare Corrector and browser-reader sessions are excluded. Authentication and
transport remain owned by the external Anthropic auth plugin.

The request also enables clear-thinking context
management when thinking is active. The cache lifetime is upstream's `cache.ttl`
provider setting. Durable instruction values and chronological updates are unchanged.

## Configuration

Claude presentation is automatic when either the selected model ID or resolved model
ID contains `claude`, case-insensitively. A configured agent system prompt is kept;
otherwise `anthropic.txt` replaces the selected base prompt. Fable 5.2 gets
`anthropic-fable-5-2.txt` appended to it.

`TANDEM_CLAUDE_BASH_SEARCH=1` enables Bash search when all prerequisites pass. The
default is off. Linux and macOS need a supported POSIX shell plus executable `ugrep`,
`bfs`, and system `grep`. On Debian or Ubuntu, install `ugrep` and `bfs`. Restart the
process after changing the flag or binaries.

When active, Claude loses dedicated `glob` and `grep` tools and uses process-local
`find` and `grep` shims through the shell. Other models and ordinary shell API calls
keep their normal PATH. If prerequisites, shell permission, or shell support are
missing, dedicated search tools remain available. Remote workspaces do not activate
the shims.

## Implementation

- `plugin.ts` selects the base prompt, places the instruction baseline, and adjusts Skill guidance. The instruction files become the first user message's own `<system-reminder>` and the rest a system message after it; after another model's compaction, the first user message after the checkpoint is used, or the start of the checkpoint itself when none follows. A Claude checkpoint, found by its `tandem.claude-compaction` metadata, is replaced by Claude Code's layout: summary, kept messages, restored context and the baseline, placed differently after automatic compaction and after `/compact`. Without native mid-conversation system messages (Claude before Opus 4.8 and 5, or a provider other than `anthropic`), each system item becomes a reminder at its position. The plugin also records file modification times on read/edit/write/patch results (`tandem.mtimes`).
- `compaction.ts` compacts Claude sessions like Claude Code, called from `session/compaction.ts`: it splits the history by assistant response, keeps the last group, sends the main request plus the summary prompt, and stores the checkpoint (`checkpoint.ts`). `restore.ts` builds the restored files, background-task lines and skills note; `transcript.ts` writes the whole-session transcript to `transcripts/<sessionID>.md` in the scratch directory.
- `workdir.ts` presents the shell as Claude Code's Bash tool without `workdir` when the shell is local bash (not remote workspaces or Windows), and carries the working folder between foreground commands: the shell tool is wrapped so each foreground call gets its own capture file, a `BASH_ENV` exit trap writes the final folder there if it differs from where the command started (as in Claude Code), and the next call's `workdir` is set to it. The folder does not move when a command `exec`s, replaces the EXIT trap, or a user `BASH_ENV` is set. When the Bash tool is presented, the environment's `Primary working directory:` line gets a note saying so.
- `updates.ts` adds Anthropic's reminder for long silent tool runs (Prompting Claude Fable 5.2, "Keep users informed during long turns") in top-level sessions on Opus, Fable and Mythos models with native mid-conversation system messages. A step is silent when it calls tools with no text and no readable progress update; a thinking block is a progress update when its signature's readable header says `narration` rather than `thinking`. After 8 silent steps in a row, the reminder follows the latest tool results as a system message. The step it followed is recorded in the session's `tandemUpdateReminders` metadata first, and every later request places a reminder after that step's tool results again, since a changed earlier turn invalidates later thinking blocks. It has no `clear_at`: the auth plugin's billing checksum covers the body, and Tandem's plugins edit requests after it.
- `instructions.ts` changes only Claude-facing rendering and order: AGENTS.md files as Claude Code's labelled instruction block (rendered last so `split` can separate them), environment first, then the Code Mode catalog and guidance, then the date; skills, environment text (Claude Code's `# Environment` and `# Environment update` lists), Code Mode references, and search guidance.
- `presentation.ts` maps native tool schemas, request history (including Claude Code-style Bash results), streamed tool events, and clear-thinking request options.
- What the model never reads is presented by the external Anthropic auth plugin with a Claude subscription: Claude Code's headers, user agent and beta, the billing line with its checksum and fields, and `tool_result` key order.
- `../request-dump/transport.ts` turns off Effect's `traceparent`/`b3` trace headers for Anthropic API requests (those with `anthropic-version`), which Claude Code does not send.
- `anthropic.txt` is the bundled Claude base prompt for every Claude model. It follows Claude Code 2.1.291's Opus 5.5 prompt, without Claude Code-only sections.
- `../bash-search/{plugin,shims}.ts` probes dependencies, filters tool snapshots, and supplies subprocess-local shims.
- `packages/core/src/session/{context,model-request}.ts` applies presentation after model and plugin hooks and before transport.
- `packages/ai/src/protocols/anthropic-messages.ts` owns context-management lowering.

Only native local tools are renamed. Provider-hosted tools and namespaces pass
through. Code Mode's internal tool paths and JavaScript stay canonical. Mappings are
derived from the actual request snapshot; presentation-name collisions fail instead
of dispatching to the wrong tool. Thinking data, signatures, IDs, provider metadata,
and raw delta text pass through unchanged; other tools' results do too, while Bash
results are reworded like Claude Code's.

Clear-thinking is emitted only for final `enabled` or `adaptive` thinking. Bedrock's
cache behavior is unchanged. Supported inline-cache routes cap combined manual and
automatic markers at four.

## Cold prompt cache

Claude's summary request is the main request unchanged, so that it reads the prompt
cache. `cold.ts` decides when the cache no longer holds the conversation: the last
measured request is older than the model's `cache.ttl` (five minutes when unset), or
went to another model, or to another variant. A switch between effort variants that
the route sends as a per-turn effort message keeps the cached prefix (Claude Opus 5
and later, Claude 5.1 and later; the summary request carries model switches from the
groups it leaves out, so that message still goes out) and does not count. After a
"too long" rejection the cache is never treated as cold.

On a cold cache a small request is sent instead, to the compaction agent's model or,
when it names none, Claude Sonnet 5.5 on the session's provider. It is built from the
prepared main request:
`[system: two sentences] [user: AGENTS.md reminder, <transcript>, the compaction prompt with a note on the cuts]`,
with no tool definitions and no cache breakpoints. It covers everything but the last
response group, which is kept verbatim as usual. The restored files are chosen before
the request, and a read of a file that comes back with its contents becomes a one-line
note. Nothing is cut to reach a size: if the summary model rejects the transcript as
too long, the usual request goes out instead. The compaction message's metadata
records the model and the replaced context's size under `tandem.compaction-pruned`;
upstream's divider shows the request's tokens.

`../prune.ts` shortens the transcript by fixed rules, in characters, not towards a size:

| Content | Rule |
| --- | --- |
| Text the user or model wrote | Whole. |
| Tool output | Up to 3,000 whole. A longer one keeps 1,500 from each end, cut back to a line break (a file read: only the first 1,500), with a note of what was left out. |
| Tool output within the newest 60,000 characters of outputs | The same with 20,000 and 10,000. |
| Tool input over 2,000 | Its first 1,000. |
| Reasoning, images, other system reminders | Left out. |

Trimmed tool results (the app's Trim and send) apply the same output rules to every
request's tool results before the prompt named by the session's `tandemTrimBefore`
metadata, before the Claude layout, so the shorter prefix is cached as usual.
Attachments in older results become a one-line note; tool inputs, replies and
reasoning are untouched.

## Debugging

Bash-search activation failures log a warning and add request guidance explaining
the missing prerequisite. Check the final request's tool catalog and system blocks
with `TANDEM_DUMP_REQUEST=<directory>`; dumps are after Claude presentation and use
canonical diagnostics without exposing transport headers. For mapping defects, trace
`ClaudePresentation.request` and confirm the presented name has one reverse mapping.
