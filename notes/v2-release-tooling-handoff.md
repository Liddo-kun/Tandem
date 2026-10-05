# Release tooling source handoff — 2026-10-04

## Ownership and files

Implemented only this bounded release-tooling assignment:

- `script/build-tandem-release.ts` — sequential v2 CLI / Android APK+AAB / packaging entrypoint, pinned Bun propagation, filtered logs, production/v2 config selection, existing signing helper integration, native tablet aapt2 override.
- `script/package-tandem-release.ts` — v2 CLI output discovery, Tandem naming, signed Android identity verification, strict/common requirements without iOS, streamed SHA-256, manifest, explicit upload of the current staging set.
- `notes/tandem-release.md` — exact build/stage/publish/install workflow and prerequisite documentation.
- `.gitattributes` — LF for owned build/native source and binary attributes for icons/mobile artifacts/keystores; upstream generated attributes retained.
- This handoff.

No edits to root package/lockfile, CLI build script, Android toolchain helpers, `packages/android/**`, or master ledger. Existing `.gitignore` plus `packages/android/.gitignore` already cover release dist, generated native project, Rust target and Android signing secrets; checked with `git check-ignore`, so no ignore change was needed.

Optional root aliases for master, if desired (direct commands already work):

```json
{
  "tandem:release": "bun script/build-tandem-release.ts",
  "tandem:package": "bun script/package-tandem-release.ts"
}
```

## Source-inspected contracts

- V1 reference `script/{build-tandem-release,package-tandem-release}.ts` and `log.md` release workflow were read only.
- Current v2 `packages/cli/script/build.ts` emits `cli-<target>/bin/opencode`, Windows may emit `.exe`, with adjacent version metadata. The packager retains all emitted architecture/baseline/musl variants except `cli-darwin-x64-baseline`.
- Current `android-signing.ts` accepts `(root, applicationId)`, returns the properties path, protects missing production keys and isolates development keys. Release orchestration uses that API directly.
- Android workspace `tauri` script owns prepare/patch steps; `OPENCODE_ANDROID_VARIANT=v2` selects development metadata. Production sets `production`, not the existing special `1` value that preserves arbitrary generated metadata.
- On-tablet APK-only helper stays independent. Full release orchestration also builds AAB and applies the native aapt2/isolated cache settings without changing that helper.

## Verified, bounded evidence

Pinned runtime: `/home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun`.

From repo root, these completed successfully:

```sh
bun script/build-tandem-release.ts --help
bun script/package-tandem-release.ts --help
```

These validation smoke commands exited 1 as expected before builds or staging writes:

```sh
bun script/build-tandem-release.ts --android-variant wrong
bun script/build-tandem-release.ts --required-common --single-cli
bun script/build-tandem-release.ts --cli-dist /tmp/tandem/v2/release-tooling
bun script/package-tandem-release.ts --android-variant wrong
bun script/package-tandem-release.ts --required-common --skip-android
bun script/package-tandem-release.ts --android-variant v2 --upload unused
bun script/package-tandem-release.ts --install-android
bun script/build-tandem-release.ts --skip-android --out script
bun script/package-tandem-release.ts --skip-android --out script
bun script/package-tandem-release.ts --required-common \
  --android-outputs /tmp/tandem/v2/release-tooling/no-android-outputs \
  --out /tmp/tandem/v2/release-tooling/validation-output
```

The last command read the existing real ARM64 CLI build metadata, reported missing common targets and signed release APK/AAB, and did not create `validation-output`. This is input validation, not release-artifact acceptance. Raw command output is under `/tmp/tandem/v2/release-tooling/{build-help,package-help,build-variant,build-common,build-sources,package-variant,package-common,package-upload,package-unknown,build-existing-output,package-existing-output,package-common-missing}.txt`.

Ignore probes passed for `packages/cli/dist`, `packages/android/src-tauri/gen`, production keystore/properties and `dist/tandem-release`. Focused diff whitespace check passed. No low-level tests, CLI/APK builds, production installs, publication, commits, device driving or service restarts were performed.

## Intentional differences from v1

- Build/package/install are separate. Build script has no install/upload flags; package script supports explicit upload only. Installation commands are documented separately.
- Fresh/empty staging directory required; no automatic recursive deletion and no reuse via `--no-clean`. This avoids publishing stale assets, and makes a user-supplied `--out` nondestructive.
- `--skip-cli` / `--skip-android` omit collection as well as builds. Use `--package-only` to gather existing outputs.
- Strict/common requires **both** signed release APK and AAB. Common checks six primary CLI targets; packaging retains additional baseline/musl outputs without making those common requirements.
- Actual Android signature and package identity are checked, not inferred solely from the filename. AAB requires an existing bundletool JAR via `BUNDLETOOL_JAR`; APK requires runnable `AAPT2`/`APKSIGNER`. Nothing is downloaded automatically. Production/v2 artifacts sharing a Gradle tree cannot silently be renamed as the other identity.
- All CLI hashing streams to limit tablet RAM use. Manifest includes built CLI versions and Android identity/debug metadata. Mixed CLI versions and duplicate output names fail.
- GitHub defaults explicitly to `Liddo-kun/Tandem`, ignoring ambient `GH_REPO`; development/debug uploads are rejected. No iOS build/input/strict requirement.

## Pending master-scheduled acceptance and release choices

1. Provision/select `BUNDLETOOL_JAR` and verify APK/AAB signing/identity commands on actual Android outputs. Bundled tool availability is not yet established. Windows SDK launcher handling and macOS/Windows executions remain unverified.
2. Schedule CLI builds for the real platform set, full staging, `sha256sum -c SHA256SUMS`, packaged CLI/server smoke through isolated v2 roots, and signed APK workflow/device checks. All heavy builds remain master-owned.
3. Choose release version/tag with Jon. `--version` embeds the CLI version; Android version/versionCode remain separate Android-owned configuration and need coordination. No version was selected/bumped here.
4. Restore/select known production signing credentials only for an approved production release. Packaging verifies cryptographic signatures, but does not attest that the signer certificate matches the deployed production key; compare against the established production certificate before cut-over.
5. Review target commit and user-facing release notes, then obtain Jon's explicit publication/cut-over instruction. No scope checkbox was marked complete; master owns ledger updates and final readiness.

The source implementation is complete for this assignment. Pending acceptance is not evidence of a passed release build or live product workflow.
