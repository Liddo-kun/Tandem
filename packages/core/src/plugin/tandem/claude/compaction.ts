export * as ClaudeCompaction from "./compaction.js"

import { AIError, isContextOverflowFailure, type LLMRequest, Message } from "@opencode/ai/effect"
import type { StreamOptions } from "@opencode/ai/route"
import type { SessionError } from "@opencode/schema/session-error"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { eq } from "drizzle-orm"
import { Model } from "@opencode/schema/model"
import { Clock, Effect, Result } from "effect"
import { join, resolve } from "path"
import { Agent } from "../../../agent.js"
import type { Bus } from "../../../bus.js"
import type { Database } from "../../../database/database.js"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { Job } from "../../../job.js"
import { Location } from "../../../location.js"
import { Model as Catalog } from "../../../model.js"
import type { SessionCompaction } from "../../../session/compaction.js"
import { SessionContext } from "../../../session/context.js"
import { SessionHistory } from "../../../session/history.js"
import { InstructionState } from "../../../session/instruction-state.js"
import type { SessionMessage } from "../../../session/message.js"
import { SessionSchema } from "../../../session/schema.js"
import { SessionModelRequest } from "../../../session/model-request.js"
import { SessionRunnerModel } from "../../../session/runner/model.js"
import { SessionRunnerRetry } from "../../../session/runner/retry.js"
import type { SessionUsage } from "../../../session/usage.js"
import { InstructionBlobTable } from "../../../session/sql.js"
import { toSessionError } from "../../../session/to-session-error.js"
import { Token } from "../../../util/token.js"
import { ClaudeCheckpoint } from "./checkpoint.js"
import { ClaudeCold } from "./cold.js"
import { ClaudeHeld } from "./held.js"
import { ClaudePresentation } from "./presentation.js"
import { background, restore, shellCommands, skillsNote } from "./restore.js"
import { writeTranscript } from "./transcript.js"

type Failure = { readonly error: SessionError.Error }
type Compacted = { readonly text: string; readonly metadata: Record<string, unknown> }
type Groups = ReadonlyArray<ReadonlyArray<SessionMessage.Info>>
type Common = Effect.Success<typeof services> & {
  db: Database.Interface["db"]
  bus: Bus.Interface
  requests: SessionModelRequest.Interface
  stream: (context: SessionContext.Loaded, request: LLMRequest, options: StreamOptions) => Effect.Effect<{ text: string }, AIError | Failure>
}

/**
 * Compaction-message metadata of a summary written from a pruned request on a cold cache: the model that wrote it
 * and `before`, the estimated size in tokens of the context it replaced.
 */
export const PRUNED = "tandem.compaction-pruned"

/** Claude models in sessions other than bare auxiliary ones; the same Claude detection as the request builder. */
export const applies = (context: SessionContext.Loaded) =>
  !TandemAuxiliary.isBareContext(context.session.metadata) &&
  (ClaudePresentation.isClaude(context.model.model.id) || ClaudePresentation.isClaude(context.model.ref.id))

/** Location nodes `services` needs, beyond those core compaction already depends on. */
export const nodes = [FSUtil.node, Global.node, Job.node, Location.node, SessionContext.node] as const

/** Agents, the catalog and the model resolver are core compaction's own dependencies; they pick the cold-cache model. */
export const services = Effect.gen(function* () {
  return {
    fs: yield* FSUtil.Service, global: yield* Global.Service, location: yield* Location.Service, jobs: yield* Job.Service,
    agents: yield* Agent.Service, catalog: yield* Catalog.Service, models: yield* SessionRunnerModel.Service,
    contexts: yield* SessionContext.Service,
  }
})

