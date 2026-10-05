# Android remaining workflows — live handoff

2026-10-04. Bounded acceptance against the already-installed signed V2 APK (editor fix + auxiliary-deletion race fix), isolated backend **4098 / PID 24838**. No builds, server restarts, authentication redo, low-level tests, commits, production changes, or application-source edits. This note is the only repository file authored by this worker; existing changes were preserved.

## Results

| Workflow | Observed outcome |
| --- | --- |
| Delete cancel/confirm | **Pass.** Native Android long-press on the owned Home session row opened its Rename / Export / Delete menu. Delete showed the named confirmation. Cancel retained the row; a second native long-press → Delete → confirm removed it. API GET returned 404 afterward, including the completed child. The in-session “More options” menu itself offered Usage / Session details; deletion was exercised through the session-row context menu. |
| Rewind and replacement | **Pass.** Sent `ANDROID_WORKFLOW_ORIGINAL_71`, received the exact response, clicked **Revert message**, immediately replaced the restored prompt and sent `ANDROID_WORKFLOW_REPLACEMENT_72`. UI and GET messages agreed: the replacement response remained and the original prompt/response did not reappear. The replacement executed successfully. This was a completed-response rewind, not interruption of an actively executing tool. |
| Attach / send / reopen | **Pass for the exercised paste-handler path.** A real PNG (`green triangle.png`, 1254×1254) entered the actual composer through a CDP-dispatched ClipboardEvent/DataTransfer. Thumbnail survived WebView reload, was sent with the prompt, and the model answered “A bright green triangle is centered on a white background.” Session was reopened later with the response intact. This is end-to-end clipboard-event injection, **not** proof of Android's native image clipboard or a physical drag/drop gesture. Native picker was already passed by the preceding worker and was not repeated. |
| Child question + background/resume | **Pass.** Real `subagent` execution created a child asking GREEN versus BLUE through the question tool. Android Home/background and V2 foreground/resume were exercised during the child work and again while the question was pending. The question remained actionable; GREEN + Submit cleared it. Child and parent completed successfully with GREEN. No pending request remained. Permission-specific and deeper-nesting variants remain unverified. |
| Page-local lost network and reconnect | **Pass for offline/reload recovery.** CDP `Network.emulateNetworkConditions` affected only the owned Android page, with `navigator.onLine=false`. An initial offline toggle left the existing stream delivering messages, so that attempt does **not** establish lost-stream recovery. Repeated with a WebView reload while offline to close the stream: backend completed marker `ANDROID_OFFLINE_RECOVERED_74` through normal API prompt/wait, marker count stayed **0 offline**, then became **1 after restoring online**, without another reload or duplicate visible response. Offline request failure was visible. Global Android networking and both servers stayed on. Server-restart and clock-skew variants were not exercised. |
| Native Android → Termux:X11 clipboard | **Pass.** Clicked the actual **Copy response** button on `ANDROID_WORKFLOW_ORIGINAL_71`, foregrounded installed `com.termux.x11`, then used read-only `DISPLAY=:0 xclip -selection clipboard -o`. First immediate read still held the preceding web worker's marker; a subsequent read after bridge synchronization returned exactly `ANDROID_WORKFLOW_ORIGINAL_71`. No xclip clipboard write was used. |
| Restricted Taobao item opener | **Pass for native dispatch.** Model rendered `[Taobao native item](taobao://item.taobao.com/item.htm?id=1)`; clicking that actual response link opened installed `com.taobao.taobao`. Screenshot shows Taobao's “商品过期不存在” (expired/nonexistent item) page. ID 1 was deliberately a harmless nonexistent item: product availability was not claimed. No purchase/login action. |
| First-use search provider picker | **Pass on Android.** Inspected isolated config and read-only SQLite `kv`: **no `websearch:provider` row** before starting. Normal composer prompt asked for official Python 3.14 release notes using websearch. The real “Third-party web search” card appeared. Opened **Any**, explicitly selected **Exa**, clicked **Enable**. Actual websearch completed (first query returned no results, model's follow-up query returned the official release notes), final URL `https://docs.python.org/3/whatsnew/3.14.html`. Read-only DB check afterward showed `websearch:provider = "exa"`. No default seeding or credential change. Selection intentionally remains persisted in isolated V2. |
| First-use picker on web | **Pending deployment.** CDP 9223 was not driven. Existing plain-HTTP integrated frontend still needs the already-documented fetch/Basic-challenge fix from `v2-web-http-live.md`; no repeat diagnosis. Android now persisted the server's provider choice, so this same server is no longer an unconfigured first-use web environment. Do not silently clear that choice or claim web picker acceptance. |
| Empty review | **Pass.** Non-Git acceptance workspace showed “No tracked changes” / “Track, review, and undo changes in this project” / “Create Git repository”; remained usable. No repository creation was triggered. |
| Ordinary and large review | **Pass for actual worktree aggregate / expand-collapse.** Separate read-only UI session on `/home/jon/code/Tandem-v2` showed real aggregate **+16,245 / −782**. Opened `.gitattributes` and `bun.lock`; their diffs rendered. Expand all completed and Collapse all remained responsive; sample elapsed 3,039 ms **includes a fixed 2,500 ms wait**. Seven diff containers were mounted in that viewport (virtualized rendering, not an inferred cap). This is not an exhaustive inspection of every file or a benchmark. Error-state review was not deliberately induced. |
| Touch inline file comment | **Pass.** Native ADB tap on `.gitattributes` line-8 gutter opened the comment editor. Native tap/text input/tap submitted `ANDROID_TOUCH_COMMENT_75`; UI showed the comment and “Comment on line 8”. This stayed in the disposable review session; no model prompt or source-file change was sent. Review session was deleted afterward. |
| Terminal scrollback | **Blocked: blank terminal.** Actual Terminal tab created `Terminal 1` / PTY `pty_106086f490014kfG3AHc1B9Hxo` (bash PID 18830), reported running by the API. Terminal canvas stayed blank after keyboard typing of a bounded 180-line `printf` and after WebView reload. Native scrollback drag therefore could not establish scrolling. Closed the owned terminal through its UI; final PTY list for the workspace was empty. No speculative terminal fix. |

## Rotation / zoom: demonstrated gap

Native temporary `cmd window user-rotation lock 1/0`, native volume keys, SwiftKey opening/dismissal, and native Enter/text input were used. No permanent orientation setting was left changed.

- Portrait at 100% and 150%: long-draft caret stayed above IME; title button stayed at y≈39, height 28 / 42. Dismissing IME restored visual height ≈1105.45.
- Landscape at 100%: long-draft caret stayed visible; Send bottom **343.45** was inside visual height **373.45**. Dismissing IME restored visual height ≈692.36.
- Landscape at 150%, **short draft**: Send bottom **328.45**, inside visual height **373.45**.
- **FAIL: landscape at 150%, 14-line draft plus newline/beta.** Caret bottom ≈362.82 remained visible, but Send occupied **y=376.55…412.55**, below visual height **373.45**. Native screenshot confirms the composer footer/Send is hidden by IME while the native/top tab bar remains visible. This is specifically a long-composer/available-height failure, not a typing-order failure.
- No shared app/editor/viewport source was changed. Master should assign this demonstrated layout issue, coordinate the shared composer/viewport ownership, then schedule a deployed-APK recheck. A source-only change would not establish acceptance.

Long-conversation scroll stability, horizontal multi-attachment-strip touch dragging, physical-keyboard hardware, native image paste/drop, the RTL locale matrix, provider safety rejection, and review-error presentation remain unverified in this bounded task.

## Sessions and settlement

- `ses_efa0309f5ffelsYnjoGpsPpIeR` — **V2 Android workflows owned**, normal API-created root in `/tmp/tandem/v2/acceptance-workspace`; all user workflows sent through the Android composer except the explicit offline-recovery prompts admitted through normal API while page offline. Succeeded, then deleted through native-menu/UI confirmation.
- `ses_ef9fbd1b8ffehX2P0vbKyleFms` — real question child; succeeded with GREEN, then removed with parent deletion.
- `ses_ef9f5ea15ffexQChJA5dxtREcs` — **V2 Android review owned**, UI-only root on the real V2 worktree; no model execution/source edits. Deleted through UI confirmation.
- Final GET for all three returned **404**. Final `/api/pty` scoped with `location[directory]=/tmp/tandem/v2/acceptance-workspace` returned **[]**. Existing unrelated sessions/tabs were preserved.

## Evidence

Scratch evidence remains under `/tmp/tandem/v2/` (not committed):

- `workflows-live.ts` plus `workflow-*.js`: Node/Playwright CDP helper and the actual bounded workflows, based on preceding `ui-live.ts` / `editor-live.ts` helpers.
- `workflows-delete-cancel.log`, `workflows-delete-confirm.log`, `workflows-delete-native-final.log`: dialogs, cancellation retention and confirmed row removal.
- `workflows-rewind-visible.log`, `workflows-rewind-messages.json`, `workflows-replacement.log`: visible and server history after rewind/replacement.
- `workflows-final-messages.json`: complete real root message evidence before cleanup, including image, successful Exa call and completed subagent metadata.
- `workflows-search-start.log`, `workflows-search-result.log`, `workflows-image-send.log`, `workflows-reopen.log`.
- `workflows-offline.log` distinguishes the insufficient first attempt; `workflows-offline-reload.log` records genuine disconnected-page recovery (**0 → 1** marker).
- `workflows-child-resume.log`, `workflows-copy.log`, `workflows-taobao-click.log`, `workflows-taobao.png`.
- `workflows-review-{open,small,large,expandall,dom}.log`; live touch-comment result also captured in the expand-all log.
- `workflows-terminal.log`, `workflows-terminal-{bottom,drag,reload}.png`, `workflows-terminal-{reload,close}.log`.
- `workflows-rotation.log`, `workflows-landscape.log`, `workflows-landscape.png`, `workflows-restored.log`, `workflows-settings-final.log`.

## Restored state and release

- V2 foreground at **Home**, original **8 tabs**, empty owned drafts removed with disposable sessions.
- **Zoom 100%, Corrector on, timeline Compact**, normal document LTR, keyboard hidden, online. Corrector verified via checked labeled input; Compact visible in Preferences. Wrap lines remained on.
- Initial/final Android settings match: `accelerometer_rotation=0`, `user_rotation=0`, `cmd window user-rotation` → **lock 0**; physical size **1904×3040**, density **440**. No multiwindow/size/density changes were made.
- Android final PID **9149**, CDP **9224** forwarded to `localabstract:webview_devtools_remote_9149`. Initial PID 24924 exited after an early native Back/Home-level navigation; the subsequent ordinary activity launch returned PID 9149. No force-stop, reinstall or deliberate process kill was issued. Saved connection recovered without reauthentication.
- Backend **4098 / PID 24838** still running. Daily v1 APK/server 4097 untouched. Browser 9223 and pending plain-HTTP frontend unchanged.
- **Exclusive Android/browser-driving ownership released.** No build or deployment requested/performed during this run. Next work: assigned investigation of landscape long-composer footer and blank terminal, integrated web deployment/picker acceptance, and the explicitly unverified variants above.
