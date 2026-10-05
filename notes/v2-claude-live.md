# Bounded live Claude acceptance — 2026-10-04

## Result and next scheduling point

Real subscription requests succeeded on the existing registered server4098 (assigned PID12544), with Bash search explicitly disabled. All acceptance sessions are idle. **Ready for master to schedule Bash-search-on/rebuild/restart.** First resolve the missing instruction-baseline marker below. This worker made no implementation changes, builds, restarts, auth changes, or progress-ledger edits. Master's `.pipe(Effect.orDie)` change in the Claude plugin is preserved.

## Concrete failures / coordination required

1. **First-user reminder missing.** Final main/general requests leave AGENTS content, skills and environment in a system block. The first user contains only the submitted prompt. Source cause: `packages/core/src/session/model-request.ts:113–120` constructs strings and calls `.map(SystemPart.make)` without adding `metadata: { "tandem.instruction-baseline": true }` to `input.initial`. `claude/plugin.ts:26` requires that marker. The README describes this seam, but it is absent in current source and runtime. **Master should authorize/apply the narrow shared-file fix**: construct base and baseline as separate SystemParts, mark only the nonempty baseline, preserve ordering/filtering. Rebuild and recheck reminder placement, billing hashes and chronological updates. No positional fallback was added in the Claude hook.
2. **Patch unavailable for Claude.** The real model correctly reported absence and substituted Write. `tool/plugin/patch.ts:296–309` deliberately deletes `patch` for non-GPT models. This is upstream policy, not failed reverse mapping. Read/Write/Edit all work. Patch acceptance remains pending a master decision about changing the shared catalog policy; do not claim Patch passed.
3. **Inherited v1 shell shims in disabled mode.** Actual Bash `command -v grep/find` resolves `/home/jon/.cache/tandem/bin/shims/{grep,find}`. Disabled mode does retain dedicated Glob/Grep. This is inherited process/login-shell PATH, not proof of v2 Bash-search activation. Active-mode/isolation acceptance must distinguish this ambient path from v2's own subprocess-local shims.
4. **Bad generated title in one session.** Persisted main title is `I can't execute this request. I'm Claude, an AI assistant—I don't have the ability to:`. The final title dump correctly retains the custom title-generator prompt (single-line <=50-character title; never execute the request), no tools or main baseline, and billing. Thus the observed failure is model output/title quality, with no demonstrated Claude presentation mutation causing it. The separate thinking-off session gets `Reading input file for marker`. Title output validation/prompt changes require master coordination; not changed here.
5. `Fetch_page` appears in Claude's normal native catalog, matching the master's independent internal-fetch exposure investigation. No additional fix attempted here.

## Sessions and observable tool results

| Route | Session | Result |
| --- | --- | --- |
| Main adaptive | `ses_efa8eb27fffe8atvSQWhOu8BqI` | Succeeded: Skill, Read, Bash, Write, general child; resumed Read/Edit/Read/Bash; then instruction-update Read |
| General child | `ses_efa8e8f6cffegVZIblk0A8bOMQ` | Succeeded on native `anthropic/claude-sonnet-5-5`; independently Read output marker |
| Thinking-off main | `ses_efa8d32e2ffe0h112Y91AcxIUd` | Succeeded on native `anthropic/claude-sonnet-5#none`; Read exact input marker |
| Automatic Corrector for child admission | `ses_efa8e8f66ffenunFGbbvcUqKPO` | Native Haiku final request captured; ephemeral session later returns 404, so no persisted cost assertion for this auxiliary |

Main uses `claude-sonnet-5-5#low` (adaptive). General explicitly selects the same model and resolves its default adaptive variant. User tools only touch `/tmp/tandem/v2/claude-acceptance`. Fixture skill is project-local `.opencode/skills/claude-acceptance/SKILL.md`.

Persisted canonical tool inputs show `skill.id`, `read.path`, `write.path`, `edit.path/oldString/newString`, `shell.command/workdir`, and `subagent`. Outbound definitions/history use `Skill.skill`, `Read.file_path`, `Write.file_path`, `Edit.file_path/old_string/new_string`, `Bash`, and `Agent`. All 11 main historical call IDs match persisted tool IDs, and all historical result IDs match those calls. Child executes canonical Read successfully. `Agent.run_in_background` is present in schema; the model did not supply it, so its value reversal is not independently exercised. Nested `AskUserQuestion.questions[].multiple` remains unchanged. WebSearch only exposes `query` in this native catalog; absent legacy keys cannot be asserted.

