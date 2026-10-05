# Tandem v2 setup and retained settings

Source-based setup guide for the pinned v2 worktree. Live checks remain in the
[progress ledger](v2-progress.md) and feature notes; this document does not establish readiness.

## CLI, server and manual updates

Run the following from `/home/jon/code/Tandem-v2`, choosing the needed command rather
than starting a second server over the current master's process:

```sh
export PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH"
bun script/tandem-v2.ts paths
bun script/tandem-v2.ts build
bun script/tandem-v2.ts cli --version
bun script/tandem-v2.ts serve
```

`build` runs `bun run --cwd packages/cli build --single` with Bun 1.4.2 and stages
`packages/cli/dist/cli-linux-arm64/bin/opencode` as development `bin/tandem` via `.new`
and rename. `serve` runs that binary with `--service --hostname 0.0.0.0 --port 4098`.
**`serve` hosts the UI; there is no `web` command.** Source TUI commands `source` and
`vite` always append `--server http://127.0.0.1:4098`.

The launcher owns `~/.local/share/tandem-v2/development/`:

| Path below that directory | Purpose |
| --- | --- |
| `bin/tandem` | Staged CLI, separate from daily `/usr/local/bin/tandem`. |
| `config/tandem/opencode.json` (or `.jsonc`) | Isolated global configuration; project configuration still applies. |
| `data/tandem/opencode.db` | V2 database/credentials; do not point a second independent server at it. |
| `config`, `data`, `cache`, `state` | Explicit XDG homes, including isolated service registration. |
| `server-password` | Stable development password, created privately when absent. |
| `environment.json` | JSON object containing only `TANDEM_*` keys with string values. |

Launcher settings override inherited environment values. Its initial `environment.json`
clears inherited `TANDEM_PROMPT_CORRECTOR_MODEL` and `_VARIANT` with empty strings;
merge edits into that file rather than replacing other settings. Example entries:

```json
{
  "TANDEM_PROMPT_CORRECTOR_MODEL": "",
  "TANDEM_PROMPT_CORRECTOR_VARIANT": "",
  "TANDEM_CLAUDE_BASH_SEARCH": "1",
  "TANDEM_DUMP_REQUEST": "/tmp/tandem/v2/request-dumps"
}
```

The launcher supplies both `OPENCODE_PASSWORD` and `OPENCODE_SERVER_PASSWORD`, clears
inherited `OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT`, and sets `TMPDIR=/tmp/tandem/v2`;
runtime scratch is `/tmp/tandem/v2/tandem`. Non-`TANDEM_*` variables such as
`ANTHROPIC_BASE_URL` belong in the invoking server environment, not this JSON file.
Changes to server settings/plugins take effect on the next coordinated server start;
the currently running server keeps its loaded environment.

Updates are manual: `tandem upgrade` directs users to
<https://github.com/Liddo-kun/Tandem/releases>; the active CLI updater does not check or
install upstream releases. Build/package/install commands, signing and staged replacement
are in [release setup](tandem-release.md) and [tablet APK setup](../script/tablet-android.md).
Production cut-over requires Jon's agreement. Its eventual server command is
`tandem serve --hostname 0.0.0.0 --port 4097` with `OPENCODE_SERVER_PASSWORD` configured;
daily v1's binary, widget, roots and running service remain separate during development.

## Android connection and controls

Use **Tandem V2**, application ID `app.liddokun.tandem.v2`; production remains
`app.liddokun.tandem` with its established signing identity. The app requires a **v2
server**. Enter `http://192.168.1.85:4098` manually on the current tablet LAN (substitute
the actual host address elsewhere). Discovery prefers 4097 and falls back to 4096;
it does not discover arbitrary development ports. `/api/info` probes distinguish
password-required reachability from an offline server.

Use username **`opencode`** and the configured server password, or the pairing flow:

```sh
bun script/tandem-v2.ts cli pair --server http://127.0.0.1:4098
```

Selected/default server, credentials and settings use native async storage. Text and
attachment drafts use the browser draft store; image bytes are separate from settings
writes and Blob URLs are reconstructed on restore. Page zoom is persisted: **80–150%,
2% steps, default 100%**, through mobile settings or hardware volume keys. Allow the
save to settle before force-stopping; immediate termination can lose the last step.
Native pinch zoom is disabled. **Enter inserts a newline; the send button submits.**
Delete-word acts at the caret and treats mentions atomically. Ordinary IME dictation uses
the keyboard; there is no custom voice/microphone feature.

