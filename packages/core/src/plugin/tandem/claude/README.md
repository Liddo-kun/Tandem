# Claude presentation + Bash search — integration handoff

Source implementation: 2026-10-04. **Live acceptance belongs to the master and is pending.**
No model/provider/tool sessions, builds, restarts, OS package installs, credential reads,
commits, or low-level tests were performed. `plugin/internal.ts` and the progress ledger
were not edited by this worker.

## Exact registration

In master-owned `packages/core/src/plugin/internal.ts`, import:

```ts
import { BashSearch } from "./tandem/bash-search/plugin.js"
import { ClaudePlugin } from "./tandem/claude/plugin.js"
```

Append these **in this order at the end of `post`**, after
`BrowserFetchPlugin.Policy`, `PromptCorrectorPlugin.Policy`, and
`TandemAuxiliaryPlugin.Policy`:

```ts
BashSearch.Plugin,
ClaudePlugin.Plugin,
```

Both satisfy the existing internal plugin dependencies; `ShellSelect.Service` and
`Global.Service` are already available. Do not remove the upstream optimize plugins:
Claude's final hook replaces the default base after upstream prompt selection, and
preserves custom agent systems. Register after configured hooks, so bare auxiliary
policy has already selected its final context. The external
`opencode-anthropic-auth-v2` plugin continues to own authentication/transport.

## Owned modules and shared seams

- `claude/anthropic.txt`: v1 `e4cff28994` Claude Code base, with the dedicated-tool
  sentence adapted to available tools. Assessment-only requests remain assessments.
- `claude/plugin.ts`: Claude-only base selection and first-user instruction reminder;
  preserves bare Corrector/browser-reader policy and custom agent systems. Skill
  description/parameter guidance points to the single available-skills list.
- `claude/instructions.ts`: presentation-only skill Markdown/environment/Code Mode
  renderers. Source keys, values, hashes and instruction-state persistence stay upstream.
  Frozen chronological instruction updates are not relocated or rewritten.
- `claude/presentation.ts`: billing block, request-local native tool/schema/history
  mapping, and a structured route-event adapter. No raw SSE or embedded JavaScript edits.
- `bash-search/{plugin,shims}.ts`: activation probes, v1 shim flags/fallback policy,
  model-specific snapshot filtering and tool-execution-local shell PATH.
- `session/context.ts`: resolve the effective model before catalog/instruction
  construction; filter the snapshot before rendering Code Mode discovery. Capture
  `ShellSelect.Service` in the Location layer. Bare-context policy remains intact.
- `tool.ts`: one optional internal `Snapshot.bashSearch` flag; no registry, public
  plugin API, permission, or tool executor replacement.
- `session/model-request.ts`: mark the rendered instruction baseline with internal
  `SystemPart.metadata` (identity hooks insert other blocks, so positions are unsafe);
  add request-local search guidance; apply presentation after context/model hooks;
  index surviving execution definitions by canonical internal names for Claude.
  Existing diagnostic attribution/HTTP/WS handlers remain intact.
- `ai/cache-policy.ts`: one-hour auto/manual hints on supported Claude/OpenRouter/
  Alibaba inline-cache paths; no billing breakpoint; cap normalized manual markers
  at four before adding automatic markers. Bedrock TTL behavior is unchanged.
- `ai/protocols/anthropic-messages.ts`: typed `clear_thinking_20251015` serialization;
  `clearThinking` request option resolves against final native enabled/adaptive mode,
  including native HTTP body overlays. Disabled/absent thinking omits the edit.
  `context-management-2025-06-27` is selected for clearing; clearing alone no longer
  requests the compaction beta. Existing compaction edits and opaque thinking paths
  remain supported.

### Why this event seam

The request-local route wraps `streamPrepared` after protocol decoding. All consumers
therefore receive canonical structured tool names/selected arguments, before the
runner publishes them, looks them up, validates schemas, or checks leaf permissions.
This also covers `generate` without adding another runner or execution loop. Native
tool-input start/delta/end/error names are canonicalized; delta text bytes remain
unchanged, while parsed delta input and final structured input use canonical keys.
Provider-hosted/namespaced calls pass through. IDs, results, ordinary text, thinking,
signatures, redacted-thinking data and provider metadata are preserved.