export const prompt = (transcript: boolean, pruned = false) => `CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

- Do NOT use Read, Bash, Grep, Glob, Edit, Write, or ANY other tool.
- You already have all the context you need in the conversation above.
- Tool calls will be REJECTED and will waste your only turn — you will fail the task.
- Your entire response must be plain text: a <summary> block.

This conversation is being compacted. Your reply replaces everything above: the next context window opens with what you write inside <summary></summary> tags, and you carry on from there. Work is paused until you finish writing.${pruned ? `\n\n${ClaudeCold.NOTE}` : ""}

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
export const groups = (messages: ReadonlyArray<SessionMessage.Info>) => responseGroups(messages)

const responseGroups = (messages: ReadonlyArray<SessionMessage.Info>) => {
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
  return { ...request, messages, toolChoice: undefined }
}

/** 416:OPr: first matches only, including text surrounding the summary tags. */
export const parseReply = (text: string) => text.replace(/<analysis>[\s\S]*?<\/analysis>/, "")
  .replace(/<summary>([\s\S]*?)<\/summary>/, (_match, body: string) => `Summary:\n${body.trim()}`)
  .replace(/\n\n+/g, "\n\n").trim()

export const summaryMessage = (text: string, transcript?: string) =>
  `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n${text}${transcript ? `\n\nIf you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: ${transcript}` : ""}\nContinue where you left off. Resume directly - pick up the task as if the break never happened.\n\nThe messages after this summary are the most recent messages from before compaction, kept verbatim. The summary was written without seeing them, so something it says has not happened yet may already have happened in them.`

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

const NO_SUMMARY: Failure = { error: { type: "compaction.failed", message: "Compaction produced no summary" } }
const tooLong = (cause: AIError) =>
  isContextOverflowFailure(cause) || (cause.reason._tag === "InvalidRequest" && cause.reason.classification === "payload-too-large")

/**
 * What a summary request is built from: the response groups, and the transcript file its prompt points to.
 * Undefined when there is no group to summarize. A manual compaction's own running message is already in history.
 */
const setup = Effect.fnUntraced(function* (input: Common, context: SessionContext.Loaded) {
  const groups: Groups = responseGroups(context.messages.filter((message) => message.type !== "compaction" || message.status === "completed"))
  if (groups.length < 2) return undefined
  const transcript = yield* writeTranscript({ db: input.db, fs: input.fs, sessionID: context.session.id, directory: input.location.directory, tmp: input.global.tmp }).pipe(Effect.orElseSucceed(() => undefined))
  return { groups, transcript }
})

/** The files and skills the next window gets back, for the first `count` groups summarized and the rest kept. */
const restoreFor = Effect.fnUntraced(function* (input: Common & { context: SessionContext.Loaded; groups: Groups; count: number; previous?: ClaudeCheckpoint.Info }) {
  const { db, fs, location, context } = input
  const excluded = new Set<string>()
  const values = yield* InstructionState.current(db, context.session.id)
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
  return yield* restore({ fs, directory: location.directory, older: input.groups.slice(0, input.count).flat(), kept: input.groups.slice(input.count).flat(), previous: input.previous, excluded })
})

/** The main request as it would go out, with the prompt added, so that it reads the prompt cache. */
const warm = Effect.fnUntraced(function* (input: Common & { context: SessionContext.Loaded; groups: Groups; budget: number; transcript: boolean }) {
  const context = input.context
  const policy = yield* SessionRunnerRetry.policy(context.session.id)
  for (let count = input.groups.length - 1; count >= 1; count--) {
    // Model switches in the held-back groups follow the summarized ones: an effort switch then still goes out as the
    // per-turn effort message, and the request-wide effort, part of the cached prefix, stays the one cached.
    const switches = input.groups.slice(count).flat().filter((message) => message.type === "model-switched")
    const older = [...input.groups.slice(0, count).flat(), ...switches]
    const base = SessionModelRequest.baseTranscript({ agent: context.agent.info, model: context.model, tools: context.tools, initial: context.initial, messages: older })
    const prepared = yield* input.requests.compaction({ session: context.session, agent: context.agent.id, model: context.model, tools: context.tools, system: base.system, messages: base.messages, inputTokens: { measured: input.budget, estimated: 0 } })
    const request = appendPrompt(prepared.request, prompt(input.transcript))
    while (true) {
      const attempt = yield* Effect.result(input.stream(context, request, prepared.options))
      if (Result.isFailure(attempt)) {
        const cause = attempt.failure
        if (!(cause instanceof AIError)) return yield* Effect.fail(cause)
        const error = toSessionError(cause)
        if (tooLong(cause)) {
          if (count === 1) return yield* Effect.fail<Failure>({ error })
          break
        }
        const decision = yield* policy({ cause, error, agent: context.agent.id, model: context.model.ref, hook: prepared.retry, retry: SessionRunnerRetry.isRetryable(cause) })
        if (!decision.retry) return yield* Effect.fail<Failure>({ error })
        yield* Effect.sleep(decision.delay)
        continue
      }
      const text = parseReply(attempt.success.text)
      if (!text) return yield* Effect.fail(NO_SUMMARY)
      return { text, count }
    }
  }
  return yield* Effect.fail(NO_SUMMARY)
})

/** The context with the model that summarizes on a cold cache: the compaction agent's, or `ClaudeCold.MODEL`. */
const coldContext = Effect.fnUntraced(function* (input: Common, context: SessionContext.Loaded) {
  const agent = yield* input.agents.get(Agent.ID.make("compaction"))
  const ref = agent?.model ?? { providerID: context.model.ref.providerID, id: Model.ID.make(ClaudeCold.MODEL) }
  const model = yield* input.models.resolve({ ...context.session, model: ref }, input.catalog.available, { kind: "compaction", agent: agent?.id ?? Agent.ID.make("compaction") }).pipe(Effect.orElseSucceed(() => undefined))
  return model ? { ...context, model } : context
})

/**
 * Everything but the last response group, rebuilt for a cold cache (see `ClaudeCold`) and sent to the cold-cache
 * model. The request is prepared through the usual hooks first, so the transcript shows what the model saw:
 * Claude's tool names and reworded results. Undefined when that model rejects the transcript as too long.
 */
const cold = Effect.fnUntraced(function* (input: Common & { context: SessionContext.Loaded; groups: Groups; transcript: boolean; restored: ReadonlyArray<string> }) {
  const context = yield* coldContext(input, input.context)
  const policy = yield* SessionRunnerRetry.policy(context.session.id)
  const base = SessionModelRequest.baseTranscript({ agent: context.agent.info, model: context.model, tools: context.tools, initial: context.initial, messages: input.groups.slice(0, -1).flat() })
  const prepared = yield* input.requests.compaction({ session: context.session, agent: context.agent.id, model: context.model, tools: context.tools, system: base.system, messages: base.messages })
  const request = ClaudeCold.request(prepared.request, { prompt: prompt(input.transcript, true), directory: input.location.directory, restored: new Set(input.restored) })
  if (!request) return undefined
  while (true) {
    const attempt = yield* Effect.result(input.stream(context, request, prepared.options))
    if (Result.isFailure(attempt)) {
      const cause = attempt.failure
      if (!(cause instanceof AIError)) return yield* Effect.fail(cause)
      if (tooLong(cause)) {
        yield* Effect.logWarning("the pruned compaction request was rejected as too long; sending the usual one", { sessionID: context.session.id, model: context.model.ref.id })
        return undefined
      }
      const error = toSessionError(cause)
      const decision = yield* policy({ cause, error, agent: context.agent.id, model: context.model.ref, hook: prepared.retry, retry: SessionRunnerRetry.isRetryable(cause) })
      if (!decision.retry) return yield* Effect.fail<Failure>({ error })
      yield* Effect.sleep(decision.delay)
      continue
    }
    const text = parseReply(attempt.success.text)
    if (!text) return yield* Effect.fail(NO_SUMMARY)
    return { text, model: context.model.ref }
  }
})

export const compact = Effect.fn("ClaudeCompaction.compact")(function* (input: Common & {
  trigger: SessionCompaction.Trigger
  budget: number
  ceiling: number
}): Effect.fn.Return<Compacted, Failure> {
  const { trigger, fs, global, location, jobs } = input
  const context = trigger.context
  const sessionID = context.session.id
  const built = yield* setup(input, context)
  if (!built) return yield* Effect.fail<Failure>({ error: { type: "compaction.unavailable", message: "Nothing to compact yet" } })
  const { groups, transcript } = built
  const first = context.messages[0]
  const previous = first?.type === "compaction" && first.status === "completed" ? ClaudeCheckpoint.read(first.metadata) : undefined
  // A summary written shortly before the cache expired, while it still covers the conversation.
  const mark = ClaudeHeld.read(context.session.metadata)
  const heldFile = ClaudeHeld.file(global.data, sessionID)
  const held = mark && ClaudeHeld.lastResponse(context.messages)?.id === mark.assistantID
    ? yield* fs.readFileString(heldFile).pipe(Effect.orElseSucceed(() => undefined))
    : undefined
  // A rejected request was just sent, so its prefix is as cached as it gets.
  const expired = trigger.reason !== "overflow" && ClaudeCold.expired(context, yield* Clock.currentTimeMillis)
  // A held or pruned summary keeps the last response group; which files come back is then known before it is written.
  const last = groups.length - 1
  const ahead = held || expired ? yield* restoreFor({ ...input, context, groups, count: last, previous }) : undefined
  const pruned = ahead && !held ? yield* cold({ ...input, context, groups, transcript: transcript !== undefined, restored: ahead.contents }) : undefined
  const summary = held && ahead
    ? { text: held, count: last, restored: ahead, pruned: undefined }
    : pruned && ahead
      ? { text: pruned.text, count: last, restored: ahead, pruned: { model: pruned.model, before: estimated(context) } }
      : yield* warm({ ...input, context, groups, transcript: transcript !== undefined }).pipe(
          Effect.flatMap((written) => restoreFor({ ...input, context, groups, count: written.count, previous }).pipe(
            Effect.map((restored) => ({ ...written, restored, pruned: undefined })))))
  const restored = summary.restored
  const kept = groups.slice(summary.count).flat()
  const tasks = background(yield* jobs.pendingBackground, sessionID, (id) => join(global.data, "shell", location.project.id, `${id}.out`),
    shellCommands([...(previous ? ClaudeCheckpoint.decodeKept(previous) : []), ...context.messages]))
  const info: ClaudeCheckpoint.Info = {
    version: 1, reason: trigger.reason === "manual" ? "manual" : "auto", text: summaryMessage(summary.text, transcript),
    kept: ClaudeCheckpoint.encodeKept(kept), providerMetadataKey: context.model.model.route.providerMetadataKey ?? context.model.model.provider,
    restored: [...restored.restored, ...tasks, ...(restored.skills.length ? [skillsNote(restored.skills)] : [])],
    files: restored.files, skills: restored.skills, transcript,
  }
  // The idle hook that discards a stale summary does not run after a compaction.
  if (held) yield* fs.remove(heldFile, { force: true }).pipe(Effect.ignore)
  return {
    text: summary.text,
    metadata: {
      [ClaudeCheckpoint.KEY]: { ...info, kept: shortenKept(info, input.ceiling, context.model.ref) },
      ...(summary.pruned ? { [PRUNED]: summary.pruned } : {}),
    },
  }
})

/** The size of the conversation's last request, in tokens: what a cold cache would have to read again. */
const estimated = (context: SessionContext.Loaded) => {
  const tokens = ClaudeCold.lastRequest(context)?.tokens
  return tokens ? tokens.input + tokens.cache.read + tokens.cache.write + tokens.output + tokens.reasoning : 0
}

/**
 * Registers this location's writer of the summary held before a prompt cache expires (see `ClaudeHeld`). It loads
 * the context the runner gives a manual compaction and sends that compaction's request with `warm`, through core
 * compaction's own `stream`, so the request is `/compact`'s: everything but the last response group, then the
 * prompt. Nothing is published to the session but the usage.
 */
export const register = (input: Omit<Common, "stream"> & {
  stream: (context: SessionContext.Loaded, request: LLMRequest, options: StreamOptions, background?: {
    readonly messages: ReadonlyArray<SessionMessage.Info>
    readonly usage: (usage: SessionUsage.Recorded) => void
  }) => Effect.Effect<{ text: string }, AIError | Failure>
  /** The largest summary request the session's model takes: a manual compaction's budget. */
  budget: (context: SessionContext.Loaded) => Effect.Effect<number>
}) => ClaudeHeld.register(input.location, (sessionID, assistantID, expires) => Effect.gen(function* () {
  // As the runner loads it for `/compact`.
  const selected = yield* input.contexts.select(SessionSchema.ID.make(sessionID))
  const model = yield* input.contexts.resolveModel(selected.session, { kind: "compaction", agent: selected.agent.id })
  const history = yield* SessionHistory.preview(input.db, selected.session.id, selected.instructions, model.ref)
  const context: SessionContext.Loaded = { session: selected.session, agent: selected.agent, tools: selected.tools, model, initial: history.initial, messages: history.messages }
  if (!applies(context) || ClaudeHeld.lastResponse(context.messages)?.id !== assistantID) return undefined
  // The cache holds nothing for a model selected since the last response: the request would pay full price.
  if (ClaudeCold.expired(context, yield* Clock.currentTimeMillis)) return undefined
  const built = yield* setup({ ...input, stream: input.stream }, context)
  if (!built) return undefined
  const usage: SessionUsage.Recorded[] = []
  const background = { messages: [], usage: (recorded: SessionUsage.Recorded) => { usage.push(recorded) } }
  const summary = yield* warm({
    ...input, context, groups: built.groups, transcript: built.transcript !== undefined, budget: yield* input.budget(context),
    stream: (context, request, options) => Effect.gen(function* () {
      if ((yield* Clock.currentTimeMillis) >= expires) return yield* Effect.fail<Failure>({ error: { type: "compaction.failed", message: "The prompt cache expired before the request could be sent" } })
      return yield* input.stream(context, request, options, background)
    }),
  })
  // A "too long" rejection made it hold back more than the last group; a compaction would then not match it.
  if (summary.count !== built.groups.length - 1) return yield* Effect.fail<Failure>({ error: { type: "compaction.failed", message: "The request was rejected as too long" } })
  const tokens = usage.map((item) => item.tokens)
  return {
    text: summary.text,
    read: tokens.reduce((sum, item) => sum + item.cache.read, 0),
    sent: tokens.reduce((sum, item) => sum + item.input + item.cache.read + item.cache.write, 0),
  }
}).pipe(Effect.mapError((failure) => "error" in failure ? failure.error.message : toSessionError(failure).message)))
