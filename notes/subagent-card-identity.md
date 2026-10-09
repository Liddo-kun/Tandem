# Subagent card identity

Tandem UI enhancement requested on 2026-10-10.

The subagent tool still accepts its existing invocation fields. Cards now resolve the child from tool metadata or the explicit follow-up `sessionID` and display the child's current session title. If the title is not loaded, the child ID is used; the invocation description is only a fallback before any child ID is known.

A call containing `sessionID` gets a localized **Follow-up** label. Session titles use bidi isolation and shrink before the follow-up label and navigation arrow. No per-call description disclosure is shown.

Files: `packages/session-ui/src/tools/tool-renderer.tsx`, `packages/ui/src/i18n/en.ts`, and fork-owned `packages/session-ui/src/styles/tandem-tool-summary.css`.

## Verification

Scratch evidence lives under `/tmp/tandem/v2/subagent-cards/`. The before snapshot and production-build navigation baseline use the actual session from Jon's screenshot: parent `ses_edd86eae2ffeLA2vBhhrFM3VTQ`, reused child `ses_edd86ac50ffeIYoZ71aj4LPk5i`. Its two background calls previously displayed “No steering parent only” and “Parent only followup”. The benchmark alternates parent and child six times and excludes the first visit of each when computing warm medians.

Passed on the production-built Tandem Dev APK and development server (4098):

- Cold opening the parent displayed the child's title on both calls, without first navigating into the child. Only the resumed call had the Follow-up label.
- Native touchscreen taps on both cards opened the same child session.
- The initial implementation's Call details disclosure was removed at Jon's request.
- A temporary long Arabic/English child title updated both cards consistently. In LTR and forced RTL, the card and label stayed inside the viewport, while the title used ellipsis. The original title and LTR direction were restored.
- Warm navigation medians: parent 100.0 → 27.9 ms, child 100.0 → 26.4 ms. No navigation regression observed; these short device runs do not establish a general speed improvement.
- Production CLI/APK builds, post-live `bun typecheck` in `packages/session-ui` and `packages/ui`, and `git diff --check` passed.

Evidence: `after-cold.json`, `after-visible.json`, `touch-result.json`, `details-open.png`, `long-title-result.json`, `long-title-{ltr,rtl}.png`, and `benchmark-{before,after,comparison}.json`. Early screenshots caught the daily app or an Android app-switch transition; `settled.png` and `details-open.png` show the settled development app. Touch checks were performed only with Tandem Dev visible.

The changes affect presentation only. Daily Tandem was not installed or restarted, and no low-level tests were added or run.

After removing Call details, rebuilt the development CLI and APK and repeated the native-touch card checks. No disclosure or Call details label remained; the stable titles, Follow-up label and both links to the same child still passed. Evidence: updated `touch-result.json` and `without-details.png`. Both package typechecks passed again. Warm navigation medians were 52.5 ms for the parent and 49.7 ms for the child, below the original 100 ms baseline; raw results are in `remove-details-benchmark.json`.
