# Tandem Change Log

This log is the final-state inventory of Tandem changes relative to official OpenCode.
Document current deltas only: no skipped commits, no OpenCode merge history, and no superseded behavior.
For each item, reference the modified files or stable symbols; line numbers are optional and may drift.

## Repo Metadata And Docs

- Adds Tandem local/generated ignore coverage for local context, env files, iOS generated assets, Android generated/build output, Android signing keys, and relay deploy artifacts. Files: `.gitignore`, `packages/app/.gitignore`, `packages/ios/.gitignore`.
- Adds Android release/build guidance and generated/signing artifact caveats. Files: `ANDROID_BUILD.md`.
- Adds separate push-notification feature notes outside this final-state inventory. Files: `PUSH_NOTIFICATIONS.md`.
- Adds iOS and Android workspace package metadata and updates workspace dependency resolution. Files: `bun.lock`, `packages/ios/package.json`, `packages/android/package.json`.

## Shared Platform And Persistence

- Extends the shared platform contract for mobile storage, default server persistence, structured voice state/start/stop, speech locale selection, haptics, and sharing. Files: `packages/app/src/context/platform.tsx`, `packages/app/src/index.ts`.
- Adds platform-backed async persistence for non-web apps while preserving legacy localStorage migration and workspace/session key normalization. Files: `packages/app/src/utils/persist.ts`.
- Adds mobile default-server handling through current OpenCode `ServerConnection.Key` and `AppInterface` server entries. Files: `packages/app/src/context/platform.tsx`, `packages/ios/src/entry-ios.tsx`, `packages/android/src/entry-android.tsx`.
- Adds mobile connection helper text for server setup. Files: `packages/app/src/components/dialog-select-server.tsx`, `packages/app/src/pages/home.tsx`.
- Adds speech locale settings persisted under `settings.v3`, platform pushdown of selected locale, and a mobile-only General settings selector. Files: `packages/app/src/context/settings.tsx`, `packages/app/src/components/settings-general.tsx`, `packages/app/src/context/platform.tsx`.
- Adds English fallback text for mobile, voice, speech-locale, refresh, delete-word, review-limit, and onboarding strings across locale dictionaries. Files: `packages/app/src/i18n/*.ts`.

## iOS App Package

- Adds the iOS app workspace package, Vite entry, bundled asset build config, and Solid entry point that mounts the shared OpenCode app through mobile platform providers. Files: `packages/ios/package.json`, `packages/ios/index.html`, `packages/ios/vite.config.ts`, `packages/ios/tsconfig.json`, `packages/ios/src/entry-ios.tsx`.
- Adds the SwiftUI iOS app shell and WebView host. Files: `packages/ios/OpenCode/App/OpenCodeApp.swift`, `packages/ios/OpenCode/App/ContentView.swift`, `packages/ios/OpenCode/WebView/OpenCodeWebView.swift`.
- Serves bundled web assets through `tauri://localhost`, supports SPA fallback to `index.html`, serves either `WebAssets/` or bundle-root assets, and keeps local dev server loading opt-in via `OPENCODE_USE_DEV_SERVER=1`. Files: `packages/ios/OpenCode/WebView/BridgeController.swift`, `packages/ios/vite.config.ts`.
- Adds native bridge plumbing for JavaScript requests/events, app lifecycle events, storage/default-server APIs, health checks, LAN scanning, reload, haptics, sharing, external links, voice input, speech locales, and keyboard toolbar events. Files: `packages/ios/OpenCode/Bridge/PlatformBridge.swift`, `packages/ios/OpenCode/WebView/BridgeController.swift`, `packages/ios/src/bridge.ts`, `packages/ios/src/ios-storage.ts`.
- Adds first-run iOS onboarding when no default server is configured, including setup instructions, copyable server command, manual URL entry, LAN scan, native `/global/health` checks, and optional display name/Basic auth credentials. Files: `packages/ios/src/onboarding.tsx`, `packages/ios/src/entry-ios.tsx`, `packages/ios/OpenCode/Bridge/NetworkScanBridge.swift`, `packages/ios/OpenCode/Bridge/PlatformBridge.swift`.
- Adds iOS server/default-credential storage through native UserDefaults-backed bridge storage. Files: `packages/ios/OpenCode/Config/ServerConfig.swift`, `packages/ios/src/ios-storage.ts`, `packages/ios/src/entry-ios.tsx`.
- Adds iOS voice input with stateful native status, WhisperKit preload/transcription on supported English locales, `SFSpeechRecognizer` fallback, locale-aware speech recognition, structured errors, and web transcription events. Files: `packages/ios/OpenCode/Bridge/WhisperBridge.swift`, `packages/ios/OpenCode/Whisper/WhisperManager.swift`, `packages/ios/OpenCode/Whisper/WhisperModel.swift`, `packages/ios/OpenCode/Whisper/AudioRecorder.swift`, `packages/ios/OpenCode/Whisper/SpeechTranscriber.swift`, `packages/ios/src/entry-ios.tsx`, `packages/ios/src/voice-input.tsx`.
- Adds iOS speech locale discovery/selection and displays the selected language in the voice overlay. Files: `packages/ios/OpenCode/Bridge/WhisperBridge.swift`, `packages/ios/OpenCode/Bridge/PlatformBridge.swift`, `packages/ios/src/entry-ios.tsx`, `packages/ios/src/voice-input.tsx`.
- Adds iOS keyboard accessory events for navigation, clear, delete word, newline, and dismiss behavior. Files: `packages/ios/OpenCode/Bridge/KeyboardBridge.swift`, `packages/ios/OpenCode/WebView/BridgeController.swift`, `packages/ios/src/entry-ios.tsx`, `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/prompt-input/editor-dom.ts`.
- Adds iOS haptics, gesture overlay plumbing, and native share behavior. Files: `packages/ios/OpenCode/Bridge/HapticBridge.swift`, `packages/ios/OpenCode/Bridge/GestureBridge.swift`, `packages/ios/OpenCode/Gestures/GestureOverlayView.swift`, `packages/ios/OpenCode/Bridge/PlatformBridge.swift`.
- Adds iOS mobile privacy, local networking, speech/microphone permissions, ATS allowances for LAN health checks, and App Store privacy metadata. Files: `packages/ios/OpenCode/Info.plist`, `packages/ios/OpenCode/PrivacyInfo.xcprivacy`.
- Adds iOS package icon/mark assets and helper scripts used by the mobile package. Files: `packages/ios/generate-icons.py`, `packages/ios/mark-w.svg`, `packages/ios/mark-w-light.svg`, `packages/ios/mark-w-tinted.svg`.

