export * as ClaudeWorkdir from "./workdir.js"

import type * as Plugin from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Global } from "@opencode/util/global"
import { Context, Effect, Predicate } from "effect"
import { randomUUID } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ShellSelect } from "../../../shell/select.js"
import { ShellTool } from "../../../tool/plugin/shell.js"
import { ClaudePresentation } from "./presentation.js"

/**
 * Claude Code 2.1.291's lean Bash description, without its permission-prompt, profile, Monitor and sandbox notes, and
 * with `head` and `tail` allowed.
 */
const description = (dedicatedSearch: boolean) => [
  "Executes a bash command and returns its output.",
  "",
  "- Working directory persists between calls, but prefer absolute paths. Shell state (env vars, functions) does not persist.",
  // Like Claude Code with embedded search, find and grep are left out when Bash search replaces Glob and Grep.
  "- IMPORTANT: Avoid using this tool to run " +
    (dedicatedSearch ? "`find`, `grep`, " : "") +
    "`cat`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user.",
  "- Command output is displayed to you, not reliably to the user.",
  `- \`timeout\` is in milliseconds: default ${ShellTool.DEFAULT_TIMEOUT_MS} for a foreground command; 0 disables it.`,
  "- `run_in_background` runs the command detached: it keeps running across turns and re-invokes you when it exits. No `&` needed.",
].join("\n")
const INPUT: Readonly<Record<string, string>> = {
  command: "The command to execute",
  timeout: `Optional timeout in milliseconds (default ${ShellTool.DEFAULT_TIMEOUT_MS} for a foreground command; 0 disables it)`,
  background: "Set to true to run this command in the background.",
}

const directory = (folder: string) => {
  try {
    return statSync(folder).isDirectory()
  } catch {
    return false
  }
}

/** The capture file of the foreground Claude Bash call this fiber is running, if any. */
const Capture = Context.Reference<string>("tandem/ClaudeWorkdir.Capture", { defaultValue: () => "" })

// bash reads BASH_ENV before a non-interactive command. The EXIT trap records the final folder while the call's capture
// file exists; child shells inherit neither the startup file nor the capture path.
const SCRIPT = [
  "__tandem_cwd_file=$TANDEM_CWD_FILE",
  "unset BASH_ENV TANDEM_CWD_FILE",
  `trap '[ -e "$__tandem_cwd_file" ] && pwd -P 2>/dev/null >| "$__tandem_cwd_file"' EXIT`,
  "",
].join("\n")

/**
 * Claude sessions on local bash see Claude Code's Bash tool: no `workdir`, and the working directory carries over
 * between foreground commands. The real tool keeps `workdir`; it is filled in with the session's folder for each call.
 * The folder does not move when a command replaces the EXIT trap, `exec`s, or a user BASH_ENV is set.
 */
export const make = Effect.fn("ClaudeWorkdir.make")(function* (ctx: Plugin.Context) {
  // Capture files are on this machine, so remote workspaces keep the plain tool.
  if (ctx.location.workspaceID !== undefined || process.platform === "win32") return { present: () => {}, inactive: () => {} }
  const global = yield* Global.Service
  mkdirSync(global.tmp, { recursive: true })
  const dir = mkdtempSync(path.join(global.tmp, "claude-workdir-"))
  yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(dir, { recursive: true, force: true })))
  const script = path.join(dir, "env.sh")
  writeFileSync(script, SCRIPT)
  // Sessions whose latest primary request presented Claude's Bash tool, and their current folders.
  const active = new Set<string>()
  const folders = new Map<string, string>()

  yield* ctx.shell.hook("create.before", (event) => Effect.gen(function* () {
    const file = yield* Capture
    if (!file || event.env.BASH_ENV || ShellSelect.name(event.shell) !== "bash") return
    event.env.BASH_ENV = script
    event.env.TANDEM_CWD_FILE = file
  }))

  yield* ctx.tool.transform((editor) => editor.update(ShellTool.name, (tool) => {
    const execute = tool.execute
    tool.execute = (input, context) => {
      if (!active.has(context.sessionID) || !Predicate.isObject(input)) return execute(input, context)
      const saved = input.workdir === undefined ? folders.get(context.sessionID) : undefined
      const reset = saved !== undefined && !directory(saved) ? saved : undefined
      if (reset !== undefined) folders.delete(context.sessionID)
      const run = execute(saved !== undefined && reset === undefined ? { ...input, workdir: saved } : input, context).pipe(
        Effect.map((result) => reset === undefined ? result : {
          ...result,
          content: [
            ...(typeof result.content === "string" ? [{ type: "text" as const, text: result.content }] : (result.content ?? [])),
            { type: "text" as const, text: ClaudePresentation.workdirReset(reset) },
          ],
        }),
      )
      // Background commands start in the folder but do not move it.
      if (input.background === true) return run
      return Effect.acquireUseRelease(
        Effect.sync(() => {
          const file = path.join(dir, randomUUID())
          writeFileSync(file, "")
          return file
        }),
        (file) => run.pipe(
          Effect.provideService(Capture, file),
          Effect.tap((result) => Effect.sync(() => {
            // `pwd` ends the path with one newline; a command moved to the background must not move the folder.
            const folder = readFileSync(file, "utf8").replace(/\n$/, "")
            if (folder && result.metadata?.status !== "running") folders.set(context.sessionID, folder)
          })),
        ),
        // Removing the file stops a command moved to the background from recording its folder later.
        (file) => Effect.sync(() => rmSync(file, { force: true })),
      )
    }
  })).pipe(Effect.orDie)

  /** Presents Claude Code's Bash tool when the shell is bash. Only primary requests decide whether calls are tracked. */
  const present = (event: SessionHooks["context"], primary: boolean) => {
    const tool = event.tools[ShellTool.name]
    if (!tool || !tool.description.includes(" using bash.")) return
    if (primary) active.add(event.sessionID)
    tool.description = description(event.tools.grep !== undefined)
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
