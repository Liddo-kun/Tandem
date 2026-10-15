import { FSUtil } from "@opencode/util/fs-util"
import { Effect, Option } from "effect"
import { basename } from "path"
import type { Job } from "../../../job.js"
import type { SessionMessage } from "../../../session/message.js"
import { ReadTool } from "../../../tool/plugin/read.js"
import { Token } from "../../../util/token.js"
import { ClaudeCheckpoint } from "./checkpoint.js"
import { actions, tools } from "./transcript.js"

export const loadedSkills = (messages: ReadonlyArray<SessionMessage.Info>) => messages.flatMap((message) => {
  if (message.type === "skill") return [message.name]
  if (message.type === "user") return message.skills?.map((skill) => skill.name) ?? []
  if (message.type !== "assistant") return []
  return message.content.flatMap((part) => {
    if (part.type !== "tool" || part.name !== "skill" || part.state.status !== "completed") return []
    const name = part.state.metadata?.name ?? part.state.input.id ?? part.state.input.name
    return typeof name === "string" ? [name] : []
  })
})

export const skillsNote = (names: ReadonlyArray<string>) =>
  `The following skills were loaded EARLIER in this session, before the conversation was compacted: ${names.join(", ")}. Their instructions were lost in compaction. If one is still relevant to the current work, load it again with the Skill tool. Do NOT re-execute their one-time setup actions (e.g., scheduling, creating files).`

/** CC's compact read falls back to a reference, not token-cut contents, at its token cap. */
export const restoredFile = (path: string, content: string) => {
  if (content.includes("\0")) return undefined
  const all = content === "" ? [] : content.replace(/\n$/, "").split("\n")
  const lines = all.slice(0, 2000)
  if (Token.estimate(lines.join("\n")) > 5000)
    return `Note: ${path} was read before the last conversation was summarized, but the contents are too large to include. Use Read tool if you need to access it.`
  const output = ReadTool.toModelContent(path, 1, {
    type: "text-page", content: lines.join("\n"), offset: 1, mime: "text/plain",
    truncated: all.length > lines.length, next: all.length > lines.length ? lines.length + 1 : undefined,
  })
  return `Called the Read tool with the following input: ${JSON.stringify({ file_path: path })}\nResult of calling the Read tool:\n${output}`
}

export const restore = Effect.fn("ClaudeCompaction.restore")(function* (input: {
  fs: FSUtil.Interface
  directory: string
  older: ReadonlyArray<SessionMessage.Info>
  kept: ReadonlyArray<SessionMessage.Info>
  previous?: ClaudeCheckpoint.Info
  excluded: ReadonlySet<string>
}) {
  const history = [...(input.previous ? ClaudeCheckpoint.decodeKept(input.previous) : []), ...input.older]
  const files = new Map(input.previous?.files.map((file) => [file.path, file.mtime]) ?? [])
  for (const tool of tools(history)) {
    for (const file of actions(tool, input.directory)) {
      const recorded: unknown = tool.state.status === "completed" ? tool.state.metadata?.[ClaudeCheckpoint.MTIMES] : undefined
      const mtime = record(recorded) ? recorded[file.path] : undefined
      const value = typeof mtime === "number" ? mtime : yield* input.fs.stat(file.path).pipe(
        Effect.map((stat) => Option.getOrUndefined(stat.mtime)?.getTime()), Effect.orElseSucceed(() => undefined),
      )
      if (value !== undefined) files.set(file.path, value)
    }
  }
  const keptReads = new Set(tools(input.kept).filter((tool) => tool.name === "read")
    .flatMap((tool) => actions(tool, input.directory).map((file) => file.path)))
  const candidates = [...files].map(([path, mtime]) => ({ path, mtime })).sort((a, b) => b.mtime - a.mtime)
  const selected = candidates.filter((file) => basename(file.path) !== "AGENTS.md" && !input.excluded.has(file.path) && !keptReads.has(file.path)).slice(0, 5)
  const restored: string[] = []
  let total = 0
  for (const file of selected) {
    const content = yield* input.fs.readFileString(file.path).pipe(Effect.orElseSucceed(() => undefined))
    if (content === undefined) continue
    const text = restoredFile(file.path, content)
    if (text === undefined || total + Token.estimate(text) > 50_000) continue
    restored.push(text)
    total += Token.estimate(text)
  }
  const keptSkills = new Set(loadedSkills(input.kept))
  const skills = [...new Set([...loadedSkills(history).reverse(), ...(input.previous?.skills ?? [])])].filter((name) => !keptSkills.has(name))
  return { files: candidates, skills, restored }
})

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The commands the model gave background shells, by shell ID, before any wrapping such as Bash search's PATH line. */
export const shellCommands = (messages: ReadonlyArray<SessionMessage.Info>) => new Map(tools(messages).flatMap((tool) =>
  tool.name === "shell" && tool.state.status === "completed" && typeof tool.state.metadata?.shellID === "string" && typeof tool.state.input.command === "string"
    ? [[tool.state.metadata.shellID, tool.state.input.command] as const] : []))

const PATH_LINE = /^export PATH='(?:[^']|'\\'')*'":\$PATH"\n/

export const background = (tasks: ReadonlyArray<Job.Background>, sessionID: string, outputFile: (shellID: string) => string, commands: ReadonlyMap<string, string>) =>
  tasks.flatMap((task) => {
    if (task.status !== "running") return []
    const recovery = task.recovery
    if (recovery.kind === "subagent") return recovery.parentSessionID === sessionID
      ? [`Background agent "${recovery.description}" (${recovery.childSessionID}) is still running. Do NOT spawn a duplicate. You will be notified when it completes. To change its course, send it a message with Agent, passing its sessionID.`] : []
    if (recovery.sessionID !== sessionID) return []
    const command = (commands.get(recovery.shellID) ?? recovery.command.replace(PATH_LINE, "")).replace(/[\r\n]+/g, " ")
    return [`Background shell ${recovery.shellID} ("${command}") is still running (command, shown on one line: \`${command}\`). Do not start it again. You can read its output at ${outputFile(recovery.shellID)}.`]
  })
