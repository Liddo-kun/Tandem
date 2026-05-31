# Android Release Build Guide

This records the imported Whisper Android release-build notes for Tandem.

## Prerequisites

- Bun installed.
- Android SDK installed.
- Android NDK `27.0.12077973` installed.
- JDK 21 installed.
- Release keystore at `packages/android/release.keystore`. The release script creates this local ignored file on first run if both signing files are absent.
- Keystore config at `packages/android/keystore.properties`. The release script creates this local ignored file on first run if both signing files are absent.

Example `keystore.properties`:

```properties
storeFile=release.keystore
storePassword=your_password
keyAlias=your_alias
keyPassword=your_password
```

## Build

Normal Windows Tandem release builds run from repo root and install both the Windows CLI and connected Android app:

```bash
bun run tandem:release -- --install-windows --install-android
```

`--install-android` checks ADB before building and requires exactly one connected device unless `ANDROID_SERIAL` is set.

Strict public release packaging with an iOS IPA uses:

```bash
bun run tandem:release -- --version <version> --strict --required-common --ios-ipa <path>
```

For Android-only release verification, run:

```bash
bun run tandem:release -- --version <version> --skip-cli --skip-ios --allow-partial
```

The imported Whisper notes recommend an arm64 release build because all-target APKs can exceed GitHub's 100 MB file limit.

## Output

Expected release APK path:

```text
packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

## Notes

- `packages/android/release.keystore` and `packages/android/keystore.properties` are intentionally ignored.
- If only one Android signing file exists, restore the missing file or delete both files so `bun run tandem:release -- --version <version>` can create a fresh local signing pair.
- `packages/android/src-tauri/gen/` is intentionally ignored as generated Tauri Android output. The release script regenerates `src-tauri/gen/android` automatically when it is missing or stale.
- Android release signing is wired through `packages/android/patch-android-generated.ts`, which patches the generated Gradle project to read `packages/android/keystore.properties` when present.
- Android release signing was verified locally with `apksigner verify` for the APK and `jarsigner -verify` for the AAB.
