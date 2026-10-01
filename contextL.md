# Tandem Linux Context

Read this at session startup on Ubuntu/Linux. `AGENTS.md` owns shared follow-through rules;
Windows work uses `contextW.md`. Load the task-specific sections below only when
needed, not the entire reference by default.

## Always Apply

- Tandem is a personal fork of current official OpenCode, with Tandem-owned
  Android/iOS apps inherited from discontinued Whispercode. Keep updates easy;
  do not preserve obsolete donor code or look for a Whispercode upstream.
- Official OpenCode is the default conflict winner. Preserve documented mobile
  contracts and useful personal enhancements with the smallest correct delta.
  Preserve `UPSTREAM-DIVERGENCE` comments. Do not propose upstream OpenCode PRs.
- Expected branch is `dev`, remotes `origin` (Tandem) and `upstream` (OpenCode);
  verify actual state. Normal upstream syncs merge `upstream/dev` into `dev`;
  do not rebase or force-push them.
- Before changing backend, web UI or mobile code, read relevant entries in
  `log.md`. It contains dated release history, a feature overview and a current
  divergence inventory. Add dated Unreleased entries for user-visible changes
  (including fork-owned features/mobile apps) and material maintenance/docs work.
  Separately revise the inventory when a shared file changes or a fork-owned file
  is added, removed or retargeted. Keep feature docs and the detailed mobile
  baseline/history in `tandem-changelog.md` in sync. Follow the release workflow
  in `log.md`; preserve published history and explicitly target `Liddo-kun/Tandem`
  in GitHub release commands rather than relying on this checkout's default repo.
- Before editing a package, read its nearest nested `AGENTS.md`. Before changing
  `packages/opencode`, check whether config, plugins or documented extension
  points solve the request without additional backend divergence.
- Treat design notes as plans, not proof of implemented behavior; check source.
- Prefer small changes, nearby helpers only when justified, and tests of actual
  behavior rather than mocks or copies of implementation logic.
- Jon's verification rule: after the necessary source/context inspection, the
  first verification must exercise a real agent session and actual tool calls
  through the normal session flow. Do not start with `bun test`, test-writing,
  fixture repairs or typechecks. Do not write, modify or run low-level tests
  unless Jon explicitly requests them; "small", "targeted" or "regression"
  does not create an exception. Historical failing-test lists are reference,
  not a work queue. If live testing is blocked or unsafe, report that specific
  blocker instead of substituting synthetic tests. Build only when necessary to
  load the implementation for live testing; use a focused typecheck after an
  implementation change only when needed, not as a baseline or repeated ritual.
  Test general features across multiple real websites/workflows. Unit-test counts
  and successful builds/typechecks are not proof that the agent workflow works.

## Read When Needed

Detailed guidance lives in [Linux Task Reference](notes/context/linux-details.md).
Use its headings to locate and read the relevant sections before editing; a link
does not mean its contents have already been loaded into context.

| Task | Required Sections / References |
| --- | --- |
| Finding code or changing dependencies | [Package Boundaries](notes/context/linux-details.md#package-boundaries) |
| TypeScript, schema or backend implementation | [Code Style And Engineering Bias](notes/context/linux-details.md#code-style-and-engineering-bias), [Testing Bias](notes/context/linux-details.md#testing-bias) |
| Server routes, API, SDK or build wiring | [Server And API Flow](notes/context/linux-details.md#server-and-api-flow), [Cross-Package Flows](notes/context/linux-details.md#cross-package-flows), [Compatibility Contract](notes/context/linux-details.md#compatibility-contract) |
| V2 session admission, execution or history | [V2 Session Core](notes/context/linux-details.md#v2-session-core); do not substitute the legacy runner |
| Shared web UI or mobile behavior | [Compatibility Contract](notes/context/linux-details.md#compatibility-contract) through **Mobile Session Behavior**; then the applicable composer, keyboard, spacing or tool-display sections |
| Composer, scrolling, keyboard or RTL changes | [Mobile Composer Architecture](notes/context/linux-details.md#mobile-composer-architecture), [Android Keyboard And Scrolling](notes/context/linux-details.md#android-keyboard-and-scrolling), [Chat Spacing](notes/context/linux-details.md#chat-spacing); load `rtl-aware-development` for direction-sensitive behavior |
| Tool/message rendering | [Tool Call Display](notes/context/linux-details.md#tool-call-display) and package AGENTS; shared rendering belongs in shared components |
| Running dev servers, tests or builds | [Local Development](notes/context/linux-details.md#local-development), [Verification Commands](notes/context/linux-details.md#verification-commands) |
| Installing the Linux CLI or packaging releases | [Tandem Release Packaging](notes/context/linux-details.md#tandem-release-packaging), [Tablet Ubuntu Tandem CLI Install](notes/context/linux-details.md#tablet-ubuntu-tandem-cli-install) |
| Android builds, signing, installation or ADB | [Android Testing And Build](notes/context/linux-details.md#android-testing-and-build), `packages/android/apkbuildontablet.md` |
| Upstream sync or commits | [Source Priorities](notes/context/linux-details.md#source-priorities) through **Merge And Update Rules**, [Branch And Commit Habits](notes/context/linux-details.md#branch-and-commit-habits); use `tandem-opencode-sync` for syncs and read `log.md` in full |
| RePrompt / prompt enhancement | `PromptEnhance.md` |

## Quick Verification

- Bun/Turbo monorepo; typecheck with `bun typecheck` in the affected package
  (`tsgo`, not direct `tsc`). Root `bun typecheck` runs the full graph.
- Run tests from the affected package. Root `bun test` intentionally fails.
  Backend example: `bun test path/to/file.test.ts --timeout 30000`.
- CLI build: `bun run --cwd packages/opencode build --single`. Full commands,
  platform caveats and install steps are in the reference, not startup context.
