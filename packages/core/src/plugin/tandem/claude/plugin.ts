export * as ClaudePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Message, SystemPart, UserMessage } from "@opencode/ai/effect"
import { Cause, Clock, DateTime, Effect, FiberMap } from "effect"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { isRecord } from "@opencode/util/record"
import { Environment } from "../../../environment/index.js"
import { FileAccess } from "../../../file-access.js"
import { ClaudeCheckpoint } from "./checkpoint.js"
import { ClaudeCold } from "./cold.js"
import { ClaudeHeld } from "./held.js"
import { ClaudeInstructions } from "./instructions.js"
import { ClaudePresentation } from "./presentation.js"
import { ClaudeUpdates } from "./updates.js"
import { ClaudeWorkdir } from "./workdir.js"
import { TandemMessageMetadata } from "../message-metadata.js"
import { TandemPrune } from "../prune.js"
import PROMPT from "./anthropic.txt" with { type: "text" }
import PROMPT_FABLE_5_2 from "./anthropic-fable-5-2.txt" with { type: "text" }

const CHECKPOINT = "<conversation-checkpoint>"

/**
 * Trimming. A prompt sent after the prompt cache expired pays for the whole conversation again. A client can set
 * `TRIM_NEXT` in the session's metadata first: the next prompt's message ID then moves to `TRIM_BEFORE`, and from
 * that request on every tool result before that prompt is shortened by `TandemPrune`'s rules. The cut is the same
 * on every later request, so the shorter prefix is cached as usual. A later trimmed prompt moves the cut forward;
 * compaction replaces the messages it applied to.
 */
const TRIM_NEXT = "tandemTrimNext"
const TRIM_BEFORE = "tandemTrimBefore"

/** Sessions at least this large, in tokens, get a summary held before their prompt cache expires. */
const HOLD_MIN = 180_000
/** How long before the cache expires a held summary's request starts, or a tenth of the lifetime if shorter. */
const HOLD_MARGIN = 3 * 60_000

/**
 * Fresh sessions and unmarked legacy checkpoints retain the opening-user anchor. Marked Claude checkpoints
 * instead rebuild the window from their structured kept group and automatic/manual placement below.
 */
const anchorOf = (messages: ReadonlyArray<Message>) => {
  const first = messages.findIndex((message) => message.role === "user")
  if (first < 0) return undefined
  const part = messages[first].content[0]
  if (part?.type !== "text" || !part.text.startsWith(CHECKPOINT)) return first
  return messages[first + 1]?.role === "user" ? first + 1 : first
}

/** A compaction rendered as a checkpoint message, whose session metadata may hold a Claude checkpoint. */
const isCheckpoint = (message: Message) => {
  const part = message.content[0]
  return message.role === "user" && part?.type === "text" && part.text.startsWith(CHECKPOINT)
}

// Same parsing as @opencode/ai's internal claudeVersion, which its public API does not export.
const claudeVersion = (id: string) => {
  const match = /(?:^|[./])claude-(?<family>[a-z]+)-(?<major>\d+)(?:[.-](?<minor>\d{1,2}))?(?:$|[-:@])/.exec(
    id.toLowerCase(),
  )?.groups
  if (!match) return undefined
  return { family: match.family, major: Number(match.major), minor: Number(match.minor ?? 0) }
}

/** Claude models the Anthropic Messages protocol sends system messages to natively, mid-conversation. */
const nativeSystem = (id: string) => {
  const version = claudeVersion(id)
  if (version === undefined) return false
  return version.family === "opus" && version.major === 4 ? version.minor >= 8 : version.major >= 5
}

/** The base prompt, plus Fable 5.2's own additions. */
const basePrompt = (id: string) => {
  const version = claudeVersion(id)
  if (version?.family === "fable" && version.major === 5 && version.minor === 2 && PROMPT_FABLE_5_2.trim()) return `${PROMPT.trimEnd()}\n\n${PROMPT_FABLE_5_2}`
  return PROMPT
}

const reminder = (text: string) => Message.text(`<system-reminder>\n${text}\n</system-reminder>`)
const compactRecords = [
  "<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user. It's recorded here as context for later messages.</local-command-caveat>\n",
  "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>\n",
  "<local-command-stdout>\x1b[2mCompacted (ctrl+o to see full summary)\x1b[22m</local-command-stdout>\n",
]

/** One chronological update, or one reminder per item at the same user/tool boundary. */
const update = (messages: Message[], items: ReadonlyArray<string | undefined>, native: boolean) => {
  const texts = items.filter((text): text is string => text !== undefined && text.length > 0)
  if (!texts.length) return
  if (native) {
    messages.push(Message.make({ role: "system", content: texts.map(Message.text) }))
    return
  }
  const previous = messages.at(-1)
  const content = texts.map(reminder)
  if (previous?.role === "user") messages[messages.length - 1] = new UserMessage({ ...previous, content: [...previous.content, ...content] })
  else messages.push(Message.user(content))
}

