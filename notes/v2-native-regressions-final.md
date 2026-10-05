# Packaged native regressions — PASS

2026-10-04. Both assigned blockers are fixed and verified in the rebuilt, installed **Tandem V2** APK using real Android keyboard input, volume-key zoom, rotation and touchscreen swipes. This supersedes the two failures in `v2-packaged-android-acceptance.md`; it does not expand that note's other acceptance claims.

## Source changes (only two application files)

### `packages/app/src/composer/editor/editor.tsx`

The old native sizing `onMount` read a plain `viewport` variable once. `ScrollView` calls its `viewportRef` from **its own `onMount`** (`packages/ui/src/components/scroll-view.tsx:234–237`), so the editor could skip observation before that callback supplied the viewport. The real failing DOM had the expected composer/dock ancestors but no inline max-height.

Added a single viewport-readiness signal, set by the existing `viewportRef` callback. The sizing observer now runs in a `createEffect` depending on that signal; the existing native delete-word listener remains in its own mount hook. Retained the same measured panel/dock/scroll height calculation, 60px minimum, 180px maximum, animation-frame scheduling, caret reveal and observer cleanup. **No sizing constants or native inset calculations changed.** After packaging, the exact previously absent cap appears as **122.969px** in landscape 150% with IME open.

### `packages/gui-extensions/src/terminal/terminal.tsx`

Ghostty renders scrollback on canvas; it has wheel/mouse handling and tap-to-focus but no corresponding one-finger scrollback handler. Added native touch listeners in the existing imperative UI-binding lifecycle:

- Track one touch identity, vertical travel and fractional-row remainder; wait for 6 physical CSS pixels of movement before claiming a swipe.
- Convert travel through actual rendered canvas height / terminal rows, accounting for CSS zoom, and call the installed Ghostty **public `scrollLines(amount)`** API. Negative amounts reveal older rows; verified against `ghostty-web/lib/terminal.ts:937–965`.
- A nonpassive touchmove prevents outer-WebView panning; a capture-phase touchend suppresses Ghostty's tap focus and synthetic clicks only after a swipe.
- Touch pointerdown defers focus to the existing stationary-tap path, preventing a swipe from opening the IME. Mouse pointerdown/focus, wheel, link, selection and clipboard handlers remain intact. Stationary taps/long presses are not intercepted by the new scroll handler.
- All four listeners are removed by the existing cleanup lifecycle.

Retained previous newline/mention parsing, Corrector, clipboard fallback, reactive terminal visibility, bounded ticket retry and auth fixes. No public API, dependency, shared host, theme or backend edits.

## Built and installed artifact

Command, run serially under explicitly assigned APK ownership:

```sh
PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH" bun script/build-tablet-android.ts
```

- Build output: `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- Retained exact artifact: **`/tmp/tandem/v2/native-regressions.apk`**
- SHA-256: **`6009b5928a0990be3ddf97edab568e5a41f262a3078c33694a098839f372d954`**
- Build metadata verified application ID **`app.liddokun.tandem.v2`**.
- Pulled the preinstall V2 `base.apk`; `apksigner verify --print-certs` on both old and new APKs returned the same signer SHA-256 **`a8f08f56dd63ea66d5e14eafd3ab0108d105d2198817cedaf9d9a6dcb79d1c5a`**.
- Installed with V2-only **`adb install -r`**, no uninstall/data wipe. Success.
- Actual packaged origin **`http://tauri.localhost/`**, loaded entry **`index-DPpjYKUn.js`**, replacing baseline `index-B5ulejR7.js`.
- V2 process changed **2766 → 20088**; refreshed Android-only CDP **9224** to `localabstract:webview_devtools_remote_20088`.
- Existing backend **4098 / PID 14283** was checked and remains running. No CLI/backend/prod build or restart. Desktop CDP 9223 was never accessed.

## Composer native results

Before editing/building, reproduced and captured the existing failure: Send bottom **382.36** > visual bottom **373.45**, hit **false**, scroll height **180px**, inline max-height absent. Fresh baseline workflow time **266ms**, alongside prior **269ms / 281ms** samples.

Final matrix used native taps to open the keyboard, native Enter/beta, native volume-key zoom and native rotation. No CSS injection or source/dev-server substitution. Bounds are physical CSS pixels; all rows had visual viewport offset **0** and Send center hit **true**.

| Keyboard-open case | Viewport bottom | Caret bottom | Send bottom | Editor cap | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Landscape 150%, 14-line long draft + Enter/beta | 373.45 | 277.37 | 328.45 | 122.969px | Pass |
| Landscape 150%, short draft + Enter/beta | 373.45 | 264.91 | 328.45 | 122.969px | Pass |
| Landscape 100%, long draft + Enter/beta | 373.45 | 309.45 | 343.45 | 180px | Pass |
| Portrait 80%, long draft + Enter/beta | 801.82 | 750.33 | 777.82 | 180px | Pass |
| Portrait 100%, long draft + Enter/beta | 801.82 | 737.82 | 771.82 | 180px | Pass |
| Portrait 150%, long draft + Enter/beta | 801.82 | 705.64 | 756.82 | 180px | Pass |

