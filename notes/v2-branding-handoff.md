# V2 product-branding handoff

Date: 2026-10-04. Scope: section 5's product-branding item only. Source implementation is ready for the master's subsequent build and rendered acceptance; this is **not** an acceptance sign-off. The running already-built binary/APK does not contain these changes.

## Implemented

- Web/app product copy is an explicit key allowlist applied after both English and translated dictionaries load. It covers pairing/setup, incompatible-server messages, product errors, About, project/settings descriptions, and desktop menu/recovery copy. Product-specific English is the fallback in every locale until translations are reviewed; existing provider/account translations remain intact.
- Central `Brand` gained repository and issue URLs. About/help/feedback/error links now point at Tandem. Upstream contributor links, copyright and trademark attribution remain upstream attribution.
- Shared logo APIs delegate to owned Tandem art. Reused the v1 T mark and ANSI Shadow terminal wordmark from `/home/jon/code/Tandem` read-only. About no longer animates the literal letters of `opencode`; it uses the shared Tandem logo. The UI wordmark preserves the `class`, `fade`, `muted`, and `outline` API.
- Interactive TUI gets the gradient wordmark on wide terminals, the product name on narrower terminals, and a T monogram at very narrow widths. Session epilogues reuse v1's TTY gradient/non-TTY plain-row renderer. Mini mode, terminal titles, attention notifications, crashes, permission copy, pairing hints and resume commands identify Tandem.
- CLI's existing branded root help was retained. Remaining ACP handshake display name, ACP fallback errors, stats footer, and update-preflight display copy identify Tandem.
- Web manifest/title/social metadata and emitted favicon/touch/PWA assets identify Tandem. Browser/desktop notifications use a bundled Tandem icon instead of fetching the OpenCode favicon.
- Desktop launcher/window/product display names and the legacy Linux launcher label use Tandem (Dev/Beta suffixes remain). Its icon staging and macOS dev icon references point at the owned artwork. This is branding-only wiring, not desktop packaging acceptance or an updater change.
- Android already had `Tandem` / `Tandem V2` names, `app.liddokun.tandem` / `app.liddokun.tandem.v2` IDs, runtime variant title and Tandem launcher generation. No Android source, signing inputs, IDs or build scripts were changed by this worker.

## Owned files and assets

- `packages/app/src/runtime/i18n/product-copy.ts`: app/native product-copy allowlists; keyed app entries checked against English dictionary keys.
- `packages/ui/src/components/tandem-logo.tsx`: v1 mark, splash and logo artwork.
- `packages/ui/src/components/tandem-wordmark.tsx`: shared wordmark implementation.
- `packages/tui/src/brand-logo.ts`: v1 ANSI artwork, gradient, plain/TTY renderer, compact T.
- `packages/tui/src/component/tandem-logo.tsx`: responsive interactive logo.
- `packages/ui/script/tandem-icons.py`: regenerates web/desktop icons using the existing Android/v1 renderer. Run from the repo root with `PYTHONDONTWRITEBYTECODE=1 python3 packages/ui/script/tandem-icons.py`; requires local Pillow (10.2.0 was available). It imports the Android artwork without running Android resource generation.
- `packages/ui/src/assets/brand/{icon.png,icon.ico,icon.icns,dock.png,apple-touch-icon.png,manifest-192.png,notification.png}`: generated Tandem artwork. These are new owned assets, not replacements for provider logos. The old v1 desktop/favicon files still depicted OpenCode, so those were deliberately not reused.

## Narrow shared-file references changed

All paths below are relative to the repo root. Several already contained other workers' changes; only branding lines were added to those files.

### Shared identity, app and UI

- `packages/util/src/brand.ts`: pure repository/issues constants and identity comment.
- `packages/app/src/runtime/i18n/{language.tsx,desktop-native.ts}`: apply copy overrides to locale dictionaries and native English fallback.
- `packages/app/{index.html,manifest.json,vite.icons.ts}`: metadata and owned asset source. Existing channel-prefixed asset URLs are preserved.
- `packages/ui/src/assets/favicon/site.webmanifest`: secondary shared manifest name.
- `packages/ui/src/components/logo.tsx`, `packages/ui/src/typography/wordmark/wordmark.tsx`: delegates; logo entry also exports the bundled notification icon URL.
- `packages/app/src/settings/about/{about.tsx,animated-wordmark.tsx}`: project URL and logo delegate.
- `packages/app/src/servers/connect/screen.tsx`: accessible product label and default `tandem pair` hint; preserves native setup/discovery additions.
- `packages/app/src/shell/titlebar/{windows-menu.tsx,titlebar.tsx}`: menu label and feedback URL.
- `packages/app/src/shell/{commands/desktop-menu.ts,errors/error.tsx}` and `packages/app/src/home/projects/controller.tsx`: project help/report links.
- `packages/app/src/runtime/platform/web.ts`: notification icon.

### Desktop

- `packages/desktop/src/main/constants.ts`, `packages/desktop/src/main/windows/{appearance.ts,early.ts}`, `packages/desktop/src/renderer/index.html`: display names/window titles.
- `packages/desktop/src/renderer/platform/notifications.ts`: notification icon.
- `packages/desktop/electron-builder.config.ts`: product/protocol display names and Linux icon file reference only. Package IDs, protocol schemes, signing and updater settings remain as found.
- `packages/desktop/scripts/{copy-icons.ts,dev-electron.ts}`: narrow icon source references only; no execution by this worker.
- `packages/desktop/resources/linux/opencode-desktop.desktop`: Tandem label and matching `/opt/Tandem` display-product directory; compatibility desktop/icon IDs retained.

