# Corrector live acceptance — 2026-10-04

## Result and environment

Core correction, Android toggle persistence across WebView reload, queue snapshot preservation,
image/mention preservation, generated-suffix preservation, HTTP admission cancellation, and
interrupted-child fallback passed against the running integrated development build.

**One unresolved integration defect:** the Android UI briefly showed `Request failed / Session not
found: ses_efa4725aeffePBxF2JU8Flmgr3` after successful correction/cleanup. That ID is the Corrector
child for the SUFFIX_EDIT admission. The corrected parent input was nevertheless admitted and
executed correctly. Do not mark the complete auxiliary UI lifecycle accepted until this is resolved.

- Server: development port 4098, existing PID 659; no build/restart/config override performed.
- Client: existing Tandem V2 Android APK, CDP 9224, root zoom 100%.
- Driver: real Android WebView through Playwright/Node `--experimental-strip-types`; no mocks or
  low-level tests. Android file input, suggestion selection, composer/settings controls, keyboard
  queue reordering and actual public HTTP session APIs were exercised.
- Final-request evidence: `/tmp/tandem/v2/request-dumps/integrated-2`.
- No production code changed. Existing editor.tsx/dom.ts terminal-BR fixes were preserved. No session
  UI patch was made, so no before/after performance benchmark or rebuild was needed.

## Owned sessions

| Session | Purpose | Final state |
| --- | --- | --- |
| `ses_efa537365ffeWUgsru44nTHb5P` | Android queue, settings, image/agent mention and suffix workflows | succeeded; empty inbox, no children |
| `ses_efa49b30affesbxWP8RvLDe0Ac` | Admit-only real-model 600/601/range/mention checks | idle; all inspected inbox items explicitly cancelled; no children |
| `ses_efa4b9c58ffeKhwR6QbhWIFGZ3` | Observed HTTP abort | idle; no input admitted, no children |
| `ses_efa450874ffeVZtk85xzfEJGqh` | Independently interrupt Corrector child; parent fallback | idle; inspected fallback inbox item cancelled; no children |
| `ses_efa4c3438ffeNQcCeW3Du6aHUW` | Initial cancellation-driver attempt | idle; empty inbox, no children; not used as acceptance evidence |

The initial cancellation driver used a nonexistent `/children` route and exited; the corrected
driver used `GET /api/session?parentID=...` and explicitly observed/aborted the admission. The
initial session was audited afterward rather than left behind running.

Final `GET /api/session/active` returned `{ "data": {} }`. All five sessions had zero pending inbox
items and zero linked children. Existing master acceptance sessions were not modified.

## Android controls and persistence

- Starting composer Corrector was off (`aria-pressed=false`). Toggled on/off through its actual
  button and observed literal disabled snapshots in stored input.
- Opened General with Ctrl+,; its Corrector switch agreed with the composer. Switched off using
  the focused native switch control and Space; reloaded the WebView and confirmed General remained
  off, then opened the owned session and confirmed composer off.
- Switched composer on, reloaded, and confirmed it stayed on. Later General reflected composer on.
- Restored **Corrector on**, **Timeline Compact** (slider value 2), **zoom 100%**. Final UI is the owned
  idle session with an empty composer. Follow-up behavior remains Steer.
- Persistence here means WebView reload/navigation. APK force-stop/process relaunch was not performed
  because this assignment prohibited restarts.

Evidence: `corrector-composer-{off,on,persist}.log`, `corrector-final-settings.log`,
`corrector-final-ui.log` under `/tmp/tandem/v2`.

## Queue acceptance

Real main work used three bounded `sleep 90` shell calls across the workflow to leave time for UI
operations and model admission. All completed; no shell work remains. This was actual main execution,
not injected busy state.

1. Queued `Pleese reply ON_TWO only.` with Corrector on and `Pleese reply OFF_TWO only.` with it off.
   The first stored `Please...`, `tandemCorrectorDisabled:false`, changed original and fingerprint;
   the second stored `Pleese...`, `tandemCorrectorDisabled:true`, without original/fingerprint.
2. With the global toggle on, edited the off item to `Pleese reply OFF_EDIT_TWO only.`: it stayed
   uncorrected and disabled=true. With the global toggle off, edited the on item to
   `Pleese reply ON_EDIT_TWO only.`: it became `Please...` and stayed disabled=false.
3. Keyboard-dragged the last queued row above the first with Space / ArrowUp / Space. Durable inbox
   order changed. Replacement IDs retained text, disabled snapshot and processed fingerprint.
   No Corrector final-send request occurred during the settled reorder interval.
4. Undid and resent the off item while global Corrector was on. It retained `Pleese...` and
   disabled=true. The on-item undo/reload/resend path retained disabled=false while global off.
5. Unchanged corrected resends had a processed fingerprint without manufacturing a new changed
   original. Edited on input got its own new original, rather than carrying the pre-edit original.
6. Steer was verified with an image-bearing queued prompt: durable delivery changed from queue to
   steer while payload and metadata remained intact.

Evidence: `corrector-queue-initial.json`, `corrector-queue-off-edit.json`, `corrector-settled.json`,
`corrector-reordered-final.json`, `corrector-off-undo-resend.json`, and `corrector-audit.json`.

Some early script snapshots used fixed waits and captured pending correction rather than settlement.
In particular `corrector-queue-{on-edit,reordered,undo-resend,steered}.json` are intermediate, not
independent pass evidence. Settled snapshots above and the subsequent attachment workflow used
actual inbox polling and confirm the outcomes.

