# Personal installation

The installer targets little-endian Linux. Linux ARM64 with Chromium
149.0.7827.102, extension 1.26.901.11451 and Bun 1.3.14 is the tested baseline.
Windows, macOS and iOS are not verified. The browser/profile label is not a
verified profile identity. See [Phase 4 evidence](../../notes/chrome-extension-phase-4-evidence.md) for rollout gates.
The supported personal clients are the web UI and Android; Electron is outside scope.

**Production page-engine repair deployed; recovery candidate not deployed:** the repaired server and matching host are installed
with binding `personal-chromium-original`. Joined production interaction and
deny/cancel checks passed, followed by a reversible public-site input/capture check.
See [the repair record](../../notes/chrome-original-repair.md#production-deployment)
for exact artifacts, evidence, rollback and remaining limits. These commands build
the standalone host component, not the server-side original page engine. A host
build alone does not upgrade that engine or establish universal readiness.

A subsequent historical-chat attempt failed with disconnection and unconfirmed
cleanup after Chromium and its host exited. The passing page-engine checks do not
establish reliable availability or recovery. A newer close/reopen candidate has
now passed same-chat HTTP recovery on isolated source and packaged servers; see
the repair record's close/reopen candidate section. Both server and host must be
upgraded in an approved deployment before relying on that recovery in production.

Build the two standalone artifacts from the repository root:

```sh
bun run --cwd packages/chrome-bridge build:host
bun run --cwd packages/chrome-bridge build:installer
```

`dist/tandem-chrome-host` is the Chrome-launched host; `dist/tandem-chrome` is the
installation manager (both under `packages/chrome-bridge`). Neither requires Bun,
Node, Codex, a shell PATH entry or checkout source at runtime. The host launcher
uses `/bin/sh` and an absolute, content-addressed executable path.

The host imports only Tandem's `client.ts` transport and its native framing/error
dependencies. It does **not** embed the original browser service, copied browser
client or WASM assets, and does not execute the original `extension-host`, Node,
or `node_repl` ELF binaries. Its source-repair delta is a narrow validation path
for original-engine cleanup calls sent by the Tandem server; transport,
journaling and lifecycle ownership remain Tandem code. The original service is
instead imported by the controller/tool dependency and embedded in the compiled
Tandem server. Rebuilding only this host does not deploy the repaired page engine.
See [chrome-original-repair.md](../../notes/chrome-original-repair.md).

Only after reviewing and approving the matching repaired server/host production
switch, run:

```sh
packages/chrome-bridge/dist/tandem-chrome install \
  --binary "$PWD/packages/chrome-bridge/dist/tandem-chrome-host"
packages/chrome-bridge/dist/tandem-chrome status
packages/chrome-bridge/dist/tandem-chrome restore
```

Defaults respect XDG: storage is `$XDG_DATA_HOME/tandem/chrome` (otherwise
`~/.local/share/tandem/chrome`), and Chromium registration is
`$XDG_CONFIG_HOME/chromium/NativeMessagingHosts/com.openai.codexextension.json`
(otherwise under `~/.config`). Use `--root` and `--manifest` for a different
Chrome-family installation or isolated test. Use an absolute, short storage path:
the socket including its host UUID must fit within 103 bytes. Storage must be
owned by the current user, private, and free of symlinks. It must be persistent
for everyday use; `/tmp` is suitable only for disposable tests.

Install saves exact previous registration bytes in private `installation.json`
before replacing it. The record, `connections.sh`, binaries and all recovery
journals remain on restore. An existing connection file with different contents
is refused, preserving it for manual review. No existing Tandem JSON/JSONC,
shell profile or service configuration is edited. The generated environment is
a dedicated addition, so restore requires removing its sourcing from the server
launcher. Preserve the old server launch configuration before adding it.

Source the printed `connections.sh` in the intended server's environment before
launching that server. It supplies `TANDEM_CHROME_CONNECTIONS` with a stable
binding ID, private socket directory, label and capture verification set false.
Do not reuse a binding ID for a different browser: saved grants belong to that
binding. No tool permissions, media bounds/expiry or `webfetch` settings change.

Before takeover, check whether the previous integration automatically reinstalls
its host when its runtime starts. The installed `chrome-standalone` plugin did
this; its setup must preserve foreign registrations or be disabled before Tandem
can remain active. Re-run that setup after installation to verify it leaves
Tandem's manifest intact. A plugin update may reintroduce the conflict.

Taking over `com.openai.codexextension` means the previous integration stops
receiving new native connections. An already running old host is not replaced or
terminated. Install therefore reports **pending_activation**. With explicit
approval, restart the intended browser/server as necessary; then run status and
the server's own browser status tool. `host_connected` proves the extension
launched the installed executable, not that a particular server owns it.
`controller_busy` requires inspecting the intended server's browser status; a
second controller must not steal the connection.

Screenshot readiness requires a real measured PNG on the intended browser
launch. Chromium 149 needs `--enable-features=CDPScreenshotNewSurface` for tested
background capture. After verifying it, explicitly set `screenshotVerified:true`
in the reviewed server environment. Do not infer readiness from extension
capabilities. The isolated tests use `--no-sandbox`; **do not add this to the real
browser launch**. Any production sandbox tradeoff needs a separate discussion.

Reinstalling identical bytes/options is harmless and resumes a setup interrupted
between rollback-record, environment and registration writes. A surviving
`install.lock` requires confirming the installer has exited before manually
removing that one lock. Do not delete journals. Different binary versions or
binding options require restoring first and selecting a new storage root; the
old installation remains available for rollback. Live executables are never
overwritten.

Restore refuses if another installer changed the registration or if the saved
host target is missing/nonexecutable. Restore is repeatable. It does not restart
anything, remove browser data, revoke grants, delete binaries, or discard
unresolved outcomes. Keep the old executable available until rollback is no
longer needed. There is no automatic repair or destructive uninstall command.

## Status and manual recovery

Status reports binding/identity limits, binary SHA-256, protocol and extension
versions when reachable, unverified capture readiness, missing host/launcher,
changed registration, ambiguous discovery, busy controller and
`cleanup_unconfirmed`. It never probes page content or repeats input.

For a lost response:

1. Stop new browser work and interrupt the owning Tandem session. Keep the
   original operation's `unknown` outcome; a later restart does not prove whether
   a click/type/submit happened.
2. Inspect the affected tab and the private journal. Do not retry the mutation.
   Preserve user tabs and deliverables. Shut down the owning server cleanly when
   possible; inspect any unconfirmed attachment separately.
3. With approval, restart the specific browser if that is needed to end the old
   attachment. Verify its old process has exited and the old debugger attachment
   is gone. A new native-host PID alone is insufficient evidence.
4. With the recovery candidate installed, keep the same binding, storage root and
   historical chat. A full browser restart permits fresh work only when kernel
   boot/start identity establishes that the old leases belong to a retired browser.
   Old uncertainty remains recorded. If recovery is still fenced, inspect the
   evidence rather than cycling installation roots, deleting journals or
   transferring grants. A host-only restart does not resolve uncertain leases.
5. Verify discovery, a read-only operation and capture readiness. Resume only
   fresh authorized work. Inspect the original site's state separately before
   deciding whether any further mutation is appropriate.

The older isolated `install-recovery.ts` script demonstrates a separate-root
manual recovery against a real extension
and installed host: a server-side counter increments once, the response is lost,
the host is killed, the isolated browser is stopped and verified absent, and a
new binding reconnects after restart. Old journal bytes remain unchanged. It
asserts that no previous debugger attachment remains and never repeats the
mutation.

The current `script/reopen-acceptance.ts` instead verifies ordinary close/reopen
in the **same historical HTTP chat and binding**, with no server restart during
the sequence. It is intentionally restricted to server4107 and the private
`/tmp/tandem/chrome-bridge/original-repair-b` fixture and refuses a running fixture
browser. Start the candidate server separately with only that fixture binding;
the script uses its existing private launcher under `timeout` and browser-level
`Browser.close`, not a production browser or registration. Source and packaged
reports are linked in the repair record. It does not test physical window controls.

## Isolated verification

The existing `prepare:isolated` accepts `--installation-root <short-test-root>`.
It runs the real installer against only the prepared registration. The existing
`smoke` then uses the installed IPC path and verifies the exact executable.
Do not launch the same prepared browser concurrently from two test scripts.

```sh
bun run --cwd packages/chrome-bridge typecheck
bun run --cwd packages/chrome-bridge test
# On a fresh prepared --installation-root fixture, which this script launches:
bun packages/chrome-bridge/script/install-recovery.ts <prepared-run-directory>
# On another fresh prepared fixture, using compiled V2 and built app artifacts:
bun packages/chrome-bridge/script/install-session.ts <prepared-run-directory> \
  packages/cli/dist/cli-linux-arm64/bin/lildax
```

Each script owns only its recorded isolated processes. Keep compact reports and
journal evidence, and remove large test profiles only after verifying their
processes exited. Release-client results and known limitations belong in the
Phase 4 evidence, not in a claim inferred from these commands existing.

For model calls, permission prompts may consume a separate bounded aggregate
allowance (currently five minutes). After approval, the ordinary native deadline
still applies; delayed approval does not grant an unbounded action window. Late
approval cannot dispatch an expired operation. Selector-based click/type/key use
the same origin/capability permission checks as returned refs.

The original plugin's local startup source and distributable were separately
updated to version `.2` with a foreign-registration ownership guard. That work,
its rollback copies and its not-yet-exercised install limit are owned by
[chrome-registration-repair.md](../../notes/chrome-registration-repair.md), not
by this installer. Preserve all private installation records and journals.