## Android App Package

- Adds the Android app workspace package, Vite entry, and shared-app mount through mobile platform providers. Files: `packages/android/package.json`, `packages/android/index.html`, `packages/android/vite.config.ts`, `packages/android/tsconfig.json`, `packages/android/src/entry-android.tsx`.
- Adds Android Tauri mobile configuration, Rust app shell, capabilities, and mobile bridge plugin. Files: `packages/android/src-tauri/Cargo.toml`, `packages/android/src-tauri/Cargo.lock`, `packages/android/src-tauri/build.rs`, `packages/android/src-tauri/tauri.conf.json`, `packages/android/src-tauri/capabilities/default.json`, `packages/android/src-tauri/src/*.rs`, `packages/android/src-tauri/mobile-bridge/**`.
- Adds the Android Kotlin mobile bridge plugin used by Tauri commands and permissions. Files: `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`, `packages/android/src-tauri/mobile-bridge/android/**`.
- Adds Android bridge, platform storage, default-server persistence, credential persistence, external links, in-app notifications, haptics, share, resume events, and mobile platform marking. Files: `packages/android/src/bridge.ts`, `packages/android/src/storage.ts`, `packages/android/src/entry-android.tsx`.
- Stabilizes Android keyboard resizing by making the WebView root follow `visualViewport`, applying `adjustResize` to generated Android manifests before Tauri commands, and refreshing scroll-bottom state when the viewport changes. Files: `packages/android/index.html`, `packages/android/src/entry-android.tsx`, `packages/android/package.json`, `packages/android/patch-android-manifest.ts`, `packages/ui/src/hooks/create-auto-scroll.tsx`.
- Adds Android first-run onboarding with setup instructions, manual URL entry, optional display name/Basic auth credentials, and `/global/health` then `/health` checks. Files: `packages/android/src/onboarding.tsx`, `packages/android/src/entry-android.tsx`.
- Adds Android voice input bridge integration and overlay. Files: `packages/android/src/entry-android.tsx`, `packages/android/src/voice-input.tsx`, `packages/android/src-tauri/mobile-bridge/src/commands.rs`, `packages/android/src-tauri/mobile-bridge/android/src/main/java/MobileBridgePlugin.kt`.
- Adds Android debug build/install helper and icon generation helper. Files: `packages/android/build-and-install.sh`, `packages/android/generate-icons.py`.

## Shared Mobile UI And Session Behavior

