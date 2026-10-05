# Tandem v2 release tooling

Build and stage with the pinned Bun 1.4.2. Master schedules CLI/Android builds serially on the tablet. These scripts do not install anything or restart a service. iOS is excluded.

```sh
export PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH"
bun script/build-tandem-release.ts --help
bun script/package-tandem-release.ts --help
```

## Build graph and outputs

`build-tandem-release.ts` runs these steps sequentially, with full logs under `/tmp/tandem/v2/release` on Linux (override with `--log-dir`):

1. `bun run --cwd packages/cli build` builds the embedded web UI and CLI targets using the existing CLI build/verification graph.
2. `bun run --cwd packages/android tauri android build --apk --aab --target aarch64 --ci` builds signed Android outputs. `--android-variant v2` also passes the absolute `tauri.v2.conf.json` path and `OPENCODE_ANDROID_VARIANT=v2`.
3. `package-tandem-release.ts` verifies and stages artifacts, `manifest.json` and `SHA256SUMS`.

CLI input is `packages/cli/dist/cli-<target>/bin/opencode` (`opencode.exe` when emitted for Windows). Output names are `tandem-<target>` or `tandem-<target>.exe`. Every emitted Linux/Windows/macOS architecture, baseline and musl variant is collected except byte-duplicate `cli-darwin-x64-baseline`. CLI versions come from adjacent build `package.json` files; mixed versions fail. Unix staged executables retain executable mode.

Android input defaults to `packages/android/src-tauri/gen/android/app/build/outputs`. Production names start with `tandem-android-`; development names start with `tandem-android-v2-`. APK/AAB signatures and actual application IDs are checked before staging. Debug artifacts are excluded unless explicitly selected; filenames containing `unsigned` are always excluded. Outputs from a different identity cause failure rather than being relabeled.

`--strict` requires a CLI and signed release Android **APK and AAB**. `--required-common` additionally requires macOS arm64/x64, Linux arm64/x64 and Windows arm64/x64. Neither requires iOS. Partial local packaging is the default; skip flags omit both building and collecting that artifact kind.

## Android prerequisites and identities

The generated Android project must already be initialized. For development, use the Android workspace's `init:v2` after loading the toolchain environment; see [tablet infrastructure](../script/tablet-android.md). Production initialization is `bun run --cwd packages/android tauri android init --ci --skip-targets-install` with `OPENCODE_ANDROID_VARIANT=production`. Both variants share the generated project/output tree: serialize them, initialize for the selected identity when necessary, and clean stale Gradle outputs before switching identities.

The orchestrator does not delete/regenerate the native project automatically. The Android package's existing `tauri` preparation step owns generated metadata and signing wiring.

| Variant                        | Application ID           | Signing                                                                                                         |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `production` (release default) | `app.liddokun.tandem`    | Existing production key/properties; missing files fail, never re-key                                            |
| `v2`                           | `app.liddokun.tandem.v2` | Isolated `~/.local/share/tandem-v2/android-signing` pair; existing helper may create this development-only pair |

`TANDEM_ANDROID_KEYSTORE_PROPERTIES` explicitly selects an existing properties file. Restore/select the original production credentials for production signing; do not substitute the development key. Keystore filenames, passwords and keys never belong in the release staging directory. Packaging verifies signatures, not continuity with an installed app's signing certificate; compare the production certificate with the known production certificate before cut-over.

Android verification needs these installed tools; nothing is downloaded by the packager:

```sh
export AAPT2=/home/jon/Android/Sdk/build-tools/36.0.0/aapt2
export APKSIGNER=/home/jon/Android/Sdk/build-tools/36.0.0/apksigner
export BUNDLETOOL_JAR=/absolute/path/to/bundletool-all.jar
```

`aapt2` reads APK application IDs; `apksigner verify` checks APK signatures. `jarsigner` checks AAB signing and bundletool reads its protobuf manifest package ID. Java/JDK tools must be on PATH. On Windows, point `APKSIGNER` at an executable wrapper if the installed SDK launcher requires a command shell. Android packaging/tool execution on Windows remains unverified.

The full build orchestrator loads the existing ARM64 toolchain, selects runnable native aapt2, sets the Gradle aapt2 override, and isolates tablet temporary/cache files under `/tmp/tandem/v2`. Package-only operation does not provision or load Android tools; supply their paths explicitly. For the established APK-only side-by-side tablet build, keep using `bun script/build-tablet-android.ts` (no AAB/bundletool prerequisite).

## Build/stage commands (master-scheduled)

Build a development CLI only:

```sh
bun script/build-tandem-release.ts --single-cli --skip-android --allow-dev-version --out dist/tandem-release-local
```

Build the full production set once the version and production signing inputs are agreed:

```sh
bun script/build-tandem-release.ts --version <version> --strict --required-common --out dist/tandem-release-<version>
```

`--version` / `OPENCODE_VERSION` controls the CLI version only. Otherwise it defaults to `packages/cli/package.json`; `--allow-dev-version` selects a local timestamp version/channel when no version is supplied. Android version/versionCode remain owned by the Android configuration and must be selected separately for the release. The scripts do not bump package manifests or the lockfile.

Stage existing artifacts without any build:

```sh
bun script/package-tandem-release.ts --strict --required-common --out dist/tandem-release-<version>
bun script/package-tandem-release.ts --android-variant v2 --skip-cli --out dist/tandem-release-v2-android
bun script/package-tandem-release.ts --skip-android --out dist/tandem-release-cli
```

`--cli-dist` and `--android-outputs` select externally gathered build trees (also supported by the orchestrator with `--package-only`). Use an empty/new staging directory. Unlike v1, no recursive cleanup or `--no-clean` reuse is provided: an old artifact must not silently enter a new manifest/upload. Inputs are validated before staging; a failed copy may leave a partial staging directory that must not be published.

The manifest records source/output paths, sizes, SHA-256, CLI version and Android application ID/debug status. `SHA256SUMS` covers every staged artifact plus the manifest. On Linux, from the staging directory run `sha256sum -c SHA256SUMS`; smoke the packaged CLI/server in the isolated v2 environment and exercise the signed APK before calling the release ready.

## Publication and installation are explicit

Review the target commit and prior **Tandem** tag, list only implemented/verified changes, and record the pinned upstream baseline. Draft user-facing release notes in a Markdown file. Do not use the upstream publish/version scripts to publish Tandem.

Only after Jon requests publication:

```sh
gh release create <tag> --repo Liddo-kun/Tandem --target <commit> --notes-file <notes.md>
```

Upload either from a new packaging invocation with `--upload <tag> --repo Liddo-kun/Tandem`, or explicitly upload the reviewed staged files with `gh release upload ... --repo Liddo-kun/Tandem`. The packager uploads only the artifacts it just staged plus the manifest/checksums. It does not create releases, and rejects development/debug uploads. `GH_REPO` cannot silently redirect the default repository.

Install separately after approval: stage the selected Unix/Windows executable beside its destination, replace it, then verify the installed version. For Android use an explicitly targeted `adb -s <serial> install -r <verified-signed.apk>`; never uninstall production to bypass a signature mismatch. The existing tablet helper's `--install` is restricted to the development identity. Preserve daily v1 roots/data and a usable rollback; production cut-over and restarting port 4097 require Jon's agreement.

## Source verification status

See [release tooling handoff](v2-release-tooling-handoff.md) for the source inspection and bounded smoke evidence. Cross-platform builds, full release staging, APK/AAB signature/identity verification against real new outputs, installed-version checks and production cut-over are separate pending acceptance work.