External links, notifications, haptics, sharing and resume use the native bridge.
Android additionally permits restricted Taobao item-detail `taobao://` links. Copy
uses the clipboard API with hidden-textarea fallback. Web search retains the first-use
provider chooser and saved choice; no provider is preselected by this port.

## Saved provider logins

Use existing saved v2 connections. These are setup/reconnect commands, not steps to
repeat before each session; all commands below use the pinned PATH from above.

### ChatGPT conversations

Built-in **Sign in with ChatGPT** uses integration `openai`, method
`chatgpt-token-sharing`; the host persists and refreshes its credential:

```sh
bun script/tandem-v2.ts cli auth login openai --method chatgpt-token-sharing --server http://127.0.0.1:4098
```

### OpenAI Images is a separate OAuth login

Conversation token sharing does **not** authorize imagegen. Keep that login and use
the separate **OpenAI Images (ChatGPT)** integration:

```sh
bun script/tandem-v2.ts cli auth login tandem-openai-images --method codex --server http://127.0.0.1:4098
```

Open the supplied authorization URL, then paste the **full**
`http://localhost:1455/auth/callback?...` URL, including code and state, within five
minutes. Connection refused at that URL is expected: this flow starts no callback
listener. Do not run another Codex login listener on 1455 during it. V2 stores this
credential separately without replacing the conversation login.

Credential preference is stored `openai` API key → `OPENAI_API_KEY` → active compatible
`tandem-openai-images` OAuth. Availability/mode controls both tool and bundled skill;
credential changes reload their schemas. API-key mode remains **untested in the recorded
v2 image workflows**.

OAuth exposes `prompt`, up to ten local `image_paths`, optional PNG alpha `mask_path`
for the first image, and `transparent` (default false). Native Codex Images handles
ordinary generation/reference edits, with backend-managed model, size and quality.
Masks use the Responses route. **Masked OAuth + transparency is unsupported and rejected
before generation.** Native transparency is checked against decoded alpha; an opaque
result fails. The bundled Photon WASM codec (`#photon-wasm`) handles decoding and display
copies; Python/Pillow or an external image CLI is not a runtime prerequisite.

Masks must match the first source dimensions and have transparent editable pixels.
Localized preservation prompts have reproducibly produced **black fill inside the mask**.
An explicit request to reconstruct the **entire editable region**, including background
and geometry, produced a visually successful result with the same source/mask. This is
an observed prompt-sensitive mitigation, not a general fix or pixel-exact preservation
guarantee. Example: “Reconstruct the entire masked rectangle as the continuation of the
green triangle on white, including crossing edges; then add the yellow dot. Every other
editable pixel must show the continuous triangle or white background, with no black patch.”
See [mask investigation](v2-imagegen-mask-investigation.md).

API-key schema additionally requires width/height (multiples of 16, at most 3840 per
edge, ratio ≤3:1, 655,360–8,294,400 pixels), with quality `medium|high|xhigh|max`
(default `high`), targeting `gpt-image-2.5-sunburst`. Each call saves one original PNG
under session `imagegen/`, optionally a smaller same-dimension JPEG/WebP display copy,
and returns paths/observed metadata rather than image bytes. Previewing it does not
itself attach it to a model request; explicit image reading can.

### External Claude plugin

Register the v2 plugin directory once in isolated `config/tandem/opencode.json`, merging
with existing configuration (v2 uses **`plugins`**, plural):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["file:///home/jon/code/opencode-anthropic-auth-v2"]
}
```

The directory's `server.ts` exports its v2 plugin; do not register the daily v1 copy or
a direct TypeScript file URI. Host-compatible dependency setup is documented in
`/home/jon/code/opencode-anthropic-auth-v2/V2-TRANSPORT.md`. After coordinated reload:

```sh
bun script/tandem-v2.ts cli auth login anthropic --method claude-pro-max --server http://127.0.0.1:4098
```

Return the full callback URL, `code#state`, or `code=...&state=...` within ten minutes;
a bare code is rejected. V2 owns token persistence; the plugin owns subscription
Bearer transport, refresh coordination and zero subscription prices. Tandem's Claude
prompt/tool presentation is a separate bundled feature, with no additional opt-in flag.

Optional server environment: `ANTHROPIC_BASE_URL` replaces only the subscription API
**origin**, retaining path/query. `ANTHROPIC_INSECURE=1` or `true`, with a valid custom
base URL, skips certificate verification only through the stock native Anthropic
subscription wrapper. HTTPS remains encrypted; HTTP has no TLS. Other independent
requests and API-key transport do not inherit the exception; token exchange/refresh
still verify TLS. Redirects followed inside that fetch share its TLS option. Unsupported
custom/AI-SDK packages fail explicitly in insecure mode. Do not use a global TLS bypass.

