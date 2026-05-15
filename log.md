# Tandem Change Log

This log records meaningful changes made to Tandem's OpenCode-based repo.

## Mobile iOS Voice And WebView Updates

Commits:

- `cd74a6c6b mobile: ignore local mobile artifacts`
- `7a1f3af0d mobile: import Whisper iOS voice updates`

### Ignore Rules

- Added `context.md` to the root `.gitignore`.
- Added `packages/ios/.gitignore` for iOS local/generated artifacts:
  - `WebAssets/`
  - `xcuserdata/`
  - `*.xcuserstate`

### iOS WebView Asset Loading

- Added an `app-local://localhost` custom URL scheme handler in `packages/ios/OpenCode/WebView/BridgeController.swift`.
- Bundled iOS web assets can now be served through the custom scheme instead of direct `file://` loading.
- The WebView notifies the native platform bridge when web content finishes loading.

### iOS Server Connection Help

- Added iOS-only connection help to the server selection dialog.
- Added iOS-only connection help to the home screen.
- The iOS helper text uses this server command:

```bash
opencode web --hostname 0.0.0.0 --cors app-local://localhost
```

### Shared App Voice API

- Extended the shared `Platform` type with iOS voice status and structured voice results.
- Added exported voice types:
  - `VoiceState`
  - `VoiceStatus`
  - `VoiceStartResult`
  - `VoiceStopResult`
- `startVoiceInput` now returns a structured result.
- `stopVoiceInput` now returns `{ text, code?, message? }`.
- Added optional `voiceStatus` to expose native voice state to the app.
- Re-exported the voice types from `packages/app/src/index.ts`.

### Prompt Input Voice UX

- The iOS microphone button now handles the promise-returning voice start API safely.
- The microphone button is disabled while voice input is recording or processing.

### iOS Voice Overlay

- `packages/ios/src/voice-input.tsx` now uses explicit overlay states:
  - `hidden`
  - `recording`
  - `processing`
- The overlay shows `Listening...` while recording.
- The overlay shows `Processing...` while transcription is running.
- The stop button is disabled while processing.

### iOS Entry Bridge

- `packages/ios/src/entry-ios.tsx` tracks native voice state with a Solid signal.
- It requests native voice status on mount via `isWhisperReady`.
- It listens for native `voiceState` events.
- It shows voice failures via toast notifications.
- It emits final `opencode:transcription` events after successful transcription.

### Native iOS Voice Bridge

- Reworked `packages/ios/OpenCode/Bridge/WhisperBridge.swift` into a stateful native voice controller.
- Native voice states are now:
  - `prewarming`
  - `ready`
  - `recording`
  - `processing`
  - `error`
- Start and stop return structured result payloads to JavaScript.
- Native state changes are emitted to JavaScript as `voiceState` events.
- Duplicate starts, empty recordings, and permission failures now return explicit error codes/messages.

### WhisperKit And Speech Recognition

- Reworked `packages/ios/OpenCode/Whisper/WhisperManager.swift` around explicit model state.
- WhisperKit preload starts after WebView content load.
- WhisperKit is used on iOS 18+.
- The WhisperKit model is `openai_whisper-tiny.en` with background download enabled.
- WhisperKit load/transcription failures return structured error details.
- Added `packages/ios/OpenCode/Whisper/SpeechTranscriber.swift` as an `SFSpeechRecognizer` fallback.
- The native voice bridge falls back to `SFSpeechRecognizer` if WhisperKit is unavailable or transcription fails.

### iOS Permissions And Local Networking

- Added `NSSpeechRecognitionUsageDescription` to `packages/ios/OpenCode/Info.plist`.
- Kept `NSMicrophoneUsageDescription` for recording.
- Added local networking allowance in App Transport Security.

### iOS Keyboard Toolbar

- Adjusted the iOS keyboard accessory toolbar installation.
- The toolbar is installed on `keyboardDidShow`.
- The toolbar uses an explicit WebView/screen-based width and flexible resizing.

### Verification

- Ran `bun typecheck` in `packages/app` successfully.
- Ran `bun typecheck` in `packages/ios` successfully.
- Ran `git diff --check` successfully before committing.
- Native Swift/Xcode build was not verified because the work was done on Windows.

## Mobile iOS Onboarding, Resume, And Pull-To-Refresh

Whisper commits processed: `d7154863d` through `cedb90b15`.

### Imported

