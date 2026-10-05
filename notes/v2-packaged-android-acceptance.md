# Final packaged Android acceptance — 2026-10-04

## Current result after unlock: FAIL — landscape long draft and native terminal touch scrollback

**This resumed acceptance supersedes the keyguard-blocked attempt below.** Jon unlocked Android; native policy confirmed `showing=false`, `SCREEN_STATE_ON`, `INTERACTIVE_STATE_AWAKE`. V2 was no longer running and normal activity launch started **PID 2766**; 9224 was forwarded to that PID. Backend 4098 / assigned PID 14283 was not restarted. Actual loaded packaged entry remained **index-B5ulejR7.js**.

### Composer results

All bounds below are physical CSS pixels measured from the real packaged WebView. Native Enter and native `beta` were used; volume keys controlled zoom. `hit` checks Send's center against `elementFromPoint`, without clicking/submitting the disposable layout draft.

| Case, keyboard open | Viewport bottom | Caret bottom | Send bottom | Send hit | Result |
| --- | ---: | ---: | ---: | --- | --- |
| Landscape 150%, 14-line draft + Enter/beta | 373.45 | 331.18 | 382.36 | false | **FAIL** |
| Landscape 150%, short draft | 373.45 | 240.91 | 328.45 | true | Pass |
| Landscape 100%, long draft | 373.45 | 309.45 | 343.45 | true | Pass |
| Portrait 80%, long draft | 801.82 | 750.33 | 777.82 | true | Pass |
| Portrait 100%, long draft | 801.82 | 737.82 | 771.82 | true | Pass |
| Portrait 150%, long draft | 801.82 | 705.82 | 756.82 | true | Pass |

The failing landscape run retained **180px** editor-scroll height and **224px** form height; `[data-component=composer-scroll]` had **no inline max-height**. `final-landscape-evidence.log` records full ancestor geometry and packaged script identity; `final-landscape-native.png` visibly shows the footer/Send clipped above the native keyboard. This is an actual packaged failure, not just a CDP screenshot discrepancy. Source inspection found the observer setup in the native-editing `onMount` guarded by `scroll && dock && boundary`; this pass did **not** establish which setup condition/lifecycle caused the absent cap, and made no source changes.

Same baseline workflow (14-line fill → Control+End → native Enter → native beta, excluding settle wait): **281ms**, compared with prior **269ms** (**+12ms / 4.5%**). Both are single samples, not evidence of a statistically meaningful performance regression/improvement; the functional clipping remains decisive.

Native `alpha` → Enter produced a terminal `<br data-caret-tail="">`; following native `beta` remained on the next line. `alpha\nbeta` survived landscape→portrait rotation and page reload. Selecting the real **@general** suggestion produced a noneditable agent mention span; mention plus newline/beta survived reload (`final-mention-select.log`). No draft was submitted during layout/mention checks. Initial keyboard-hidden landscape matrix samples were explicitly superseded by the keyboard-open short150/long100 measurements above.

### One integrated real Corrector workflow: PASS

- Owned parent **ses_ef91c8d6effe5vsg4TmtK6fN2W**, cwd `/tmp/tandem/v2/acceptance-workspace`.
- Composer input: `Plese run pwd with the shell tool, then reply only with the working directory. Do not modify any files.`
- Normal timeline displayed corrected **Please**, real **Shell** tool execution, and `/tmp/tandem/v2/acceptance-workspace` as the answer. Selected existing model was **Claude Sonnet 5.5**; it was not changed by this task.
- Auxiliary **ses_ef91c8343ffe8CVDpTpMr2ykHG** metadata initially returned **200**, parent prompt returned **200**, cleanup metadata returned **404**. Final rendered body had no Request failed / Session not found toast. Normal parent history remained through repeated reloads.
- Parent final outcome **succeeded**, idle, empty inbox and children before deletion. This is one normal packaged admission supplementing the user's prior packaged 3/3 race verification, not a new three-run race campaign.
- Evidence: `final-resume-corrector.log`, `final-restored.log`.

### Real Android terminal: rendering/transport PASS, touch scrollback FAIL