## Attachments, mentions, and generated context

- Uploaded real `triangle with spaces.png` through Android's DOM file input. Inserted `@explore`
  using the actual suggestion menu, appended typo-containing prose and sent it.
- Stored parent input corrected only prose; `@explore` remained exactly at its structured range.
  The filename stayed `triangle with spaces.png`; decoded image bytes matched the original file.
- Repeated with a queued image-bearing prompt. While global Corrector was off, edited the queued
  on prompt, undid it, reloaded its draft, resent and steered. Every admitted stage retained identical
  PNG bytes, filename, agent identity/mention substring and disabled=false. The restored editor
  contained the structured noneditable agent chip, not merely plain `@explore` text.
- API multi-range admission included two `@explore` mentions plus `@file.txt`, with an inline text
  attachment and generated suffix. Each final mention's adjusted start/end sliced the exact original
  mention; text attachment bytes were identical and suffix remained byte-for-byte unchanged.
- API-seeded UI queue input with an authored prefix and
  `\n\nGENERATED_CONTEXT: pleese dont corect this suffix.` survived queue edit. A second such item
  survived Undo → WebView reload → Send while global Corrector was off; its old on snapshot remained
  false and the suffix remained generated/unmodified in stored and final model input.

Evidence: `corrector-attachment.json`, `corrector-attachment-ui.log`,
`corrector-attachment-queue.{json,log}`, `corrector-edges.json`, `corrector-audit.json`.

Quality limitation observed in the real multi-mention API case: independently corrected fragments
produced `Please check. @explore And @file.txt And @explore.` from
`Pleese check @explore and @file.txt and @explore.`. Mention protection/offsets and meaning survived,
but treating fragments as standalone prose creates awkward punctuation/capitalization. Changing
that correction-context strategy is a product/algorithm follow-up, not claimed fixed here.

## Real backend edge and cancellation checks

- Exactly 600 trimmed characters: Corrector executed and accepted changes; original and fingerprint
  recorded. At 601: original text retained, with no changed-original metadata and no Corrector request.
- Already-correct `Please reply with OK.`: unchanged, fingerprint present, no changed original.
- Explicit empty authored ranges: generated-only text unchanged, no correction child/request.
- Interrupted child fallback: observed child `ses_efa450854ffeLBsWsex7geku8T`, called its public
  interrupt API (`interrupted:true`), and awaited parent admission. Original typo text was admitted
  with a processed fingerprint but no changed original. Child list was empty before admission
  response inspection completed.
- HTTP operation abort: observed child `ses_efa4b9c2fffekrxCN4Z8Bp8g3B` while the prompt request was
  pending, then aborted that request using AbortController. Client got AbortError. Six seconds later
  the parent had zero messages, zero inbox entries and zero children. Child had deny-all permissions,
  correct role/owner/bare/disabled metadata. This is **not** parent Stop's known idle pre-admission no-op.

Evidence: `corrector-edges.json`, `corrector-child-failure.json`, `corrector-http-abort.json`.

## Final provider request inspection

Audited 22 Corrector final HTTP request dumps created during these own-session workflows. Each had
the copy-editor instructions, exactly one raw user input and zero tools. Protected agent mentions,
PNG attachment data and generated suffix were not sent as Corrector input. Normal main requests
contained corrected on text, uncorrected off text, preserved images and generated suffix.

Representative files in `request-dumps/integrated-2`:

- `1791096948782-41a6a44c-d214-47fc-b8e5-0939a0adabc1.json`: on-item edit despite global off.
- `1791097070591-f8e8cdf1-52d4-4121-8de2-39f885b81ab4.json`: explicitly aborted Corrector operation.
- `1791097300221-79a30a95-0d02-4664-b186-39c899acd030.json`: queued image/mention prose edit only.
- `1791097429089-4d4bb964-4a46-4628-b9ae-ea3f8d565d05.json`: main request includes preserved suffix
  and images, corrected on history and uncorrected off history.

Machine-readable summaries: `corrector-audit.json`, `corrector-main-dumps.json`. The audit script
asserted bytes, ranges, suffixes, metadata, dump isolation and final empty child/inbox state against
live records; it is scratch acceptance tooling, not a repository unit test.

## Remaining / integration handoff

1. **Transient deleted-child toast:** evidence `corrector-suffix-status.log` lines 50–51. Matching
   child final request is `1791097363073-c35e122f-7013-497a-8982-6f4ee84b87fe.json`. UI's shared
   `packages/app/src/runtime/server/runtime.tsx` createData `onError` emits this generic toast;
   exact fetch/event race has not been traced. Parent admission succeeded. Shared client data/
   auxiliary visibility handling is master-owned; no blanket 404 suppression or architecture change
   was introduced by this bounded worker.
2. No live forced expansion/answer rejection, explicit bad model/variant, legacy `small_model`, title
   override precedence, standalone run, debug retention/concurrent Locations, skill mention, comment
   UI, or failed-send/retry transport restoration case was exercised in this pass.
3. App-process relaunch persistence remains unverified here; WebView reload persistence passed.
4. Parent Stop before admission remains the previously documented idle no-op limitation; crash-orphan
   cleanup remains outside the feature. HTTP admission abort and child cleanup are now verified.

Browser/device ownership is released. Corrector is on, timeline Compact, zoom 100%, and all owned
sessions are idle. No rebuild is requested by this worker because no source patch was made.
