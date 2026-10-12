export * as ClaudeWorkdir from "./workdir.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Global } from "@opencode/util/global"
import { Effect, Predicate } from "effect"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ShellSelect } from "../../../shell/select.js"
import { ShellTool } from "../../../tool/plugin/shell.js"

/** Claude Code 2.1.291's lean Bash description, without its permission-prompt, profile, Monitor and sandbox notes. */
const DESCRIPTION = [
  "Executes a bash command and returns its output.",
  "",
  "- Working directory persists between calls, but prefer absolute paths. Shell state (env vars, functions) does not persist.",
  "- Command output is displayed to you, not reliably to the user.",
  `- \`timeout\` is in milliseconds: default ${ShellTool.DEFAULT_TIMEOUT_MS} for a foreground command; 0 disables it.`,
  "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
].join("\n")
const INPUT: Readonly<Record<string, string>> = {
  command: "The command to execute",
  timeout: `Optional timeout in milliseconds (default ${ShellTool.DEFAULT_TIMEOUT_MS} for a foreground command; 0 disables it)`,
  background: "Set to true to run this command in the background.",
}

const directory = (folder: string) => statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true

/**
 * Claude sessions on bash see Claude Code's Bash tool: no `workdir`, and the working directory carries over between
 * foreground commands. The real tool keeps `workdir`; it is filled in with the session's folder before each call.
 */
export const make = Effect.fn("ClaudeWorkdir.make")(function* (ctx: Context) {
  const global = yield* Global.Service
  mkdirSync(global.tmp, { recursive: true })
  const dir = mkdtempSync(path.join(global.tmp, "claude-workdir-"))
  yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })))
  // Sessions whose latest primary request presented Claude's Bash tool, and their current folders.
  const active = new Set<string>()
  const folders = new Map<string, string>()
  // Foreground calls waiting for their folder, and calls whose saved folder had disappeared.
  const pending = new Map<string, string>()
  const resets = new Map<string, string>()
  // bash reads BASH_ENV before a non-interactive command. Its EXIT trap records the final folder, but only while a
  // foreground Claude call of that session has created the file; child shells get the original BASH_ENV back.
  const script = path.join(dir, "env.sh")
  const trackable = /^[\w./-]+$/.test(dir)
  writeFileSync(script, [
    `if [ -n "\${TANDEM_BASH_ENV-}" ]; then BASH_ENV=$TANDEM_BASH_ENV; unset TANDEM_BASH_ENV; . "$BASH_ENV"; else unset BASH_ENV; fi`,
    `trap '[ -n "\${OPENCODE_SESSION_ID-}" ] && [ -e "${dir}/$OPENCODE_SESSION_ID" ] && pwd -P 2>/dev/null >| "${dir}/$OPENCODE_SESSION_ID"' EXIT`,
    "",
  ].join("\n"))

  yield* ctx.shell.hook("create.before", (event) => Effect.sync(() => {
    if (!trackable || ShellSelect.name(event.shell) !== "bash") return
    if (event.env.BASH_ENV) event.env.TANDEM_BASH_ENV = event.env.BASH_ENV
    event.env.BASH_ENV = script
  }))

  yield* ctx.tool.hook("execute.before", (event) => Effect.sync(() => {
    if (event.tool !== ShellTool.name || !active.has(event.sessionID) || !Predicate.isObject(event.input)) return
    const input = { ...event.input }
    const folder = folders.get(event.sessionID)
    if (input.workdir === undefined && folder !== undefined) {
      if (directory(folder)) input.workdir = folder
      else {
        folders.delete(event.sessionID)
        resets.set(event.id, folder)
      }
    }
    // Background commands start in the folder but do not move it.
    if (input.background !== true && trackable) {
      writeFileSync(path.join(dir, event.sessionID), "")
      pending.set(event.id, event.sessionID)
    }
    event.input = input
  }))

  yield* ctx.tool.hook("execute.after", (event) => Effect.sync(() => {
    if (event.tool !== ShellTool.name) return
    const reset = resets.get(event.id)
    resets.delete(event.id)
    if (reset !== undefined && event.status === "completed") {
      const content = event.result.content
      event.result = {
        ...event.result,
        content: [
          ...(typeof content === "string" ? [{ type: "text" as const, text: content }] : (content ?? [])),
          { type: "text", text: `The working directory ${reset} no longer exists, so this command ran in the session's starting directory.` },
        ],
      }
    }
    if (!pending.delete(event.id)) return
    const file = path.join(dir, event.sessionID)
    const folder = readFileSync(file, { encoding: "utf8", flag: "a+" }).trim()
    // A command moved to the background keeps running; its later exit must not move the folder.
    const running = event.status === "completed" && event.result.metadata?.status === "running"
    if (folder && !running) folders.set(event.sessionID, folder)
    if (![...pending.values()].includes(event.sessionID)) rmSync(file, { force: true })
    else writeFileSync(file, "")
  }))

  /** Presents Claude Code's Bash tool when the shell is bash. Only primary requests decide whether calls are tracked. */
  const present = (event: SessionHooks["context"], primary: boolean) => {
    const tool = event.tools[ShellTool.name]
    if (!tool || !trackable || !tool.description.includes(" using bash.")) return
    if (primary) active.add(event.sessionID)
    tool.description = DESCRIPTION
    const properties = tool.input.properties
    if (!Predicate.isObject(properties)) return
    tool.input = {
      ...tool.input,
      properties: Object.fromEntries(Object.entries(properties).flatMap(([key, value]) => key === "workdir" ? [] : [[
        key,
        Predicate.isObject(value) && INPUT[key] ? { ...value, description: INPUT[key] } : value,
      ]])),
    }
  }
  const inactive = (sessionID: string) => void active.delete(sessionID)
  return { present, inactive }
})
