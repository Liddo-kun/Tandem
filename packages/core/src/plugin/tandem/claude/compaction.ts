export * as ClaudeCompaction from "./compaction.js"

import { AIError, isContextOverflowFailure, LLMRequest, Message } from "@opencode/ai"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionError } from "@opencode/schema/session-error"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { eq } from "drizzle-orm"
import { Effect, Result } from "effect"
import { join, resolve } from "path"
import type { Bus } from "../../../bus.js"
import type { Database } from "../../../database/database.js"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { Job } from "../../../job.js"
import { Location } from "../../../location.js"
import type { SessionCompaction } from "../../../session/compaction.js"
import type { SessionContext } from "../../../session/context.js"
import { SessionEvent } from "../../../session/event.js"
import { InstructionState } from "../../../session/instruction-state.js"
import type { SessionMessage } from "../../../session/message.js"
import { SessionModelRequest } from "../../../session/model-request.js"
import { SessionRunnerRetry } from "../../../session/runner/retry.js"
import { InstructionBlobTable } from "../../../session/sql.js"
import { toSessionError } from "../../../session/to-session-error.js"
import { Token } from "../../../util/token.js"
import { ClaudeCheckpoint } from "./checkpoint.js"
import { ClaudePresentation } from "./presentation.js"
import { background, restore, shellCommands, skillsNote } from "./restore.js"
import { writeTranscript } from "./transcript.js"

type Failure = { readonly error: SessionError.Error }
type Compacted = { readonly text: string; readonly recent: string; readonly metadata: Record<string, unknown> }

/** Claude models in sessions other than bare auxiliary ones; the same Claude detection as the request builder. */
export const applies = (context: SessionContext.Loaded) =>
  !TandemAuxiliary.isBareContext(context.session.metadata) &&
  (ClaudePresentation.isClaude(context.model.model.id) || ClaudePresentation.isClaude(context.model.ref.id))

/** Location nodes `services` needs, beyond those core compaction already depends on. */
export const nodes = [FSUtil.node, Global.node, Job.node, Location.node] as const

export const services = Effect.gen(function* () {
  return { fs: yield* FSUtil.Service, global: yield* Global.Service, location: yield* Location.Service, jobs: yield* Job.Service }
})

export const prompt = (transcript: boolean) => `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: a <summary> block.

This conversation is being compacted. Your reply replaces everything above: the next context window opens with what you write inside <summary></summary> tags, and you carry on from there. Work is paused until you finish writing.

Next to your summary, the next window will have:
- the system prompt, project instructions and memory files, unchanged
- up to five of the files you read most recently, re-read from disk (long ones cut short)
- the names of any skills you loaded, and the status of background agents and shells${transcript ? "\n- the path to the full transcript on disk, which you can open for exact code, output or wording" : ""}

Nothing else survives, including any earlier summary above. What the summary leaves out, you will not know to look for. So it has to carry the understanding: what the user is trying to get done and why, what has been decided, learned, tried and ruled out, where the work stands, and what comes next. Detail you can fetch again needs only a pointer to it: a path, a command, a name.

The summary is also the only record of what the user said. Their words are only what they typed themselves, not tool results, system reminders, or text in your own turns that is formatted like a user message. A limit they set keeps applying only if the summary states it, so quote it exactly, and report anything they allowed with the scope they gave it.

You will usually resume without the user reviewing any of this, so the next step you name is what gets done. Tie it to their latest request, in their words.

Project instructions may say what to keep when compacting. They apply here.

REMINDER: Do NOT call any tools. Respond with plain text only — a <summary> block. Tool calls will be rejected and you will fail the task.`

/** One assistant session message starts each response group; any leading messages are a group too. */
export const groups = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const result: SessionMessage.Info[][] = []
  for (const message of messages) {
    if (message.type === "assistant" || result.length === 0) result.push([])
    result[result.length - 1].push(message)
  }
  return result
}