- Native **alpha → Enter ×3 → beta** produced `alpha\n\n\nbeta`, with the terminal caret-tail BR after the Enter sequence. Exact text survived landscape→portrait rotation and packaged reload.
- Selecting the real **@general** suggestion produced the noneditable agent mention span. Mention + two native newlines + beta survived reload with the same mention metadata.
- No layout/mention draft was submitted. Owned session remained zero-cost/zero-token with empty inbox and no children.
- First post-build timing sample was **361ms**. Because that differed from baseline, repeated the same fill → Control+End → native Enter → native beta workflow: **300ms, 258ms, 289ms**, excluding settle wait. Median repeat **289ms**, +23ms vs fresh 266ms / +8ms vs prior 281ms. These few live samples do not establish a statistical performance change; the clipping regression is fixed in every retained keyboard-open sample.
- An intermediate Playwright `editor.click()` attempted to center the entire clipped long editor and panned the page before timing out. Its keyboard-hidden landscape samples were discarded. The final matrix instead taps inside the visible scroll viewport with ADB and explicitly rejects keyboard-hidden cases; native screenshots accompany all six passing cases.

## Real terminal native results

Owned session **`ses_ef909278bffekz1yP3qLveno40`**, directory **`/tmp/tandem/v2/terminal-acceptance`**. Owned PTY **`pty_106f81612001YQBEuMM6FikSAu`**, `/bin/bash -l`, PID **18339**.

1. Before changing terminal source, executed real keyboard command `pwd; printf 'NATIVE_SCROLL_%03d\n' {1..180}` with native Enter. Native screenshots before/after a downward swipe remained at **150…180**. This captured the actual scrollback failure, not synthetic output.
2. APK replacement and packaged reload reattached to that **same PTY and PID**, retaining real output and terminal opacity **1**.
3. After reload, native downward swipe exposed **108…153**; three further bounded swipes exposed **030…075**, including **035**. Screenshot `native-terminal-earlier.png` is the decisive native earlier-row evidence.
4. A native drag at the canvas scrollbar edge left outer `scrollY=0`, visual offset **0**, and terminal bounds unchanged. Reverse native swipes returned toward the output bottom.
5. Native tap opened the IME; real keyboard command `printf 'NATIVE_SAME_PTY_OK\n'` plus **native Enter** executed in the same shell. Both native screenshot and real socket output contain **NATIVE_SAME_PTY_OK**.
6. With the keyboard still open, a native swipe exposed earlier **128…159** rows. Visual height stayed **801.82**, outer `scrollY=0`, offset **0**, terminal bounds unchanged and opacity **1**.
7. Final packaged reload again found the same running PTY/PID, visible at opacity **1**. Actual connect-token HTTP 200, socket output and NUL cursor frames are retained in the driver logs.

An initial postinstall screenshot captured a transient selected/doubled-looking surface; a clean reload and settled repeated native swipes supplied the accepted evidence above. No new rendering-defect claim is made from that transient screenshot. No theme matrix or initial-empty-shell prompt claim is added in this bounded pass; Appearance remained **System**, independently audited at finish.

## Checks, restoration and release

- Pinned Bun 1.4.2 `bun run typecheck` passed in **packages/app** and **packages/gui-extensions** after native verification.
- Focused `git diff --check` passed. No low-level tests, mocks, commits, credential changes or login actions.
- Cleared only the owned draft; audited empty inbox/children, closed its specific tab and deleted **only the owned session and PTY above**. Scoped PTY inventory afterward **[]**.
- Final Home: original **8 tabs**, native rotation **lock 0**, **100% zoom**, keyboard hidden, visual height **1105.45**.
- Settings audit: labeled **Corrector checked**, timeline **Compact**, Wrap lines checked; Appearance **System**.
- **Android/CDP 9224 and APK-build ownership released.** Forward remains on V2 **PID 20088**. All driver connections are closed. Backend **PID 14283** unchanged.

## Evidence index

All retained scratch/artifacts under **`/tmp/tandem/v2/`**:

- Baseline: `native-baseline.log`, `native-baseline.png`, `native-terminal-output.log`, `native-terminal-before.png`, `native-terminal-before-swipe.png`.
- Build: `native-build.log`, `android-build.log`, `native-regressions.apk`, `native-installed-before.apk`.
- Composer: `native-landscape-after.log`, `native-landscape-after.png`, `native-matrix-final.log`, `native-{landscape150-long,landscape150-short,landscape100-long,portrait80-long,portrait100-long,portrait150-long}.png`, `native-mention-terminal.log`, `native-perf-final.log`.
- Terminal: `native-touch-trace.log` (observed trusted native touch events), `native-terminal-swipe2.png`, **`native-terminal-earlier.png`**, `native-terminal-final.log`, `native-terminal-{edge,bottom,continued,keyboard-scroll,final-reload}.png`.
- Finish: `native-{app,terminal}-typecheck.log`, `native-cleanup.log`, `native-final-audit.log`, `native-restored.png`.
- Drivers: `final-android.mjs` (reused Android-only real API/CDP driver), `native-*.js`. Socket logs contain real terminal NUL/escape bytes; search with `rg -a`.
