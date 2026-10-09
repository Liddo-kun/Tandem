# Subagent final answer omitted after an in-flight follow-up

Investigated 2026-10-09 using a consistent SQLite backup of the daily server's
actual session records. The resulting implementation is a **Tandem feature/enhancement**, as requested by Jon, rather than a temporary upstream fix. No low-level tests were added or run.

## Finding

The first answer was saved intact in the child, but never forwarded to the parent.
This was not a completion notification being overwritten or a UI-only problem.
The follow-up arrived while the first answer was streaming, so both answers fell
within one continuously running child job. Result selection returned only the
latest completed assistant message after that job became idle.

This is an information-loss gap when steering a running subagent. Coalescing work
is intentional in the execution/job layer; omitting an earlier completed final
answer is a consequence of the single-message result collector.

## Recorded timeline

Times are local UTC+07:00 on 2026-10-09.

| Time | Event |
| --- | --- |
| 21:58:52 | Parent starts the background research job. |
| 22:03:44.986 | Child starts the assistant message containing **Findings**. |
| 22:04:02.174–.198 | Parent's second `subagent` tool call admits the follow-up while that answer is still streaming. |
| 22:05:09.995 | **Findings** completes normally (`finish: stop`, text phase `final_answer`; 10,142 characters). |
| 22:05:10.009 | Queued follow-up becomes a user message in child history. |
| 22:05:10.062 | Child starts its response to the follow-up. |
| 22:05:34.152 | **Revised conclusion** completes normally (2,609 characters). |
| 22:05:34.158 | Child records its only idle message for this run. |
| 22:05:34.211 | Parent receives one synthetic completion containing only **Revised conclusion**. |

Thus the follow-up arrived about 68 seconds before the first answer finished—not
after a first completion notification had been generated. The parent's stored
visible messages contain no copy of the first Findings text.

Identifiers:

