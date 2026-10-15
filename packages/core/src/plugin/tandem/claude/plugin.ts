export * as ClaudePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Message, SystemPart } from "@opencode/ai"
import { Effect } from "effect"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { claudeVersion } from "@opencode/ai/protocols/utils/claude-model"
import { Environment } from "../../../environment/index.js"
import { FileAccess } from "../../../file-access.js"
import { ClaudeCheckpoint } from "./checkpoint.js"
import { ClaudeInstructions } from "./instructions.js"
import { ClaudePresentation } from "./presentation.js"
import { ClaudeWorkdir } from "./workdir.js"
import PROMPT from "./anthropic.txt" with { type: "text" }

const CHECKPOINT = "<conversation-checkpoint>"

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

/** Claude models the Anthropic Messages protocol sends system messages to natively, mid-conversation. */
const nativeSystem = (id: string) => {
  const version = claudeVersion(id)
  if (version === undefined) return false
  return version.family === "opus" && version.major === 4 ? version.minor >= 8 : version.major >= 5
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
  if (previous?.role === "user") messages[messages.length - 1] = new Message({ ...previous, content: [...previous.content, ...content] })
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
  const user = info.reason === "manual" && rest[next]?.role === "user" ? next : -1
  const messages = event.messages.slice(0, at)
  if (user < 0) {
    messages.push(Message.user([...(files === undefined ? [] : [reminder(files)]), Message.text(info.text)]))
    update(messages, [date], native)
    messages.push(...kept)
    update(messages, [...info.restored, baseline], native)
    messages.push(...rest)
  } else {
    messages.push(Message.user(info.text), ...kept, ...rest.slice(0, user))
    const message = rest[user]
    messages.push(new Message({ ...message, content: [...(files === undefined ? [] : [reminder(files)]), ...compactRecords.map(Message.text), ...message.content] }))
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
    const environment = yield* Environment.Service
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
      return TandemAuxiliary.isBareContext(session.metadata) ? undefined : id
    })
    const hook = (kind: "context" | "compaction" | "generate") => (event: SessionHooks["context"]) => Effect.gen(function* () {
      const primary = kind === "context"
      if (primary) workdir.inactive(event.sessionID)
      const id = yield* presented(event)
      if (id === undefined) return
      const bash = workdir.present(event, primary)
      const agent = (yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.orDie)).data
      if (!agent.system && event.system[0]) event.system[0] = SystemPart.make(PROMPT)
      // Identity and configured hooks insert/reorder blocks, so use the assembly marker,
      // not a positional guess. Chronological frozen updates remain in place.
      const index = event.system.findIndex((part) => part.metadata?.["tandem.instruction-baseline"] === true)
      const initial = event.system[index]
      const marked = event.messages.findIndex((message) => ClaudeCheckpoint.read(message.metadata) !== undefined)
      const anchor = anchorOf(event.messages)
      if (initial && (marked >= 0 || anchor !== undefined)) {
        // As in Claude Code: instruction files as the anchor's own reminder, the rest as a system message after it.
        const { files, context } = ClaudeInstructions.split(bash ? ClaudeWorkdir.environment(initial.text) : initial.text)
        const native = event.model.providerID === "anthropic" && nativeSystem(id)
        const info = marked < 0 ? undefined : ClaudeCheckpoint.read(event.messages[marked].metadata)
        if (info) checkpoint(event, marked, info, files, context, native)
        else if (anchor !== undefined) {
          const system = native ? context : undefined
          const reminders = [files, system === undefined ? context : undefined].flatMap((text) => text === undefined ? [] : [reminder(text)])
          const message = event.messages[anchor]
          event.messages.splice(anchor, 1, new Message({ ...message, content: [...reminders, ...message.content] }), ...(system === undefined ? [] : [Message.system(system)]))
        }
        event.system.splice(index, 1)
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
