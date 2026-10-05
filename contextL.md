# Tandem — Linux context

## Environment

- Ubuntu 24.04 aarch64 userland on the rooted Android 15 kernel, not a VM or proot. Linux and Android share a PID namespace: never use broad process kills.
- User `jon`; repo `/home/jon/code/Tandem-v2`, branch `tandem-v2`, pinned upstream `40679546d4`.
- Tandem requires Bun 1.4.2: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin`. Global Bun stays 1.3.14; put the pinned one first on PATH so build subprocesses inherit it.
- Three servers run on this tablet (setup, logins, flags, app build and releases: `notes/tandem-setup.md`):

| | Daily Tandem | Development | Tandem v1 fallback |
| --- | --- | --- | --- |
| Port | 4097 | 4098 | 4095 (no password) |
| Binary | `/usr/local/bin/tandem` | `~/.local/share/tandem-v2/development/bin/tandem` | `/usr/local/bin/tandem-v1` |
| Start | `~/.local/bin/tandem-server` | `bun script/tandem-v2.ts serve` | `~/.local/bin/tandem-v1-server` |
| Folders | standard `~/.config/tandem`, `~/.local/share/tandem`, … | `~/.local/share/tandem-v2/development/` | `~/.local/share/tandem-v1/` |
| App | Tandem (`app.liddokun.tandem`) | Tandem V2 (`app.liddokun.tandem.v2`) | Tandem v1 (`ai.opencode.android.v1`) |

- An agent's shell inherits its server's environment. In a development-server session, `XDG_*` and `OPENCODE_DB` point at the development folders, so `tandem` commands there act on the development server. Never point a second server at a database that is in use, and never export `OPENCODE_DB` globally: v2 converts any v1 database it opens in place.
- The daily and development servers are both named `tandem`. Stop one by matching its port or path (for example `pkill -f "[t]andem serve --service --hostname 0.0.0.0 --port 4097"`), never `pkill -x tandem`. The `[t]` keeps pkill from matching its own command line.
- `serve` hosts the UI; v2 has no `web` command. The Basic-auth username is `opencode`.
- All temporary work, downloaded build archives and logs go under `/tmp/tandem/v2`.
- Shared machine RAM is limited; serialize CLI/APK builds and device/browser-driving checks.

## Package and compatibility guidance

- Deferred work is `notes/todo-after-v2.md`. Port history and what was or wasn't tested: `notes/archive/`. Read the nearest package `AGENTS.md` before edits.
- Backend is split across `packages/core`, `server`, `protocol`, `schema`, `ai`, `plugin`, `client` and `cli`; use current source rather than v1 package paths.
- Shared Solid app: `packages/app`; chat/tools: `packages/session-ui`; optional views: `packages/gui-extensions`; Android wrapper: `packages/android`.
- Preserve upstream API, auth, CORS, event and generated-client contracts. Mobile platform extensions must be optional for other clients. Regenerate clients after public contract changes.
- Keep upstream's v2 session engine (durable admission, execution and history) as designed; do not import v1 runner architecture.
- Use Effect v4 guidance for Effect code and RTL guidance for direction-sensitive UI changes.

## Build and verification

- Install dependencies with the pinned Bun: `bun install --frozen-lockfile`.
- Development CLI: `bun script/tandem-v2.ts build` stages `packages/cli/dist/cli-linux-arm64/bin/opencode` as the development `bin/tandem`. Restarting the development server picks it up.
- Android app: `bun run tandem:tablet -- --install` builds and installs the daily **Tandem** app; add `--dev` for the **Tandem V2** test app. It switches to Bun 1.4.2 and sets up the shared Android project for the selected app itself.
- Daily CLI, with the pinned Bun on PATH and a new version such as `2.0.22-tandem-v2.1`:
  `OPENCODE_CHANNEL=latest OPENCODE_VERSION=<version> bun run --cwd packages/cli build --single`, then
  `sudo install -m 755 packages/cli/dist/cli-linux-arm64/bin/opencode /usr/local/bin/tandem.new && sudo mv /usr/local/bin/tandem.new /usr/local/bin/tandem`. It takes effect when the daily server restarts.
- First verification is a real agent session with actual tool calls on the development server. No low-level tests without Jon's explicit request. Report unverified cases rather than claiming acceptance from builds.

## Android toolchain and device

- `adb-reconnect` discovers the local device; prefer `127.0.0.1:5555`. Wrap GUI/ADB operations in timeouts. Avoid heavy wireless dumpsys calls.
- The daily app is signed with its existing key (`packages/android/{release.keystore,keystore.properties}`, ignored by Git), never a new one.
- Native insets have one owner. Verify keyboard/titlebar/composer behavior at different zooms and orientations rather than transplanting old layout fixes.

## Deployment

- Installing to the daily setup (binary, app, start scripts) and restarting the daily server need Jon's instruction.
- Keep the Tandem v1 fallback working and its data intact until Jon retires it.
- GitHub operations target `Liddo-kun/Tandem` explicitly. Commit/push/upload only when requested.
