// Tandem-owned (not in upstream): shared bare-session policy for Corrector and browser webfetch.
/*
 * Auxiliary work uses normal child sessions; this module does not add another runner or API.
 * Shared IDs and metadata schemas live in @opencode/util/tandem-auxiliary.
 * Create a fresh child with explicit role, bare-context, Corrector-disabled, and owner metadata.
 * Do not inherit or copy the parent's metadata, permissions, agent, or model implicitly.
 * Literal tandemBareContext=true selects agent-only instructions before ambient discovery and
 * Read-triggered injection. The selected agent system prompt and requested file content remain.
 * Defaults run before configuration. They create hidden primary agents, deny Corrector tools,
 * and give the reader openai/gpt-5.6-sol#medium with only fetch_page and Read allowed.
 * Policy runs after configuration. It preserves user model/system settings, enforces hidden
 * primary mode, and denies fetch_page to every non-reader agent.
 * Feature code must still pass narrow child permissions and validate role, owner, and budgets
 * inside privileged tool executors; catalog visibility is not authorization.
 * Prompt admits work and wait observes idle, so callers must inspect outcome and context.
 * Own children in an operation scope and always await remove in a finalizer on success, failure,
 * timeout, or cancellation. Process death cannot run finalizers; no orphan cleanup is provided.
 */
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
