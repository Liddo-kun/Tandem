# Tandem v2 — Windows implementation context

- Root `AGENTS.md` and `notes/v2-port.md` define implementation and acceptance. The v1 changelog is reference, not extra scope. Check nearest package guidance.
- Branch `tandem-v2` starts at `upstream/v2` commit `40679546d4`; preserve daily v1 and do not advance the baseline during this port.
- Windows host: `ssh jon@JJ` (PowerShell). For substantial remote commands, upload a `.ps1` and invoke it with `powershell -ExecutionPolicy Bypass -File`; do not chain with `&&`.
- Existing Bun is `C:\Program_Files\Bun\bin\bun.exe`; use an isolated Bun 1.4.2 for v2 and propagate its PATH to subprocesses.
- Existing `XDG_CONFIG_HOME` is `C:\Program_Files\Config`. Development must override config/data/cache/state and service identity, not reuse production Tandem or official OpenCode roots.
- `~/code` is mirrored to `C:\Users\Jon\code` by Syncthing. Do not manually copy edits through the SMB mirror.
- Build CLI from `packages/cli`: `bun run --cwd packages/cli build --single`. Consume `packages/cli/dist/cli-<target>/`, preserving upstream package scopes and target naming.
- V2 serves its embedded UI with `tandem serve`; no `web` command. Use a separate development port/password/launcher. Basic-auth username is `opencode`.
- Preserve public API, auth/CORS, events and client-generation contracts. Mobile platform additions remain optional; follow current v2 durable session semantics.
- First verification is a real agent session with actual tools; no low-level tests without Jon's request. Builds/typechecks are supporting checks, not acceptance.
- Reuse Android signing/build infrastructure selectively. Development APK is **Tandem V2** with separate app identity/data; production ID remains `app.liddokun.tandem` with the existing signing key. iOS is deferred.
- Follow the existing variant installer's direct invocation/log handling after adaptation. Coordinate device operations and heavy builds with the master orchestrator.
- Production deployment requires explicit agreement, staged replacement and version verification. Preserve v1 rollback/data and do not restart the daily server without a request.
- Record shared-code divergence in `logv2.md` and workflow evidence in `notes/v2-progress.md`; GitHub actions target `Liddo-kun/Tandem` explicitly.