Mappings use actual snapshot definitions and hook alias identities:

| Internal | Claude | Selected top-level keys |
| --- | --- | --- |
| `read`, `write` | `Read`, `Write` | `path` → `file_path` |
| `edit` | `Edit` | `path` → `file_path`; `oldString/newString/replaceAll` → snake_case |
| `shell` | `Bash` | unchanged (`command`, `workdir`, etc.) |
| `patch` | `Patch` | unchanged `patchText` |
| `subagent` | `Agent` | `background` → `run_in_background` |
| `question` | `AskUserQuestion` | unchanged, including nested `questions[].multiple` |
| `skill` | `Skill` | `id` → `skill` (v2 uses IDs, not v1 `name`) |
| `grep` | `Grep` | `include` → `glob` |
| `glob`, `webfetch`, `websearch` | `Glob`, `WebFetch`, `WebSearch` | otherwise unchanged |
| native `execute` | `Execute` | unchanged `code` |

Initial-capitalization handles other native tools; `StructuredOutput` is unchanged.
Selected legacy keys are mapped only when actually present in a definition. Nested
schema keys are not renamed. Name collisions fail explicitly rather than silently
dispatching to a different tool.

Code Mode's `tools` paths, host schemas, discovery `search(...)`, JavaScript programs,
and results stay canonical. Only the outer native `Execute` name and exact harness
references to that wrapper change. Filtering happens before Code Mode catalog/runtime
construction, including if a configuration moves built-in search tools into Code Mode.

Billing uses `2.1.280`, `cli`, salt `59cf53e54c78`, character positions `[4, 7, 20]`,
the three-character SHA-256 version suffix, and five-character first-user-text hash.
The first user text is the first text part in the final assembled request, including
the instruction reminder when present. Title/generate/child/Corrector calls share the
same final request seam; auxiliary prompt isolation is not replaced by the main base.

## Bash-search setup and fallback

Default off. Set `TANDEM_CLAUDE_BASH_SEARCH=1` on the model-executing process.
The plugin never installs OS packages. Supported local platforms are Linux/macOS with
working POSIX shells (`bash`, `dash`, `sh`, `zsh`, `ksh`) and executable `ugrep`, `bfs`,
and system `grep`. Setup examples for the operator:

```sh
# Debian/Ubuntu
sudo apt install ugrep bfs
# macOS
brew install ugrep bfs
```

Restart the isolated process after provisioning when scheduling acceptance. Activation
checks bfs depth-first traversal and `findutils-default` or `emacs` regex support,
writes executable shims under the runtime scratch directory, and executes actual
grep/find shim probes plus a system-grep probe before marking availability. Missing,
broken, or unsupported dependencies retain the dedicated tools and provide setup
guidance. Windows and explicit remote workspaces retain tools. No global PATH change.

Observed paths only (binaries were not executed by this worker): `/usr/bin/ugrep`,
`/usr/bin/bfs`; the worker's inherited `grep` resolves to a **v1 shim**. V2 intentionally
resolves fallback grep separately via `/usr/bin:/bin:/usr/local/bin`.

Active Claude snapshots suppress `glob`/`grep` before native and Code Mode catalogs
are built. The execution snapshot supplies a fiber-local shim path; shell hooks add
it only to those subprocesses, including after login startup can reset PATH. Inactive
snapshots explicitly clear the reference so a non-Claude child cannot inherit the
parent's search mode. Other shell API calls are unaffected.

An agent denied all shell execution retains its dedicated search tools. In particular,
upstream's default **explore** agent denies shell; do not silently grant it shell access.
Use the **general** child for active Bash-search acceptance, and verify explore's
intentional fallback separately. A configured supported shell and shell permission
are prerequisites for active mode. Leaf permission checks still use original tool names.

## Validation status

