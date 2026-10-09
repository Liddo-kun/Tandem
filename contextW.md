# Tandem — Windows context

- The daily Tandem runs on Jon's tablet (port 4097, see `contextL.md`). This Windows host also runs Tandem v2 (v1 was removed on 2026-10-09):
  - Binary `C:\Program_Files\tandem.exe`, server on port 4096, started by `C:\Program_Files\Tandem\tandem-server.ps1` (Desktop shortcut "Tandem server"). The script clears `OPENCODE_DB`, which the user environment keeps for the official `opencode.exe`, and points browser-backed webfetch at a separate Chrome instance (installed Chrome, profile `C:\Program_Files\Data\tandem\chrome`, CDP `127.0.0.1:9223`), starting it if needed.
  - Standard Tandem folders under the user's XDG roots: `C:\Program_Files\{Config,Data,Cache}\tandem`; `service.json` (hostname, port, password) is in the config folder.
  - The Claude plugin is a bundled copy of `opencode-anthropic-auth-v2` (`bun build src/v2.ts --target bun`) in `C:\Program_Files\Tandem\plugins\anthropic-auth-v2`; rebundle it after plugin changes.
  - Update by cross-building `--target=opencode-windows-x64` on the tablet and replacing the binary while the server is stopped.
- Windows host: `ssh jon@JJ` (PowerShell). For substantial remote commands, upload a `.ps1` and invoke it with `powershell -ExecutionPolicy Bypass -File`; do not chain with `&&`.
- Existing Bun is `C:\Program_Files\Bun\bin\bun.exe`; use an isolated Bun 1.4.2 for Tandem and propagate its PATH to subprocesses.
- Existing `XDG_CONFIG_HOME` is `C:\Program_Files\Config`. A local development server must override config/data/cache/state and service identity, not reuse Tandem or official OpenCode roots.
- `~/code` is mirrored to `C:\Users\Jon\code` by Syncthing. Do not manually copy edits through the SMB mirror.
- Build CLI from `packages/cli`: `bun run --cwd packages/cli build --single`. Consume `packages/cli/dist/cli-<target>/`, preserving upstream package scopes and target naming.
- V2 serves its embedded UI with `tandem serve`; no `web` command. Basic-auth username is `opencode`.
- Preserve public API, auth/CORS, events and client-generation contracts. Mobile platform additions remain optional.
- Development APK is **Tandem Dev** with separate app identity/data; production ID remains `app.liddokun.tandem` with the existing signing key. Windows builds the Android app and the Windows CLI. iOS is deferred.
- GitHub operations target `Liddo-kun/Tandem` explicitly.
