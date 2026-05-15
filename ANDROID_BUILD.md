# Android Release Build Guide

This records the imported Whisper Android release-build notes for Tandem.

## Prerequisites

- Bun installed.
- Android SDK installed.
- Android NDK `27.0.12077973` installed.
- JDK 21 installed.
- Release keystore at `packages/android/release.keystore`.
- Keystore config at `packages/android/src-tauri/gen/android/keystore.properties`.

Example `keystore.properties`:

```properties
storeFile=../../../../release.keystore
storePassword=your_password
keyAlias=your_alias
keyPassword=your_password
```

## Build

Run from `packages/android` after setting local Android environment variables:

```bash
bun run tauri android build --apk --target aarch64
```

The imported Whisper notes recommend an arm64 release build because all-target APKs can exceed GitHub's 100 MB file limit.

## Output

Expected release APK path:

```text
packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

## Notes

- `packages/android/release.keystore` is intentionally ignored.
- `packages/android/src-tauri/gen/` is intentionally ignored as generated Tauri Android output.
- Native Android build/signing was not verified during the Windows import.
