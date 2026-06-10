# Tandem Project Context

Use this as the recurring startup context when working in `Tandem` from Ubuntu/Linux/proot. The root `AGENTS.md` should stay as a thin pointer to the environment-specific context file so the project rules do not drift across documents.

## Goal

Build and maintain one personal repo, `Tandem`, based on current official OpenCode, with selected Whispercode mobile/iOS/Android features and personal enhancements, while staying easy to update from OpenCode.

Use `log.md` as the exhaustive final-state inventory of Tandem changes relative to official OpenCode. This file explains how to work in this repo from Ubuntu/Linux/proot; it should not become a skipped-commit ledger or merge-history log.

Always read and update log.md when making a change to opencode, the web ui or the mobile apps.

See `PromptEnhance.md` for the built-in prompt-corrector/RePrompt plugin (a Tandem personal enhancement): what it corrects, how it works, and its env-var configuration.

Before changing `packages/opencode` backend source, first check whether OpenCode config, a plugin, the opencode configuration skill, or documented extension points can solve the request without creating fork divergence.

## Source Priorities

- Official OpenCode is the long-term source of truth and default conflict winner.
- Whispercode is only a feature donor, mainly for mobile wrappers and shared web UI improvements.
- Tandem is the product: current OpenCode plus deliberately selected Whispercode mobile features and personal enhancements.
- Future updates must primarily come from official OpenCode; do not blindly merge Whispercode.
- New divergence from OpenCode needs a clear compatibility or personal-product reason.

## Repo And Branch Model

Expected remotes:

```text
origin   = personal Tandem repo / fork
upstream = official OpenCode
whisper  = Whispercode
```

- The default branch is `dev`; local `main` may not exist. Use `dev` or `origin/dev` for comparisons unless remotes show otherwise.
- The repo should remain shaped like current OpenCode with additive mobile packages and carefully isolated shared-web UI deltas.
- Do not preserve old Whispercode server or web UI code just because it exists.
- Root workspaces are `packages/*`, `packages/console/*`, `packages/sdk/js`, and `packages/slack`; this is a Bun/Turbo monorepo using `tsgo` for type checks.

## Merge And Update Rules

- For normal OpenCode syncs, fetch `upstream`, switch to `dev`, then merge `upstream/dev`. Use merge, not rebase, and do not force-push normal sync work.
- For Whispercode after the initial import, fetch `whisper`, then cherry-pick or manually port only specific useful commits/features.
- Core OpenCode/server files: default to current OpenCode; keep fork behavior only when an explicit mobile compatibility reason exists.
- iOS/Android/mobile-specific files: prefer the Tandem mobile behavior already documented in `log.md`.
- Shared web UI mobile changes: inspect manually and keep the smallest useful behavior. Preserve Tandem-added features that still serve the mobile/product contract, and import compatible OpenCode improvements.
- Preserve `UPSTREAM-DIVERGENCE` comments. They mark Tandem-specific code that should survive upstream merges.
- Do not treat `PUSH_NOTIFICATIONS.md` notes as implemented source unless the referenced files exist in Tandem.
- If conflicts arise, optimize for a working current OpenCode build with the documented iOS/Android/mobile behavior intact.

## Package Boundaries

