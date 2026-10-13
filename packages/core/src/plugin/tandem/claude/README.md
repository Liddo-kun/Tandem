# Claude presentation and Bash search

Tandem presents Claude requests in a Claude Code-compatible shape. It selects a
Claude-specific base prompt, moves the initial rendered instruction baseline into
the first user message, maps local tool names and selected input keys, and maps
structured tool events back to canonical names before validation and execution.
Bare Corrector and browser-reader sessions are excluded. Authentication and
transport remain owned by the external Anthropic auth plugin.

The request also adds the Claude Code billing block, enables clear-thinking context
management when thinking is active, and uses one-hour cache hints on supported
Claude routes. Durable instruction values and chronological updates are unchanged.

## Configuration

Claude presentation is automatic when either the selected model ID or resolved model
ID contains `claude`, case-insensitively. A configured agent system prompt is kept;
otherwise `anthropic.txt` replaces the selected base prompt.

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

- `plugin.ts` selects the base prompt, relocates the instruction baseline, and adjusts Skill guidance.
- `workdir.ts` presents the shell as Claude Code's Bash tool without `workdir` when the shell is local bash (not remote workspaces or Windows), and carries the working folder between foreground commands: the shell tool is wrapped so each foreground call gets its own capture file, a `BASH_ENV` exit trap writes the final folder there, and the next call's `workdir` is set to it. The folder does not move when a command `exec`s, replaces the EXIT trap, or a user `BASH_ENV` is set. When the Bash tool is presented, the environment's `Working directory:` line gets a note saying so.
- `instructions.ts` changes only Claude-facing rendering of skills, environment text, Code Mode references, and search guidance.
- `presentation.ts` maps native tool schemas, request history (including Claude Code-style Bash results), streamed tool events, billing metadata, and clear-thinking request options. Its `toolResultBody`, applied to outgoing Anthropic request bodies, gives `tool_result` blocks Claude Code's key order.
- `anthropic.txt` is the bundled Claude base prompt for every Claude model. It follows Claude Code 2.1.291's Opus 5.5 prompt, without Claude Code-only sections.
- `../bash-search/{plugin,shims}.ts` probes dependencies, filters tool snapshots, and supplies subprocess-local shims.
- `packages/core/src/session/{context,model-request}.ts` applies presentation after model and plugin hooks and before transport.
- `packages/ai/src/{cache-policy.ts,protocols/anthropic-messages.ts}` owns cache and context-management lowering.

Only native local tools are renamed. Provider-hosted tools and namespaces pass
through. Code Mode's internal tool paths and JavaScript stay canonical. Mappings are
derived from the actual request snapshot; presentation-name collisions fail instead
of dispatching to the wrong tool. Thinking data, signatures, IDs, provider metadata,
and raw delta text pass through unchanged; other tools' results do too, while Bash
results are reworded like Claude Code's.

Clear-thinking is emitted only for final `enabled` or `adaptive` thinking. Bedrock's
cache behavior is unchanged. Supported inline-cache routes cap combined manual and
automatic markers at four, and the volatile billing block never gets a breakpoint.

## Debugging

Bash-search activation failures log a warning and add request guidance explaining
the missing prerequisite. Check the final request's tool catalog and system blocks
with `TANDEM_DUMP_REQUEST=<directory>`; dumps are after Claude presentation and use
canonical diagnostics without exposing transport headers. For mapping defects, trace
`ClaudePresentation.request` and confirm the presented name has one reverse mapping.
