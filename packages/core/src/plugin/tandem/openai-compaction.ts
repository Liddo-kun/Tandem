// Tandem-owned (not in upstream): default OpenAI to native compaction.
/*
 * OpenAI compacts natively (Codex's in-band trigger or /responses/compact) unless something already chose a
 * policy. Register after ProviderPlugins: the token-sharing login sets "summary" there because it cannot compact
 * natively, and that choice must stand. Configuration merges later, so `providers.openai.settings.compaction`
 * still overrides this default.
 */
export * as OpenAICompactionPlugin from "./openai-compaction.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { Provider } from "../../provider.js"

export const Plugin = define({
  id: "tandem.openai.compaction",
  effect: Effect.fn("OpenAICompactionPlugin")(function* (ctx) {
    yield* ctx.provider.transform((providers) => {
      if (!providers.get(Provider.ID.openai)) return
      providers.update(Provider.ID.openai, (provider) => {
        if (provider.settings?.compaction) return
        provider.settings = Provider.mergeOverlay(provider.settings, { compaction: { type: "native" } })
      })
    })
  }),
})