- Switched bundled iOS asset loading to the `tauri://localhost` custom scheme.
- Added bundled iOS SPA fallback so unknown extensionless paths resolve to `index.html`.
- Removed the need for the iOS server command to include `--cors app-local://localhost`.
- Updated iOS helper text to recommend `opencode web --hostname 0.0.0.0`.
- Added native iOS lifecycle events and web `opencode:resume` handling.
- Added forced session/global refresh on mobile resume/focus/visibility/online events.
- Added iOS first-run onboarding for server setup and connection.
- Added iOS LAN scanning for OpenCode servers on port `4096`.
- Added mobile pull-to-refresh in the session timeline.

### Skipped

- App icon updates from WhisperCode branding.
- iOS build/version bump.
- README, App Store link, privacy policy, and release-doc-only updates.

### Verification

- Ran `bun typecheck` in `packages/app` successfully.
- Ran `bun typecheck` in `packages/ios` successfully.
- Ran `git diff --check` successfully.
- Native Swift/Xcode build was not verified because the work was done on Windows.

## Mobile Android Support And Onboarding Health Checks

Whisper commits processed: `1893c8c68` through `21b6868f2`.

### Imported

- Added `packages/android` with Android web entry, Tauri config, Rust mobile bridge, Android Kotlin bridge plugin, storage, onboarding, and voice overlay.
- Added Android to the shared app platform type.
- Enabled the mobile microphone button and connection helper text for Android.
- Added Android local/generated/signing ignore rules:
  - `packages/android/src-tauri/**/build/`
  - `packages/android/src-tauri/gen/`
  - `packages/android/release.keystore`
- Adapted Android startup to current OpenCode server APIs:
  - `Platform.getDefaultServer`
  - `Platform.setDefaultServer`
  - `ServerConnection.Key.make`
- Imported onboarding health-check fixes:
  - iOS network scan now checks `/global/health`.
  - iOS onboarding uses native `checkHealth`.
  - Android onboarding checks `/global/health` before falling back to `/health`.
- Added `ANDROID_BUILD.md` with adapted release-build notes.
- Ran `bun install` to update workspace dependencies and `bun.lock`.

### Skipped

- iOS build-number bump.
- Generated Android project output under `packages/android/src-tauri/gen/`.
- Desktop Android icon churn and WhisperCode branding/icon churn.
- Android generated Gradle signing-config changes, because `src-tauri/gen/` is intentionally ignored/generated.

### Verification

- Ran `bun typecheck` in `packages/app` successfully.
- Ran `bun typecheck` in `packages/ios` successfully.
- Ran `bun typecheck` in `packages/android` successfully.
- Ran `git diff --check` successfully.
- Native Swift/Xcode, Rust, Gradle, and APK builds were not verified because the work was done on Windows.

## Mobile Onboarding Credentials And Keyboard Refinements

Whisper commits processed: `e4c2f4630` through `c923e83ac`.

### Imported

- Added optional display name, username, and password fields to iOS and Android onboarding.
- Persisted mobile onboarding credentials in platform-local storage and pass them to `AppInterface` as a server entry so shared OpenCode health/API calls can use Basic auth.
- Extended iOS native `checkHealth` to include Basic auth headers when onboarding credentials are provided.
- Added the iOS keyboard accessory `\dw` action, native bridge event, and prompt-input delete-word handling.
- Added Android runtime platform marking with `document.documentElement.dataset.platform = "android"` for mobile-specific web behavior.
- Updated mobile resume handling so the SSE stream reconnects on `opencode:resume` and active session status refreshes alongside message/session data.
- Added the Android debug build flag to `packages/android/build-and-install.sh` so local debug installs do not require release signing.
- Added iOS local build/TestFlight artifact ignore rules under `packages/ios/.gitignore`.
- Declared `ITSAppUsesNonExemptEncryption` as false in the iOS `Info.plist`.
- Truncated long model names in the mobile prompt controls while preserving the full title tooltip.

### Skipped

- README/download-link edits and AGENTS.md changes from Whisper.
- iOS 17/project metadata and version/build-number bumps, because Tandem keeps `packages/ios/OpenCode` and native project metadata was not verified on Windows.
- The large upstream merge commit, except for mobile follow-up fixes that still applied to Tandem.
- Beam/TestFlight scripting and docs.
- Generated Android Gradle output under `packages/android/src-tauri/gen/`.
- The large push notification/relay feature merge and follow-up push-package commits; these add new packages, native entitlements, APNS relay infrastructure, and settings UI, and should be evaluated as a separate feature import.

### Verification

- Ran `bun typecheck` in `packages/app` successfully.
- Ran `bun typecheck` in `packages/ios` successfully after fixing the onboarding prop type.
- Ran `bun typecheck` in `packages/android` successfully.
- Ran `git diff --check` successfully.
- Native Swift/Xcode, Rust, Gradle, and APK builds were not verified because the work was done on Windows.