- `packages/opencode` owns the CLI, API server, TUI, storage, session/domain services, and provider integration. Start at `src/index.ts`, `src/cli/cmd/*`, `src/server/server.ts`, and `src/server/routes/instance/httpapi/server.ts`.
- `packages/app` is the shared Solid web UI used by standalone web, embedded CLI web UI, desktop renderer, Android, and iOS. Start at `src/entry.tsx`, `src/app.tsx`, `src/context/platform.tsx`, `src/context/server.tsx`, and `src/pages/session.tsx`.
- `packages/ui` is shared chat/component/CSS infrastructure. Message rendering lives in `src/components/session-turn.tsx`, `src/components/message-part.tsx`, `src/components/basic-tool.tsx`, and their CSS; changes affect web, desktop, Android, iOS, and embedded web UI.
- `packages/sdk/js` is generated from the HTTP API. Generated v2 client code lives under `src/v2/gen`.
- `packages/desktop` is the Electron wrapper. Main process code is `src/main/*`, preload IPC is `src/preload/index.ts`, and renderer code mounts `@opencode-ai/app` from `src/renderer/index.tsx`.
- `packages/android` is the Tauri Android wrapper around `@opencode-ai/app`. Platform wiring is `src/entry-android.tsx`, bridge code is `src/bridge.ts`, native storage is `src/storage.ts`, and the native plugin is under `src-tauri/mobile-bridge`. Building APKs natively on the tablet: `packages/android/apkbuildontablet.md`.
- `packages/ios` is the Swift WebView wrapper around `@opencode-ai/app`. Platform wiring is `src/entry-ios.tsx`, JS bridge/storage are `src/bridge.ts` and `src/ios-storage.ts`, and native code is under `OpenCode/Bridge`, `OpenCode/WebView`, and `OpenCode/Whisper`.
- `packages/llm` is a private Effect Schema-first LLM core with its own `AGENTS.md`; do not assume it is the production provider path for `packages/opencode` unless imports show that.
- Check nested `AGENTS.md` before editing package-specific code, especially under `packages/opencode`, `packages/app`, `packages/llm`, `packages/desktop`, and `packages/opencode/test`.

## Server And API Flow

- `opencode serve` and `opencode web` call `Server.listen(...)`; the server loads project instances per request through workspace/instance middleware rather than an ambient CLI cwd.
- HTTP route assembly is centralized in `packages/opencode/src/server/routes/instance/httpapi/server.ts`: root routes, event routes, instance routes, `/doc`, and UI fallback are merged there.
- Normal API endpoints need a schema in `src/server/routes/instance/httpapi/groups/*` and a handler in `src/server/routes/instance/httpapi/handlers/*`; wire new groups/handlers in `server.ts` instead of providing layers inside request handlers.
- Raw `HttpRouter.use(...)` is for WebSocket upgrades or catch-all/fallback routes; use `HttpApiBuilder.group(...)` for normal JSON and SSE endpoints.
- Public wire errors should be explicit Schema error classes declared on the endpoint; translate domain/storage errors at the handler boundary.
- Database schemas live in `packages/opencode/src/**/*.sql.ts`; create migrations from `packages/opencode` with `bun run db generate --name <slug>`.

## Cross-Package Flows

- OpenAPI/SDK generation: after API schema changes, run `bun ./script/generate.ts` from repo root; SDK-only regeneration is `bun ./packages/sdk/js/script/build.ts`.
- `packages/opencode/script/generate.ts` fetches `https://models.dev/api.json` unless `MODELS_DEV_API_JSON` points to a local snapshot, then writes `packages/core/src/models-snapshot.*`.
- CLI binary builds run `packages/opencode/script/build.ts`; full builds embed a freshly built `packages/app` bundle unless `--skip-embed-web-ui` is passed.
- Desktop prebuild runs `packages/opencode/script/build-node.ts`; `packages/desktop/src/main/sidecar.ts` imports that node bundle through `virtual:opencode-server`, sets Basic auth/CORS, runs migrations, and starts `Server.listen`.
- Web UI data flow is `AppInterface` -> `ServerProvider` -> `GlobalSDKProvider`/`GlobalSyncProvider`; server keys, project lists, and health polling live in `packages/app/src/context/server.tsx`.
- Session UI flow is `packages/app/src/pages/session.tsx` for data orchestration, resume refresh, review/diff limits, tabs, and terminal panel; `SessionComposerRegion` for the bottom dock; `PromptInput` for editor behavior, attachments, slash/at popovers, voice, history, and submit.
 - Tool display flow is `SessionTurn` -> `message-part.tsx` `PART_MAPPING["tool"]` -> `ToolRegistry.render(...)`; shared compact trigger/collapse UI belongs in `basic-tool.tsx` and `basic-tool.css`, not one-off tool renderers.

## V2 Session Core

Upstream guidance for the embedded v2 session runtime (`SessionV2`/`SessionExecution`/`SessionRunner`). Follow it when touching that code.

