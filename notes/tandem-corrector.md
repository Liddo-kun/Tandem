# Corrector

Corrector copy-edits a prompt before it is admitted to the session: spelling, punctuation,
capitalization, wrong-word autocorrect and dictation artifacts, including clear technical symbols,
paths and names. It returns only the corrected message; ambiguous wording stays unchanged. It is on by
default. The composer **Corrector** button and General settings share one per-client setting,
`settings.v3.general.corrector` (legacy `promptEnhance` on/no-reprompt migrates to on, off to off).

Code: `packages/core/src/plugin/tandem/prompt-corrector.ts` (registered in `plugin/internal.ts`),
shared metadata in `packages/util/src/tandem-auxiliary.ts`, client in `packages/app/src/settings/model.tsx`
and `packages/app/src/session/composer/`.

## Server settings

Set in the server environment (or the development launcher's `environment.json`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `TANDEM_PROMPT_CORRECTOR` | on | `0`, `false`, `off`, `no` disable (case-insensitive). |
| `TANDEM_PROMPT_CORRECTOR_MAX` | `600` | Maximum trimmed length (UTF-16) of each authored text range; `0` is uncapped. |
| `TANDEM_PROMPT_CORRECTOR_MODEL` | unset | Explicit `provider/model`, optionally `#variant`. |
| `TANDEM_PROMPT_CORRECTOR_VARIANT` | unset | Overrides the selected model's variant. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG` | off | Keeps visible debug root sessions instead of hidden children. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG_KEEP` | `2` | Newest inactive debug roots kept; `0` is unlimited. |

Model selection, reevaluated per prompt: environment override → configured `tandem-corrector` agent
model (including a migrated `small_model`) → a cheap available model for the session's provider
(Copilot `gpt-5-mini`, OpenCode `gpt-5-nano`, otherwise a Haiku/Flash/nano priority list) → the
session model. An invalid explicit model or variant keeps the original text rather than switching
provider. Only the default model and the 600 limit have been tested live.

## Behavior and constraints

- Only nonempty authored text ranges are corrected. File, agent and skill mentions are protected;
  attachments and generated context are untouched. Mention offsets and `displayText` shift with accepted
  edits. API callers without range metadata expose their whole raw text, so producers of generated text
  must send empty ranges or `tandemCorrectorDisabled: true`.
- Accepted text becomes the stored prompt; a changed original is kept in `tandemPromptCorrectorOriginal`.
  Empty, failed or rejected corrections keep the original. A result is rejected if it grows beyond
  `1.5 × input + 40` characters or, for inputs up to 4,000 characters, if its case-insensitive edit
  distance exceeds `max(10, floor(input × 0.65))`.
- A SHA-256 fingerprint of the processed ranges stops queue reorders and unchanged resubmissions from
  being corrected again. Editing a queued prompt invalidates it.
- Submission snapshots the toggle as `tandemCorrectorDisabled` true/false, so toggling later affects new
  drafts, not already-queued prompts. Queue edit, reorder, steer, undo/resend and failed-send restore keep
  the snapshot; undo appended to an existing draft keeps the recovered item's setting.
- Each correction runs in a fresh auxiliary child session (see `auxiliary.ts`): copy-editor system
  prompt and raw text only, no tools, no instruction files, no recursive correction. Browser-fetch reader
  prompts bypass Corrector. The child is removed on completion or when the admission is cancelled;
  process death leaves it behind. Pressing Stop on the parent before admission does nothing.
- Correcting fragments around mentions can leave awkward punctuation or capitalization.
