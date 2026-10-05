export * as TandemAuxiliaryPlugin from "./auxiliary.js"

import { define } from "@opencode/plugin/effect/plugin"
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
import { Model } from "../../model.js"
import { Provider } from "../../provider.js"
import { Effect } from "effect"

/** Install defaults before configuration; feature plugins supply system instructions and executors. */
export const Defaults = define({
  id: "tandem.auxiliary.defaults",
  effect: Effect.fn("TandemAuxiliaryPlugin.defaults")(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(TandemAuxiliary.correctorAgent, (agent) => {
        agent.hidden = true
        agent.mode = "primary"
        agent.permissions = [{ action: "*", resource: "*", effect: "deny" }]
      })
      editor.update(TandemAuxiliary.readerAgent, (agent) => {
        agent.hidden = true
        agent.mode = "primary"
        agent.model = Model.Ref.make({
          providerID: Provider.ID.make("openai"),
          id: Model.ID.make("gpt-5.6-sol"),
          variant: Model.VariantID.make("medium"),
        })
        agent.permissions = [
          { action: "*", resource: "*", effect: "deny" },
          { action: TandemAuxiliary.fetchTool, resource: "*", effect: "allow" },
          { action: "read", resource: "*", effect: "allow" },
        ]
      })
    })
  }),
})

/** Install last, after configured agents and ordinary hooks, without replacing user model/system overrides. */
export const Policy = define({
  id: "tandem.auxiliary.policy",
  effect: Effect.fn("TandemAuxiliaryPlugin.policy")(function* (ctx) {
    yield* ctx.session.hook("instructions", (event) =>
      Effect.gen(function* () {
        const session = yield* ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)
        if (TandemAuxiliary.isBareContext(session.metadata)) event.mode = "agent-only"
      }),
    )
    yield* ctx.agent.transform((editor) => {
      for (const agent of editor.list()) {
        if (agent.id === TandemAuxiliary.correctorAgent || agent.id === TandemAuxiliary.readerAgent)
          editor.update(agent.id, (current) => {
            current.hidden = true
            current.mode = "primary"
          })
        if (agent.id !== TandemAuxiliary.readerAgent)
          editor.update(agent.id, (current) => {
            current.permissions.push({ action: TandemAuxiliary.fetchTool, resource: "*", effect: "deny" })
          })
      }
    })
  }),
})
