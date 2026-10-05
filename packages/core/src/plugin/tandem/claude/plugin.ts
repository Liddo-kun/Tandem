export * as ClaudePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Message, SystemPart } from "@opencode/ai"
import { Effect } from "effect"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { ClaudePresentation } from "./presentation.js"
import PROMPT from "./anthropic.txt" with { type: "text" }

/** Register after configured hooks and the auxiliary policies. Transport auth is external. */
export const Plugin = define({
  id: "tandem.claude",
  effect: Effect.fn("ClaudePlugin.Plugin")(function* (ctx) {
    const hook = (event: SessionHooks["context"]) => Effect.gen(function* () {
      if (!ClaudePresentation.isClaude(event.model.id)) {
        const model = (yield* ctx.model.list().pipe(Effect.orDie)).data.find((model) => model.providerID === event.model.providerID && model.id === event.model.id)
        if (!ClaudePresentation.isClaude(model?.modelID ?? "")) return
      }
      const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
      if (TandemAuxiliary.isBareContext(session.metadata)) return
      const agent = (yield* ctx.agent.get({ agentID: event.agent }).pipe(Effect.orDie)).data
      if (!agent.system && event.system[0]) event.system[0] = SystemPart.make(PROMPT)
      // Identity and configured hooks insert/reorder blocks, so use the assembly marker,
      // not a positional guess. Chronological frozen updates remain in place.
      const index = event.system.findIndex((part) => part.metadata?.["tandem.instruction-baseline"] === true)
      const initial = event.system[index]
      if (initial) {
        const first = event.messages.findIndex((message) => message.role === "user")
        if (first >= 0) {
          const message = event.messages[first]
          event.messages[first] = new Message({ ...message, content: [Message.text(`<system-reminder>\n${initial.text}\n</system-reminder>`), ...message.content] })
          event.system.splice(index, 1)
        }
      }
      const skill = event.tools.skill
      if (skill) {
        skill.description = "Load a specialized skill's instructions and resources. Choose its ID from the available skills list in the system reminder; do not reload skills already present in the conversation."
        const properties = skill.input.properties
        if (properties && typeof properties === "object" && !Array.isArray(properties)) {
          const id = "id" in properties ? properties.id : undefined
          if (id && typeof id === "object" && !Array.isArray(id))
            skill.input = { ...skill.input, properties: { ...properties, id: { ...id, description: "The skill ID from the available skills list in the system reminder" } } }
        }
      }
    })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})
