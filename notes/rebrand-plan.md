# Tandem Rebrand Plan (Option B: parallel-install-capable)

Handoff plan for an executor model (e.g. GPT-5.5). Self-contained. Follow the steps in order. This was scoped by a prior session; all facts below were verified against the tree on 2026-05-30 at `dev` tip `4865d827f`. Line numbers may drift — always re-`grep` before editing.

## Goal

Rebrand this fork from "opencode" to "Tandem" **far enough that official `opencode` and Tandem can be installed and run side by side on the same machine without sharing data**, while keeping the fork easy to sync from upstream OpenCode.

The blocker for parallel install is that all per-user dirs (auth, sessions, storage, cache, state, logs) derive from a single hardcoded `const app = "opencode"`. Changing that one constant (plus a couple of visible strings and the installed binary name) is the whole job.

## Guardrails — DO NOT TOUCH (these break upstream sync or wire compatibility)

- **Do NOT rename the `@opencode-ai/*` package scope.** ~882 references across 16 packages + lockfile + SDK generation. Catastrophic conflict + build breakage.
- **Do NOT rename `OPENCODE_*` environment variables / flags.** Plugins, users, and upstream depend on them (45 files). Keep reading them as-is.
- **Do NOT change the HTTP User-Agent or installation identity string.** `packages/opencode/src/installation/index.ts` builds `opencode/${channel}/${version}/${client}` and `build.ts` sets `--user-agent=opencode/${version}`. These are wire/compat identity per the repo's Compatibility Contract — leave them.
- **Do NOT change the compiled binary file name in `build.ts`** (`dist/${name}/bin/opencode`). We rename only at install time. Touching build.ts is extra conflict surface for zero benefit.
- **Mark every edit you DO make with an `UPSTREAM-DIVERGENCE` comment** so future merges preserve it (repo convention).
- Make the smallest correct change. Prefer Bun APIs. Follow the flat-ESM self-export pattern in `packages/core` and `packages/opencode` (see `packages/opencode/AGENTS.md`).

## What to actually change (5 edits + install + log + migration)

### Step 1 — Create the brand module (single source of truth)

Create `packages/core/src/brand.ts`:

```ts
// UPSTREAM-DIVERGENCE: Tandem is a rebranded fork of opencode. This module is the single
// source of truth for the product name, CLI command, and the per-user directory name used
// for config/data/cache/state. Keeping it isolated means future upstream merges only ever
// touch the one or two call sites that import it, not scattered string literals.
export const Brand = {
  /** Human-facing product name (banners, titles). */
  name: "Tandem",
  /** CLI command / scriptName shown in help and usage. */
  command: "tandem",
  /**
   * XDG app directory segment. Drives ~/.config/<dir>, ~/.local/share/<dir>,
   * ~/.cache/<dir>, ~/.local/state/<dir>. MUST differ from "opencode" so Tandem
   * and official opencode can coexist without sharing auth/sessions/storage.
   */
  dir: "tandem",
} as const
```

Notes for the executor:
- `packages/core` already uses plain top-level exports; this file exports a `const`, no self-reexport namespace needed. Import it as `import { Brand } from "./brand"` (within core) or `import { Brand } from "@opencode-ai/core/brand"` (from `packages/opencode`). Confirm the working import style by checking how a sibling like `packages/core/src/flag/flag.ts` is imported elsewhere; `@opencode-ai/core/*` subpath imports are used throughout `packages/opencode`.

### Step 2 — Point the global dirs at `Brand.dir`

File: `packages/core/src/global.ts` (currently ~line 9).

Current:
```ts
const app = "opencode"
```

Change to:
```ts
import { Brand } from "./brand"
// ...
const app = Brand.dir // UPSTREAM-DIVERGENCE: see brand.ts — separates Tandem dirs from opencode for parallel install
```

- Add the `import { Brand } from "./brand"` near the other imports at the top.
- This unconditionally defaults Tandem to `~/.config/tandem` etc. Do **not** gate it behind an env var — for parallel install Tandem must default to its own dirs, not opencode's.
- Leave everything else in `global.ts` untouched (the `OPENCODE_TEST_HOME` and `Flag.OPENCODE_CONFIG_DIR` overrides stay as-is).

### Step 3 — CLI command / scriptName

File: `packages/opencode/src/index.ts` (currently ~line 72): `.scriptName("opencode")`.

Change to use the brand:
```ts
import { Brand } from "@opencode-ai/core/brand"
// ...
.scriptName(Brand.command) // UPSTREAM-DIVERGENCE: Tandem command name
```

