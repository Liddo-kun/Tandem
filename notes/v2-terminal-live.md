# Terminal blank rendering — source fix and live handoff

2026-10-04. **Source fix verified against real PTY/socket traffic on desktop Chromium CDP 9223. Combined APK rebuild and Android replay remain pending.** Backend **4098 / PID 24838** was left running. No Android/CDP 9224/ADB interaction, builds, backend restarts, low-level tests, commits, or production changes.

## Demonstrated blank-rendering cause

`packages/gui-extensions/src/terminal/terminal.tsx` mixed imperative visibility with a reactive style object:

- First nonempty Ghostty output set `container.style.opacity = "1"` and a plain `revealed = true` flag.
- The JSX style contained a hard-coded `opacity: 0` alongside `terminalColors().background`.
- A subsequent theme change reran that style binding, overwriting opacity with **0**. The flag remained **true**, so neither `reveal()` nor later incoming output could reveal the terminal again.

Live reproduction used the existing system-theme setting and desktop CDP color-scheme emulation: a working terminal went from **opacity 1 / rgb(255,255,255)** to **opacity 0 / rgb(22,22,22)** on switching to dark. The same running shell accepted `printf 'TERMINAL_THEME_PROBE\n'` while invisible; its marker was present in later real socket replay. This establishes a rendering failure independent of shell execution, websocket protocol, or ticket authentication.

The earlier Android evidence shows a dark, blank terminal, but does not contain a theme/opacity/socket trace. **This run establishes the shared-code failure and fix; it does not prove which theme-loading transition happened in that particular APK run.** Confirm it on the rebuilt APK rather than marking native acceptance complete from desktop evidence.

### Fix

Visibility now has one reactive owner: a `createSignal(false)` changed after nonempty output, read by both the reveal guard and JSX opacity. A later theme update therefore preserves visibility. The initial no-output hiding behavior remains intact.

## Additional demonstrated connection-failure defect

The previous worker's temporary Vite proxy used `changeOrigin: true`. For PTY tickets, that forwards browser Origin `http://192.168.1.85:4108` with Host `192.168.1.85:4098`; the backend correctly rejects that pair with **403**. Ordinary authenticated API requests succeeding through this proxy did not establish PTY ticket acceptance.

The terminal interpreted every rejected connect-token request as a missing shell and invoked the panel's clone callback. Each new shell hit the same rejection. This produced a fast cloning loop, accumulated hidden terminal surfaces, and orphaned running shells. Reproduction was confined to `/tmp/tandem/v2/terminal-acceptance`; **145 owned PTYs** were closed individually through the scoped API after navigating away to stop the loop.

The same terminal file now:

- Displays the existing localized connection-error toast for the first rejected connection attempt.
- Sends ticket rejection through the existing bounded-backoff retry path, whose real PTY GET checks whether replacement is warranted. A running shell is retained rather than cloned.
- Does not clone a shell merely because Ghostty/UI initialization failed; that catch already displays the error toast.

Real 403 verification after this change retained exactly **one** PTY, **`pty_1061b0b23001jDdOhl5YXkIfPC` / bash PID 5482**, across repeated retries. Restoring the correct proxy and reloading reconnected to that same shell and history.

The scratch proxy `/tmp/tandem/v2/web-vite.config.mts` now has **`changeOrigin: false, ws: true`**, preserving the incoming Host and same-origin security relationship. This is a development-topology correction, not an auth bypass or backend policy change. No credential or Origin injection was added.

## Real workflow verification

Source Vite at **http://192.168.1.85:4108**, unchanged isolated backend at **4098**; existing saved source-origin connection was reused. `agent-browser` was unavailable, so the existing Playwright CDP installation was used against only the owned app tab.

Owned UI-only session: **`ses_ef9e6584affeDe4bhvJq7oANue`**, “V2 terminal owned acceptance”, directory **`/tmp/tandem/v2/terminal-acceptance`**. No model prompt was submitted.