- Keep durable prompt admission separate from model execution. `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)` unless `resume: false` requests admit-only behavior. The serialized runner promotes admitted inputs into visible user messages at safe boundaries.
- Reusing a Session ID adopts the existing Session. Reusing a prompt message ID reconciles an exact retry only when Session, prompt, and delivery mode match; conflicting reuse fails. Historical projected prompts lazily synthesize promoted inbox records during exact retry.
- Keep `SessionExecution` process-global and Session-ID based. Its local implementation owns the process-local Session coordinator and discovers placement through `SessionStore` plus `LocationServiceMap.get(session.location)` only when a drain starts; no layer should take a Session ID. V2 interruption targets the active process-local ownership chain for that Session; idle or missing interruption is a no-op.
- Keep `SessionRunner`, model resolution, tool registry, permissions, and filesystem Location-scoped. Omitted `Location.workspaceID` means implicit-local placement; explicit workspace identity remains reserved for future placement semantics.
- Preserve one explicit `llm.stream(request)` call per provider turn and reload projected history before durable continuation. Do not bridge through legacy `SessionPrompt.loop(...)` or delegate orchestration to an in-memory tool loop.
- Keep local Session drains process-local until clustering is implemented. `SessionRunCoordinator` joins explicit same-Session resumes, coalesces prompt wakeups, and allows different Sessions to run concurrently. Advisory wakes drain eligible durable inbox rows only; post-crash activity recovery requires a separate explicit design before it may retry provider work.
- Keep delivery vocabulary explicit. Prompts steer by default and coalesce into the active activity at the next safe provider-turn boundary. Explicit `queue` inputs open FIFO future activities one at a time after the active activity settles.
- Keep EventV2 replay owner claims separate from clustered Session execution ownership.
- Keep the System Context algebra, registry, and built-ins in `src/system-context`; keep Context Source producers with their observed domains, and keep Session History selection plus Context Epoch persistence Session-owned.

## Compatibility Contract

The iOS/Android apps must work with the Tandem/OpenCode server. Preserve official OpenCode API behavior unless intentionally adding an optional enhanced capability.

Protect these areas, and change them only intentionally and additively:

- API endpoint paths
- JSON payload shapes
- auth/session behavior
- CORS/origin behavior
- WebSocket/SSE semantics
- static asset routes mobile wrappers expect
- WebView assumptions

Enhanced-only features should be additive or feature-detected where possible.

## Shared App And Platform Contract

- `packages/app/src/context/platform.tsx` is the app-to-native contract. Preserve optional mobile methods/types for push state, push pairing, relay preferences, voice input, speech locale, haptics, share, default server storage, and native async storage when merging upstream.
- Android/iOS wrappers dispatch `opencode:transcription`; `PromptInput` consumes it. Preserve native voice input compatibility when refactoring prompt input or platform code.
- Preserve platform-backed persistence for non-web apps. Do not replace native iOS/Android storage with browser-only `localStorage`.
- Preserve existing Tandem/Whispercode mobile i18n keys during upstream merges.

## Mobile Session Behavior

- Mobile session pages must recover after native/background suspension by refreshing session/todos/status on pageshow, online, visibility restore, and `opencode:resume`. Do not treat plain window focus as a heavy resume signal without device evidence; mobile wrappers already emit native resume events from visibility/native lifecycle changes.
- On phones, keep session title, context usage, and overflow actions accessible from the Session tab; do not reintroduce a duplicate title/action bar except during inline rename.
- Native mobile session overflow/delete flows must remain WebView-safe: non-modal menus and deferred confirmations avoid suppressed popups or swallowed dialogs.
- Keep mobile review/diff handling guarded by fallback diff generation and the mobile review limit so large reviews do not freeze iOS/Android WebViews.
- Terminal touch dragging on iOS/Android should continue to scroll terminal history.

## Mobile Composer Architecture

