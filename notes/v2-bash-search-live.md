# Bounded active Bash-search acceptance — 2026-10-04

## Result

Real subscription calls on the assigned rebuilt server4098 (PID659 at handoff), with `TANDEM_CLAUDE_BASH_SEARCH=1`, pass active main/general Claude search, non-Claude isolation, default explore fallback, baseline relocation, billing/cache, and durable instruction update after resume. All seven acceptance sessions were confirmed idle with outcome `succeeded` through the API.

One residual native-wrapper spelling was demonstrated in final request system guidance and fixed in owned source. **That source fix still needs master's next build/deployment and final-request recheck.** No worker build, restart, credential change, extra server, low-level test, browser/device interaction, or production change occurred.

## Sessions

| Route | Session | Observed result |
| --- | --- | --- |
| Claude main, resumed twice | `ses_efa824178ffeIY4NFXWWb6WGyE` | Plain grep/find, three children across first two prompts, updated instruction epoch on third |
| Claude general child | `ses_efa8225dfffe9BBjZ1V6S6OLaj` | Actual shell search and Read |
| OpenAI main | `ses_efa81ba18ffeRl716ajbGGPbWa` | Dedicated glob/grep and unmodified shell paths |
| OpenAI general child of Claude | `ses_efa8174a9ffenQjoDdHkRc2V0Z` | Dedicated glob/grep and unmodified shell paths |
| Explore with blanket Session allow | `ses_efa81a536ffe2D06EB5pvCOtrb` | Correctly active: inherited allow overrides default shell denial; Code Mode search confirms no glob/grep |
| Claude parent using default agent rules | `ses_efa8040b6ffeydV6ARkVH3opv7` | Spawns default explore child |
| Default explore child | `ses_efa803153ffei3U6Y81npKdJ4X` | Actual dedicated Glob/Grep calls succeed; no Bash exposed |

Initial fixture permissions allowed `*`, which intentionally supersedes agent defaults and therefore was unsuitable for testing default explore. Repeated using only an external-directory allowance; no implementation fix was needed. The two explore results are not contradictory.

## Active tools and subprocess behavior

- Main/general resolved plain commands to `/tmp/tandem/v2/tandem/bash-search-e8TN4G/{grep,find}`. Neither used v1's inherited shim directory.
- Plain recursive grep found the visible and hidden fixture, skipped the `.gitignore`-ignored file and `.git/fixture`, and after adding a NUL-containing fixture skipped binary matches too.
- Plain find included hidden, ignored and VCS files, consistent with bfs/find behavior. `-regex './.*\.ts'` found the three expected TypeScript fixtures.
- GNU basic regex was preserved: `grep '^a+$'` selected literal `a+`, not `aa`.
- System-grep fallback worked: `grep -z fallback` preserved its terminating NUL (`66 61 6c 6c 62 61 63 6b 00`).
- OpenAI main and child used `/usr/bin/grep` and `/usr/bin/find`; both had real successful canonical glob/grep calls. Six final OpenAI request dumps retain those definitions.
- Final active Claude catalogs omit Glob/Grep and Fetch_page. Code Mode inventory has no search-tool paths; the overridden explore child's actual Execute searches for glob/grep both returned zero items. Default explore exposes `Glob`, `Grep`, `Read`, `WebFetch`, `WebSearch`, with no Bash.
- Main successfully called native Execute to run the canonical host tool `tools.opencode.models`; persisted metadata confirms the host call and model lookup result. Embedded host paths remain canonical.
- No active harness instructions direct use of removed Glob/Grep tools.

## Baseline, billing and durable resume

Inspected 16 attributed Claude requests across the five Claude sessions (8 main, 2 general, 2 overridden explore, 2 default parent, 2 default explore):

- Billing is first and independently recomputed suffix/hash matches every request's final first-user text. Billing has no cache marker.
- Every cache marker has TTL `1h`; no request has more than four.
- Instruction baseline appears exactly once, in the first user message's reminder, never in later user/tool-result messages or system blocks. Main/general each have one available-skills list and the environment introduction in that reminder.
- Main baseline remains `BASH_LIVE_ALPHA` after AGENTS changes to `BASH_LIVE_BETA`. The API persists a system message with `notice: instructions`, `instructionSources: ["core/instructions"]`, and the frozen BETA content. Subsequent requests carry that chronological update while preserving ALPHA in the first-user reminder. Claude reports BETA without an AGENTS Read call.
- Main cache reads reach 15,094 tokens; general reads 10,264. All persisted assistant costs in all seven sessions are zero.

## Source-ready fix / deployment needed

`packages/core/src/plugin/tandem/claude/presentation.ts`:

1. Extend exact native Execute reference mapping for `consider using \`execute\` to call \`tools.opencode.session_move\``.
2. Apply existing native-wrapper reference mapping to system parts during final Claude presentation, preserving all other part fields. The shared opencode tool plugin adds this guidance directly as a system block, bypassing the instruction-source renderer.

Evidence: first main dump `1791093490349-fcd0fe61-f1f6-486d-adc5-44c7eece06c0.json` contains lowercase native `execute` in that worktree sentence while the catalog exposes `Execute`. This is a presentation defect, not a failed host call. No shared files were edited. Source change is not rebuilt, live-verified, or typechecked by this worker; next scheduled build must inspect the sentence and confirm unchanged `tools.opencode.session_move` spelling.

## Evidence

All scratch is under `/tmp/tandem/v2`:

- `bash-live/`: isolated fixtures and AGENTS, now at BETA.
- `bash-live-run.py`, `bash-inspect.py`: bounded API runner and offline final-request inspection; import existing credential-safe helper without printing tokens.
- `bash-{main,children,fallback,explore,update}.txt`: exact prompts.
- `bash-evidence-{main,general,openai,openai-child,explore-overridden,default-main,explore}.json`: session state plus actual persisted messages.
- `bash-inspection.json`: per-Claude-request attribution, catalogs, baseline placement, billing/cache checks, durable update and usage. Its request loop intentionally handles Anthropic `messages`; the six OpenAI `input` dumps were inspected separately for catalogs.
- Final payloads: `request-dumps/integrated-2/`. First default explore: `1791093626184-671d2549-d7a3-44e3-a8a3-6d101f6a500f.json`. Updated main: `1791093620598-20e3644a-3312-4f47-aac2-28f02cc4803e.json`.

Unsupported-shell, missing-dependency, remote-workspace and other-platform fallback were not exercised: they require different process/configuration conditions beyond this bounded existing-server assignment. No claims about headers absent from diagnostic dumps. Prior disabled-mode thinking/signature acceptance remains in `notes/v2-claude-live.md`.