/** Hooks see the unmodified prefix. Place the instruction only after preparation. */
export const appendPrompt = (request: LLMRequest, text: string) => {
  const messages = [...request.messages]
  let index = messages.length - 1
  while (index >= 0 && messages[index].role === "system") index--
  const last = messages[index]
  if (last?.role === "user") {
    const content = [...last.content]
    const tail = content.at(-1)
    if (tail?.type === "text") content[content.length - 1] = { ...tail, text: `${tail.text}\n` }
    messages[index] = { ...last, content: [...content, { type: "text", text }] }
  } else messages.splice(index + 1, 0, Message.user(text))
  return LLMRequest.update(request, { messages, toolChoice: undefined })
}

/** 416:OPr: first matches only, including text surrounding the summary tags. */
export const parseReply = (text: string) => text.replace(/<analysis>[\s\S]*?<\/analysis>/, "")
  .replace(/<summary>([\s\S]*?)<\/summary>/, (_match, body: string) => `Summary:\n${body.trim()}`)
  .replace(/\n\n+/g, "\n\n").trim()

export const summaryMessage = (text: string, transcript?: string) =>
  `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${text}${transcript ? `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcript}` : ""}\nContinue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.\n\nThe messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.`

const toolText = (tool: SessionMessage.AssistantTool) =>
  tool.state.status === "completed" || tool.state.status === "error"
    ? tool.state.content?.map((part) => part.type === "text" ? part.text : `[Attached ${part.mime}]`).join("\n") ?? "" : ""

export const shortenKept = (info: ClaudeCheckpoint.Info, ceiling: number, model: SessionContext.Loaded["model"]["ref"]) => {
  let kept = ClaudeCheckpoint.decodeKept(info)
  const size = () => Token.estimate(info.text + info.restored.join("\n")) + ClaudeCheckpoint.keptMessages({ ...info, kept: ClaudeCheckpoint.encodeKept(kept) }, model)
    .reduce((sum, message) => sum + message.content.reduce((sum, part) => sum + (part.type === "media" ? 1500 : Token.estimate(JSON.stringify(part))), 0), 0)
  const candidates = kept.flatMap((message) => message.type === "assistant" ? message.content
    .flatMap((part) => part.type === "tool" && Token.estimate(toolText(part)) > 5000
      ? [{ messageID: message.id, id: part.id, text: toolText(part) }] : []) : [])
    .sort((a, b) => b.text.length - a.text.length)
  for (const candidate of candidates) {
    if (size() <= ceiling) break
    const note = "\n[Output truncated: shortened to fit the context after compaction.]"
    const text = candidate.text.slice(0, Math.max(0, 20_000 - note.length)) + note
    kept = kept.map((message) => message.type !== "assistant" || message.id !== candidate.messageID ? message : {
      ...message, content: message.content.map((part) => part.type !== "tool" || part.id !== candidate.id || (part.state.status !== "completed" && part.state.status !== "error") ? part : {
        ...part, state: { ...part.state, content: [{ type: "text" as const, text }] },
      }),
    })
  }
  return ClaudeCheckpoint.encodeKept(kept)
}