### TUI / CLI

- `packages/tui/src/{logo.ts,component/logo.tsx}`: delegates.
- `packages/tui/src/{app.tsx,attention.ts}`: product titles and project help link.
- `packages/tui/src/component/{dialog-pair.tsx,dialog-update.tsx,error-component.tsx,terminal-pane.tsx}`: product text/command hints/crash report destination.
- `packages/tui/src/mini/{splash.ts,runtime.lifecycle.ts,footer.prompt.tsx,footer.permission.tsx}`: mini label, T mark, title, resume command and copy.
- `packages/tui/src/routes/session/permission.tsx`, `packages/tui/src/feature-plugins/system/stats.tsx`: product copy.
- `packages/tui/src/util/{presentation.ts,error.ts,error-details.ts}`: epilogue delegate, resume/model commands and diagnostic copy.
- `packages/cli/src/acp/{service.ts,translate.ts,error.ts}`: display name/fallback text only, no wire-field names changed.
- `packages/cli/src/commands/handlers/{default.ts,stats.ts}`, `packages/cli/src/services/update-preflight.tsx`: product copy.

## Checks performed

No heavy builds, app/device/browser interactions, low-level tests, installs, restarts, commits or publication. No dependency/package/lockfile changes by this worker. Root release/build/signing scripts, plan checkboxes and progress ledger were not edited.

- Read root guidance/context, section 5 and nearest app/UI/TUI/CLI/desktop guidance; inspected v1 artwork read-only and current v2 wiring.
- Generated icons locally from the canonical renderer and visually inspected `packages/ui/src/assets/brand/icon.png`: white offset-shadow T on teal/sky/violet gradient.
- Focused `bun typecheck` using `/tmp/tandem/v2/bun-1.4.2-extract/bun-linux-aarch64` on PATH:
  - **UI passed.** `/tmp/tandem/v2/branding-ui-typecheck.log`.
  - **App blocked on unrelated existing integration errors only in the final run:** `src/session/composer/queue.ts:84` has undefined Corrector metadata not assignable to `JsonValue`; `src/settings/model.test.ts:70` lacks required `corrector`. No branding diagnostics remain. `/tmp/tandem/v2/branding-app-typecheck.log`.
  - **TUI graph blocked on unrelated existing Claude hooks:** `../core/src/plugin/tandem/claude/plugin.ts:47–49`, `Effect<void, unknown, never>` versus required `Effect<void, never, never>`. `/tmp/tandem/v2/branding-tui-typecheck.log`. This does not establish a complete TUI typecheck pass.
- Formatted owned TS/TSX modules; `git diff --check` passed.
- Desktop and CLI package typechecks were not run. The existing root CLI help already delegates to `Brand`; it needs rendered inspection from the next built artifact.

## Remaining rendered acceptance — master scheduling

1. Rebuild the embedded app and CLI using the established isolated build workflow. Inspect browser title, favicon, install/PWA name and icon, blank/new-session wordmark, connect/setup screen, Settings/About, menu accessibility label and an error/report screen. Follow report/help links to the Tandem project.
2. Change the UI locale to one non-English locale and reopen About/connect/settings; ensure product-copy overrides remain Tandem while **OpenCode Console, OpenCode Go, OpenCode Free**, stored provider/account names and their URLs remain untouched. Check light/dark logo contrast and loading splash. Exact brand-copy overrides intentionally remain English pending language review.
3. Run built `tandem --help`, interactive full TUI and mini mode through the isolated server. Check wide (~80-column), narrow (~40-column) and very narrow terminal logo behavior, terminal title, resume hints, session epilogue and crash/report copy. Confirm no clipping with the taller six-row wordmark; this has not been rendered yet.
4. Build the next development APK through the master's existing Android schedule. Verify launcher/recents remains **Tandem V2**, the T icon appears, connect/setup/About use Tandem product branding, and the development application ID stays `app.liddokun.tandem.v2`. Verify production packaging still uses `app.liddokun.tandem` and the established signing certificate using the existing release checks. No signing result is claimed here.
5. If native desktop is built, inspect the staged `resources/icons`, launcher/dock/window/notification icon, product title and Linux launcher path. Desktop compatibility IDs/schemes and its existing updater/install implementation remain upstream-shaped; desktop release/updater adaptation is outside this branding pass. In particular, native CLI install copy still names `opencode` because that installer actually installs the compatibility command; do not relabel it without adapting the installer.

## Intentional OpenCode references

Provider/account names and provider icons (including Console/Go/Free), provider URLs, upstream contributor/legal attribution, upstream package scopes, config filenames/environment variables, Basic-auth username, persisted keys, theme IDs, protocol schemes and wire fields retain their existing identities. Dormant upstream updater implementations and unused legacy assets were not mechanically rewritten. The active app metadata/icon entry points now use the owned Tandem assets; the master should judge rendered surfaces, not a global zero-match search for `OpenCode`.
