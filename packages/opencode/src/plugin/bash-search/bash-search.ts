import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { Global } from "@opencode-ai/core/global"
import { which } from "@opencode-ai/core/util/which"

// UPSTREAM-DIVERGENCE: Tandem-only "claude bash-search" core. Mirrors Claude Code's
// v2.1.117+ environment: Claude models get no Glob/Grep tools and instead search via
// plain `grep`/`find` in Bash, which are silently upgraded to ugrep/bfs. CC does this
// with shell functions in its shell snapshots; opencode spawns a fresh shell per
// command, so Tandem uses PATH shims delivered through the `shell.env` plugin hook
// instead. Shim flags and the grep fallback pattern list are copied verbatim from
// CC 2.1.220's shell-snapshot functions (captured on this tablet). Binaries are
// provisioned out of band (system packages, e.g. `apt install ugrep bfs`); when the
// flag is off or a binary is missing the feature is fully inert.
// Design: notes/plan-bash-search.md. Registration: plugin/index.ts; tool removal:
// tool/registry.ts (both marked).

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return !["0", "false", "off", "no"].includes(value.toLowerCase())
}

// Default off; opt in with TANDEM_CLAUDE_BASH_SEARCH=1.
export function enabledByFlag(): boolean {
  return envBool("TANDEM_CLAUDE_BASH_SEARCH", false)
}

export interface Binaries {
  ugrep: string
  bfs: string
  // The real system grep, resolved before shims are on any PATH, for the
  // incompatible-flag fallback baked into the grep shim.
  grep: string
}

export function resolveBinaries(env?: NodeJS.ProcessEnv): Binaries | undefined {
  const ugrep = which("ugrep", env)
  const bfs = which("bfs", env)
  const grep = which("grep", env)
  if (!ugrep || !bfs || !grep) return undefined
  return { ugrep, bfs, grep }
}

// CC passes `-regextype findutils-default` to bfs for GNU-find regex fidelity, but
// that type only exists in bfs >= 3.2 (Ubuntu 24.04 ships 3.1.2). Probe once at shim
// generation and bake the best supported flavor; `emacs` is the closest approximation
// (findutils-default is an emacs-RE hybrid), and omitting the flag (posix-basic) is
// the last resort.
export function probeRegextype(bfsPath: string): string | undefined {
  for (const candidate of ["findutils-default", "emacs"]) {
    const probe = spawnSync(bfsPath, ["-S", "dfs", "-regextype", candidate, os.tmpdir(), "-maxdepth", "0"], {
      timeout: 5000,
      stdio: "ignore",
    })
    if (probe.status === 0) return candidate
  }
  return undefined
}

// Default flags and the incompatible/dangerous-flag fallback list are copied verbatim
// from CC 2.1.220's shell-snapshot `grep` function: repo-friendly defaults (respect
// ignore files, include hidden, skip VCS dirs, skip binaries, basic regex like GNU
// grep), and any arg matching the case list falls through to the real grep.
export function grepShim(bin: Binaries): string {
  return [
    "#!/bin/sh",
    "# Tandem bash-search shim: grep -> ugrep with Claude Code's default flags.",
    "# Generated; regenerated on activation. See plugin/bash-search/ in Tandem.",
    'for _a in "$@"; do',
    '  case "$_a" in',
    `    -*-filter*|-*-pager*|-*-view*|-*-format-open*|-*-config*|---*|-@*|-*-save-config*|-[Zz]*|-[!-]*[Zz]*|--null|--null-data) exec ${JSON.stringify(bin.grep)} "$@" ;;`,
    "  esac",
    "done",
    `exec ${JSON.stringify(bin.ugrep)} -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl "$@"`,
    "",
  ].join("\n")
}

// bfs is a full find drop-in; CC forces find's depth-first ordering and regex flavor.
export function findShim(bin: Binaries, regextype: string | undefined): string {
  const flags = regextype ? `-S dfs -regextype ${regextype}` : "-S dfs"
  return [
    "#!/bin/sh",
    "# Tandem bash-search shim: find -> bfs with Claude Code's flags.",
    "# Generated; regenerated on activation. See plugin/bash-search/ in Tandem.",
    `exec ${JSON.stringify(bin.bfs)} ${flags} "$@"`,
    "",
  ].join("\n")
}

export async function writeShims(dir: string, bin: Binaries): Promise<void> {
  const regextype = probeRegextype(bin.bfs)
  await fs.mkdir(dir, { recursive: true })
  for (const [name, content] of [
    ["grep", grepShim(bin)],
    ["find", findShim(bin, regextype)],
  ] as const) {
    const file = path.join(dir, name)
    await fs.writeFile(file, content)
    // writeFile's `mode` only applies on creation; chmod covers regeneration.
    await fs.chmod(file, 0o755)
  }
}

// shell.txt's dedicated-tools list steers the model at Glob/Grep; with those tools
// removed for Claude the bullets point at nothing and discourage the shell search the
// model should now use. The registry strips them from the shell description per-request.
const SEARCH_BULLETS = /^- (?:File search: use Glob|Content search: use Grep).*\n/gm

export function stripSearchBullets(description: string): string {
  return description.replace(SEARCH_BULLETS, "")
}

let activeShimDir: string | undefined

// Consulted by the tool registry: Glob/Grep are removed for Claude models only when
// the shims are confirmed written, so the model is never stranded with neither.
export function isActive(): boolean {
  return activeShimDir !== undefined
}

// Idempotent; called from plugin construction (once per instance, restart to refresh
// after installing binaries — same semantics as imagegen credentials).
export async function activate(): Promise<string | undefined> {
  if (activeShimDir) return activeShimDir
  if (!enabledByFlag()) return undefined
  if (process.platform === "win32") return undefined
  const bin = resolveBinaries()
  if (!bin) return undefined
  const dir = path.join(Global.Path.bin, "shims")
  await writeShims(dir, bin)
  activeShimDir = dir
  return dir
}

export function deactivate(): void {
  activeShimDir = undefined
}

export * as BashSearch from "./bash-search"
