# Corrector

Corrector copy-edits a prompt before durable admission and main-agent execution. It is
on by default; the composer **Corrector** button and General settings share a persisted
per-client setting. There is no RePrompt mode, duplicated prompt, or `Read it again:` suffix.

## What changes

It fixes spelling, punctuation, capitalization, wrong-word autocorrect and dictation
artifacts, including clear technical symbols, paths and names. It must return only the
corrected message: no answer, instructions executed, added ideas or invented precision.
Ambiguous wording stays unchanged when the intended correction is unclear.

Only nonempty authored text ranges are eligible, up to **600 trimmed UTF-16 code units
per range** by default. Structured file/agent/skill mentions are protected; attachments,
image bytes and generated context stay intact. Mention offsets and displayed text are
adjusted with accepted edits. API callers without range/display metadata expose their
whole raw text; producers of generated-only text should supply empty authored ranges or
`tandemCorrectorDisabled: true`.

Accepted text becomes the stored/displayed prompt. Changed originals are retained in
`tandemPromptCorrectorOriginal`; unchanged, failed or rejected corrections do not create
a changed-original record. A processed fingerprint avoids correcting unchanged queued
resubmissions again. Independent fragments around mentions can acquire awkward punctuation;
this is a known quality limitation, not a guarantee of perfect copy-editing.

## Queued prompts keep their setting

Submission snapshots literal `tandemCorrectorDisabled: true` (off) or `false` (on) before
asynchronous attachment handling. Later toggle changes affect new drafts, **not already
queued prompts**. Queue editing, reorder, steer, undo/resend and failed-send restoration
retain that snapshot. Editing invalidates the old processed fingerprint/original; an
unchanged reorder does not launch another correction. Undo restores generated context
separately from authored text. If restored input is appended to an existing draft, the
recovered queue item's setting governs the combined resend; a new/reset draft uses the
current toggle.

The setting is `settings.v3.general.corrector`. Legacy `promptEnhance: on` or
`no-reprompt` migrates to on, `off` to off; older `reprompt: false` leaves correction on.
There is no special CLI `run` disablement in v2.

## Server settings

Set these in the server environment, or as string values in the isolated launcher's
`environment.json` described in [V2 configuration](notes/tandem-v2-configuration.md).

| Variable | Default | Meaning |
| --- | --- | --- |
| `TANDEM_PROMPT_CORRECTOR` | on | `0`, `false`, `off`, `no` disable (case-insensitive). |
| `TANDEM_PROMPT_CORRECTOR_MAX` | `600` | Maximum trimmed range length; `0` is uncapped. |
| `TANDEM_PROMPT_CORRECTOR_MODEL` | unset | Explicit `provider/model`, optionally `#variant`. |
| `TANDEM_PROMPT_CORRECTOR_VARIANT` | unset | Overrides the selected model's variant. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG` | off | Same boolean parsing; retains visible debug root sessions. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG_KEEP` | `2` | Retain newest inactive debug roots; `0` is unlimited. |

Empty boolean values use defaults; integer settings require nonnegative integers or fall
back to defaults. Model selection is explicit environment override → configured
`tandem-corrector` model (including migrated legacy `small_model`) → available cheap model
for the session provider → session/default model. Copilot prefers `gpt-5-mini`; OpenCode
prefers `gpt-5-nano`; other providers use the retained Haiku/Flash/nano priority list.
An invalid explicit model/variant keeps the original rather than silently switching provider.

## Isolation and fallback

Each correction uses a fresh auxiliary session containing only the copy-editor system
instructions and raw authored text, with no tools, project/global instruction files,
attachment scaffolding or recursive correction. Browser-reader internal prompts also
bypass correction. Normal children are removed on completion or operation cancellation;
debug roots are stopped and pruned. Process death cannot run cleanup finalizers.

Empty/failed responses keep the original. The acceptance check rejects expansion beyond
`1.5 × input length + 40` and, for texts no longer than 4,000 characters, requires
case-insensitive edit distance ≤ `max(10, floor(input length × 0.65))`. Above 4,000,
only the nonempty/expansion guards apply. These are bounds, not semantic proof.
Parent Stop before prompt admission can still be an idle no-op; cancellation of the
admission operation is the relevant cleanup boundary.

Source: [`prompt-corrector.ts`](packages/core/src/plugin/tandem/prompt-corrector.ts),
[`settings/model.tsx`](packages/app/src/settings/model.tsx), and
[`session/composer`](packages/app/src/session/composer/). Detailed implementation and
the runtime contract are in [Corrector implementation notes](notes/tandem-corrector.md).
