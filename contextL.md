# Tandem v2 — Linux implementation context

## Environment

- Ubuntu 24.04 aarch64 userland on the rooted Android 15 kernel, not a VM or proot. Linux and Android share a PID namespace: never use broad process kills.
- User `jon`; repo `/home/jon/code/Tandem-v2`, branch `tandem-v2`, pinned upstream `40679546d4`.
- Daily v1 is `/home/jon/code/Tandem`, `/usr/local/bin/tandem`, server port 4097 and Android ID `app.liddokun.tandem`. Preserve these until an agreed cut-over.
- V2 requires Bun 1.4.2. Provision it separately from global Bun 1.3.14 and ensure build subprocesses inherit the pinned binary on PATH.
- Development server port: 4098, verified unused on 2026-10-03. `serve` hosts the UI; v2 has no `web` command. Configure `OPENCODE_SERVER_PASSWORD`; Basic-auth username remains `opencode`.
- Configuration, credentials, data/database, cache/state and service registration must all use isolated development roots. See `notes/v2-progress.md` for the implemented launcher and root paths.
- All temporary work, downloaded build archives and logs go under `/tmp/tandem/v2`.
- Shared machine RAM is limited; serialize CLI/APK builds and device/browser-driving checks.

## Package and compatibility guidance

- Scope/acceptance is `notes/v2-port.md`; deferred items are `notes/todo-after-v2.md`. Read nearest package `AGENTS.md` before edits.
- Backend is split across `packages/core`, `server`, `protocol`, `schema`, `ai`, `plugin`, `client` and `cli`; use current source rather than v1 package paths.
- Shared Solid app: `packages/app`; chat/tools: `packages/session-ui`; optional views: `packages/gui-extensions`; Android wrapper: `packages/android` once adapted.
- Preserve upstream API, auth, CORS, event and generated-client contracts. Mobile platform extensions must be optional for other clients. Regenerate clients after public contract changes.
- Keep v2 durable admission/execution/history semantics from root `AGENTS.md`. Do not import v1 runner architecture.
- Use Effect v4 guidance for Effect code and RTL guidance for direction-sensitive UI changes.

## Build and verification

- Install dependencies with the pinned Bun: `bun install --frozen-lockfile`.
- ARM64 CLI: `bun run --cwd packages/cli build --single`. Output directories are `packages/cli/dist/cli-<target>/`; determine executable names from the adapted build script.
- First verification is a real ChatGPT-authenticated agent session and actual tool calls. Build when required to run it. No low-level tests without Jon's explicit request.
- V2's first Android checkpoint requires a side-by-side APK, actual tool use and saved connection plus text/image draft recovery after relaunch.
- Record real session/client results, failures and unverified cases in `notes/v2-progress.md`; do not mark code-only work accepted.

## Android toolchain and device

- Reuse v1's `packages/android/apkbuildontablet.md`, native shell, variant installer and `script/{build-tablet-android,android-signing,android-toolchain-env}.ts` selectively, updating v2 imports and output paths.
- Existing aarch64 toolchain is installed; inspect its documented environment before downloading replacements. Android builds require the glibc ARM64 aapt2 override and `/usr/bin/adb`, not the SDK's bionic adb.
- `adb-reconnect` discovers the local device; prefer `127.0.0.1:5555`. Wrap GUI/ADB operations in timeouts. Avoid heavy wireless dumpsys calls.
- Development app name is **Tandem V2**, with a separate application ID and app data. Production identity/signing remain `app.liddokun.tandem` and its existing key.
- Native insets have one owner. Verify keyboard/titlebar/composer behavior at different zooms and orientations rather than transplanting old layout fixes.

## Deployment

- Build/package and install are separate actions. Do not update daily widget, port 4097, binary or production APK during development.
- Production cut-over requires Jon's agreement, staged replacement, installed-version verification and a usable v1/data rollback. Restart the daily service only when explicitly requested.
- GitHub operations target `Liddo-kun/Tandem` explicitly. Commit/push/upload only when requested.
