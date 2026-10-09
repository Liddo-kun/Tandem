# Direct subagent chat

Tandem enhancement requested by Jon on 2026-10-10.

## Behavior

- Child sessions use the normal composer and context-token display. The current child agent remains available even if it is configured as subagent-only.
- A compact composer note says: “Replies after the delegated task ends are not sent to the main session.” The existing link back to the main session remains available.
- During an active delegated job, direct user prompts appear in a separate, quoted **Direct user steering prompts** section before **Subagent final responses**. Multiple prompts retain chronological order; attachment names are included.
- The subagent tool and command-spawning path mark their prompts with `tandemSubagentPrompt: true`, so parent-agent follow-ups are not presented as direct user steering.
- Once the job finishes, direct conversation stays in the child. Prompting it directly does not start another parent-notification job.

## Ownership

Steering presentation is owned by `packages/core/src/session/tandem-subagent-steering.ts`: origin filtering, headings, quoting and attachment summaries. The shared collector reads messages within the existing job boundary, collects final answers, and calls `withUserSteering(messages, output)`. The two prompt-origin markers stay at the tool/command admission sites. Composer editability depends only on whether a request is blocking it; the redundant `showComposer()` check is removed.

## Verification

Scratch scripts and evidence: `/tmp/tandem/v2/child-chat/`. All live checks target the development server on port 4098 and Tandem Dev, not the daily installation.

Before editing session/composer code, the installed production-built Tandem Dev app was benchmarked by navigating six times each to a fixed parent and child and waiting for rendered content plus two animation frames. First navigation is excluded from warm medians. Baseline script: `index-D-oCOLyo.js`; evidence: `benchmark-before.json`, `baseline-page.json`, `baseline.png`.

- Parent warm median: 99.3 ms; 761 DOM nodes.
- Child warm median: 100.4 ms; 695 DOM nodes.
- Reported JavaScript heap: 33.1 MB (WebView's coarse value).

The smoke workflow uses actual model, subagent and shell execution. A child waits on a scratch FIFO while the parent sends a delegated follow-up and the user sends a prompt through the child composer. After release, the parent should receive only the direct user prompts in the steering section, followed by the final answer. A later child-only exchange should create no new parent notification.

### Passed live checks (2026-10-10)

- **Idle child chat through the actual app:** a native touchscreen Send tap admitted `CHILD_LOCAL_UI_OK`'s request and the child replied. Its parent received no new completion notice. `general-sol`, GPT-6.1 Sol and medium effort were preserved. Parent `ses_ede9b9154ffekhd6qWzbudhfxX`; child `ses_ede9b7db6ffe55XPUvkk0opp4E`. Evidence: `local-result.json`.
- **Context display:** the visible child footer showed 6,051 tokens, matching the latest child message's recorded input/output/reasoning/cache total. Evidence: `local-ui-state.json`.
- **No direct steering:** two additional real jobs confirmed that steering headings are absent from the parent's actual received payload: an ordinary foreground child, and a background child given only a parent-agent follow-up while its shell was running. The latter returned exactly `PARENT_ONLY_FINAL` inside the normal subagent wrapper, with no steering or extra final-response headings. Parent `ses_edd86eae2ffeLA2vBhhrFM3VTQ`; children `ses_edd86dd29ffeK9PKllkwW0SvmQ` and `ses_edd86ac50ffeIYoZ71aj4LPk5i`. Evidence: `no-steering-result.json`, `no-steering-ordinary.md`, `no-steering-parent-only.md`.
- **Active steering through the actual app:** a native touchscreen Steer tap admitted a direct user prompt while the child was waiting in shell. A second direct prompt carried `steering-note.txt`. The parent received both direct prompts once, in order, followed by a separate final-response section. Its own subagent-tool follow-up was not included among user prompts. Parent `ses_eddb9d47bffe3Q62w3ZgBG3fbM`; child `ses_eddb9bcbdffeVcO4OXOagYvmSR`. Evidence: `active-result.json`, `returned-steering.md`, `verify-final.log`.
- **Notice and navigation:** the child composer showed the local-only delivery note and token button. A native touchscreen tap on “Back to main session.” opened the correct parent. The notice and link remained within the viewport under English with forced RTL; direction was restored to LTR. Evidence: `active-child-final.png`, `rtl.png`, `rtl-layout.json`.
- **Checks:** production CLI and development APK builds, app and core `bun typecheck`, formatting, and `git diff --check` passed. No low-level tests were added or run. Core typecheck caught an attempted metadata spread on command input, which has no metadata field; the command marker now uses a plain metadata object.

The first active-check assertion incorrectly searched for the final marker across the whole returned payload; the user's quoted instruction already contained that marker. Checking the distinct final-response section against the same live result passed, without another model run.

### Matched production-build comparison

After script `index-BKSt9H7e.js`, using the same sessions and six-navigation procedure:

| Metric | Before | After |
| --- | ---: | ---: |
| Parent warm navigation median | 99.3 ms | 50.0 ms |
| Child warm navigation median | 100.4 ms | 49.9 ms |
| Parent DOM nodes | 761 | 761 |
| Child DOM nodes | 695 | 738 |

No navigation regression was observed. The child's extra 43 nodes provide the newly enabled composer. These short runs do not establish a general speed improvement. WebView reported coarse heap values of 33.1 MB before and 50.4 MB after in different app processes, without controlled GC; these are not a retained-memory comparison. Raw evidence: `benchmark-before.json`, `benchmark-after.json`, `benchmark-comparison.json`.

Only Tandem Dev and port 4098 were updated. Daily Tandem was not installed or restarted.

### Owned-formatter refactor verification

After extracting `withUserSteering` and simplifying composer editability, rebuilt the production CLI and Tandem Dev APK and repeated the real workflows on port 4098. Direct steering submitted by a native touchscreen tap, a second direct attachment prompt, and a parent-authored follow-up produced the same separated output with correct attribution. Parent `ses_edd79c99affeliD9L2lSM3sBLv`; child `ses_edd79b464ffeqQDdAHJcOuZXiq`. Both negative cases also passed again: ordinary foreground output and parent-only background steering contained no user-steering headings.

Evidence: `refactor-verify.log`, `refactor-no-steering.log`, and the current `active-result.json` / `no-steering-result.json` files in the scratch directory. Earlier payloads and identifiers were retained under `pre-refactor/`.

Post-refactor app and core typechecks passed after live verification, along with formatting and `git diff --check`.

A fresh production-build navigation baseline was recorded before the composer edit. Warm parent/child medians were 97.7/102.1 ms before and 50.0/50.0 ms afterward; no navigation regression was observed. Raw results are in `refactor-benchmark-{before,after,comparison}.json`. As with the earlier short run, this is a regression check rather than evidence of a general speed improvement.