- Owned session **ses_ef9166546ffeDoaGuCVrgI2Xsr**, cwd `/tmp/tandem/v2/terminal-acceptance`.
- PTY **pty_106e9a22d0010qGoq2fegWirCH**, real `/bin/bash -l`, PID **9915**.
- Temporarily selected **Dark** from the real Appearance UI before opening Terminal; original **System** was restored afterward.
- Initial connect-token **200**, websocket text output and NUL-prefixed binary cursor metadata received, terminal opacity **1**. Native visual initial prompt before commands was not separately captured; initial-open acceptance is limited to transport/opacity evidence.
- Real terminal keyboard input ran `pwd; printf 'ANDROID_TERMINAL_REPLAY_%03d\n' {1..180}`. Reload reconnected to the **same PTY/PID**, replayed actual output **001…180**, and retained opacity **1**. Native screenshot `final-terminal-native.png` shows rows **136…180** and prompt in dark mode. Continued input `printf 'ANDROID_SAME_PTY_OK\n'` with native Enter executed in that same shell, confirmed by socket replay and native screenshot.
- **CDP screenshots omitted the terminal canvas** despite native screen output being present. `final-terminal-initial.png`, `final-terminal-output.png`, and `final-terminal-reload.png` are not valid evidence of native blank rendering. Native screenshots supersede them. No additional blank-rendering defect is established.
- **Touch scrollback failed:** repeated native swipes inside the foreground terminal did not expose earlier rows. The first focus opened the IME, showing final rows 150…180; a subsequent downward swipe left that range unchanged. A drag near the visible scrollbar panned the outer WebView, placing terminal content beneath the status bar, instead of revealing earlier history. A fresh reload and two further bounded swipes still showed final rows **153…180** plus the continued-input marker. Earlier-row touch acceptance cannot be marked passed.
- Native evidence: `final-terminal-scrollback-native2.png`, `final-terminal-scrollback-native3.png`, `final-terminal-scrollbar-native.png`, `final-terminal-touch-final.png`, `final-terminal-continued-native.png`. Transport/PTY evidence: `final-terminal-open.log`, `final-terminal-command.log`, `final-terminal-continue.log` (these contain real terminal escape/NUL bytes; use `rg -a`).
- An initial API diagnostic omitted the required `location[directory]` parameter and got a default-location PTY 404. Correctly scoped metadata calls all found the same live shell. This was a driver error, not a terminal failure.
- The native foreground changed to the user's daily view and later Termux:X11 during portions of this run. Those attempts/screenshots were excluded from acceptance; V2 was explicitly brought foreground before the retained native evidence. No desktop CDP 9223 connection was made.

### Final cleanup and ownership release

- Cleared disposable composer draft; both owned roots audited with **empty inboxes and children**, then their specific tabs closed and sessions deleted.
- Deleted only owned PTY **pty_106e9a22d0010qGoq2fegWirCH**; scoped inventory afterward **[]**.
- Final **Home**, original **8 tabs**, **100% zoom**, **portrait lock 0**, keyboard hidden; final viewport **1105.45**. Settings audit verified labeled **Corrector checked** and timeline **Compact**. Appearance restored to **System**.
- Evidence: `final-restored.log`, `final-restored-native.png`; a final Home reload removed stale deleted-session rows (**OWNEDROWS 0**, `final-home.log`, `final-home-native.png`). All scratch files are under `/tmp/tandem/v2`; the only checkout edit is this note. No builds, source changes, API regeneration, backend restart, low-level tests, mocks, or production action.
- **Android/CDP 9224 ownership released.** Forward points to V2 PID **2766**. Desktop 9223 remains master's.

### Remaining work for master

1. Coordinate a fix for the **non-applied dynamic landscape editor cap**; then repackage and repeat the failing long150 case and nearby matrix.
2. Coordinate **native terminal touch scrollback** handling; repeat native earlier-row evidence against the packaged APK.
3. Initial dark terminal prompt visual capture and light/dark transition matrix remain incomplete; current evidence establishes dark real-output/reload/same-PTY operation. Attachment/queued draft and forced RTL extra cases were not exercised in this bounded acceptance.

## Historical first attempt: BLOCKED by native secure keyguard

This pass does **not** establish a packaged feature pass or failure. The device's secure keyguard remains showing, native screenshots are black, and normal Playwright clicks cannot complete their animation-frame stability checks. Android requires an interactive unlock before the requested native IME/touch/visual acceptance can proceed. No application source fix is justified by this evidence.

## Artifact and connection

