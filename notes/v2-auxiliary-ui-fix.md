# Auxiliary deletion / UI refresh race — 2026-10-04

## Status

**Fixed in source and verified in the real Android WebView using the Vite source frontend against
the existing development server. The installed APK still contains the old client code.** Master
must rebuild/reinstall the development APK before marking packaged-client acceptance complete.

Owned production change: `packages/client/src/solid/data.ts` only. No protocol, API, persistence,
server, editor, dependency, or generated-client changes. The existing mobile newline fix is intact.
No builds, server restarts, low-level tests, commits, or daily-service actions were performed.

## Exact cause

Original acceptance evidence:

- `/tmp/tandem/v2/corrector-suffix-status.log`, lines 50–51.
- Child `ses_efa4725aeffePBxF2JU8Flmgr3`.
- `/tmp/tandem/v2/request-dumps/integrated-2/1791097363073-c35e122f-7013-497a-8982-6f4ee84b87fe.json`.

The old screenshot/log alone did not identify the triggering fetch. This pass reproduced the
defect with real model-backed Corrector admissions and captured Android CDP network initiators,
event-handler observations, and visible UI text in `/tmp/tandem/v2/auxiliary-trace.json`.

Sequence:

1. `session.created` causes `createData.handleEvent` to invalidate and fetch child metadata.
   This initial `GET /api/session/<child>` succeeds.
2. `session.execution.succeeded` updates local idle state, invalidates the same metadata, and
   immediately starts another `result.session.sync(child)` request.
3. The Corrector has already obtained its result. Its scoped release in
   `packages/core/src/plugin/tandem/prompt-corrector.ts`, `correct()` (around lines 102–149),
   removes the child before parent admission returns. This is successful cleanup.
4. The UI receives `session.deleted` and `removeSession` clears the child from its stores.
   Previously this did not retire the background refresh's error reporting or prevent a late
   successful metadata response from writing the child back.
5. The completion-triggered metadata GET returns typed `SessionNotFoundError` / HTTP 404.
   `refresh` passes it to `config.onError`. The app's
   `packages/app/src/runtime/server/runtime.tsx:createServerController` turns that into
   `Request failed / Session not found: <child>`.

One captured example, timestamps in epoch milliseconds:

| Observation | Time |
| --- | ---: |
| Child `ses_efa3b3aa3ffeP1jMONGl0Zr7wR` execution succeeded | 1791098149176 |
| Same child's deletion delivered to the data handler | 1791098149179 |
| Metadata GET returned 404 | 1791098149183 |

The GET's CDP initiator is `solid-DuZWQ34a.js`, the execution-terminal handler's call to
`session.sync`, not a parent prompt request. The captured bundle is
`/tmp/tandem/v2/auxiliary-solid-bundle.js`; the completion refetch appears around character 18615.
Events were observed with a conditional debugger logpoint, without changing their payloads.

## Fix and boundaries

- Event-driven session-info refreshes carry their session ID and temporarily observe deletion.
  Their error handler ignores **only** a typed `SessionNotFoundError` whose `sessionID` matches
  that refresh, **and only if a deletion event was observed while the refresh was pending**.
- Metadata synchronization also observes deletion while its HTTP read is pending. A successful
  response for that deleted session is discarded rather than restoring its metadata/family entry.
- Both temporary subscriptions are removed when their operation settles. There is no permanent
  deleted-ID registry or auxiliary-specific exception in the UI toast formatter.
- Explicit reads retain their rejection behavior, including reads sharing an in-flight sync.
  Other errors and unknown/missing roots without a matching deletion still surface.
- The same lifecycle rule applies to created, renamed, viewed, execution-terminal, and worktree
  metadata refreshes. It requires no changes to auxiliary metadata or visibility policy.

This handles the observed ordering: deletion arrives before the failed read settles. It does not
delay every 404 in anticipation of a possible future deletion. The late-success guard was reviewed
and typechecked but was not separately forced with a delayed HTTP response.

## Real verification

`agent-browser` was unavailable. Used the existing Playwright connection to Android CDP 9224,
development APK process 28156, and the unchanged backend on port 4098 (PID 659).

### Installed-client baseline, before edits

- Captured the existing idle Corrector acceptance session, its visible text, URL, navigation
  performance entries and DOM count. Initial screenshot: `/tmp/tandem/v2/auxiliary-baseline.png`.
- Three bounded `resume:false` admissions through the real API; each invoked the real Corrector.
  Each returned corrected parent text, then its admitted inbox item was explicitly cancelled.
