export * as BashSearch from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Context, Effect } from "effect"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import path from "node:path"
import { which } from "../../../util/which.js"
import { ShellSelect } from "../../../shell/select.js"
import { ShellTool } from "../../../tool/plugin/shell.js"
import { SystemPart } from "@opencode/ai/effect"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { ClaudePresentation } from "../claude/presentation.js"
import { grepShim, findShim } from "./shims.js"

/** Only a Claude session's shell tool call supplies this; ordinary shell API calls stay unchanged. */
export const Current = Context.Reference<string>("tandem/BashSearch.Current", { defaultValue: () => "" })
let directory: string | undefined
let status = "Bash search is disabled."
export const enabled = () => process.env.TANDEM_CLAUDE_BASH_SEARCH === "1"
const supportedShell = (shell: string) => ["bash", "dash", "sh", "zsh", "ksh"].includes(ShellSelect.name(shell))

const guidance = (active = true) => enabled()
  ? directory && !active ? "Bash search requires an available shell tool and a supported POSIX shell. Dedicated search tools have been retained." : status
  : undefined
const stripGuidance = (text: string) => text
  .replace(/^- (?:File search: use Glob|Content search: use Grep).*\n/gm, "")
  .replace(/^- (?:File search: use the glob|Content search: use the grep).*\n/gm, "")
  .replaceAll("- Use Glob for broad file pattern matching", "- Use plain find through Bash for broad file searches")
  .replaceAll("- Use Grep for searching file contents with regex", "- Use plain grep through Bash for content searches")

export const Plugin = define({
  id: "tandem.bash-search",
  effect: Effect.fn("BashSearch.Plugin")(function* (ctx) {
    if (!enabled()) return
    const global = yield* Global.Service
    const shells = yield* ShellSelect.Service
    const supported = process.platform === "linux" || process.platform === "darwin"
    if (!supported) {
      status = "Bash search is unsupported on this platform. Keep using the available dedicated search tools."
      yield* Effect.logWarning(status)
    }
    const result = !supported ? undefined : yield* Effect.try(() => {
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
    if (supported) {
      status = result
        ? "Use plain grep and find through Bash for content and file searches. They use subprocess-local ugrep/bfs shims; grep falls back to system grep for incompatible flags."
        : `Bash search is unavailable; keep using the available dedicated search tools. Install working ugrep and bfs (${process.platform === "darwin" ? "brew install ugrep bfs" : "sudo apt install ugrep bfs"}), then restart the development process to retry activation.`
      if (!result) yield* Effect.logWarning(status)
    }
    // Sessions whose latest request replaced Glob and Grep; only their shell tool calls get the shims.
    const active = new Set<string>()
    // Glob and Grep stay registered and are left out of each eligible Claude request, so they are neither sent to the
    // model nor callable by it. Both are outside Code Mode by default; one a plugin moved into Code Mode would stay.
    const hook = (event: SessionHooks["context"]) => Effect.gen(function* () {
      if (!enabled()) return
      const id = ClaudePresentation.isClaude(event.model.id)
        ? event.model.id
        : (yield* ctx.model.list().pipe(Effect.orDie)).data.find((model) => model.providerID === event.model.providerID && model.id === event.model.id)?.modelID ?? ""
      if (!ClaudePresentation.isClaude(id)) return
      const shell = event.tools[ShellTool.name]
      // Do not remove search when the agent cannot use a shell at all. Remote workspaces keep the plain tools.
      const on = directory !== undefined && shell !== undefined && ctx.location.workspaceID === undefined &&
        supportedShell(yield* shells.resolve({ priority: "compat" }))
      if (!on) {
        active.delete(event.sessionID)
        if (shell) event.system.push(SystemPart.make("Bash search is inactive for this request; use the available search tools. " + (guidance(false) ?? "")))
        return
      }
      active.add(event.sessionID)
      delete event.tools.glob
      delete event.tools.grep
      for (const tool of Object.values(event.tools)) tool.description = stripGuidance(tool.description)
      event.system = event.system.map((part) => ({ ...part, text: stripGuidance(part.text) }))
      event.system.push(SystemPart.make(guidance() ?? "Use plain grep and find through Bash for searches."))
    })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
    yield* ctx.tool.transform((editor) => editor.update(ShellTool.name, (tool) => {
      const execute = tool.execute
      tool.execute = (input, context) => {
        const run = execute(input, context)
        return directory && active.has(context.sessionID) ? run.pipe(Effect.provideService(Current, directory)) : run
      }
    })).pipe(Effect.orDie)
    yield* ctx.shell.hook("create.before", (event) => Effect.gen(function* () {
      const dir = yield* Current
      if (!dir || !supportedShell(event.shell)) return
      event.env.PATH = dir + path.delimiter + (event.env.PATH ?? process.env.PATH ?? "")
      // Login startup files can reset PATH. Set it again inside this subprocess, after startup.
      event.command = `export PATH='${dir.replaceAll("'", "'\\''")}'"\u003a$PATH"\n${event.command}`
    }))
  }),
})
