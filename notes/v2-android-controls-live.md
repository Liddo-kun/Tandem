# V2 Android editor / native controls — live acceptance

2026-10-04. Bounded device task in `/home/jon/code/Tandem-v2`; exclusive device and serialized APK build ownership supplied by master. No CLI/server build or restart, production APK install/force-stop, model calls, or low-level tests.

## Root cause and fix

The failed Enter check was **not a Playwright `type()` artifact**. Before edits, both CDP Enter/type and `adb shell input keyevent 66` followed by `input text beta` produced `Android newline alphabeta\n` instead of `Android newline alpha\nbeta`.

Event/selection capture showed:

1. Starting text node caret offset 21.
2. Enter inserted an actual `\n`; selection became editor DIV offset 2 with a zero-sized range rectangle.
3. The following trusted `beforeinput` still saw that selection, but Chromium's native insertion placed the character before the trailing newline. The synthetic input handler was not removing the newline.

Changes confined to `packages/app/src/composer/editor/{editor.tsx,dom.ts}` on top of the existing mobile-edit implementation:

- Keep the caret at the inserted newline text node's end; supply a marked terminal BR for Chromium's final line box in the **same parent block**. This also handles browser-generated nested DIVs.
- Reuse Chromium's existing terminal placeholder BR after clearing an editor, rather than introducing an extra persisted newline.
- Restore the terminal line box when rendering a draft ending in a newline.
- Ignore the marked BR in prompt parsing, editor text, and logical selection lengths; mention spans retain their metadata/atomic boundaries.
- Use the terminal line-box rectangle for caret reveal when Chromium reports a zero-sized collapsed range. Long-editor Enter now scrolls to the new blank line before subsequent typing.

The marker is a runtime editor placeholder, not draft content or a testing hook. Chromium may consume it on subsequent insertion. Its `innerText` can include a presentation-only terminal newline; persisted prompt text excludes the marker.

## Real checks on the final signed APK

| Check | Result |
| --- | --- |
| Original `fill → End → Enter → type beta` workflow | Pass: `Android newline alpha\nbeta` |
| Native Android Enter + native text input | Pass: same exact two-line result; no send |
| SwiftKey onscreen Enter then onscreen B, driven by ADB taps | Pass: `Android IME alpha\nB`; B capitalization came from IME |
| Three native Enter presses then beta | Pass: `alpha\n\n\nbeta` |
| Mid-text Enter and selected-word replacement | Pass: following text retained and next typed character goes after newline |
| 18-line editor with browser-created DIVs | Pass: native Enter then beta produces final `line 17\nbeta`; terminal line/caret revealed in scroll viewport |
| Native Ctrl+Backspace (`input keycombination 113 67`) within `bravo` | Pass: `alpha bravo charlie` → `alpha charlie`; caret offset 6; next X yields `alpha Xcharlie` |
| Real suggestion-picked `@explore` + native Ctrl+Backspace | Pass: entire noneditable mention deleted, no partial label left |
| Mention + native newline + beta, then reload | Pass: mention remains noneditable with agent/name metadata; newline and beta preserved |
| Two Enter presses in empty editor, then reload and typing | Pass: exactly two persisted newlines; next input follows them |
| Mixed Arabic/English and English with forced document RTL | Pass: logical newline/typing order preserved; document direction restored afterward |
| Native volume-down/up clamp and step | Pass: 80% minimum, 80→82%, 150% maximum, including presses beyond both limits |
| Zoom persistence | Pass: 150% after WebView reload; 112% after V2 process force-stop/cold launch with a 2-second save-settle wait |
| Basic keyboard/composer insets | Pass in current portrait viewport at 80%, 100%, 102%, 150%; caret/editor remained above IME; keyboard dismissal restored full height |

At 100%, visual viewport height changed from about 1105.45 CSS px to 801.82 with SwiftKey shown. The two-line editor ended at y≈737.82; typing caret bottom≈729.45. At 150%, editor bottom≈705.82. Long-editor caret bottom≈737.82 after typing. Keyboard dismissal restored visual height≈1105.45.

**Unverified:** spoken IME dictation (SwiftKey is installed and microphone affordance is present, but no actual spoken input was available); physical external keyboard hardware, landscape/rotation, other IMEs, and the full RTL-locale matrix. Native key injection and actual onscreen key taps are distinguished above. Broader provider/image UI acceptance remains with master.

An immediate force-stop directly after a volume key did not retain the last step. With the save allowed to settle, 112% survived cold launch. This task did not change zoom persistence code.

## Benchmarks

Same installed production-bundle session workflow, `ses_efa948758ffeCT7sSxxpfvTwNX` (imagegen-settlement):

| Workflow | Before | After |
| --- | ---: | ---: |
| Fill `Android newline alpha`, End, Enter, type beta, DOM snapshots (102%) | 579 ms | 603 ms |
| Search sessions → imagegen-settlement → Prompt available | 700 ms (master handoff) | 431 ms (final install); 528 ms after final cold persistence check |
| Native cold activity launch | 97 ms (master handoff) | 73 ms final cold relaunch; earlier final-APK launches 96–267 ms |

These are single live samples, not statistical performance claims. The typing workflow includes CDP/snapshot overhead and keyboard visibility transitions. No substantial timing conclusion is warranted from the 24 ms difference.

## Build and evidence

Built serially with pinned Bun 1.4.2:

```sh
PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH" bun script/build-tablet-android.ts
```

Verified signer before each `adb install -r`; only the development APK was installed. Final APK:

- `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`
- Application ID `app.liddokun.tandem.v2`, version `2.0.22`, versionCode `2000022`.
- Signing certificate SHA-256 `a8f08f56dd63ea66d5e14eafd3ab0108d105d2198817cedaf9d9a6dcb79d1c5a`.
- Focused `packages/app` `bun typecheck`: passed. Scoped `git diff --check`: passed.

Evidence under `/tmp/tandem/v2/`:

- `editor-live.ts`: live Playwright/CDP + native ADB workflow driver. Run with `node --experimental-strip-types`; the initial Bun 1.3.14 CDP WebSocket attempt timed out, while Node 22 worked.
- `editor-baseline.log`, `editor-final.log`: before/after DOM, selection, range geometry and event streams, including native trusted events.
- `editor-controls-final.log`, `editor-ime-final.log`, `editor-persistence.log`: final-APK control/IME/draft checks.
- `editor-zoom-final.log`, `editor-zoom-cold-before.log`, `editor-cold-persistence.log`, `editor-zoom-reset.log`: zoom range, reload/cold persistence and reset.
- `editor-open-final.log`, `editor-build-driver-final.log`, `android-build.log`, `editor-typecheck.log`.
- `editor-final-state.log`, `editor-final-state.png`: final editor/viewport and ADB screenshot.

## Final state / handoff

- V2 foreground, PID **28156**, activity `app.liddokun.tandem.v2/.MainActivity`.
- ADB **127.0.0.1:5555**; CDP **9224** forwarded to `localabstract:webview_devtools_remote_28156`.
- Session **ses_efa948758ffeCT7sSxxpfvTwNX** open with disposable unsent draft `Android newline alpha\nbeta`.
- Zoom **100%**, save settled; keyboard hidden. Normal document LTR restored; editor uses its normal auto direction.
- API server **4098 / PID 659** left running. Daily v1 APK/server were not installed, stopped, or restarted.
- Exclusive device/browser and APK build ownership released back to master at task completion.