- All three produced a child-cleanup 404 and a visible failure toast.
- Baseline record: `/tmp/tandem/v2/auxiliary-trace.json`; driver: `auxiliary-trace.ts`.

### Patched source frontend

- Ran the existing app with Vite on temporary port 5174, explicitly configured with
  `VITE_OPENCODE_SERVER_HOST=127.0.0.1 VITE_OPENCODE_SERVER_PORT=4098` and pinned Bun 1.4.2.
  Connected using the saved development credential without printing it.
- Navigated the same Android WebView to the real source app. The final run used a full navigation
  after HMR, with the same existing acceptance session visible as in the installed-client baseline.
- Final source run: three real Corrector admissions, three typed cleanup-race 404s, **zero visible
  failure toasts**, and all three parent inputs correctly admitted. All admitted items cancelled.
- `/tmp/tandem/v2/auxiliary-source-trace.json` contains request origins, statuses, parent payloads,
  UI snapshots, and final empty child/active state. This is the final source version including
  exact error/session-ID matching.
- Child metadata request count was unchanged: six GETs for three children before and after
  (creation + terminal refresh). CDP-observed request/response intervals were 1 ms median for the
  installed baseline and 4.5 ms for Vite. These different builds/origins are not a controlled
  rendering-performance comparison; no timeline performance acceptance is claimed.
- Navigated directly to a now-missing session in the source app. It displayed **“This session
  cannot be found”**, its session ID, and Close Tab. Evidence:
  `/tmp/tandem/v2/auxiliary-missing-root.log`. No missing-root suppression was introduced.
- Focused `bun typecheck` in `packages/client` passed after the final edit:
  `/tmp/tandem/v2/auxiliary-typecheck.log`.

Browser-reader cleanup uses the same client metadata lifecycle and scoped removal
(`packages/core/src/plugin/tandem/browser-fetch/plugin.ts`), but a new browser-reader model run
was not performed in this pass. Do not treat this as separate browser-reader acceptance.

## Rebuild / packaged verification recipe

1. Master schedules the documented isolated development APK build/install, including this client
   source change and the already-existing editor fixes. A backend rebuild/restart is unnecessary
   for this client-only fix. Do not update the daily APK or service.
2. Reconnect Android CDP to the installed development APK; enable network capture. Leave Corrector
   on and observe a normal parent session. Use a fresh bounded parent for the following admissions.
3. Submit several typo-containing prompts with `resume:false` through the public API (or use the
   actual composer for a bounded normal reply). Confirm corrected parent text is admitted and
   auxiliary children are deleted. Cancel any admit-only inbox items afterward.
4. Confirm metadata GETs racing cleanup may still return 404, but no failure toast is shown for
   those known-deleted children. Capture network initiators and visible UI text, not just API success.
5. Navigate to a genuinely missing session: the missing-session UI must remain visible. Also confirm
   normal parent metadata/timeline updates still work and no deleted child reappears in the family.
6. For broader auxiliary acceptance, repeat with a bounded browser-reader fetch and its cleanup.
7. Audit owned sessions for empty inbox/children and idle execution; restore the user's view/settings.

The scratch trace driver references the old bundle filename for its installed-client debugger
logpoint; update that filename/handler offset for a rebuilt APK rather than blindly rerunning it.

## Final ownership / cleanup

All five created roots are idle with empty inboxes and no children:

- `ses_efa3d7955ffebO6443TdlKF4W6` — first diagnostic admission.
- `ses_efa3b3abeffe5jXBW01k7Cw66k` — recorded installed baseline.
- `ses_efa3619efffelzNOVitPT9S7pC` — initial Vite verification.
- `ses_efa343eaaffetWuPP5VSVQgGXz` — post-edit HMR verification.
- `ses_efa32f24affeOtspQnI7V33nmY` — final full-navigation source verification.

Audit: `/tmp/tandem/v2/auxiliary-final-audit.json`; global active response was `{ "data": {} }`.
The initial diagnostic driver stopped when it tried to JSON-decode an empty successful DELETE
response; the final audit confirms its input was cancelled. Later runs handle empty responses.

Restored the original APK URL and idle acceptance session. Its Corrector / Compact / zoom settings
were not edited. Returning from the external Vite page initially left the APK shell loading with
HTTP timeouts despite a healthy backend. A Home → existing development activity foreground/resume
cycle followed by navigation to the original URL restored the real session and composer; no process
restart was used. Evidence: `/tmp/tandem/v2/auxiliary-restored-ui.log`. Stopped only the owned Vite
processes. **Android/browser runtime ownership is released.**
