export * as BashSearch from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Context, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { which } from "../../../util/which.js"
import { ShellSelect } from "../../../shell/select.js"
import { Wildcard } from "../../../util/wildcard.js"
import type { Tool } from "../../../tool.js"
import type { Permission } from "../../../permission.js"
import { ClaudePresentation } from "../claude/presentation.js"
import { grepShim, findShim } from "./shims.js"

/** Only a captured Claude tool execution supplies this; ordinary shell API calls stay unchanged. */
export const Current = Context.Reference<string>("tandem/BashSearch.Current", { defaultValue: () => "" })
let directory: string | undefined
let status = "Bash search is disabled."
export const enabled = () => process.env.TANDEM_CLAUDE_BASH_SEARCH === "1"
const supportedShell = (shell: string) => ["bash", "dash", "sh", "zsh", "ksh"].includes(ShellSelect.name(shell))

export const guidance = (active = true) => enabled()
  ? directory && !active ? "Bash search requires an available shell tool and a supported POSIX shell. Dedicated search tools have been retained." : status
  : undefined
export const stripGuidance = (text: string) => text
  .replace(/^- (?:File search: use Glob|Content search: use Grep).*\n/gm, "")
  .replace(/^- (?:File search: use the glob|Content search: use the grep).*\n/gm, "")
  .replaceAll("- Use Glob for broad file pattern matching", "- Use plain find through Bash for broad file searches")
  .replaceAll("- Use Grep for searching file contents with regex", "- Use plain grep through Bash for content searches")

/** Filter before both native definitions and the Code Mode inventory are captured. */
export const snapshot = Effect.fn("BashSearch.snapshot")(function* (
  registry: Tool.Interface, permissions: Permission.Ruleset, modelID: string, shells: ShellSelect.Interface,
) {
  const fallback = () => registry.snapshot(permissions).pipe(Effect.map((tools) => ({
    ...tools, execute: (input: Parameters<Tool.Snapshot["execute"]>[0]) => tools.execute(input).pipe(Effect.provideService(Current, "")),
  })))
  if (!enabled() || !directory || !ClaudePresentation.isClaude(modelID)) return yield* fallback()
  const shell = yield* shells.resolve({ priority: "compat" })
  if (!supportedShell(shell)) return yield* fallback()
  const available = yield* registry.list()
  // Do not remove search when the agent cannot use a shell at all.
  const shellTool = available.find((tool) => tool.id === "shell")
  const rule = permissions.findLast((rule) => Wildcard.match(shellTool?.options?.permission ?? "shell", rule.action))
  const allowed = shellTool && !(rule?.resource === "*" && rule.effect === "deny")
  if (!allowed) return yield* fallback()
  const dir = directory
  const tools = yield* registry.snapshot([...permissions, ...["glob", "grep"].map((action) => ({ action, resource: "*", effect: "deny" as const }))])
  return { ...tools, bashSearch: true, execute: (input: Parameters<Tool.Snapshot["execute"]>[0]) => tools.execute(input).pipe(Effect.provideService(Current, dir)) }
})

export const Plugin = define({
  id: "tandem.bash-search",
  effect: Effect.fn("BashSearch.Plugin")(function* (ctx) {
    if (!enabled()) return
    const global = yield* Global.Service
    if (process.platform !== "linux" && process.platform !== "darwin") {
      status = "Bash search is unsupported on this platform. Keep using the available dedicated search tools."
      yield* Effect.logWarning(status)
      return
    }
    const result = yield* Effect.try(() => {
      const ugrep = which("ugrep")
      const bfs = which("bfs")
      // The parent process may itself have a v1 shim on PATH; fallback must be the real utility.
      const grep = which("grep", { ...process.env, PATH: "/usr/bin:/bin:/usr/local/bin" })
      if (!ugrep || !bfs || !grep) throw new Error("missing binary")
      const bin = { ugrep, bfs, grep }
      const probe = (command: string, args: string[], input?: string) => spawnSync(command, args, { input, timeout: 5000, stdio: ["pipe", "ignore", "ignore"] }).status === 0
      mkdirSync(global.tmp, { recursive: true })
      const regex = ["findutils-default", "emacs"].find((mode) => probe(bfs, ["-S", "dfs", "-regextype", mode, global.tmp, "-maxdepth", "0"]))
      if (!regex) throw new Error("unsupported bfs")
      const dir = mkdtempSync(path.join(global.tmp, "bash-search-"))
      for (const [name, content] of [["grep", grepShim(bin)], ["find", findShim(bin, regex)]]) {
        writeFileSync(path.join(dir, name), content, { mode: 0o755 })
        chmodSync(path.join(dir, name), 0o755)
      }
      if (!probe(path.join(dir, "grep"), ["needle"], "needle\n") || !probe(grep, ["needle"], "needle\n") || !probe(path.join(dir, "find"), [dir, "-maxdepth", "0"])) throw new Error("shim probe failed")
      return dir
    }).pipe(Effect.orElseSucceed(() => undefined))
    directory = result
    status = result
      ? "Use plain grep and find through Bash for content and file searches. They use subprocess-local ugrep/bfs shims; grep falls back to system grep for incompatible flags."
      : `Bash search is unavailable; keep using the available dedicated search tools. Install working ugrep and bfs (${process.platform === "darwin" ? "brew install ugrep bfs" : "sudo apt install ugrep bfs"}), then restart the development process to retry activation.`
    if (!result) yield* Effect.logWarning(status)
    yield* ctx.shell.hook("create.before", (event) => Effect.gen(function* () {
      const dir = yield* Current
      if (!dir || !supportedShell(event.shell)) return
      event.env.PATH = dir + path.delimiter + (event.env.PATH ?? process.env.PATH ?? "")
      // Login startup files can reset PATH. Set it again inside this subprocess, after startup.
      event.command = `export PATH='${dir.replaceAll("'", "'\\''")}'"\u003a$PATH"\n${event.command}`
    }))
  }),
})
