import { Patch } from "@opencode/util/patch"
import { FSUtil } from "@opencode/util/fs-util"
import { asc, eq } from "drizzle-orm"
import { Effect, Result } from "effect"
import { join, resolve } from "path"
import type { Database } from "../../../database/database.js"
import { SessionHistory } from "../../../session/history.js"
import type { SessionMessage } from "../../../session/message.js"
import type { SessionSchema } from "../../../session/schema.js"
import { SessionMessageTable } from "../../../session/sql.js"

export const tools = (messages: ReadonlyArray<SessionMessage.Info>) =>
  messages.flatMap((message) => message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [])

/** Canonical session tool inputs, before Claude's wire-name presentation. */
export const actions = (tool: SessionMessage.AssistantTool, directory: string) => {
  if (tool.state.status !== "completed") return []
  const input = tool.state.input
  if (["read", "edit", "write"].includes(tool.name) && typeof input.path === "string")
    return [{ path: resolve(directory, input.path), action: tool.name === "read" ? "read" : tool.name === "write" ? "wrote" : "edited" }]
  if (tool.name !== "patch" || typeof input.patchText !== "string") return []
  const parsed = Patch.parse(input.patchText)
  if (Result.isFailure(parsed)) return []
  return parsed.success.map((hunk) => ({
    path: resolve(directory, hunk.type === "update" ? hunk.movePath ?? hunk.path : hunk.path),
    action: hunk.type === "add" ? "wrote" : "edited",
  }))
}

export const renderTranscript = (messages: ReadonlyArray<SessionMessage.Info>, directory: string) =>
  messages.flatMap((message) => {
    if (message.type === "user") return message.text ? [`User:\n${message.text}`] : []
    if (message.type !== "assistant") return []
    return message.content.flatMap((part) => {
      if (part.type === "text") return part.text ? [`Assistant:\n${part.text}`] : []
      if (part.type !== "tool") return []
      return actions(part, directory).map((file) => `[${file.action}] ${file.path}`)
    })
  }).join("\n\n") + "\n"

/** Read every row, deliberately bypassing the history loader's compaction boundary. */
export const writeTranscript = Effect.fn("ClaudeCompaction.transcript")(function* (input: {
  db: Database.Interface["db"]
  fs: FSUtil.Interface
  sessionID: SessionSchema.ID
  directory: string
  tmp: string
}) {
  const rows = yield* input.db.select().from(SessionMessageTable)
    .where(eq(SessionMessageTable.session_id, input.sessionID)).orderBy(asc(SessionMessageTable.seq)).all()
  const messages = yield* Effect.forEach(rows, SessionHistory.decodeMessageRow)
  const path = join(input.tmp, "transcripts", `${input.sessionID}.md`)
  yield* input.fs.writeWithDirs(path, renderTranscript(messages, input.directory))
  return path
})
