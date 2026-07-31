import path from "node:path"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { BashSearch } from "./bash-search"

// UPSTREAM-DIVERGENCE: Tandem-only claude bash-search plugin. When active (flag on,
// POSIX, ugrep + bfs installed) it prepends the shim dir to PATH for spawned shell
// commands only — the user's interactive environment is untouched — so `grep`/`find`
// silently become ugrep/bfs, matching real Claude Code. Inert otherwise. The tool
// registry consults BashSearch.isActive() to drop Glob/Grep for Claude models.
// Design: notes/plan-bash-search.md.

export async function BashSearchPlugin(_input: PluginInput): Promise<Hooks> {
  const shimDir = await BashSearch.activate()
  if (!shimDir) return {}
  return {
    "shell.env": async (_input, output) => {
      // shellEnv spreads this over process.env, so provide the full merged PATH.
      output.env.PATH = shimDir + path.delimiter + (process.env.PATH ?? "")
    },
  }
}