- `SessionComposerRegion` owns the full bottom composer dock: prompt input, model/agent/effort tray, todo dock, followup dock, revert dock, and the measured dock height used by session scrolling.
- `PromptInput` owns editor behavior, prompt-local controls, text layout, prompt history, attachments, slash/at popovers, and submit/newline key handling.
- The session message timeline scrolls through `ScrollView`; the composer dock sits outside that timeline and reports its height through `setPromptDockRef` plus `createResizeObserver`.
- On Android/iOS WebView, keyboard-up viewport behavior can require native non-passive touch listeners at the composer boundary when Solid delegated handlers are too late in the event path.

## Android Keyboard And Scrolling

- Preserve Android keyboard/scroll stability: real visual viewport height, generated `adjustResize`/`MainActivity` patches, contained overscroll, reduced mobile bottom padding, and resize-aware auto-scroll.
- Android keyboard/viewport stability spans `packages/android/src/entry-android.tsx`, `packages/android/patch-android-generated.ts`, `packages/android/src-tauri/templates/MainActivity.kt`, and session/composer scroll code.
- Do not remove `adjustResize`, visual-viewport CSS vars, zoom compensation, or non-passive composer touch handling without device evidence.
- Keep native mobile timeline turns on real full scroll height; do not re-enable per-turn `content-visibility: auto` or `contain-intrinsic-size` placeholders without fresh iOS/Android evidence.
- Keep mobile `overflowAnchor` behavior as `"dynamic"`; do not add the mobile `overflowAnchor: "none"` variant.
- Use app-controlled display zoom on Android. Keep native page pinch zoom disabled; keep width uncompensated, but divide viewport height and safe-area padding by zoom so the prompt/status bar stays aligned.

## Chat Spacing

- Android APKs bundle their own UI from local `@opencode-ai/app` and `@opencode-ai/ui`. Two Android builds can connect to the same server but render different spacing if their bundled UI/CSS differs.
- Main spacing files: `packages/ui/src/components/message-part.css`, `packages/ui/src/components/session-turn.css`, plus rendering glue in `message-part.tsx` and `session-turn.tsx`.
- Current compact spacing choices: user bubble padding is `4px 10px`; assistant text margin-top is `4px`; assistant copy/meta row reserve is `20px` plus `2px` margin; assistant content gap is `6px`; turn-list gap is `4px`.
- Useful spacing math: collapsed shell tool row to following assistant text is about `10px` (`6px` assistant content gap plus `4px` text margin). Assistant text to next user bubble reserves about `26px` before the next turn (`20px` copy row plus `2px` margin plus `4px` turn gap).
- The hidden assistant copy/meta row lives at `packages/ui/src/components/message-part.css` `[data-slot="text-part-copy-wrapper"]`; it is invisible until hover but still reserves space.

## Tool Call Display

- Tool rendering is centralized in `packages/ui/src/components/message-part.tsx`: `PART_MAPPING["tool"]` finds the tool part, then renders `ToolRegistry.render(part.tool) ?? GenericTool`.
- Shared collapsible behavior lives in `packages/ui/src/components/basic-tool.tsx`. Prefer adding data to `BasicTool` or `ToolSummaryTrigger` rather than duplicating compact trigger markup in individual tool renderers.
- Shared compact trigger styling lives in `packages/ui/src/components/basic-tool.css` under `tool-summary-trigger` selectors. Keep status dots, call text, subject truncation, and output preview styling there instead of adding Bash-only CSS.
- Bash summary data comes from `props.input.command` or `props.metadata.command`; output preview comes from the first non-empty ANSI-stripped line of `props.output` or `props.metadata.output`; nonzero `metadata.exit`/`exitCode` should render as an error state.
- Apply-patch summaries should continue using parsed file data from `patchFiles(props.metadata.files)` so single-file and multi-file displays share the same trigger component and preserve existing accordion/details behavior.
- When adding summaries for more tools, derive `{ title, subject, preview, status, failed }` once per tool and pass it to the shared trigger. Tool-specific code should provide data only unless expanded details need custom UI.

## Local Development