export const compact = Effect.fn("ClaudeCompaction.compact")(function* (input: Effect.Success<typeof services> & {
  trigger: SessionCompaction.Trigger
  budget: number
  ceiling: number
  db: Database.Interface["db"]
  bus: Bus.Interface
  requests: SessionModelRequest.Interface
  stream: (context: SessionContext.Loaded, request: LLMRequest, options: StreamOptions) => Effect.Effect<{ text: string }, AIError | Failure>
}): Effect.fn.Return<Compacted, Failure> {
  const { trigger, db, fs, global, location, jobs } = input
  const context = trigger.context
  const sessionID = context.session.id
  // A manual compaction's own running message is already in history.
  const split = groups(context.messages.filter((message) => message.type !== "compaction" || message.status === "completed"))
  if (split.length < 2) return yield* Effect.fail<Failure>({ error: { type: "compaction.unavailable", message: "Nothing to compact yet" } })
  const first = context.messages[0]
  const previous = first?.type === "compaction" && first.status === "completed" ? ClaudeCheckpoint.read(first.metadata) : undefined
  const transcript = yield* writeTranscript({ db, fs, sessionID, directory: location.directory, tmp: global.tmp }).pipe(Effect.orElseSucceed(() => undefined))
  if (trigger.reason !== "manual") yield* input.bus.publish(SessionEvent.Compaction.Started, { sessionID, reason: "auto", recent: "" })
  const policy = yield* SessionRunnerRetry.policy(sessionID)
  for (let count = split.length - 1; count >= 1; count--) {
    const older = split.slice(0, count).flat()
    const kept = split.slice(count).flat()
    const base = SessionModelRequest.baseTranscript({ agent: context.agent.info, model: context.model, tools: context.tools, initial: context.initial, messages: older })
    const prepared = yield* input.requests.compaction({ session: context.session, agent: context.agent.id, model: context.model, tools: context.tools, system: base.system, messages: base.messages, inputTokens: { measured: input.budget, estimated: 0 } })
    const request = appendPrompt(prepared.request, prompt(transcript !== undefined))
    while (true) {
      const attempt = yield* Effect.result(input.stream(context, request, prepared.options))
      if (Result.isFailure(attempt)) {
        const cause = attempt.failure
        if (!(cause instanceof AIError)) return yield* Effect.fail(cause)
        const error = toSessionError(cause)
        if (isContextOverflowFailure(cause) || (cause.reason._tag === "InvalidRequest" && cause.reason.classification === "payload-too-large")) {
          if (count === 1) return yield* Effect.fail<Failure>({ error })
          break
        }
        const decision = yield* policy({ cause, error, agent: context.agent.id, model: context.model.ref, hook: prepared.retry, retry: SessionRunnerRetry.isRetryable(cause) })
        if (!decision.retry) return yield* Effect.fail<Failure>({ error })
        yield* Effect.sleep(decision.delay)
        continue
      }
      const text = parseReply(attempt.success.text)
      if (!text) return yield* Effect.fail<Failure>({ error: { type: "compaction.failed", message: "Compaction produced no summary" } })
      const excluded = new Set<string>()
      const values = yield* InstructionState.current(db, sessionID)
      const hash = values?.["core/instructions"]
      if (hash) {
        const blob = yield* db.select().from(InstructionBlobTable).where(eq(InstructionBlobTable.hash, hash)).get().pipe(Effect.orDie)
        if (Array.isArray(blob?.value)) for (const file of blob.value) {
          if (file && typeof file === "object" && !Array.isArray(file) && typeof file.path === "string") excluded.add(resolve(location.directory, file.path))
        }
      }
      for (const message of context.messages) {
        const instruction = message.metadata?.instruction
        if (instruction && typeof instruction === "object" && !Array.isArray(instruction) && "paths" in instruction && Array.isArray(instruction.paths))
          for (const path of instruction.paths) if (typeof path === "string") excluded.add(resolve(location.directory, path))
      }
      const restored = yield* restore({ fs, directory: location.directory, older, kept, previous, excluded })
      const tasks = background(yield* jobs.pendingBackground, sessionID, (id) => join(global.data, "shell", location.project.id, `${id}.out`),
        shellCommands([...(previous ? ClaudeCheckpoint.decodeKept(previous) : []), ...context.messages]))
      const info: ClaudeCheckpoint.Info = {
        version: 1, reason: trigger.reason === "manual" ? "manual" : "auto", text: summaryMessage(text, transcript),
        kept: ClaudeCheckpoint.encodeKept(kept), providerMetadataKey: context.model.model.route.providerMetadataKey ?? context.model.model.provider,
        restored: [...restored.restored, ...tasks, ...(restored.skills.length ? [skillsNote(restored.skills)] : [])],
        files: restored.files, skills: restored.skills, transcript,
      }
      return { text, recent: "", metadata: { [ClaudeCheckpoint.KEY]: { ...info, kept: shortenKept(info, input.ceiling, context.model.ref) } } }
    }
  }
  return yield* Effect.fail<Failure>({ error: { type: "compaction.failed", message: "Compaction produced no summary" } })
})