- Assigned artifact: `/tmp/tandem/v2/release-stage/tandem-android-v2-universal-release.apk`, already installed by master after full build/strict packaging. No build/install performed in this pass.
- Resolved `pidof app.liddokun.tandem.v2`: **14826**. Refreshed **9224** to `localabstract:webview_devtools_remote_14826`.
- Actual packaged origin **http://tauri.localhost/**, loaded entry **index-B5ulejR7.js**. No Vite/source substitution or interception.
- Existing development backend **4098**, assigned master PID **14283**, left running. Authenticated real session API reads succeeded. No public API regeneration.
- Desktop CDP **9223** was never accessed.

## Exact observations

1. Initial Home displayed Loading. A normal page reload restored real session metadata and Home content, with HTTP 200s. This alone is not a sustained startup failure.
2. Created owned session **ses_ef9d0753cffe77eABnxbijvvVh**, title `Final packaged Android acceptance`, cwd **/tmp/tandem/v2/acceptance-workspace**.
3. Attempted the first real workflow through the composer: `Plese run pwd with the shell tool, then reply only with the working directory. Do not modify any files.` Filling succeeded; Send clicks timed out waiting for visible/enabled/stable despite a resolved enabled button. **No prompt was admitted, no Corrector/model/tool execution occurred.** Pre-cleanup session remained cost 0, all tokens 0, with unchanged creation/update timestamps.
4. At rest, DOM reported `visibilityState=visible`, viewport **692.36 × 1105.45**, zoom **1**, Send **y=1051.45…1075.45**. These are **not** IME/layout acceptance results: the native display was not available. Playwright screenshot also stalled.
5. Native screenshots `final-native.png`, `final-awake.png`, `final-keyguard.png` were entirely black. `dumpsys power` showed **Asleep**. A bounded Power-key wake reached **Awake**, but returned to sleep **10,001ms** later with reason `timeout`.
6. A wake followed by `wm dismiss-keyguard` and foregrounding only the V2 activity did not unlock it. A bounded native upward swipe also did not unlock it. Window policy reported **showing=true, secure=true, mIsShowing=true, mInputRestricted=true**, including while `SCREEN_STATE_ON` / `INTERACTIVE_STATE_AWAKE`.

## Required cases remaining

All requested post-build feature checks remain **unverified in this pass**:

- Landscape 150% long draft + real keyboard; Send and caret both visible/hit-testable. Same-workflow comparison to the previous **269ms** baseline cannot be made from a blocked run.
- Portrait 80/100/150, short landscape 150, long landscape 100, rotation/draft restore, native newline/BR/beta, mention persistence.
- Packaged Android terminal initial dark rendering, 180 real output lines, reload/replay, native touch earlier-row scrollback, continued same-PTY input, theme transitions and any necessary ticket/socket/opacity diagnosis.
- Integrated normal Corrector admission and normal history; no-toast auxiliary cleanup. The user-authorized prior packaged **3/3** race evidence was not repeated or independently reclassified here.
- No low-level tests or mocks were substituted for these workflows.

## Cleanup and handoff

- Cleared the owned draft, navigated Home, deleted **ses_ef9d0753cffe77eABnxbijvvVh** through the real API, and closed its specific tab. Original **8** tabs retained. No PTYs created.
- Verified **rotation lock 0**, **zoom 100%**, visual height **1105.45**. Corrector/Compact settings were never changed; their initial assigned state was not independently rechecked through the locked UI. No keyboard was successfully opened; cannot claim a native visual keyboard-hidden check.
- No source changes, build, backend restart, production action, other app interaction, or auth/config modification. Only this durable note was added to the checkout.
- **Android/CDP 9224 exclusive ownership released.** Forward remains set to PID 14826. All driver CDP connections disconnected.
- Next prerequisite: unlock the tablet's Android keyguard, then reacquire exclusive Android ownership and rerun the bounded packaged acceptance. Do not rebuild based on this environmental blocker.

## Evidence

All scratch evidence is under `/tmp/tandem/v2/`:

- `final-android.mjs`: Android-only real CDP/API driver; no credentials printed.
- `final-initial.log`, `final-start.log`: startup and real API connectivity.
- `final-corrector.log`, `final-send.log`, `final-send-awake.log`: owned session and attempted composer navigation; click timeout details were returned by the tool shell, not redirected stdout.
- `final-inspect.log`: actual bundle filename and resting DOM bounds.
- `final-native.png`, `final-awake.png`, `final-keyguard.png`, `final-keyguard-state.log`: display/keyguard evidence.
- `final-blocked-cleanup.log`: zero-usage owned session, draft cleared, session deleted, rotation/zoom.
- `final-close.log`: owned tab closure and final Home state.
- `final-owned-session.json`: exact owned session identity; it has been deleted.