## Final request and persistence inspection

Inspected 17 attributed native Anthropic dumps, including main, general, two title requests and the automatic Corrector:

- All 17 billing blocks are first and match independently recomputed suffix/hash from actual first-user text. No billing cache breakpoint.
- Every cache marker uses `ttl: "1h"`; maximum four markers in any request.
- Main/general each list the fixture skill once as Markdown and include `Environment context you are running in:`. Their baseline is incorrectly still system-side (failure above).
- Adaptive main/general include `clear_thinking_20251015` with `keep: "all"`. Explicit off main uses `{ "type": "disabled" }` and omits clearing. Title and Corrector have absent thinking and omit clearing.
- One main signed thinking block is persisted with a 1,028-character signature. Its text/signature survives tool-result continuation and both resumed turns; every re-emitted signature exactly equals persistence. No redacted-thinking block was naturally returned.
- Cached resume is real: initial cache write 11,443 tokens; later main cache reads reach 14,591 tokens. Every one of ten persisted main assistant messages has cost `0`; both persisted general-child messages also cost `0`. Off assistant messages cost `0`. Catalog native Anthropic subscription models expose `cost: []`.
- Changing only fixture AGENTS from `CLAUDE_EPOCH_ALPHA` to `CLAUDE_EPOCH_BETA` creates a durable system instruction-update message (`notice: instructions`, `instructionSources: ["core/instructions"]`). Later requests retain the original ALPHA epoch baseline and carry BETA chronologically. Claude reports BETA without reading AGENTS again.
- Title and Corrector dumps retain their own auxiliary prompts, without main environment/skills/project instructions. Main top-level prompts explicitly disabled Corrector via metadata; the general-child admission independently triggered the configured Corrector.

Dumps intentionally omit headers. Bearer/x-api-key/beta/user-agent assertions cannot be established from these files. Final recorded URL is `https://api.anthropic.com/v1/messages` without `beta=true`; successful transport is established, but that URL representation alone is not proof of post-hook query rewriting. Master should use the credential-safe transport inspection for header/query assertions.

## Evidence and rerun helpers

All scratch is under `/tmp/tandem/v2`:

- `live-claude.py`: imports safe `api/unwrap` from master `live-session.py`; normal create/prompt/wait APIs. Modes `on`, `off`, `resume`. Separate helper, no master helper edits.
- `claude-first.txt`, `claude-resume.txt`, `claude-update.txt`, `claude-off.txt`: exact prompts.
- `claude-disabled-claude-{first,resume,update}-messages.json`, `claude-off-claude-off-messages.json`: persisted API projections.
- `claude-{disabled,off}-state.json`, `claude-child-ses_efa8e8f6cffegVZIblk0A8bOMQ.json`: session/child evidence.
- `inspect-claude.py`, `claude-inspection.json`: per-dump attribution, billing/cache/thinking/placement checks; signature digest/length rather than printing its bytes.
- `request-dumps/integrated/1791092674092-4cc0a156-8f3c-4a00-a764-bc50ba73a44f.json`: first adaptive request and missing reminder.
- `request-dumps/integrated/1791092674091-ccb7a8cf-2984-48a9-a918-51beea044fe7.json`: title prompt for malformed persisted title.
- `request-dumps/integrated/1791092679939-be9ad224-d014-4f2e-a1ca-781a7d85b4cc.json`: first re-emitted signed thinking block.
- `request-dumps/integrated/1791092772161-d1d15b3c-dfda-4633-82d5-dc5529eccbf8.json`: explicit thinking-off main.
- `request-dumps/integrated/1791092795342-db6bfe01-0622-476d-9986-5aec3afcd7ff.json`: updated epoch, complete historical mappings and signed thinking.

## Pending within / beyond this checkpoint

Before accepting presentation: fix/rebuild/retest baseline relocation; settle Patch catalog expectation; schedule active Bash-search and isolation/fallback checks. The running process predates master's typecheck fix.

Not exercised here: explicit enabled-budget thinking, HTTP-body off override, redacted-thinking payload, API-key switch, refresh/concurrent rotation, restart credential reuse, self-signed endpoint/TLS isolation, generate/compaction, background Agent argument, actual question/websearch, Code Mode host call. No login redo or forced expiry, second credential-DB server, low-level tests, browser/Android/OS work, or v1 modification occurred.
