# Tandem setup on this tablet

How the daily server, the v1 fallback and the development server are set up, how to sign in, and how
to build the app and publish releases. Day-to-day build commands are in `contextL.md`.

## Daily server

| Item | Location |
| --- | --- |
| Command | `/usr/local/bin/tandem` (`latest` channel) |
| Server | port 4097, started by `~/.local/bin/tandem-server` |
| Configuration | `~/.config/tandem/`: `opencode.jsonc`, `service.json` (hostname, port, server password), Jon's global `AGENTS.md`, `skills/`, parked `skills-disabled/` |
| Data | `~/.local/share/tandem/opencode.db` (history and logins), plus `~/.cache/tandem` and `~/.local/state/tandem` |
| Scratch | `/tmp/tandem` (browser fetch uses `/tmp/tandem/webfetch/`) |
| Android app | **Tandem**, `app.liddokun.tandem` |

`tandem-server` runs `tandem serve --service --hostname 0.0.0.0 --port 4097` with no root overrides. It
unsets `OPENCODE_DB`: v2 converts any v1 database it opens in place, so never export `OPENCODE_DB`
from `~/.profile`. The `tandem` CLI attaches to the running service. To connect a browser or app, run
`tandem pair` and paste the one-time link into the app's server-address field, or use username
`opencode` with the password from `service.json`. `TANDEM_*` flags come from the login environment
(`~/.profile` sets `TANDEM_CLAUDE_BASH_SEARCH=1`). The app's LAN discovery tries 4097, then 4096.

`opencode.jsonc` registers the Claude plugin, turns auto-compaction off, replaces the built-in
`general`/`explore` helpers with model-pinned `general-sol` (GPT-5.6 Sol; v2's ChatGPT login lacks
GPT-6.1 Sol) and `general-astra` (GPT-6 Astra), both denying todowrite and nested subagents, and denies
the `firecrawl-crawl`, `firecrawl-map`, `router-admin` and `linux-cdp` skills.

Updates are manual: `tandem upgrade` points to <https://github.com/Liddo-kun/Tandem/releases>.

## Tandem v1 fallback

`~/.local/bin/tandem-v1-server` runs `/usr/local/bin/tandem-v1 web --hostname 0.0.0.0 --port 4095`, no
password, with the XDG folders pointed at `~/.local/share/tandem-v1/{config,data,cache,state}`,
`OPENCODE_DB=opencode-dev.db` and its DeepSeek Corrector override. Its config folder links back to
`~/.config/tandem/AGENTS.md` and every other `~/.config` entry, so tools such as `gh` work. App:
**Tandem v1** (`ai.opencode.android.v1`). The old v1 APK, `~/.profile` and `~/.bashrc` are kept in
`~/.local/share/tandem-v1/`.

## Development server

From `/home/jon/code/Tandem-v2`, with the pinned Bun (`~/.local/share/tandem-v2/toolchain/bun-1.4.2/bin`)
first on PATH:

```sh
bun script/tandem-v2.ts build     # build the CLI and stage it as the development bin/tandem
bun script/tandem-v2.ts serve     # run it on port 4098 (serve hosts the UI; there is no web command)
bun script/tandem-v2.ts cli ...   # run CLI commands against it
bun script/tandem-v2.ts paths     # show its folders
```

Everything lives in `~/.local/share/tandem-v2/development/`: `bin/tandem`, explicit XDG homes
(`config`, `data`, `cache`, `state`; the database is `data/tandem/opencode.db`), `server-password`, and
`environment.json`, a JSON object of `TANDEM_*` string values that override the inherited environment
(merge edits rather than replacing the file). The launcher clears inherited `OPENCODE_CONFIG*`, sets
`TMPDIR=/tmp/tandem/v2`, and keeps the server's loaded settings until it restarts. Its config folder
links to the daily `AGENTS.md`, selected skills and every other `~/.config` entry. App: **Tandem V2**
(`app.liddokun.tandem.v2`); enter `http://192.168.1.85:4098` manually or pair with
`bun script/tandem-v2.ts cli pair --server http://127.0.0.1:4098`.

## Logins

Each server keeps its own logins. Never copy them between servers: OAuth refresh tokens rotate, so two
copies of one login break each other. For the daily server run `tandem auth login ...`; for the
development server run `bun script/tandem-v2.ts cli auth login ... --server http://127.0.0.1:4098`.

| Login | Arguments | Notes |
| --- | --- | --- |
| ChatGPT conversations | `openai --method chatgpt-token-sharing` | Does not authorize image generation. |
| OpenAI Images | `tandem-openai-images --method codex` | Open the URL, then paste the **full** `http://localhost:1455/auth/callback?...` URL within five minutes. "Connection refused" there is expected; don't run another Codex login on port 1455 meanwhile. |
| Claude | `anthropic --method claude-pro-max` | Needs the plugin below. Paste the full callback URL, `code#state` or `code=...&state=...` within ten minutes; a bare code is rejected. |

The Claude plugin is registered in the global config (daily `~/.config/tandem/opencode.jsonc`,
development `config/tandem/opencode.json`) as
`"plugins": ["file:///home/jon/code/opencode-anthropic-auth-v2"]` (v2 uses `plugins`, plural). Never
register the v1 copy, `~/code/opencode-anthropic-auth`. Its dependency setup and the optional
`ANTHROPIC_BASE_URL`/`ANTHROPIC_INSECURE` transport settings are in that repo's `V2-TRANSPORT.md`.

