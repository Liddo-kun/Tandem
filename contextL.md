# Tandem — Linux context

## Environment

- Tandem requires Bun 1.4.2: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin`. Global Bun stays 1.3.14; put the pinned one first on PATH so build subprocesses inherit it.
- Three servers run on this tablet (setup, logins, flags, app build and releases: `notes/tandem-setup.md`):

| | Daily Tandem | Development | Tandem v1 fallback |
| --- | --- | --- | --- |
| Port | 4097 | 4098 | 4095 (no password) |
| Binary | `/usr/local/bin/tandem` | `~/.local/share/tandem-v2/development/bin/tandem` | `/usr/local/bin/tandem-v1` |
| Start | `~/.local/bin/tandem-server` | `bun script/tandem-v2.ts serve` | `~/.local/bin/tandem-v1-server` |
| Folders | standard `~/.config/tandem`, `~/.local/share/tandem`, … | `~/.local/share/tandem-v2/development/` | `~/.local/share/tandem-v1/` |
| App | Tandem (`app.liddokun.tandem`) | Tandem Dev (`app.liddokun.tandem.v2`) | Tandem v1 (`ai.opencode.android.v1`) |

- An agent's shell inherits its server's environment. In a development-server session, `XDG_*` and `OPENCODE_DB` point at the development folders, so `tandem` commands there act on the development server. Never point a second server at a database that is in use, and never export `OPENCODE_DB` globally: v2 converts any v1 database it opens in place.
- The daily and development servers are both named `tandem`: stop one by matching its port or path, never `pkill -x tandem`.
- `serve` hosts the UI; v2 has no `web` command. The Basic-auth username is `opencode`.
- Shared machine RAM is limited; serialize CLI/APK builds and device/browser-driving checks.

## Packages

- Backend is split across `packages/core`, `server`, `protocol`, `schema`, `ai`, `plugin`, `client` and `cli`. Shared Solid app: `packages/app`; chat/tools: `packages/session-ui`; optional views: `packages/gui-extensions`; Android wrapper: `packages/android`.
- Preserve upstream API, auth, CORS, event and generated-client contracts. Mobile platform extensions must be optional for other clients.
- Port history and what was or wasn't tested: `notes/archive/`.

## Build, install and restart

- Install dependencies with the pinned Bun: `bun install --frozen-lockfile`.
- Development CLI: `bun script/tandem-v2.ts build` stages `packages/cli/dist/cli-linux-arm64/bin/opencode` as the development `bin/tandem`. Restarting the development server picks it up.
- Android app: `bun run tandem:tablet -- --install` builds and installs the daily **Tandem** app; add `--dev` for the **Tandem Dev** test app, or `--desktop` for the side-by-side **Tandem Desktop** app (`app.liddokun.tandem.desktop`, production key) used to connect to Tandem on the Windows desktop. It switches to Bun 1.4.2 and sets up the shared Android project for the selected app itself. The daily app is signed with its existing key (`packages/android/{release.keystore,keystore.properties}`, ignored by Git), never a new one.
- Daily CLI, with the pinned Bun on PATH and a new version such as `2.0.22-tandem-v2.2`:
  `OPENCODE_CHANNEL=latest OPENCODE_VERSION=<version> bun run --cwd packages/cli build --single`, then
  `sudo install -m 755 packages/cli/dist/cli-linux-arm64/bin/opencode /usr/local/bin/tandem.new && sudo mv /usr/local/bin/tandem.new /usr/local/bin/tandem`. It takes effect when the daily server restarts.
- Daily server restart: `setsid nohup tandem-restart-daily >/dev/null 2>&1 </dev/null &`. It waits until the server is idle, restarts it through its widget and logs to `~/.local/share/tandem-v2/restart-daily.log`; it works from a session on the daily server.
- Native Android insets have one owner, `packages/android/src/viewport.ts`; check keyboard/titlebar/composer changes at different zooms and orientations.
- Android touch checks must use real fingers or `adb -s <serial> shell input touchscreen ...`. Do not use CDP `Input.synthesizeScrollGesture` in the WebView: it can leave Chromium's active-touch counter stuck and contaminate later scrolling checks. CDP remains useful for inspection and tracing. Reproduce on a freshly started development app after any synthetic-input experiment.
- GitHub operations target `Liddo-kun/Tandem` explicitly, because this checkout also has the OpenCode remote.