- Parent: `ses_eded8e199ffeYb062W1ZxSC8AA` (Swipe Tabs, fork #1).
- Child: `ses_eded36b03ffezqLqugaqZ5s9iP`.
- First final: `msg_121310c2e001VxplkiRzWwPEvf`, child sequence 349.
- Follow-up: `msg_121314f8e001iozo7yW264jD2k`, child sequence 357.
- Revised final: `msg_121325883001ozyxkNcN9I19hJ`, child sequence 358.
- Only completion notification: `msg_1212c9528001OtufTDwBP4r20R`, parent sequence 1678.

## Code path

1. `packages/core/src/tool/plugin/subagent.ts:203–230` admits follow-up input before
   starting/joining the child job. `Session.prompt` defaults to steering and wakes
   execution (`packages/core/src/session/session.ts:145–175`).
2. `packages/core/src/job.ts:261–264` returns the existing running job for the child
   ID. It does not start a separate job for the follow-up.
3. `packages/core/src/session/runner/llm.ts:161–195` promotes pending input and keeps
   running, even when the previous model response ended normally.
   `run-coordinator.ts:32–38,124–133` makes `resume` wait for the busy period to end.
4. `packages/core/src/session/subagent-job.ts:44–51` waits for `sessions.resume`,
   reads messages newest-first, and uses `.find(...)` to select one completed,
   error-free assistant message. Here that is the revision; the first final is
   simply not selected.
5. `subagent-job.ts:20–33` deliberately registers one notification observer per
   child/job generation. The second background call joins the existing observer.
   `subagent-completion.ts:37–44` delivers the single selected output.

## Upstream and coverage

These relevant implementations are unchanged from the pinned upstream baseline
`80c4a6b7c8`. The official upstream/v2 head checked on 2026-10-09 was
`5cfe3b42712a2384fc5136fca6df8e65903c85ee`; it still has the same latest-message
selection and running-job coalescing. Its `ee0e614221` change preserves notification
observers across location eviction, which does not address this case.

`packages/core/test/tool-subagent.test.ts:512–559` verifies that steering admits
input to a running child, but uses a never-finishing job and does not check that
two completed final answers reach the parent.

## Tandem enhancement

Jon approved preserving all completed final answers and adding deterministic delivery guidance to delegated prompts. The implementation:

- Stores the first admitted prompt ID in the job's recovery record. Joining a running job preserves that boundary; a later continuation gets its own boundary.
- Reads assistant messages after that prompt in sequence order, without a 20-message cap or compaction-window restriction.
- Collects error-free, completed `stop` responses without local tool calls. Explicit `final_answer` text parts take precedence; otherwise text is included except parts tagged `commentary`. This supports providers without phase metadata using their normalized turn-ending signal.
- Returns one combined result, numbering answers when there is more than one. Existing notification deduplication remains in place.
- Uses the same collector after background server recovery. Old durable jobs without a prompt boundary retain latest-message behavior to avoid replaying their old turns.
- Replaces upstream's existing first-prompt introductory string with the concise reminder below, at the tool- and command-spawning sites. The existing conditional handles first-prompt-only delivery; follow-up prompts pass through unchanged. No append logic, prompt hook, tracking state, or reminder constant in the result collector is needed:

  ```text
  <system-reminder>
  You are a subagent spawned by another session. At idle, the main agent receives your completed final answers in order, but not commentary or tool output. Include all needed findings in your final answer.
  </system-reminder>
  ```

Source and changelog inventory: [Tandem differences](../logv2.md#instructions-and-tool-guidance), [changelog](../changelogv2.md).

## Live verification procedure

The development-server smoke client in `/tmp/tandem/v2/subagent-delivery/live.py` uses explicit `http://127.0.0.1:4098` requests and real model/tool execution. A parent launches a background child that emits a commentary marker, calls shell, and streams a long final answer. While that answer is streaming, the client asks the parent to steer the same child through the actual subagent tool. It checks that admission precedes completion of the first final and that one notification contains both finals, in order, without commentary or tool output. It then checks foreground and background continuations for old-answer replay. The reminder-only smoke client, `reminder-live.py`, checks that the first prompt contains the reminder prefix and the continuation is passed through verbatim without one.

**Passed on 2026-10-09**, with real GPT-6.1 Sol parent/child sessions and actual subagent/shell tools:

- Parent `ses_edeacdb00ffe6NEC0V5QvJWLOm`; child `ses_edeacc336ffek21BI1nwGpxVZ9`.
- First final `msg_121534b35001mJJq2gc7h6z6In` was still incomplete when the follow-up tool completed admission.
- Both unique finals arrived once, in order, in one completion notification. Commentary and shell output were excluded.
- Subsequent foreground and background continuations returned only their own new final; earlier finals were not replayed.
- The initial implementation included the appended reminder on all four child prompts; this was subsequently changed to first-prompt-only delivery at Jon's request.
- Development CLI build, subsequent `bun typecheck` in `packages/core`, and `git diff --check` passed.

After shortening the reminder and moving the identity line inside it, another development build and real smoke check passed: parent `ses_edea15780ffelzGsERvRW1OgD1`, child `ses_edea1457bffeIvcarbi2ydNeAr`. The initial prompt contained the exact concise reminder with no separate identity prefix; a continuation received the same reminder. Actual shell execution and final-answer delivery worked, with no old-final replay. Historical evidence: `reminder-live.log` in the scratch directory below.

The final, first-prompt-only implementation also passed a development build and real smoke check: parent `ses_ede9b9154ffekhd6qWzbudhfxX`, child `ses_ede9b7db6ffe55XPUvkk0opp4E`. The new child's prompt began with the exact reminder, replacing upstream's intro. The follow-up matched the main agent's prompt verbatim, with no reminder. Actual shell execution and both final-answer deliveries worked, without old-answer replay. Evidence: `reminder-live-result.json` and `reminder-once-live.log`. Formatting and `git diff --check` passed.

The first smoke attempt was stopped because its observer looked for text deltas in the message-list API, which projects text at `Text.Ended`. The corrected check observes `Text.Started` on the answer step after the completed shell step. Command-spawned children and crash recovery share the implementation but were not separately exercised. Daily Tandem was not installed or restarted.

Scratch evidence: `/tmp/tandem/v2/subagent-delivery/` contains the database snapshot,
extracted session records, and both original final texts.
