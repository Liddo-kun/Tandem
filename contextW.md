# Tandem — Windows context

- The daily Tandem runs on Jon's tablet (port 4097, see `contextL.md`); this Windows host has no Tandem v2 install.
- Windows host: `ssh jon@JJ` (PowerShell). For substantial remote commands, upload a `.ps1` and invoke it with `powershell -ExecutionPolicy Bypass -File`; do not chain with `&&`.
- Existing Bun is `C:\Program_Files\Bun\bin\bun.exe`; use an isolated Bun 1.4.2 for Tandem and propagate its PATH to subprocesses.
- Existing `XDG_CONFIG_HOME` is `C:\Program_Files\Config`. A local development server must override config/data/cache/state and service identity, not reuse Tandem or official OpenCode roots.
- `~/code` is mirrored to `C:\Users\Jon\code` by Syncthing. Do not manually copy edits through the SMB mirror.
- Build CLI from `packages/cli`: `bun run --cwd packages/cli build --single`. Consume `packages/cli/dist/cli-<target>/`, preserving upstream package scopes and target naming.
- V2 serves its embedded UI with `tandem serve`; no `web` command. Basic-auth username is `opencode`.
- Preserve public API, auth/CORS, events and client-generation contracts. Mobile platform additions remain optional.
- Development APK is **Tandem V2** with separate app identity/data; production ID remains `app.liddokun.tandem` with the existing signing key. Windows builds the Android app and the Windows CLI. iOS is deferred.
- GitHub operations target `Liddo-kun/Tandem` explicitly.