/** The date is the baseline's final paragraph, not a date-like line inside an instruction file or catalog. */
const splitDate = (context: string | undefined) => {
  const match = context?.match(/(?:^|\n\n)(Today's date: [^\n]+)\s*$/)
  return match ? { context: context?.slice(0, match.index) || undefined, date: match[1] } : { context, date: undefined }
}

const checkpoint = (event: SessionHooks["context"], at: number, info: ClaudeCheckpoint.Info, files: string | undefined, context: string | undefined, native: boolean) => {
  const { context: baseline, date } = splitDate(context)
  const kept = ClaudeCheckpoint.keptMessages(info, event.model)
  const rest = event.messages.slice(at + 1)
  // Only a user message right after the checkpoint: a turn that continued past a mid-turn /compact keeps the
  // automatic layout, even once the user types again.
  const next = rest.findIndex((message) => message.role !== "system")
  const message = info.reason === "manual" ? rest[next] : undefined
  const user = message?.role === "user" ? next : -1
  const messages = event.messages.slice(0, at)
  if (message?.role !== "user") {
    messages.push(Message.user([...(files === undefined ? [] : [reminder(files)]), Message.text(info.text)]))
    update(messages, [date], native)
    messages.push(...kept)
    update(messages, [...info.restored, baseline], native)
    messages.push(...rest)
  } else {
    messages.push(Message.user(info.text), ...kept, ...rest.slice(0, user))
    messages.push(new UserMessage({ ...message, content: [...(files === undefined ? [] : [reminder(files)]), ...compactRecords.map(Message.text), ...message.content] }))
    update(messages, [...info.restored, baseline, date], native)
    messages.push(...rest.slice(user + 1))
  }
  event.messages.splice(0, event.messages.length, ...messages)
}

/** Register after configured hooks and the auxiliary policies. Transport auth is external. */
export const Plugin = define({
  id: "tandem.claude",
  effect: Effect.fn("ClaudePlugin.Plugin")(function* (ctx) {
    const workdir = yield* ClaudeWorkdir.make(ctx)
    const messageMetadata = TandemMessageMetadata.make(ctx)
    const environment = yield* Environment.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    yield* ctx.tool.hook("execute.after", (event) => Effect.gen(function* () {
      if (event.status !== "completed" || !["read", "edit", "write", "patch"].includes(event.tool)) return
      const input = event.input
      const paths = event.tool === "patch"
        ? (Array.isArray(event.result.metadata?.files) ? event.result.metadata.files : []).flatMap((file) =>
          file && typeof file === "object" && "file" in file && typeof file.file === "string" ? [file.file] : [])
        : input && typeof input === "object" && "path" in input && typeof input.path === "string" ? [input.path] : []
      const mtimes: Record<string, number> = {}
      for (const path of new Set(paths)) {
        const absolute = FileAccess.resolvePath(ctx.location.directory, path)
        const stat = yield* environment.files.stat(absolute).pipe(Effect.orElseSucceed(() => undefined))
        if (stat?.type === "file") mtimes[absolute] = stat.mtimeMs
      }
      if (Object.keys(mtimes).length) event.result = { ...event.result, metadata: { ...event.result.metadata, [ClaudeCheckpoint.MTIMES]: mtimes } }
    }))
    // The API model ID of selected or resolved Claude models, except bare auxiliary sessions.
    const presented = (event: Pick<SessionHooks["context"], "sessionID" | "model">) => Effect.gen(function* () {
      const id = (yield* ctx.model.list().pipe(Effect.orDie)).data.find((model) => model.providerID === event.model.providerID && model.id === event.model.id)?.modelID ?? event.model.id
      if (!ClaudePresentation.isClaude(event.model.id) && !ClaudePresentation.isClaude(id)) return undefined
      const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
      return TandemAuxiliary.isBareContext(session.metadata) ? undefined : { id, trimBefore: session.metadata?.[TRIM_BEFORE], session }
    })
    /** Puts something that went wrong where clients show it: the session's metadata, until its next turn ends. */
    const report = (sessionID: SessionHooks["prompt"]["sessionID"], message: string) => Effect.gen(function* () {
      yield* Effect.logWarning(message, { sessionID })
      const session = yield* ctx.session.get({ sessionID })
      const failure = { at: yield* Clock.currentTimeMillis, message }
      yield* ctx.session.update({ sessionID, metadata: { ...session.metadata, [ClaudeHeld.FAILED]: failure } })
    }).pipe(Effect.ignore)
    /** Reports whatever failed, as `describe` words it. An interruption is not a failure: it stays one. */
    const failed = (sessionID: SessionHooks["prompt"]["sessionID"], describe: (reason: string) => string) => (cause: Cause.Cause<unknown>) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
      const error = Cause.squash(cause)
      return report(sessionID, describe(typeof error === "string" ? error : error instanceof Error ? error.message : String(error)))
    }

    yield* ctx.session.hook("prompt", (event) => Effect.gen(function* () {
      const session = yield* ctx.session.get({ sessionID: event.sessionID })
      if (session.metadata?.[TRIM_NEXT] !== true) return
      const { [TRIM_NEXT]: _, ...metadata } = session.metadata
      yield* ctx.session.update({ sessionID: event.sessionID, metadata: { ...metadata, [TRIM_BEFORE]: event.messageID } })
    }).pipe(Effect.catchCause(failed(event.sessionID, (reason) => `Earlier tool results may not have been trimmed for this prompt: ${reason}`))))

    // Idle compaction: a summary written shortly before a large idle session's prompt cache expires (see `ClaudeHeld`).
    const holds = yield* FiberMap.make<string>()
    // Set once it went wrong in a way that would repeat for every session, until the server restarts.
    let off = false
    yield* ctx.session.hook("experimental.idle", (event) => Effect.gen(function* () {
      const sessionID = event.sessionID
      const session = yield* ctx.session.get({ sessionID })
      // The turn that just ended made any earlier summary, and any report about one, stale.
      if (session.metadata && (ClaudeHeld.KEY in session.metadata || ClaudeHeld.FAILED in session.metadata)) {
        const { [ClaudeHeld.KEY]: _, [ClaudeHeld.FAILED]: __, ...metadata } = session.metadata
        yield* fs.remove(ClaudeHeld.file(global.data, sessionID), { force: true }).pipe(Effect.ignore)
        yield* ctx.session.update({ sessionID, metadata })
      }
      if (off || session.parentID || TandemAuxiliary.isBareContext(session.metadata)) return
      const last = ClaudeHeld.lastResponse(yield* ctx.session.context({ sessionID }))
      if (!last?.tokens || last.error) return
      const info = (yield* ctx.model.list()).data.find((model) => model.providerID === last.model.providerID && model.id === last.model.id)
      if (!ClaudePresentation.isClaude(last.model.id) && !ClaudePresentation.isClaude(info?.modelID ?? "")) return
      if (last.tokens.input + last.tokens.cache.read + last.tokens.cache.write + last.tokens.output + last.tokens.reasoning < HOLD_MIN) return
      // Compaction's own summary request, sent by compaction's own code (see `ClaudeCompaction.register`).
      const write = ClaudeHeld.writer(ctx.location)
      if (!write) {
        off = true
        return yield* report(sessionID, "Idle compaction is unavailable: compaction has not registered its request for this folder. It is off until the server restarts.")
      }
      const lifetime = ClaudeCold.cacheLifetime(info?.settings?.cache?.ttl)
      const expires = DateTime.toEpochMillis(last.time.created) + lifetime
      const due = expires - Math.min(HOLD_MARGIN, lifetime / 10)
      const now = yield* Clock.currentTimeMillis
      if (due <= now) return
      yield* FiberMap.run(holds, sessionID, Effect.gen(function* () {
        yield* Effect.sleep(due - now)
        // A device that slept through the timer wakes with the cache already gone.
        if (off || (yield* Clock.currentTimeMillis) >= expires) return
        if (ClaudeHeld.lastResponse(yield* ctx.session.context({ sessionID }))?.id !== last.id) return
        const written = yield* write(sessionID, last.id, expires)
        if (!written) return
        yield* Effect.logInfo("idle compaction wrote a summary", { sessionID, read: written.read, sent: written.sent })
        const at = yield* Clock.currentTimeMillis
        yield* fs.writeWithDirs(ClaudeHeld.file(global.data, sessionID), written.text)
        const current = yield* ctx.session.get({ sessionID })
        const mark: ClaudeHeld.Mark = { assistantID: last.id, at }
        yield* ctx.session.update({ sessionID, metadata: { ...current.metadata, [ClaudeHeld.KEY]: mark } })
        // The request exists to read the cache. One that did not paid full price, and so would the next.
        if (written.read * 2 >= written.sent) return
        off = true
        const count = (tokens: number) => tokens.toLocaleString("en-US")
        yield* report(sessionID, `Idle compaction read only ${count(written.read)} of ${count(written.sent)} tokens from the prompt cache and paid full price for the rest. The summary is kept. Idle compaction is off until the server restarts.`)
      }).pipe(Effect.catchCause(failed(sessionID, (reason) => `Idle compaction failed before the prompt cache expired: ${reason}`))))
    }).pipe(Effect.catchCause(failed(event.sessionID, (reason) => `Idle compaction could not be scheduled: ${reason}`))))
    const hook = (kind: "context" | "compaction" | "generate") => (event: SessionHooks["context"]) => Effect.gen(function* () {
      const primary = kind === "context"
      if (primary) workdir.inactive(event.sessionID)
      const shown = yield* presented(event)
      if (shown === undefined) return
      const id = shown.id
      // Before the layout below moves messages: shorten the tool results ahead of a prompt sent with "trim".
      const trimBefore = event.messages.findIndex((message) => message.id === shown.trimBefore)
      if (typeof shown.trimBefore === "string" && trimBefore > 0) event.messages.splice(0, event.messages.length, ...TandemPrune.trim(event.messages, trimBefore))
      const bash = workdir.present(event, primary)
      const agent = (yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.orDie)).data
      if (!agent.system && event.system[0]) event.system[0] = SystemPart.make(basePrompt(id))
      // Identity and configured hooks insert/reorder blocks, so find the instructions part by the
      // metadata upstream's baseTranscript gives only it, not a positional guess. Chronological frozen updates remain in place.
      const index = event.system.findIndex((part) => {
        const experimental = part.metadata?.experimental
        return isRecord(experimental) && Array.isArray(experimental.instructions)
      })
      const initial = event.system[index]
      const metadata = yield* messageMetadata(event.sessionID, event.messages, isCheckpoint)
      const marked = event.messages.findIndex((message) => ClaudeCheckpoint.read(metadata(message)) !== undefined)
      const anchor = anchorOf(event.messages)
      if (initial && (marked >= 0 || anchor !== undefined)) {
        // As in Claude Code: instruction files as the anchor's own reminder, the rest as a system message after it.
        const { files, context } = ClaudeInstructions.split(bash ? ClaudeWorkdir.environment(initial.text) : initial.text)
        const native = event.model.providerID === "anthropic" && nativeSystem(id)
        const info = marked < 0 ? undefined : ClaudeCheckpoint.read(metadata(event.messages[marked]))
        if (info) checkpoint(event, marked, info, files, context, native)
        else if (anchor !== undefined) {
          const system = native ? context : undefined
          const reminders = [files, system === undefined ? context : undefined].flatMap((text) => text === undefined ? [] : [reminder(text)])
          const message = event.messages[anchor]
          // anchorOf only returns user messages.
          if (message?.role === "user")
            event.messages.splice(anchor, 1, new UserMessage({ ...message, content: [...reminders, ...message.content] }), ...(system === undefined ? [] : [Message.system(system)]))
        }
        event.system.splice(index, 1)
      }
      // Anthropic's reminder after a long silent tool run, in sessions the user watches (see `ClaudeUpdates`).
      if (shown.session.parentID === undefined && ClaudeUpdates.applies(claudeVersion(id), event.model.providerID === "anthropic" && nativeSystem(id))) {
        const recorded = ClaudeUpdates.recorded(shown.session.metadata)
        const next = primary ? ClaudeUpdates.due(event.messages, recorded) : undefined
        // Sent only once recorded, so that every later request places it again.
        if (next !== undefined) yield* Effect.gen(function* () {
          const current = yield* ctx.session.get({ sessionID: event.sessionID })
          yield* ctx.session.update({ sessionID: event.sessionID, metadata: { ...current.metadata, [ClaudeUpdates.KEY]: [...recorded, next] } })
          recorded.add(next)
        }).pipe(Effect.catchCause((cause) => Effect.logWarning("Unable to record an update reminder", { sessionID: event.sessionID, cause })))
        ClaudeUpdates.place(event.messages, recorded)
      }
      const skill = event.tools.skill
      if (skill) {
        skill.description = "Load a specialized skill's instructions and resources. Choose its ID from the available skills list; do not reload skills already present in the conversation."
        const properties = skill.input.properties
        if (properties && typeof properties === "object" && !Array.isArray(properties)) {
          const id = "id" in properties ? properties.id : undefined
          if (id && typeof id === "object" && !Array.isArray(id))
            skill.input = { ...skill.input, properties: { ...properties, id: { ...id, description: "The skill ID from the available skills list" } } }
        }
      }
    })
    yield* ctx.session.hook("context", hook("context"))
    yield* ctx.session.hook("compaction", hook("compaction"))
    yield* ctx.session.hook("generate", hook("generate"))
  }),
})