- Only change the `.scriptName(...)` call. Do NOT touch the `Log.Default.info("opencode", {...})` log channel name on ~line 112 (internal log tag, not user-facing; leave it to reduce conflict).

### Step 4 — Web document title

File: `packages/app/index.html` (line 6): `<title>OpenCode</title>` → `<title>Tandem</title>`.

- This is a static HTML file (can't import the brand module), so a literal is fine. Add an HTML comment `<!-- UPSTREAM-DIVERGENCE: Tandem brand -->` on the line above.
- Note: `packages/app` is shared by web/desktop/android/ios. Android/iOS are already WhisperCode-branded natively and set their own native titles, so this only affects the browser tab / desktop window / embedded web UI. That is acceptable and on-brand. Do not touch favicons/manifest unless asked.

### Step 5 — TUI ASCII wordmark (OPTIONAL — recommend DEFER)

The startup logo spells "OPENCODE" in custom block-letter art across two files:
- `packages/opencode/src/cli/ui.ts` lines 5-10 (`wordmark`, plain non-TTY fallback)
- `packages/opencode/src/cli/logo.ts` (`logo.left`/`logo.right` glyph art for TTY, using the `_ ^ ~` encoding decoded in `ui.ts` `draw()`)

Redrawing this as "TANDEM" is fiddly, easy to misalign, and is the single highest-conflict cosmetic item. **Recommendation: leave the ASCII art as-is for now** (it is purely cosmetic and does not affect parallel install). If the user explicitly wants it changed, do it as a separate, isolated commit and verify alignment by running `tandem` in a real TTY. Do not block the rest of the work on it.

### Step 6 — (OPTIONAL) npm bin key

File: `packages/opencode/package.json` line ~22: `"bin": { "opencode": "./bin/opencode" }`.

Only relevant for `npm`/`bunx` global installs (not the tablet binary). If desired, rename the key to `"tandem": "./bin/opencode"` (keep the shim path `./bin/opencode` — the file name doesn't matter). Optional and low-value for the tablet workflow; safe to skip.

## Step 7 — log.md: add a dedicated "Rebranding" section

`log.md` is the exhaustive inventory of Tandem's divergence from opencode. Add a NEW top-level section (the user explicitly wants its own section). Place it sensibly — e.g. after the prompt/backend sections, before "Test-Only Compatibility". Draft content:

```markdown
## Rebranding (Tandem identity, parallel-install safe)

- Introduces a single brand source of truth so Tandem can be installed and run alongside official opencode without sharing auth/sessions/config. Files: `packages/core/src/brand.ts`.
- Points the global XDG app directory at `Brand.dir` ("tandem") so config/data/cache/state live under `~/.config/tandem`, `~/.local/share/tandem`, `~/.cache/tandem`, `~/.local/state/tandem` instead of the shared `opencode` dirs. Files: `packages/core/src/global.ts`.
- Sets the CLI command/`scriptName` to `Brand.command` ("tandem") so help/usage and the installed binary present as Tandem. Files: `packages/opencode/src/index.ts`; installed binary is named `tandem`.
- Renames the web document title to "Tandem" (browser tab / desktop window / embedded web UI; mobile wrappers keep their native WhisperCode titles). Files: `packages/app/index.html`.
- Deliberately NOT rebranded to preserve upstream sync and wire compatibility: the `@opencode-ai/*` package scope, `OPENCODE_*` env vars/flags, the HTTP User-Agent / installation identity (`opencode/<channel>/<version>/<client>`), and the TUI ASCII wordmark.
```

Adjust wording if Step 5/6 are done.

## Step 8 — Typecheck

From `packages/core` and `packages/opencode`:
```
bun typecheck
```
(Run from each package dir; do NOT run `tsc` directly. Root `bun typecheck` runs Turbo if you prefer.)

Fix any import errors from the new `brand.ts` (most likely: subpath export resolution — confirm `@opencode-ai/core/brand` resolves; `packages/core` exports `./src/*` per its package.json `exports`, so `@opencode-ai/core/brand` should map to `src/brand.ts`. Verify against how `@opencode-ai/core/global` is imported.)

## Step 9 — Build the tablet binary (Linux ARM64)

This repo runs on an Android tablet under Ubuntu/proot; the tablet uses the **Linux ARM64** binary. From `packages/opencode`:
```
bun run build 2>&1 | tee /tmp/opencode/opencode-build.log | rg -i "error|fail|exception|warning|building|smoke test|passed"
```
Confirm `building opencode-linux-arm64` and `Smoke test passed`. Output binary: `packages/opencode/dist/opencode-linux-arm64/bin/opencode`.

## Step 10 — Install as `tandem` (parallel, leaves any opencode install intact)

```
install -m 755 packages/opencode/dist/opencode-linux-arm64/bin/opencode /home/jon/.opencode/bin/tandem
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"
which tandem && tandem --version
```
- Installs the command as `tandem` on PATH. Any existing `opencode` binary in `~/.opencode/bin` is untouched, so both commands coexist.
- The current `~/.opencode/bin/opencode` is presently a *Tandem* build from a prior session; that's fine. If the user later installs official opencode there, it will not collide with `tandem`.

## Step 11 — Seed Tandem's dirs from the existing opencode dirs (user's "start at same spot")

The user wants Tandem to begin with the current config/sessions/auth. After Step 10, copy the existing opencode XDG dirs into the new tandem dirs. Default XDG locations on this machine (Ubuntu/proot):

```
# data (auth.json, sessions/storage DB, logs, repos)
cp -rn ~/.local/share/opencode/.  ~/.local/share/tandem/  2>/dev/null
# config
cp -rn ~/.config/opencode/.       ~/.config/tandem/        2>/dev/null
# state
cp -rn ~/.local/state/opencode/.  ~/.local/state/tandem/   2>/dev/null
# cache (optional; safe to skip / let it rebuild)
cp -rn ~/.cache/opencode/.        ~/.cache/tandem/          2>/dev/null
```
Notes:
- `tandem --version` (Step 10) already created the empty tandem dirs (`global.ts` mkdirs them on load), so the targets exist.
- `-n` (no-clobber) avoids overwriting anything Tandem already wrote. Use `cp -r` (no `-n`) only if you want a clean overwrite.
- If `XDG_DATA_HOME`/`XDG_CONFIG_HOME`/etc. are set in the environment, use those bases instead of the `~/.local/share` etc. defaults. Confirm with `echo "$XDG_DATA_HOME $XDG_CONFIG_HOME $XDG_STATE_HOME $XDG_CACHE_HOME"`.
- This is a one-time copy. After this, `opencode` and `tandem` evolve independently.

## Step 12 — Verify

- `tandem --version` prints a version (e.g. `0.0.0-dev-…`). The version string is brand-independent; it won't say "tandem", that's expected.
- `tandem --help` shows usage under the `tandem` command name (from Step 3).
- Launch `tandem` (TUI) and confirm it reads the seeded sessions/auth from `~/.local/share/tandem`.
- Confirm official `opencode` (if installed) still points at `~/.local/share/opencode` and is unaffected.
- Optional: run the focused skill test from `packages/opencode`: `bun test test/skill/skill.test.ts --timeout 30000` (should stay green; unrelated but cheap sanity).

## Step 13 — Commit

Use the repo's `personal:` prefix (this is a Tandem-specific enhancement). Suggested message:
```
personal: rebrand to Tandem with parallel-install-safe data dirs

Add a brand module as the single source of truth and point the global
XDG app dir at Brand.dir ("tandem") so Tandem coexists with official
opencode (separate auth/sessions/config). Set CLI scriptName and web
title to Tandem. Deliberately leaves the @opencode-ai scope, OPENCODE_*
env vars, and HTTP/install identity untouched for upstream-sync and
wire compatibility.
```
Stage only the intended files: `packages/core/src/brand.ts`, `packages/core/src/global.ts`, `packages/opencode/src/index.ts`, `packages/app/index.html`, `log.md` (and `packages/opencode/package.json` if Step 6 done). Do NOT commit `problem.md` or `rebrand-plan.md` unless asked. Then push: `git push origin dev` (gh is set up as the credential helper for the `Liddo-kun` account).

## Quick reference — verified facts

- Single dir lever: `packages/core/src/global.ts:9` `const app = "opencode"`.
- Only `config` is env-overridable today (`Flag.OPENCODE_CONFIG_DIR`); `data/cache/state/tmp/bin/log/repos` all derive from `app`. So the code change is required — env alone can't separate auth/sessions.
- CLI command name: `packages/opencode/src/index.ts:72` `.scriptName("opencode")`.
- Web title: `packages/app/index.html:6`.
- TUI art: `packages/opencode/src/cli/ui.ts:5-10` + `packages/opencode/src/cli/logo.ts`.
- Compiled binary path: `packages/opencode/dist/opencode-linux-arm64/bin/opencode` (name stays `opencode` in build; rename at install only).
- Tablet install target: `/home/jon/.opencode/bin/tandem`.
- Build: `bun run build` from `packages/opencode` (produces all targets incl. linux-arm64).
```
