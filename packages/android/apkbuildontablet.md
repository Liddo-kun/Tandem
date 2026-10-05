# First V2 Android checkpoint

Base `src-tauri/tauri.conf.json` retains production `app.liddokun.tandem` / Tandem.
`src-tauri/tauri.v2.conf.json` supplies `app.liddokun.tandem.v2` / Tandem V2.
Use the V2 scripts for both initialization and build: their environment also selects
the matching generated metadata and frontend title. Internal Rust/Kotlin names are
not application IDs and remain stable.

Master owns dependency installation, serialized builds, signing and device operations.
Source implementation alone is not checkpoint acceptance.

## Prerequisites

- Pin Bun 1.4.2 on PATH: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin`.
- Existing JDK 17: `/usr/lib/jvm/java-17-openjdk-arm64`.
- Rust Android target `aarch64-linux-android`.
- `ANDROID_HOME` / `ANDROID_SDK_ROOT`: `/home/jon/Android/Sdk`.
- `NDK_HOME` / `ANDROID_NDK_HOME`: `/home/jon/Android/Sdk/ndk/29.0.14206865`.
- Platform 36 for the bridge; current Tauri generation also requires platform 37.
  Gradle installs missing platform packages alongside the existing SDK.
- glibc ARM64 SDK build-tools. The generated patcher sets
  `android.aapt2FromMavenOverride` instead of Maven's x86_64 aapt2.
- `/usr/bin/adb`; do not put the SDK's bionic platform-tools on PATH.

Tauri initialization can exhaust Android's shared UID inotify limits before
generating the project. The first checkpoint build temporarily raised
`fs.inotify.max_user_instances` from 128 to 1024 and `max_user_watches` from
77755 to 262144, then restored both original values. Coordinate any repeat
adjustment with master; stopping unrelated processes is unnecessary.

Gradle may add Google's x86_64 build-tools in a suffixed directory such as
`36.0.0-2`. The generated patcher and tablet build script now select an aapt2
that actually runs on this host, including for final APK identity inspection.

## Master build sequence

After installing the Android workspace dependencies and completing the first real
server tool session, run from `packages/android` with the pinned Bun/toolchain environment:

```sh
bun run init:v2
bun run build:v2
```

`build` deliberately bundles only; focused typechecks are a separate post-live check.
No build script installs the APK. Generated sources/caches are ignored and must not
be copied from v1.

Release signing uses `TANDEM_ANDROID_KEYSTORE_PROPERTIES` pointing to an external
development properties file (absolute path). It contains Gradle's `storeFile`,
`storePassword`, `keyAlias` and `keyPassword`. Resolve `storeFile` relative to that
properties file or supply an absolute path. Keep one development key across APK
updates. The ignored local `keystore.properties` path remains a production fallback;
never copy production keys into the worktree or log property values.

Output:
`src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`.
Check adjacent `output-metadata.json` for **app.liddokun.tandem.v2** before installation.
Do not use v1's `--overwrite` installer: its uninstall target is the daily app.

## Connection and acceptance

Enter the isolated development server's full URL including port 4098 and its password.
Native discovery prefers 4097 with 4096 fallback; a recognizable 401 response is
listed as credential-required. Successful connection requires the v2 `/api/info`
contract. Pasted single-use v2 pairing links are exchanged through the shared client.
Do not recommend the current CLI `pair --server` until its service-election behavior
has been adapted for an explicit isolated endpoint.

Acceptance requires actual Android tool use and saved connection plus text/image
draft recovery after relaunch. Check keyboard, rotation, zoom and both directions;
safe-area values have one wrapper owner and shared chrome consumes them. No custom
voice/microphone integration is included; keyboard IME dictation remains native.
