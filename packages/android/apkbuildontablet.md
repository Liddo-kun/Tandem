# Building the Android APK on the tablet (aarch64 chroot)

How to build the Tandem Android APK natively in the Ubuntu aarch64 chroot on the Y700,
instead of on the Windows x86_64 box. This works because the toolchain was sourced as
**arm64-Linux** builds; Google ships the NDK and SDK build-tools for x86_64 hosts only.

## Quick commands (do this)

From the repo root:

```sh
bun run tandem:tablet -- --setup     # one-time: install the arm64 toolchain (idempotent)
bun run tandem:tablet -- --install   # build the debug APK and install it on the tablet
```

`--setup` runs `script/setup-tablet-android.sh`; the build/install runs
`script/build-tablet-android.ts`. Add `--overwrite` if a release-signed Tandem is already
installed (it erases that app's data). The rest of this file explains what those scripts do.

## One-time setup (already done on this machine)

**System packages** (`apt`, needs sudo):

```
openjdk-17-jdk-headless build-essential pkg-config p7zip-full python-is-python3
```

**Rust** (rustup, as user `jon`): stable toolchain + Android targets
(`rustup target add aarch64-linux-android` — `tauri android init` adds the rest).

**SDK at `~/Android/Sdk`** assembled from community arm64 builds:

- **NDK** — `lzhiyong/termux-ndk` r29 (`android-ndk-r29-aarch64.7z`). Its `clang`/`lld` are
  **statically linked (musl/Zig)**, so they run in the glibc chroot. Placed at
  `~/Android/Sdk/ndk/29.0.14206865`. (`ndk-build` is broken on aarch64, but Tauri drives
  cargo -> NDK clang directly, so that does not matter.)
- **SDK base** — `lzhiyong/termux-ndk` `android-sdk-aarch64.7z`: `cmdline-tools` (sdkmanager,
  Java), `platforms` android-35/36 (Java), `platform-tools`, `cmake`, `build-tools/35.0.0`.
- **build-tools native binaries** — the lzhiyong ones are **bionic** (request
  `/system/bin/linker64`, absent in the chroot), so the native binaries
  (`aapt2`, `aidl`, `zipalign`, `split-select`) were replaced with **glibc** arm64 builds
  from `Commit451/android-arm-build-tools` (the `36.0.0` release). `d8`/`apksigner` are Java
  wrappers and need no change. Both `build-tools/35.0.0` and `build-tools/36.0.0` carry the
  glibc binaries.

**Environment** — `/etc/profile.d/50-android.sh` (loaded by every login shell):

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NDK_HOME="$ANDROID_HOME/ndk/29.0.14206865"
export ANDROID_NDK_HOME="$NDK_HOME"
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-arm64"
export PATH="$HOME/.cargo/bin:$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
```

Note: `$ANDROID_HOME/platform-tools` is intentionally NOT on PATH — that `adb` is bionic.
The working glibc `adb` is `/usr/bin/adb` (system `android-sdk` package).

## The two gotchas

1. **bionic vs glibc** — only statically linked (NDK) or glibc-built (build-tools) binaries
   run in the chroot. Bionic binaries fail with `cannot execute: required file not found`
   (missing `/system/bin/linker64`).
2. **AGP pulls its own x86_64 aapt2 from Maven** and chokes
   (`aapt2: Syntax error: "(" unexpected`). Fixed with
   `android.aapt2FromMavenOverride=<arm64 aapt2>` in `gen/android/gradle.properties`.
   `patch-android-generated.ts` re-injects this automatically on arm64 Linux hosts
   (`findArm64Aapt2()`), so it survives `gen/android` regeneration. No-op off-tablet.

## Build + install

```sh
cd packages/android
bun run tauri android init --ci          # first time / after gen/android is wiped
bun run tauri android build --apk --debug --target aarch64
```

Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

Install (use the glibc adb; reconnect first if no device):

```sh
adb connect 127.0.0.1:5555
adb install -r <apk>     # debug-signed; collides with a release-signed install of the
                         # same id (app.liddokun.tandem) -> uninstall first to overwrite
```
