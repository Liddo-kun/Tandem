# Tandem — Windows context

- Root `AGENTS.md` defines the working rules; deferred work is `notes/todo-after-v2.md`. Check nearest package guidance.
- Branch `tandem-v2` is OpenCode `upstream/v2` at `40679546d4` plus Tandem's customizations. Advance the baseline only with Jon's approval (`tandem-opencode-sync` skill).
- The daily Tandem runs on Jon's tablet (port 4097, see `contextL.md`); this Windows host has no Tandem v2 install. The tablet's v1 checkout `/home/jon/code/Tandem` is a read-only fallback.
- Windows host: `ssh jon@JJ` (PowerShell). For substantial remote commands, upload a `.ps1` and invoke it with `powershell -ExecutionPolicy Bypass -File`; do not chain with `&&`.
- Existing Bun is `C:\Program_Files\Bun\bin\bun.exe`; use an isolated Bun 1.4.2 for Tandem and propagate its PATH to subprocesses.
- Existing `XDG_CONFIG_HOME` is `C:\Program_Files\Config`. A local development server must override config/data/cache/state and service identity, not reuse Tandem or official OpenCode roots.
- `~/code` is mirrored to `C:\Users\Jon\code` by Syncthing. Do not manually copy edits through the SMB mirror.
- Build CLI from `packages/cli`: `bun run --cwd packages/cli build --single`. Consume `packages/cli/dist/cli-<target>/`, preserving upstream package scopes and target naming. Windows executables have not been run yet.
- V2 serves its embedded UI with `tandem serve`; no `web` command. Basic-auth username is `opencode`.
- Preserve public API, auth/CORS, events and client-generation contracts. Mobile platform additions remain optional; follow current v2 durable session semantics.
- First verification is a real agent session with actual tools; no low-level tests without Jon's request. Builds/typechecks are supporting checks, not acceptance.
- Development APK is **Tandem V2** with separate app identity/data; production ID remains `app.liddokun.tandem` with the existing signing key. Android packaging on Windows is unverified. iOS is deferred.
- Installing to the daily setup or restarting the daily server requires Jon's instruction. Record shared-code divergence in `logv2.md`; GitHub actions target `Liddo-kun/Tandem` explicitly.