- Adds mobile prompt voice controls, `opencode:transcription` handling, mobile-specific prompt voice placement, and protection against editor refocus when tapping mobile prompt controls. Files: `packages/app/src/components/prompt-input.tsx`, `packages/ios/src/entry-ios.tsx`, `packages/android/src/entry-android.tsx`.
- Adds prompt keyboard delete-word behavior for native mobile toolbar events. Files: `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/prompt-input/editor-dom.ts`, `packages/ios/src/entry-ios.tsx`.
- Truncates long prompt model names while preserving full-value tooltips. Files: `packages/app/src/components/prompt-input.tsx`.
- Adds prompt footer context-token display and a tighter prompt input inset for mobile-safe composer layout. Files: `packages/app/src/components/prompt-input.tsx`.
- Adds mobile-visible session header search and mobile refresh button behavior. Files: `packages/app/src/components/session/session-header.tsx`.
- Adds mobile connection and platform help in shared app surfaces. Files: `packages/app/src/components/dialog-select-server.tsx`, `packages/app/src/pages/home.tsx`.
- Adds mobile resume recovery for browser focus, visibility restore, online, page show, native foreground events, and SSE reconnect. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/context/global-sdk.tsx`, `packages/app/src/context/global-sync.tsx`, `packages/app/src/context/sync.tsx`, `packages/ios/src/entry-ios.tsx`, `packages/android/src/entry-android.tsx`.
- Adds session/todo/status refresh on active-session resume and copy-safe todo cache updates. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/context/global-sync.tsx`, `packages/app/src/context/global-sync/event-reducer.ts`, `packages/app/src/context/todo-store.ts`.
- Adds session ancestor warming for mobile permission/question prompt requests that arrive after background suspension. Files: `packages/app/src/context/global-sync.tsx`, `packages/app/src/context/global-sync/bootstrap.ts`, `packages/app/src/context/global-sync/bootstrap.test.ts`.
- Adds mobile-aware reversed timeline scrolling, bottom detection, nested scroll gesture protection, and scroll-view keyboard endpoints for iOS/Android positive scroll offsets. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/message-timeline.tsx`, `packages/ui/src/components/scroll-view.tsx`, `packages/ui/src/components/scroll-view.css`, `packages/ui/src/hooks/create-auto-scroll.tsx`.
- Folds mobile session title, context usage, and overflow actions into the Session tab, hides the duplicate timeline title bar on phones except while renaming, and defers native-mobile delete confirmation until after the non-modal menu closes. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/message-timeline.tsx`.
- Tightens mobile session tab and composer spacing. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/composer/session-composer-region.tsx`.
- Exposes mobile session refresh through the session header button. Files: `packages/app/src/components/session/session-header.tsx`, `packages/app/src/pages/session.tsx`, `packages/app/src/pages/session/message-timeline.tsx`.
- Adds mobile review diff fallback behavior when VCS diffs are empty or unavailable, including file-status/file-read fallback, legacy `before`/`after` diff normalization, synthetic deleted-file patches, and a 100-file mobile review cap. Files: `packages/app/src/pages/session.tsx`, `packages/app/src/utils/diffs.ts`, `packages/app/src/utils/mobile-review-limit.ts`, `packages/app/src/utils/diffs.test.ts`.
- Adds touch/pointer support for inline file comments and direct draft opening on coarse/touch pointers. Files: `packages/ui/src/components/file.tsx`, `packages/ui/src/components/line-comment-annotations.tsx`, `packages/ui/src/components/line-comment.tsx`.
- Adds touch-drag terminal scrollback on iOS/Android. Files: `packages/app/src/components/terminal.tsx`, `packages/app/src/components/terminal-touch.test.ts`.
- Adds mobile-specific icons used by prompt, keyboard, refresh, and platform controls. Files: `packages/ui/src/components/icon.tsx`.

## Shared Chat And Tool Display

- Compacts chat feed spacing by reducing user bubble padding, assistant text spacing, copy-row reserve height, assistant content gap, and turn-list gap. Files: `packages/ui/src/components/message-part.css`, `packages/ui/src/components/session-turn.css`.
- Adds compact multiline tool summary triggers for Bash and `apply_patch`, including status dots, command/file subjects, and first-line output/change previews while preserving existing expanded details. Files: `packages/ui/src/components/basic-tool.tsx`, `packages/ui/src/components/basic-tool.css`, `packages/ui/src/components/collapsible.css`, `packages/ui/src/components/message-part.tsx`, `packages/ui/src/components/tool-error-card.tsx`.
