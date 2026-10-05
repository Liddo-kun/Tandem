# Android landscape composer — source-ready handoff

2026-10-04. **Source ready; deployed acceptance pending the master's serialized APK build.** Android driving ownership is released. No APK/backend build, install, restart, authentication change, low-level test, or commit was performed. Desktop Chromium 9223 was not driven.

## Root cause, measured on the installed APK

Reproduced with the existing imagegen-settlement session, a disposable 14-line draft, native volume keys to 150%, native landscape rotation, native Enter and `beta`. The initial draft was empty; it was cleared afterward. No prompt was sent.

The native viewport owner is correct: visual viewport **373.4546px**, zoom **1.5**, `--android-viewport-height: 248.9697px`. Root physical height matches the visual viewport. Insets are already divided by zoom exactly once. This does not require another keyboard inset subtraction.

The overflow is below that boundary:

| Element | Unzoomed block size |
| --- | ---: |
| Session panel / composer dock parent | 178.970px |
| Composer editor scroll region | 180px |
| Composer form | 224px |
| Nonshrinking composer dock, including bottom padding | 236px |

The dock exceeds its parent by **57.03 layout pixels / 85.55 physical CSS pixels**. Its editor retains the fixed 180px cap even when the entire panel is smaller. Ancestor overflow clips the footer. Native caret reveal can still reveal the insertion point without revealing Send.

Actual bounds in this run: Send **y=346.36…382.36**, visual bottom **373.45**. Later stable sample: dock **y=61.36…415.36**, parent **y=61.36…329.82**. Prior worker saw Send bottom 412.55; layout/panning changes the coordinates, but both runs demonstrate the same oversized dock.

Baseline workflow time: **269ms** for fill → Control+End → native Enter → native beta (excludes the subsequent 800ms settling wait). Single live sample, not a statistical benchmark. Compare using the same `/tmp/tandem/v2/landscape-bounds.js` after deployment.

## Source change

Only this task's application edit:

- `packages/app/src/composer/editor/editor.tsx`: within the existing native-editing mount effect, observe the session panel, composer dock, and editor scroll wrapper. Limit the editor to `clamp(60, panelHeight - dockHeight + scrollHeight, 180)` layout pixels. The measured difference reserves the actual controls, attachment/queue content, and dock padding rather than introducing a guessed viewport reserve. `ResizeObserver.borderBoxSize` supplies unzoomed sizes. Schedule writes on an animation frame, then invoke the existing caret reveal. Disconnect and cancel the scheduled update on unmount.

For the measured case this reduces the editor cap from 180 to approximately **122.97px**, fitting the dock within its panel. Larger panels retain the existing 180px cap. The existing 60px editor minimum remains.

No viewport/inset owner, editor DOM parsing, terminal BR/newline insertion, mention semantics, or direction/focus order was changed. The existing native Enter/terminal-BR fix remains present. No physical left/right layout logic was introduced. Other workers' pre-existing changes in this file were preserved.

## Checks and verification boundary

- `packages/app`: pinned Bun 1.4.2 `bun typecheck` **passed**.
- Scoped `git diff --check` **passed**.
- **No post-fix live pass claimed.** A temporary Android-entry Vite server was started on 1422 and CDP routing attempted to serve its source at the original `http://tauri.localhost` origin. Tauri's packaged resource loader bypassed that interception: the page still loaded `index-_9scPd4s.js`, not the Vite entry. The empty inline editor cap confirmed the new code was not executing. This attempt is not source validation.
- A different-origin Vite navigation was not used: installed capabilities have no remote-origin grant, and native storage/IPC parity would no longer be established. Both owned temporary Vite processes and the routing helper were stopped; interception was removed and the packaged page reloaded.

Scratch evidence: `/tmp/tandem/v2/landscape-before.log`, `landscape-before.png`, `landscape-bounds.js`, `landscape-typecheck.log`, `landscape-restored.log`, `landscape-settings.log`, `landscape-final.log`. No credential/auth payload was logged.

## Serialized deployment / next checks

Master should combine this with the parallel terminal source fix, then build using:

```sh
PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH" bun script/build-tablet-android.ts
```

Use the established V2 signer verification and V2-only `adb install -r` procedure. APK path: `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Do not deploy to the daily application ID. Recheck PID and refresh CDP 9224 forwarding after the master's relaunch.

Required deployed checks:

1. Repeat landscape 150% long draft + native Enter/beta. Record editor, dock, parent, Send and caret bounds. Verify Send is both visible and hit-testable above the IME, without an ancestor scroll workaround. Compare the baseline workflow timing.
2. Short landscape 150%, long landscape 100%, and long portrait at 80%, 100%, 150%; keyboard show/dismiss and rotate with a draft. Confirm the cap grows back and caret remains visible.
3. Native Enter terminal line/BR, following beta, and persisted mention/newline regression checks. Test forced RTL/mixed content without changing locale; restore normal direction.
4. Exercise an attached image / queued prompt if available, since their actual measured height reduces editor space. Extremely small panels still retain the existing 60px editor minimum; no claim is made for arbitrary attachment stacks that alone exhaust the panel.
5. Restore original rotation, 100% zoom, Corrector on, Compact, keyboard hidden and clear only the disposable draft.

## Final state and ownership release

- Android **PID 9149**, CDP **9224**, ADB **127.0.0.1:5555**. Backend **4098 / PID 24838** still running.
- V2 at **Home**, original **8 tabs**; owned draft cleared. No sessions created/deleted by this task.
- Native rotation **lock 0**, `accelerometer_rotation=0`; zoom **100%**, visual height **1105.45**, keyboard hidden.
- Settings verified: labeled **Corrector checked**, timeline **Compact**, Wrap lines checked. No settings changed other than temporary rotation/zoom, now restored.
- Daily v1 app/server and window size/density untouched.
- **Exclusive Android device-driving ownership released to master for serialized compiled verification.** Source readiness is not deployed acceptance.