One focused Core `bun typecheck` ran with pinned Bun 1.4.2. It reported three issues:
skill JSON-property narrowing, an uncaptured `ShellSelect.Service` requirement, and
the empty-tools fallback's missing snapshot type. All three were corrected. Per the
one-check limit, it was **not rerun**; subsequent source refinements are also not
typecheck-verified. Log: `/tmp/tandem/v2/claude-core-typecheck.log`.
Master should run the post-integration static check and real acceptance; no passing
build/typecheck or Claude workflow is claimed here.

## Concrete real-Claude acceptance sequence

Use the existing isolated launcher, a registered native Claude model, and the external
auth plugin. Do not target v1. Master owns staging/build scheduling. Set diagnostics on
the private-spawn/server process; for example, from the v2 root:

```sh
TANDEM_DUMP_REQUEST=/tmp/tandem/v2/claude-dumps \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts cli \
  run --standalone --model '<provider>/<claude-model>#<thinking-on-variant>' --format json \
  'Read notes/v2-port.md lines 207–254. Use shell to run pwd. Create a small scratch text file with Patch, read it, then use the general subagent to read the same file. Report each result.'
```

1. **Disabled mode, OAuth then API key:** leave Bash-search unset. Confirm final
   definitions include `Read/Bash/Patch/Agent/Skill` and any enabled `Glob/Grep`.
   Run real reads, shell, patch and a general child. Inspect stored tool events:
   canonical `read.path`, `shell`, `patch.patchText`, `subagent.background`; IDs match
   final request call/result history. Exercise an enabled Edit/Write configuration
   and a real Skill load separately. Check question nesting and websearch keys in
   schemas without renaming ordinary prose words.
2. **Prompt and durable updates:** inspect billing first, Claude base, one Markdown
   skill list, environment introduction, and instruction-file content only in the
   first-user reminder. Add a unique line to an acceptance project's AGENTS.md,
   resume the same Session, and verify a chronological instruction update with the
   original epoch baseline still present. Resume again for a cached tool round trip.
   Compute billing hashes from the dump's first user text; inspect one-hour cache
   hints, at most four markers, and no billing marker.
3. **Thinking and auxiliary:** repeat with explicit enabled, adaptive, and disabled
   variants. Confirm only on modes contain `clear_thinking_20251015/keep:all` and its
   beta; verify signed thinking and any naturally returned redacted-thinking payload
   round-trip exactly through a tool result and continuation. Exercise title,
   `generate`, summary/native compaction where available, and a Claude Corrector or
   browser-reader child. Bare auxiliaries retain only their own instruction context.
   Force an explicit thinking-off auxiliary variant and an HTTP-body thinking-off
   override; both must omit clearing. Record unavailable redacted-thinking as untested.
4. **Active Bash search:** rerun with `TANDEM_CLAUDE_BASH_SEARCH=1` and request:
   “Use plain find to locate TypeScript files under packages/core/src/plugin/tandem,
   then plain grep to find ClaudePresentation references. Ask a general Claude child
   to independently search and read one result. Report paths and matching lines.”
   Inspect final main/general-child native catalogs and Code Mode listings for absent
   dedicated search tools and stale instructions directing their use. Inspect shell
   output for shim resolution, hidden/ignored/VCS/binary behavior and GNU-basic regex;
   exercise a system-grep fallback flag supported on the host. Test Code Mode with a
   real available host tool and ensure its embedded JS and exact `tools` path survive.
5. **Fallback and isolation:** run a normal non-Claude main and a non-Claude child
   while the flag remains on; their catalogs and subprocess PATH should be normal.
   Exercise default explore (dedicated search retained), a shell-denied agent, and an
   unsupported shell. Start an isolated process with ugrep/bfs deliberately absent
   from its PATH; verify setup guidance plus working dedicated tools. Restore PATH
   and test a fresh process. Do not remove/replace the installed binaries to test this.

Use final native request dumps for payload assertions, and the master's credential-safe
transport inspection for beta assertions (diagnostic dumps intentionally omit headers).
Third-party final HTTP hooks can still deliberately replace a body after native lowering;
those hooks own consistency of their replacements. Record Session IDs, tool outcomes,
cache observations and untested routes in the master ledger before accepting the feature.