## Feature flags

Server-environment settings. Corrector's are in [tandem-corrector.md](tandem-corrector.md).

| Variable | Default / effect |
| --- | --- |
| `TANDEM_CLAUDE_BASH_SEARCH` | Off; exactly `1` gives eligible Claude sessions `ugrep`/`bfs` search shims inside the shell instead of separate search tools. Needs `ugrep`, `bfs` and system `grep` (`sudo apt install ugrep bfs`); without them the search tools stay. |
| `TANDEM_BROWSER_FETCH` | On; exactly `0` restores upstream webfetch. Fetches through the real Chromium (desktop, launched on demand) or Android Chrome over CDP. PDF text needs `pdftotext` (`poppler-utils`). |
| `TANDEM_BROWSER_FETCH_ENDPOINT` | Desktop CDP `host:port`, default `127.0.0.1:9223`; setting it disables the Android fallback. |
| `TANDEM_BROWSER_FETCH_ANDROID_ENDPOINT` | Android CDP `host:port`, default `127.0.0.1:9222`. |
| `TANDEM_BROWSER_FETCH_LAUNCHER` | Desktop browser launcher, default `~/.local/bin/chromium-x`. |
| `TANDEM_IMAGEGEN` | On when an image credential exists; `0`, `false`, `off` or `no` disables the tool and its skill. |
| `TANDEM_IMAGEGEN_OAUTH_MODEL` | `gpt-5.5`; host model for masked edits only. |
| `TANDEM_IMAGEGEN_JPEG_QUALITY` | `90` (1–100); quality of the JPEG display copy. |
| `TANDEM_DUMP_REQUEST` | Unset disables. A directory receives credential-redacted copies of each final provider request (they can contain prompt and source text). |

## Building the Android app

`bun run tandem:tablet -- --install` builds and installs the daily app; `--dev` selects the Tandem V2
test app, `--debug` a debug APK, `--help` the rest. The script reruns itself under the pinned Bun,
loads the Android toolchain, and regenerates the shared generated project
(`packages/android/src-tauri/gen/android`, ignored by Git) when it was set up for the other app, so
build the two apps one at a time. It installs to `127.0.0.1:5555` unless `--device` is given, after
checking the APK's application ID. `--overwrite` (test app only) uninstalls a test app with a
mismatched signature; the daily app is never uninstalled. Logs: `/tmp/tandem/v2/android-build.log` and
`android-init.log`; Gradle and other caches are under `/tmp/tandem/v2`.

**Signing:** the daily app uses its existing key, `packages/android/{release.keystore,keystore.properties}`
(ignored by Git; the original is in the v1 checkout's `packages/android/`), certificate SHA-256
`90af42e463563021e8dcc7b9203aa6cb8852b123806b5450a9e9c95c10f8d10b`. Never create a new key for it. The
test app's key is in `~/.local/share/tandem-v2/android-signing/`, created on first build.
`TANDEM_ANDROID_KEYSTORE_PROPERTIES` selects other existing signing properties.

**inotify:** the build needs a few file watches from the kernel-wide limit of 77,755. Syncthing normally
uses about 9,000 (build folders are in `~/code/.stglobalignore`) but keeps watches on folders moved
within or out of `~/code` until it restarts. If the script reports running out, restart Syncthing
(command in `~/code/Android/y700-handoff/y700ubuntu.md`, Syncthing ignores) and rerun.

**Toolchain** (checked 2026-10-03; `--setup` or `bash script/setup-tablet-android.sh` reinstalls it):
SDK `~/Android/Sdk` (platforms 35, 36); NDK `29.0.14206865` (community ARM64 build); JDK 17 at
`/usr/lib/jvm/java-17-openjdk-arm64`; Rust in `~/.cargo/bin` with the Android targets; glibc ARM64
`aapt2` in `build-tools/{35.0.0,36.0.0}`, which the script hands to Gradle instead of Maven's x86_64 one;
ADB at `/usr/bin/adb` (never the SDK's bionic `platform-tools/adb`).

## Publishing a GitHub release

Only when Jon asks. Updating the tablet itself needs none of this.

1. Run `bun run tandem:tablet` so the Android project is set up for the daily app.
2. With the pinned Bun on PATH and `BUNDLETOOL_JAR` pointing at a `bundletool-all` JAR (download it to
   `/tmp/tandem/v2/release-tools/` if missing):
   `bun script/build-tandem-release.ts --version <version> --strict --out dist/tandem-release-<version>`.
   This builds the CLI for every platform plus the signed APK and AAB, and stages them with
   `manifest.json` and `SHA256SUMS` (logs in `/tmp/tandem/v2/release`). `--required-common` also
   requires Linux, macOS and Windows on arm64 and x64; `--help` lists the skip and package-only options.
   Use a new, empty staging directory.
3. Write release notes from the previous **Tandem** tag: verified changes only, plus the pinned upstream
   baseline. Don't use upstream's publish or version scripts.
4. `gh release create <tag> --repo Liddo-kun/Tandem --target <commit> --notes-file <notes.md>`, then
   `gh release upload <tag> --repo Liddo-kun/Tandem dist/tandem-release-<version>/*`.

Windows, macOS and musl executables have never been run on those platforms. Copies of the
2.0.22-tandem-v2.0 tablet build are in `~/.local/share/tandem-v2/releases/`.
