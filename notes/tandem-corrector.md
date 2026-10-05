# Corrector source handoff

Corrector is implemented in `packages/core/src/plugin/tandem/prompt-corrector.ts`, with registration
in `plugin/internal.ts`. No RePrompt duplication or CLI `run` disablement is included. Runtime
acceptance, builds and deployment remain master-owned.

## Runtime contract

- Default on. `TANDEM_PROMPT_CORRECTOR=0` (also false/off/no) disables automatic correction.
- `_MAX` defaults to 600 trimmed UTF-16 characters per authored text range; 0 is uncapped.
- `_MODEL` accepts `provider/model` (optionally `#variant`). `_VARIANT` overrides its variant.
- `_DEBUG` defaults off; `_DEBUG_KEEP` defaults to 2, with 0 retaining unlimited debug roots.
- Model precedence: environment override → configured `tandem-corrector` model (including preserved
  legacy `small_model`) → retained v1 cheap-model priorities among available models for the session
  provider → session/default model. Copilot prefers gpt-5-mini; OpenCode prefers gpt-5-nano. Selection
  is reevaluated per admission rather than cached across config changes.
- Invalid/unavailable model or variant settings retain the original text. Child execution failure,
  empty response or failed v1 expansion/bounded-edit checks also retain it. No alternate provider is
  silently selected after an explicit model fails.

The pre-admission prompt hook changes authoritative text before attachment materialization and
durable enqueue. Originals are written only for accepted changes. UI `displayText`, authored range
ends and following structured mention offsets change together. Protected mentions are excluded from
correction; surrounding plain-text ranges remain eligible. Files and generated context are untouched.

The shared browser-safe schema is imported as `TandemAuxiliary` from
`@opencode/util/tandem-auxiliary`. `readCorrectorMetadata` decodes its fields once. Range bounds/order
are checked against the actual prompt. Missing range metadata means the displayed authored prefix,
or the full raw text for API callers without presentation metadata; API producers of generated text
must supply empty/authored ranges or the disabled marker.

Fingerprint encoding is SHA-256, lowercase hexadecimal, over UTF-8 `JSON.stringify` of the ordered
array of `[start, end, text.slice(start, end)]` tuples. Structured mention spans are subtracted first.
The fingerprint describes the processed final text/ranges, including rejected/failed/unchanged results.
It prevents queue reorder replacements from launching another correction. It is not a security token.

## Isolation and lifecycle

Corrector defaults install after shared auxiliary defaults and before configured agents. Its final
context policy installs after ordinary/config hooks, immediately before shared auxiliary policy.
The final policy replaces system instructions with the retained copy-editor prompt, removes tools,
and rebuilds user input from the stored raw child message rather than earlier context-hook additions.
Assistant context remains for normal incomplete-stream continuation. Corrector system overrides do
not turn it into a coding agent; model overrides remain supported.

Normal corrections create fresh linked `tandem-corrector` children with shared role/owner/bare/disabled
metadata and an explicit all-tool deny ruleset. Execution uses create → prompt → wait → outcome/context,
then an operation-scoped acquire/release finalizer removes the child. Interruption of the correction
operation is not caught as a successful correction; finalization removes the independently running
child. Parent Stop before admission remains an idle no-op limitation, as documented in
`tandem-auxiliary-sessions.md`.

Debug mode creates named root sessions at the invoking Location, stops/waits before retention, and
prunes older inactive Corrector roots. Active debug sessions are tracked across Locations. Process
death cannot run finalizers; crash-orphan cleanup remains outside this feature. Cleanup errors are
logged without replacing a completed correction or swallowing operation interruption.

## Client behavior

The persisted setting is `settings.v3.general.corrector`, default true. Both the composer toggle and
General settings control use English fallback i18n. Legacy `general.promptEnhance` on/no-reprompt
migrate to true, off to false; the older `reprompt:false` remains correction-on. Android Enter,
delete-word and page zoom edits are preserved.

The submission snapshots a literal `tandemCorrectorDisabled` true/false before asynchronous image
handling. Client settings must be hydrated before submission. Queue edit preserves that snapshot;
reorder preserves the processed text/fingerprint; failed-send restoration and retry keep it. Undo
restores authored text with its snapshot and carries the old generated suffix separately in persisted
`queuedContext`, so resend does not recategorize generated notes as authored input. If undo appends to
an existing draft, the recovered queued setting applies to the combined resubmission. An explicit
new/reset draft snapshots the current client toggle.

Queue edits invalidate old originals/fingerprints, reconstruct authored ranges, preserve model-only
notes and avoid repeating old path-reference scaffolding. Ambiguous shifted mention matches are not
rebound to an arbitrary occurrence. Existing undo restrictions for detached non-mentioned context
attachments remain; an unavailable undo leaves the queue item in place.

## Master acceptance steps

1. Build/load the isolated v2 source. Enable final-request diagnostics. Submit a typo/dictation example;
   inspect durable inbox/delivered text, `displayText`, changed original and final main request.
2. Confirm the Corrector request contains only copy-editor instructions/raw text, no project/global
   instructions, catalogs, tools or RePrompt. Normal child is absent from root lists and removed.
3. Toggle off, submit, toggle on and submit again. Verify persisted client setting across relaunch and
   literal false/true opt-out snapshots. Check General/composer controls and Android Enter/zoom.
4. While the main session is busy, queue on/off prompts, toggle again, edit each, reorder, steer, undo
   and resend. Inspect each snapshot, generated suffix, files and processed fingerprint. Reorder must
   produce no extra correction requests.
5. Exercise inline file/agent/skill mentions, repeated mentions, screenshots and path/comment context.
   Correct surrounding prose; compare attachment identities/content and exact mention substrings at
   adjusted offsets. Generated attachment/comment text must remain unchanged.
6. Exercise blanks/context-only input, exactly 600 and over-600 authored ranges, multiple text ranges,
   unchanged response, rejected answer/expansion and model/variant failure. Unchanged/failed cases
   must retain text without manufacturing changed-original metadata.
7. Exercise configured `small_model`, a distinct title-model override, environment model/variant and
   session fallback. Also exercise standalone `run`; the v1 disablement is intentionally absent.
8. Cancel the admission operation while a correction waits; inspect child outcome/removal and confirm
   no parent input was admitted. Do not count parent Stop's known pre-admission no-op as operation
   cancellation. Exercise DEBUG_KEEP=2 and 0, including concurrent Locations.
9. Invoke browser-reader flow after master integration. Its internal prompts must launch no Corrector
   children, independently of the client toggle.

No live acceptance or scope checkbox completion is claimed by this source handoff.