| Check | Result |
| --- | --- |
| Auth and wire protocol | Real connect-token **200**, real websocket text output, binary NUL-prefixed cursor metadata; terminal size updates **200**. No mock, injected socket output, or generated-client change. |
| Commands and output | Actual keyboard input ran `pwd` and bounded 180-line `printf` commands. Visible prompt and output confirmed the isolated cwd. |
| Blank baseline | System color-scheme light → dark changed opacity **1 → 0** despite the live shell; later input did not reveal it. |
| Fixed theme transitions | Light → dark → light → dark stayed **opacity 1** at each step. Real output `TERMINAL_THEME_FIXED_001` through `_180` rendered. |
| Reload/replay | Dark-mode reload reconnected to the same PTY/PID, received replay plus cursor metadata, and rendered output at **opacity 1**. |
| Scrollback | Real desktop wheel scrolling showed earlier rows after reload; fixed screenshot shows `_035` through `_084`, distinct from the final `_180`/prompt view. |
| Narrow shared UI | Desktop viewport **672×1105** exercised the Session / Changes / Files / Terminal mobile navigation and terminal canvas. This is not native Android touch/IME acceptance. |
| Ticket rejection | Real 403s retried the same live PTY rather than creating replacement shells. |
| Static check | Pinned Bun 1.4.2: `bun run typecheck` in `packages/gui-extensions` **passed**. Focused `git diff --check` passed. |

Only the terminal component was changed; no session/timeline edits were made, so no session production benchmark was required. The pre-change terminal screenshots/opacity measurements are retained. Existing clipboard fallback changes in this file, branding, web fetch/auth fix, and client-delete fix were preserved. No public API, persistence format, dependencies, generated client, or shared integration ledger was changed.

## Evidence and repeatable source workflow

All manually authored scratch work is under `/tmp/tandem/v2`:

- `terminal-live.mjs`: desktop-only CDP driver, scoped real API helper, sanitized socket-path/status logging (no auth header or ticket logging).
- **`terminal-theme.log`, `terminal-theme.png`**: decisive pre-fix opacity **1 → 0** reproduction.
- **`terminal-theme-fixed.log`**, `terminal-theme-fixed-{output,reload,scrollback}.png`: theme matrix, real socket input/output/replay, same PTY/PID, visible history.
- `terminal-repro.log`, `terminal-owned-ptys.json`, `terminal-reset.log`: initial proxy rejection, cloned-shell inventory, individual cleanup count.
- `terminal-rejection-fixed.log`, `terminal-rejection-fixed.png`: one retained live shell under real repeated 403s.
- `terminal-output.png`, `terminal-reload.png`, `terminal-scrollback.png`: initial healthy transport/rendering controls.
- `terminal-typecheck.log`, `terminal-finish.log`, `terminal-vite.log`.
- `terminal-{repro,command,reload,theme,theme-fixed,failure,verify,finish}.js`: workflow drivers. `terminal-open.js` was an initial setup attempt that assumed an unwrapped API response; use the recorded session's `.data.id` as in the subsequent drivers, or create a fresh owned session.

Vite launch shape, from `packages/app`:

```sh
PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH" \
VITE_OPENCODE_SERVER_HOST=192.168.1.85 \
VITE_OPENCODE_SERVER_PORT=4108 \
node node_modules/vite/bin/vite.js \
  --config /tmp/tandem/v2/web-vite.config.mts --port 4108
```

## Master rebuild / Android replay

1. Include `packages/gui-extensions/src/terminal/terminal.tsx` in the scheduled combined APK/shared-frontend rebuild. No backend rebuild or contract regeneration is required for this fix.
2. On the rebuilt APK, use a fresh owned session and terminal in `/tmp/tandem/v2/terminal-acceptance`. Record the PTY ID and cwd before entering commands.
3. Verify prompt visibility on initial open with saved dark/system theme, after app/page reload, and through light/dark appearance changes. Inspect `[data-component="terminal"]` opacity if blank; after receiving nonempty output it must be **1**.
4. Enter `pwd; printf 'ANDROID_TERMINAL_REPLAY_%03d\n' {1..180}`. Verify actual socket text frames and binary cursor metadata, visible final output, native touch scrollback, reload history, and continued input in the same PTY.
5. If the APK remains blank at opacity **1**, capture the actual ticket status, websocket frames, console errors, and canvas dimensions. That would establish an additional native/rendering defect, not invalidate the proven opacity failure above.
6. Close only that run's owned PTY IDs through UI/API and record the empty scoped inventory.

## Cleanup and ownership release

- Navigated away before cleanup. Final scoped PTY inventory is **[]**; the last accepted PTY was closed via API. The owned session was deleted via API.
- Temporary Vite **PID 31133** was checked by exact command line and stopped; no backend process was stopped.
- Cleared desktop color-scheme/device-metrics emulation; owned tab returned to **http://192.168.1.85:4098/**. That unchanged integrated frontend still shows its previously documented Loading/auth-challenge state.
- Playwright disconnected. **Exclusive desktop CDP 9223 ownership released.** Android/viewport worker ownership was never used.
