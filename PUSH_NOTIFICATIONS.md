# Push Notifications Import Notes

This documents the Whispercode push-notifications work that was not imported in commit `b7fc019fa`.
The small follow-ups imported separately were `packages/app/.gitignore` coverage for `.env.local` and root `.gitignore` coverage for `script/deploy-relay`.

## What The Feature Adds

Whispercode's push-notifications work adds a mobile push system for backgrounded mobile apps, primarily iOS.

- Pairs a mobile app install with an OpenCode server/session.
- Registers iOS push tokens through native app code.
- Adds APNS-facing relay infrastructure so local OpenCode servers do not need to talk directly to Apple Push Notification service.
- Adds a push CLI/package and relay package.
- Adds settings UI for mobile notification setup, test pushes, relay configuration, and pair status.
- Adds app-side push click handling so notifications can navigate back to the relevant session.
- Adds native iOS bridge code, entitlements, keychain/config storage, and startup integration.
- Adds tests around pairing, relay URLs, push plugin behavior, relay storage, APNS payloads, and check-ins.
- Reuses OpenCode's existing notification and server-event flow through a local push plugin rather than adding durable core OpenCode server endpoints in the final merge.

The expected user-facing behavior is: after pairing mobile with a server, the phone can receive notifications for OpenCode activity even while the mobile app is backgrounded.

## Why It Was Split Out

This is larger than a mobile compatibility patch. It introduces new packages, relay behavior, native iOS entitlements, pairing/security logic, UI settings, mobile/desktop notification plumbing, and native build requirements. It should be imported as its own focused feature pass so API compatibility, security, and native requirements can be reviewed together.

## Relevant Commits In The 99-Commit Sequence

The user's import numbering is the exact 99 commits from `git log --reverse dev..whisper/dev`.

- `54` - `7d37b6b49` - `add relay-backed mobile push notifications`
- `55` - `974a5c065` - `add notifications`
- `57` - `148ec52a1` - `improve mobile push pairing and pty handling`
- `59` - `648d8487f` - `Merge pull request #20 from DNGriffin/dg/notifs` - `feat(ios): Add push notifications`
- `61` - `6220727c8` - `linux fix for push plugin`
- `63` - `2324586df` - `remove terminal logging`
- `64` - `038624f36` - `unpin push plugin version`
- `65` - `9d384f5a7` - `update push version`
- `66` through `75` - notification follow-up branch ending in `025474cbb` - `Improve notifications`
- `76` - `0eb0dae5d` - `deploy relay git ignore` (`script/deploy-relay` ignore rule imported separately)
- `98` - `7411e59f3` - `clear notifs`

## Initial Notification PR

Merged by commit `59` (`648d8487f`) in the corrected 99-commit numbering. The actual feature branch commits are numbered separately because the 99-commit list includes side-branch commits.

- `7d37b6b49` - `add relay-backed mobile push notifications`
- `974a5c065` - `add notifications`
- `148ec52a1` - `improve mobile push pairing and pty handling`
- `648d8487f` - `Merge pull request #20 from DNGriffin/dg/notifs`

Main areas touched:

- `packages/app/src/context/push-relay.tsx`
- `packages/app/src/context/push-pair.tsx`
- `packages/app/src/components/settings-mobile-notifications.tsx`
- `packages/app/src/utils/push-plugin.ts`
- `packages/app/src/utils/push-pair.ts`
- `packages/app/src/utils/push-relay-url.ts`
- `packages/push/`
- `packages/push-relay/`
- `packages/ios/WhisperCode/WhisperCode/Bridge/PushBridge.swift`
- iOS entitlements and project metadata
- `packages/app/src/context/notification.tsx`
- `packages/app/src/utils/notification-click.ts`
- `packages/app/src/utils/server.ts`
- `packages/app/src/pages/layout.tsx`
- desktop, Electron, and Android notification adapter wiring
- root ignore/script/deploy support files
- transient branch commits touched PTY/OpenAPI/SDK files, but the final corrected merge does not appear to require importing those server/API changes.

## Follow-Up Notification PR

Merged by commit `75` (`025474cbb`) in the corrected 99-commit numbering. These commits refine the initial notification feature.

- `dd7f82a0a` - `notif with debugging and override`
- `69e2f0879` - `remove debug logs`
- `42ad8efa3` - `various notif fixes`
- `13c85ce99` - `push plugin changes`
- `bb9e209aa` - `push version`
- `e5bd383fb` - `push relay dedupe`
- `9a1551fb5` - `update push plugin to not pin version`
- `f3d429ac5` - `bump version, update push pair tests`
- `4d565a89b` - `update ios version, checkin test`
- `025474cbb` - `Merge pull request #23 from DNGriffin/dg/improve-notif`

Main areas touched:

- notification settings UI and data
- mobile platform push APIs
- push pairing tests and state machine
- push plugin installation and version handling
- iOS push bridge behavior
- abortable iOS bridge calls used by push pairing requests
- iOS app environment loading for push relay configuration
- push check-in command/tests
- push relay deduplication and store tests
- iOS project version metadata

## Supporting Push Commits After The Initial PR

These are commits after the initial notification merge that touch push packages or relay support.

- `6220727c8` - fixes Linux packaging behavior in `packages/push/src/pack.ts`.
- `2324586df` - removes terminal logging from `packages/push/src/index.ts` and `packages/push/src/state.ts`.
- `038624f36` - unpins push plugin version behavior and adds `packages/push/src/tsconfig.json`.
- `9d384f5a7` - updates push package version and related tests/lockfile.
- `0eb0dae5d` - adds deploy relay ignore rule.
- `7411e59f3` - clears iOS notifications during app lifecycle/startup and updates fastlane support.

## Import Guidance

If importing this feature into Tandem, treat it as a separate feature batch starting at numbered commit `54`, then include the follow-up fixes through numbered commit `75`. Commit `76` only adds `script/deploy-relay` to `.gitignore` and has already been imported.

Recommended scope for a dedicated import:

- Port `packages/push` and `packages/push-relay` deliberately.
- Adapt iOS native push code from Whisper's `WhisperCode` paths into Tandem's `OpenCode` layout.
- Adapt `PushBridge.swift`, `KeychainStore.swift`, entitlement files, and `OpenCodeApp.swift` startup/notification delegate behavior together.
- Reconcile shared app changes around `NotificationProvider`, `PushPairProvider`, `PushRelayProvider`, notification click routing, settings tabs, and mobile settings UI.
- Reconcile platform API additions across web, desktop, Electron, Android, and iOS so existing notification behavior does not regress.
- Include the iOS bridge timeout/abort support, iOS `envDir` behavior, and Bun test type support if importing the follow-up pairing/check-in tests.
- Review iOS entitlements and signing requirements on macOS/Xcode.
- Preserve current OpenCode server behavior; the final push merge is designed around plugin/relay behavior rather than core server endpoints.
- Regenerate or reconcile SDK/OpenAPI changes only if a future import intentionally reintroduces server API changes.
- Verify `bun typecheck` in relevant package directories.
- Add native verification steps for Xcode/APNS/relay behavior where Windows cannot validate them.

## Not The Same As Existing Notifications

Earlier OpenCode commits mention notifications, but they are not this mobile push feature. Examples include desktop/system notifications, toast notifications, project notification dots, CI notifications, and ecosystem docs. The push-notification import starts at corrected 99-list commit `54` (`7d37b6b49`) and is merged by commit `59` (`648d8487f`).
