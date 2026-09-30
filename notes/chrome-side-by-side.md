# Chromium Side By Side

**Status: removed at Jon's request.** The dedicated Codex profile and cache,
`chromium-codex` / `codex-chromium` wrappers, desktop entry, browser environment
file, and side-by-side rollback directory were deleted. Source and installed
Codex plugin launchers were restored to their pre-isolation contents. Regular
Chromium's profile and Tandem native-host manifest were preserved (manifest hash
verified unchanged). No dedicated browser or process using its environment was
running at removal. The standalone Codex plugin itself remains installed; this
does not establish coexistence with Tandem on the regular browser. The setup and
rollback paths below are historical and no longer available.

Installed on the Y700 Ubuntu desktop on 2026-09-12 at Jon's request, including an
explicitly authorized local profile and credential transfer. No Tandem build,
service restart, browser restart, or shared-registration takeover was performed.

## Launch

- Existing Chromium / `chromium-x`: Tandem, `~/.config/chromium`.
- Menu **Chromium - Codex** / `chromium-codex`: original Codex plugin,
  `~/.config/chromium-codex/chromium`, profile `Profile 5`.
- `codex-chromium`: normal Codex CLI with the isolated browser environment also
  available to outer-shell diagnostics. Plain `codex` gets the same environment
  inside the plugin's MCP process. Existing MCP processes need a fresh session.

Both wrappers and the plugin launcher use the user-owned shell configuration
`~/.config/chrome-standalone/browser-env.sh`. It sets CHROME_CONFIG_HOME and
CODEX_CHROMIUM_USER_DATA_DIR, not HOME, XDG_DATA_HOME, or the desktop keyring.
The browser inherits the XFCE D-Bus session and uses the existing GPU/audio
launch flags. It has its own window class and no remote-debugging port.

The original plugin's marketplace source and installed `.2+codex.20260911`
cache both have the optional environment-file loader in `start-node-repl.sh`.
The source README documents it. The distributable tarball was not repacked;
reinstalling from that older archive would lose the launcher change.

## Profile Copy

The original browser's process tree was paused for 1.37 seconds during an rsync
snapshot and resumed in a finally block with an independent resume watchdog.
The copy includes profile preferences, bookmarks, extensions, SQLite journals,
session/site storage, cookies, encrypted login databases, and Local State.
Singleton process links, temporary root files, crash reports, and the original
NativeMessagingHosts directory were excluded. The source profile was not edited.
The private destination is outside the code tree and is not a live shared profile.

Existing keyring access was retained rather than exporting plaintext passwords
or changing the encryption backend. This is a one-time copy, not ongoing sync.
Not every saved password or website login has been tested; hardware-backed
passkeys are not duplicated by copying a Chromium profile.

## Verification

- A real `codex-chromium exec` session loaded the installed plugin, read its full
  browser documentation, listed the copied browser's original tab, and inspected
  the Example Domain heading at example.org.
- The same session visited Shopee and reported signed in from visible screenshot
  inspection. DOM inspection timed out; screenshot inspection succeeded.
- Tandem's actual browser tool independently discovered the original browser,
  opened and inspected example.com, then explicitly finalized with confirmed
  cleanup. Its original user tab was preserved.
- Process evidence showed original Chromium PID 17713 parenting Tandem host
  17853, and isolated Chromium PID 26251 parenting original Codex host 26445.
  These PIDs are deployment evidence, not stable identifiers for future commands.
- The Tandem manifest stayed byte-identical, SHA256
  `5f0944f5d7a7b109b98a6160d1e064efdf388061acce9d5bc8a328906f058a3e`.
- Codex's packaged diagnostic resolved the isolated native-host manifest and
  returned `correct: true`, with no problem.
- Private temporary evidence: `/tmp/tandem/codex-side-by-side-session.jsonl`,
  `codex-side-by-side-result.txt`, and `codex-chromium.log`. Do not publish raw
  screenshot/session logs; they may contain account UI.

Codex left its two temporary tabs unmarked for its normal automatic Stop-hook
cleanup. A second real Codex session performed discovery only and confirmed
neither example.org nor shopee.vn remained. It saw two user tabs (one blank),
rather than the original one-tab baseline; no user tabs were modified in this
follow-up. Evidence: `/tmp/tandem/codex-side-by-side-cleanup.txt` and `.jsonl`.

## Rollback

Private backups live at
`~/.local/share/chrome-standalone/side-by-side-rollback-20260912/`:
source/cache launchers and READMEs, plus a reference copy of the untouched Tandem
manifest. No restoration of Tandem's manifest is necessary.

To retire this setup, first close only the dedicated Codex browser normally.
Remove its two launch wrappers and desktop entry, and archive or remove its
private profile only with Jon's approval. Restore the backed-up source/cache
launchers and remove the optional browser environment file. This does not make
original Codex coexist with Tandem on the old browser; it restores the prior
registration conflict. Do not run `--take-over-registration` as rollback.