- Bun path on this machine: `bun` on PATH.
- `oc web` or `opencode dev web` may show the remote `https://app.opencode.ai` UI, so it is not proof that local `packages/app` changes are visible.
- LAN web test command: `oc web --hostname 0.0.0.0 --port 4096` or `opencode web --hostname 0.0.0.0 --port 4096`.
- Local app UI test backend: `bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096`.
- Local app UI test frontend: `bun run --cwd packages/app dev -- --port 4444`.
- Open `http://localhost:4444` for local app UI changes; it targets the backend at `http://localhost:4096`.
- Running `bun dev` from the root or `packages/opencode` starts the interactive TUI. Do not use it as a blocking foreground verification command.
- Official release comparison command: `npx --yes -p opencode-ai@<version> opencode web --hostname 0.0.0.0 --port 4096`. The npm package name is `opencode-ai`.

## Verification Commands

- Install dependencies with `bun install --frozen-lockfile`. CI uses `bun install`, and Windows CI uses `--linker hoisted` in `.github/actions/setup-bun/action.yml`.
- Lint from repo root with `bun lint`.
- Root typecheck is `bun typecheck` and runs Turbo.
- Focused typecheck is `bun typecheck` from a package directory such as `packages/opencode`, `packages/app`, `packages/ui`, `packages/desktop`, `packages/android`, or `packages/ios`; do not run `tsc` directly for typechecking.
- Root `bun test` intentionally fails via the `do-not-run-tests-from-root` guard. Run tests from package directories.
- Focused `packages/opencode` test: `bun test path/to/file.test.ts --timeout 30000`.
- Focused `packages/app` unit test: `bun test --preload ./happydom.ts ./src/path/to/file.test.ts`.
- Focused `packages/ui` test: `bun test src/path/to/file.test.ts`.
- HTTP API gates: from `packages/opencode`, run `bun run test:httpapi`.
- App e2e: from repo root, run `bun --cwd packages/app test:e2e:local`; install Chromium first with `bunx playwright install chromium` from `packages/app` if the browser is missing.
- Build CLI from `packages/opencode`: `bun run build` (all platforms) or `bun run build --single` (current platform). `dist` is recreated each build; the Linux ARM64 binary is `packages/opencode/dist/opencode-linux-arm64/bin/opencode`. For filtered logs append `2>&1 | tee /tmp/opencode/opencode-build.log | rg -i "error|fail|exception|warning|building|smoke test|passed"`.
- Build desktop from `packages/desktop`: `bun run build`; this first builds `packages/opencode/dist/node`.
- Build Android debug APK from `packages/android`: `bun run tauri android build --apk --debug --target aarch64` → `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`. For filtered logs append `2>&1 | tee /tmp/opencode/android-build.log | rg -i "error|fail|exception|warning|building|built|assemble|apk|passed"`.

## Tandem Release Packaging

- `bun run tandem:release` is the canonical full release build set: CLI all platforms, signed Android release APK/AAB, iOS web assets, then packaging into `dist/tandem-release`. Filtered logs land in `/tmp/opencode/*.log`. Add `--install-android` to also `adb install -r` the signed APK (preflights ADB; needs exactly one device unless `ANDROID_SERIAL` is set). Local quick build: `--single-cli --allow-partial --allow-dev-version --debug-android`; see `--help` for more.
- On this tablet `--install-windows` throws, and `--strict --required-common` cannot pass because a signed iOS `.ipa` is not exportable here; use `--skip-ios` or `--allow-partial` for full local runs.
- Signing uses ignored `packages/android/release.keystore` + `keystore.properties` (auto-created on first run if both are missing); the script also regenerates `packages/android/src-tauri/gen/android` when stale, so do not hand-delete it.

## Tablet Ubuntu Tandem CLI Install

- The command is `tandem`, installed at `/usr/local/bin/tandem` (root-owned; no `~/.opencode/bin` install).
- Build + install: `bun run --cwd packages/opencode build --single` then `sudo install -m 755 packages/opencode/dist/opencode-linux-arm64/bin/opencode /usr/local/bin/tandem`; verify with `tandem --version`.

## Android Testing And Build

