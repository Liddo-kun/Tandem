# Tandem V2 tablet Android infrastructure

## Build invocation

From `/home/jon/code/Tandem-v2`, after the Android worker finishes native/frontend configuration and master installs its dependencies:

```sh
PATH="/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin:$PATH" \
  bun script/build-tablet-android.ts
```

This builds an ARM64 release APK using `packages/android/src-tauri/tauri.v2.conf.json` and `OPENCODE_ANDROID_VARIANT=v2`. It does not install it. `--debug` selects a debug APK; `--config <JSON file>` selects another explicit Tauri override. The merged identifier must be `app.liddokun.tandem.v2`.

The generated project must first be initialized through the Android package's `init:v2` script, with `loadAndroidToolchainEnv()` applied to its environment. Initialization and builds are master-scheduled operations, not performed by this infrastructure assignment.

Output: `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk` (`debug` replaces `release` for debug builds).

Full build log: `/tmp/tandem/v2/android-build.log`. Setup log, when explicitly requested via `--setup`: `/tmp/tandem/v2/android-setup.log`. Temporary files, Gradle user home and download caches are under `/tmp/tandem/v2`.

## Device installation

Installation requires `--install`, optionally with `--device 127.0.0.1:5555`. `--overwrite` implies installation and permits uninstall only after a signature mismatch. The target is the APK's actual application ID, checked against the merged build configuration before any ADB installation. An unsuccessful uninstall stops the operation. Production `app.liddokun.tandem` is not accepted by this build entrypoint.

## Signing

Release builds use `/home/jon/.local/share/tandem-v2/android-signing/{release.keystore,keystore.properties}` by default. A V2-only key is created on an explicit release build when both files are absent; a partially missing pair fails. New files are mode 0600. Existing production signing files are neither copied nor replaced.

`TANDEM_ANDROID_KEYSTORE_PROPERTIES` can select existing signing properties; relative paths are resolved from the repo root and passed to Gradle as an absolute path. A missing explicitly supplied file fails rather than generating a replacement key. The referenced keystore must remain available. Preserve the original production key/properties separately for eventual agreed cut-over.

## Installed tablet prerequisites (inspected 2026-10-03)

- Bun: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun`, `1.4.2`.
- SDK: `/home/jon/Android/Sdk`; Android platforms 35 and 36 are present.
- NDK: `/home/jon/Android/Sdk/ndk/29.0.14206865`; clang 21.0.0. Its `toolchains/llvm/prebuilt/linux-aarch64` resolves to the community build's `linux-x86_64` directory; the compiler itself runs on ARM64 and reports a musl host target.
- JDK: `/usr/lib/jvm/java-17-openjdk-arm64`, OpenJDK 17.0.19.
- Cargo/rustup: `/home/jon/.cargo/bin`; Cargo and rustc 1.96.0. Installed Android targets include `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`.
- ARM64 glibc aapt2: `/home/jon/Android/Sdk/build-tools/{35.0.0,36.0.0}/aapt2`. Version command succeeds. The build script also passes the selected path as a Gradle project system property to prevent Maven's x86_64 aapt2 from being used.
- ADB: `/usr/bin/adb`, version 1.0.41 / Debian 34.0.4. Do not put the SDK's bionic `platform-tools/adb` on PATH.
- Host gcc, pkg-config, python and 7z are present under `/usr/bin`.

`setup-tablet-android.sh` retains the established community NDK/SDK and glibc build-tools sources. Run it only when toolchain provisioning is explicitly needed. It can install system packages and shared SDK/Rust components, but no longer rewrites `/etc/profile.d/50-android.sh`. Downloads and extraction use `/tmp/tandem/v2`.

## Integration ownership

The Android worker owns `packages/android/**`, including the V2 config, V2-aware generated metadata, release signing wiring, icons, frontend build and native initialization. The infrastructure expects its `tauri` script to prepare Android metadata before calling Tauri. The worker's existing external signing-properties hook is used directly.

Master owns package/lockfile changes and build scheduling. The newly added Android workspace requires a dependency install after its package manifest is final; this worker does not update the lockfile. An optional root convenience script is `"tandem:tablet": "bun script/build-tablet-android.ts"`; it must be run with pinned Bun on PATH.

No broad release orchestrator, variant installer, iOS workflow or package-source patcher is copied into `script/`.