## Retained feature flags

Server-process settings; Corrector's six variables and exact queue behavior are in
[Corrector](../PromptEnhance.md). The launcher JSON accepts the `TANDEM_*` rows below.

| Variable | Default / effect |
| --- | --- |
| `TANDEM_DUMP_REQUEST` | Unset/blank disables. A directory enables credential-redacted final provider-request diagnostics; write failures are nonfatal. Dumps can contain prompt/source content. |
| `TANDEM_IMAGEGEN` | Enabled when credentials exist; trimmed case-insensitive `0`, `false`, `off`, `no` disable tool and bundled skill. |
| `TANDEM_IMAGEGEN_OAUTH_MODEL` | `gpt-5.5`; host model for masked Responses edits only, not native serving-model/size/quality selection. |
| `TANDEM_IMAGEGEN_JPEG_QUALITY` | `90`, clamped to 1–100; JPEG display copy, not backend generation quality. |
| `TANDEM_CLAUDE_BASH_SEARCH` | Off; exactly `1` enables eligible Claude sessions after prerequisite checks. |
| `TANDEM_BROWSER_FETCH` | On; exactly `0` restores upstream webfetch. |
| `TANDEM_BROWSER_FETCH_ENDPOINT` | Desktop CDP `host:port`, default `127.0.0.1:9223`; explicit override disables automatic Android fallback. |
| `TANDEM_BROWSER_FETCH_ANDROID_ENDPOINT` | Android CDP `host:port`, default `127.0.0.1:9222`. |
| `TANDEM_BROWSER_FETCH_LAUNCHER` | Desktop executable, default `~/.local/bin/chromium-x`. |

Bash search requires working `ugrep`, `bfs` and system `grep`: install with
`sudo apt install ugrep bfs` on Ubuntu or `brew install ugrep bfs` on macOS. It uses
subprocess-local shims only for eligible Claude shell calls. Unsupported platforms/shells,
missing dependencies or unavailable/denied shell retain dedicated search tools. Windows
shim support is not implemented.

Browser fetch uses the real Chromium/Chrome session via CDP. Default Linux startup needs
the desktop/X display and launcher; Android fallback needs `adb-reconnect`, ADB and Chrome.
Elsewhere, supply an already-running CDP endpoint. PDF text extraction needs
`pdftotext` (`sudo apt install poppler-utils` on Ubuntu). `webfetch` accepts URL,
`format` (markdown/text/html), timeout ≤120 seconds, extraction `prompt`, and `screenshot`.
The bare internal `web-fetcher` defaults to `openai/gpt-5.6-sol#medium` with medium
verbosity; user agent overrides are retained. Screenshots are saved on every fetch,
and `screenshot:true` gives them to the reader. Downloads/overflow/screenshots use
runtime `webfetch/`, here `/tmp/tandem/v2/tandem/webfetch/`. Reader prompts bypass Corrector.

Build-only controls are covered in release setup: `TANDEM_ANDROID_KEYSTORE_PROPERTIES`
selects existing signing properties, `OPENCODE_ANDROID_VARIANT=v2` selects the isolated
app identity, and `OPENCODE_VERSION`/`OPENCODE_CHANNEL` control CLI build identity.
`TANDEM_ANDROID_NAME` is injected by Vite from variant selection, not a runtime preference.

## Source anchors

Algorithms take precedence over older worker README/status claims:

- [`script/tandem-v2.ts`](../script/tandem-v2.ts), CLI `services/updater.ts` and
  `commands/handlers/upgrade.ts`: launcher and manual-update behavior.
- Android [`entry-android.tsx`](../packages/android/src/entry-android.tsx), native bridge,
  app `runtime/persistence`, `servers/connect` and composer: storage and controls.
- Core [`provider/chatgpt.ts`](../packages/core/src/plugin/provider/chatgpt.ts) and
  [`tandem/imagegen`](../packages/core/src/plugin/tandem/imagegen/): separate auth,
  credential priority, transport, codec and schema.
- Core [`tandem/browser-fetch`](../packages/core/src/plugin/tandem/browser-fetch/) and
  [`tandem/bash-search`](../packages/core/src/plugin/tandem/bash-search/), AI
  [`request-dump.ts`](../packages/ai/src/tandem/request-dump.ts): retained flags.
- External auth-v2 `src/{v2,transform,insecure,insecure-provider,auth,refresh}.ts`:
  normal registration and endpoint-scoped transport.
