export * as ClaudePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Message, SystemPart } from "@opencode/ai"
import { Effect } from "effect"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { claudeVersion } from "@opencode/ai/protocols/utils/claude-model"
import { ClaudeInstructions } from "./instructions.js"
import { ClaudePresentation } from "./presentation.js"
import { ClaudeWorkdir } from "./workdir.js"
import PROMPT from "./anthropic.txt" with { type: "text" }

const CHECKPOINT = "<conversation-checkpoint>"

/**
 * Claude Code attaches context to the user turn that opens the context window: the first user message, or after
 * compaction the first user message after the summary. Without one, it goes before the checkpoint's own text.
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

/** Register after configured hooks and the auxiliary policies. Transport auth is external. */
export const Plugin = define({
  id: "tandem.claude",
  effect: Effect.fn("ClaudePlugin.Plugin")(function* (ctx) {
    const workdir = yield* ClaudeWorkdir.make(ctx)
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
      const anchor = anchorOf(event.messages)
      if (initial && anchor !== undefined) {
        // As in Claude Code: instruction files as the anchor's own reminder, the rest as a system message after it.
        const { files, context } = ClaudeInstructions.split(bash ? ClaudeWorkdir.environment(initial.text) : initial.text)
        // Compaction drops system messages when it shrinks its request, so it keeps the reminder form.
        const system = kind !== "compaction" && event.model.providerID === "anthropic" && nativeSystem(id) ? context : undefined
        const reminders = [files, system === undefined ? context : undefined].flatMap((text) => text === undefined ? [] : [Message.text(`<system-reminder>\n${text}\n</system-reminder>`)])
        const message = event.messages[anchor]
        event.messages.splice(anchor, 1, new Message({ ...message, content: [...reminders, ...message.content] }), ...(system === undefined ? [] : [Message.system(system)]))
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
