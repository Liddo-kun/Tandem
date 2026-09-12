# Original Plugin Registration Repair

Scope: original Codex Chrome Standalone startup registration only, 2026-09-11.
No Tandem browser-engine files, live registrations, account settings, or running
browser processes were changed by this task. The delivery follow-up updated only
the installed cache's setup script, as detailed below.

## Source Chain

- `/home/jon/.codex/config.toml` enables `chrome-standalone@personal`.
- `/home/jon/.agents/plugins/marketplace.json` names the `personal` marketplace
  and declares local source `./code/codex/chrome-standalone-plugin`.
- The local source is `/home/jon/code/codex/chrome-standalone-plugin`.
- Its `.mcp.json` starts `./scripts/start-node-repl.sh` with plugin-relative cwd.
  That launcher invokes bundled Node on `scripts/setup-native-host.mjs` before
  executing `node_repl`; it passes no setup arguments.
- Installation makes an independent cache copy. The current cache is
  `/home/jon/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247`.
  Its earlier partial preservation patch was replaced with an exact copy of the
  tested source setup script during delivery. Its version directory and plugin
  manifest remain unchanged; it is not a newly installed versioned cache.

## Changes

Six files changed under the original source across repair and delivery:

1. `scripts/setup-native-host.mjs`: preserve foreign and unknown-owner manifests;
   require direct `--take-over-registration` for intentional takeover. Ownership
   means exact equality of manifest `path` with the stable standalone host path.
   Invalid JSON, null, missing path, and empty manifests are preserved by default.
   Missing registrations and owned repairs retain automatic startup behavior.
2. `tests/smoke.py`: preseed a foreign Chromium registration before real MCP
   startup; assert unchanged bytes/mtime and no backup. Extend setup regression
   checks and isolate HOME, CODEX_HOME, and temporary files under `/tmp/tandem`.
3. `README.md`: document ownership, takeover scope, and first-backup retention.
4. `TESTING.md`: describe the regression checks and their limits.
5. `.codex-plugin/plugin.json`: bump local version to
   `26.901.51231-standalone.2+codex.20260911`, giving future installs a distinct
   cache identity.
6. `PROVENANCE.md`: record the ownership-guard packaging change.

This note is the only Tandem file added by this task. The original source is not
in a Git repository. Persistent private rollback copies and delivery evidence
are now retained under
`/home/jon/.local/share/tandem/chrome-rollout-20260911/registration-source-repair`.
No production registration rollback is needed because no production setup
command was run.

## Validation

From `/home/jon/code/codex/chrome-standalone-plugin`:

- `node --check scripts/setup-native-host.mjs`: passed.
- `python3 tests/smoke.py`: passed with a relocated independent plugin copy and
  an isolated home under `/tmp/tandem/chrome standalone smoke 6ddpz4lo` (cleaned
  automatically). Foreign registration survived MCP initialization and JS
  execution unchanged. JS returned `2`; `turn_ended` succeeded.
- Setup checks passed for initial registration, idempotence, owned repair,
  host-config regeneration, foreign/unknown-owner preservation, explicit
  takeover, and retention of the first backup.
- Reviewed the setup diff against the pre-edit backup: only argument validation
  and the ownership guard changed executable setup behavior.
- A separate old-code full-copy control ran out of temporary disk space while
  copying, before assertions. It is not a demonstrated red test. Its extra copy
  was removed; `/tmp` then had 574 MiB available. The successful new-code test
  above completed before that attempt.

## Distribution Delivery

Local source version: `26.901.51231-standalone.2+codex.20260911`.

Rebuilt artifacts:

- `/home/jon/code/codex/chrome-standalone-linux-arm64.tar.gz`
- `/home/jon/code/codex/chrome-standalone-linux-arm64.tar.gz.sha256`

The tarball retains top-level directory `chrome-standalone/`. Every one of its
5,057 regular files was SHA256-compared with the corresponding source file,
and the file inventory matched exactly before publication. No symlinks or
unexpected archive entry types were accepted. The SHA256 sidecar is now relative
to its containing directory; verify from `/home/jon/code/codex` with
`sha256sum -c chrome-standalone-linux-arm64.tar.gz.sha256`.

Tarball SHA256:
`31c4995d941e77251052113cef23dfa9bfd83b973fc4f5f2e366d3f8d9e7ee73`.

Source, tarball entry, and updated existing-cache setup script SHA256 all match:
`8f7e2816bba591ce7f53c1506d912830d17e3b884a28955527ae3ec7963e5e73`.

All eight discovered production `com.openai.codexextension.json` manifests
retained their SHA256 hashes and mtimes before/after delivery. The same checks
passed for Codex config, the personal marketplace, and source/cache MCP and Stop
hook files. The exact file evidence is in `protected-before.json` and
`protected-after.json` in the private rollout directory. `delivery.json` records
version and artifact hashes. No saved environment or credentials are included.

Only `codex plugin --help` and `codex plugin add --help` were invoked. Their help
does not establish that installation avoids account/network operations or
startup, so no live install/update command was run. A future deliberately
scheduled `codex plugin add chrome-standalone@personal` should copy the bumped
local source to a new versioned cache; verify the resulting version and setup
hash and retain the existing plugin tool-policy and hook-trust settings. Do not
use a fresh browser/server session or run setup as an automatic delivery check.

## Rollback

The private rollout directory has mode 0700 and contains:

- `before-source-repair/`: the four original pre-guard source files, migrated
  from the temporary backup.
- `before-delivery/source/`: six source files as they were immediately before
  version/distribution delivery (the setup guard was already present).
- `before-delivery/cache/setup-native-host.mjs`: the earlier installed-cache
  script with its partial preservation patch.
- `before-delivery/chrome-standalone-linux-arm64.tar.gz` and its `.sha256`:
  the previous distributable and checksum.

For delivery-only rollback, copy only the corresponding saved manifest, README,
provenance, cache script, and distribution artifacts back to their original
paths. The tested source setup guard does not need reverting. For a complete
source-repair rollback, the earlier source copies are available, but restoring
the pre-guard setup reintroduces the registration conflict. Neither rollback
requires executing setup, altering native manifests, or restarting anything.

## Limits

- No new-version install, restart, or registration switch was performed. The
  bumped source and rebuilt tarball contain the fix, and the existing installed
  setup script matches it exactly, but a Codex-managed install of the new version
  has not been exercised. Existing sessions may retain already loaded code.
- A future replacement of the local source itself must retain this local fix.
- Normal setup still provisions standalone-owned host files even when a foreign
  browser registration is preserved. It does not modify the foreign host.
- Takeover applies to all configured Chrome-family registration directories,
  including the explicit profile-root override, and retains the first backup
  rather than replacing it on later takeovers.
- The existing read/replace sequence is not a cross-process ownership lock;
  simultaneous registration changes by another installer are not covered.
- These tests establish startup registration behavior and MCP runtime health,
  not browser connectivity through the preserved host or unrelated Tandem
  browser-engine readiness. No live browser/account actions were tested.