- Normal Android builds package as `Tandem`, Android package id `app.liddokun.tandem`.
- Build + install on the tablet itself with one command from repo root: `bun run tandem:tablet -- --install` (native aarch64 debug APK; auto-connects ADB, prefers `127.0.0.1:5555`; add `--overwrite` to replace a signature-mismatched/release-signed install). On a fresh chroot run `bun run tandem:tablet -- --setup` once to install the arm64 toolchain (NDK + glibc build-tools + JDK + Rust). Rationale and pinned sources: `packages/android/apkbuildontablet.md`.
- Signed release APK/AAB build: see "Tandem Release Packaging" (`bun run tandem:release -- --install-android`).
- `bun run prepare:android` regenerates launcher icons and restores generated Android metadata/MainActivity patches; on aarch64 hosts it also re-injects the arm64 `aapt2` override (`android.aapt2FromMavenOverride`).
- Side-by-side variant: from `packages/android` run `bun run install:y700 -- -Name <name>` — builds a parallel-installable debug APK (id `ai.opencode.android.<name>`) and installs it without touching the main app. It self-bootstraps the toolchain env and auto-resolves/connects the device, so just run it directly: no `tee`/`rg` wrapper, no ADB pre-check, no `-Device` needed on the tablet (pass `-Device <serial>` only to override).
- The working `adb` is `/usr/bin/adb` (glibc); the SDK's `platform-tools/adb` is bionic and will not run in the chroot. If ADB shows no devices, run `adb-reconnect`, then re-enable Wireless debugging on Android if it still cannot connect.

## Branch And Commit Habits

- `dev`: personal combined working build.
- `mobile/*`: Android/iOS/mobile compatibility work.
- `personal/*`: personal enhancements.
- `whisper/*`: clean branches for possible Whispercode PRs.
- `sync/*`: OpenCode update work if a separate branch is useful.

Use commit prefixes:

```text
personal:      only for Tandem-specific enhancements
mobile:        APK/mobile compatibility or mobile UI behavior
whisper:       possible Whispercode PR work
opencode-sync: upstream OpenCode merge/update
wip:           temporary messy work
```

Keep commits focused so they can be cherry-picked later if needed.

## Code Style And Engineering Bias

- Make the smallest correct change that satisfies the documented Tandem/mobile contract.
- Keep simple logic inline; extract helpers only when they are reused, name a real concept, or hide genuinely complex validation.
- Prefer deletion over accommodation for stale fork code outside the selected Tandem/mobile contract.
- Prefer repo conventions: Bun APIs where they fit, precise types, type inference when clear, early returns, readable array methods, and type guards on filters.
- When a function has several validation branches or supporting details, make the main function read as the happy path and move supporting details into small helpers below it.
- Keep helpers close to the code they support when that improves readability.
- Do not return `Effect` from helpers unless they actually perform effectful work. Synchronous parsing, validation, and option building should stay synchronous.
- Avoid `try`/`catch` where possible. Prefer Effect schema helpers such as `Schema.UnknownFromJsonString` and `Schema.decodeUnknownOption` over manual `JSON.parse` wrapped in `Effect.try` when parsing untrusted JSON strings.
- Add comments for non-obvious constraints and surprising behavior, not for obvious assignments or control flow.
- In `packages/opencode`, follow the flat ESM self-export pattern described in `packages/opencode/AGENTS.md`; do not add barrels in multi-sibling directories such as `src/session` or `src/config`.
- In `packages/opencode/src/config`, follow the existing self-export pattern at the top of the file, for example `export * as ConfigAgent from "./agent"`, when adding a new config module.
- In Drizzle schemas, use snake_case field names so column names do not need duplicate string definitions.
- Never alias imports or use star imports; if a namespace-style value is needed, import the module's own exported namespace by name (for example `import { Project } from "@opencode-ai/core/project"`) and reference `Project.ID`.
- Prefer dynamic imports for heavy modules only needed on selected code paths, especially in startup-sensitive entrypoints. Destructure dynamic-import bindings near the top of the narrowest scope that needs them so they read like normal imports; avoid inline chains like `(await import("./module")).value()`, and keep branch-specific imports inside the branch that needs them to preserve lazy loading.

## Testing Bias

- Avoid mocks as much as possible.
- Test actual implementation behavior instead of duplicating implementation logic in tests.
