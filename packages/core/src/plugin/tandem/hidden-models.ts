// Tandem-owned (not in upstream): drop retired model versions from every provider's catalog.
/*
 * Removes Claude Haiku 4.5, Opus 4.5, Opus 4.7, Opus 5, Sonnet 5 and Fable 5; GPT-6 Sol, GPT-5.6 Terra,
 * GPT-5.5 and GPT-5.3 (including Codex Spark); GLM 4.5, 4.6, 4.7, 5, 5.1, 5.2 and every GLM Turbo; and
 * Kimi K2.6. Each goes with all its fast, pro, thinking, dated and regional variants, so none can be picked,
 * defaulted to or configured. Providers spell IDs differently (`claude-haiku-4-5`, `claude-4.5-haiku`,
 * `anthropic.claude-haiku-4-5-20251001-v1:0`, `openai-gpt-55`, `glm-4p7`), so the API model IDs are
 * matched by family and version rather than listed. Registered after configuration, so models a config
 * file declares are removed too. Claude Fable 5.2 Fast, GPT-6 Cyber and GPT-5.6 Cyber are removed on their
 * own; Fable 5.2 and later Cyber versions stay.
 *
 * `FreeModels` turns on upstream's OPENCODE_DISABLE_FREE_MODELS unless it is already set, so OpenCode's
 * free models stay out of the picker. Set OPENCODE_DISABLE_FREE_MODELS=0 to bring them back. It must be
 * registered before the provider plugins, because the OpenCode provider reads the variable when it starts.
 */
export * as HiddenModelsPlugin from "./hidden-models.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"

const S = "[-._]"
// Version separator; Fireworks writes decimal points as "p" (glm-5p3).
const V = "(?:[-._]|p)"

const HIDDEN = [
  // claude-haiku-4-5, claude-opus4-5-20251101, claude-opus4-7, claude-opus-5-fast, claude-fable-5; not
  // claude-opus-5-5, claude-fable-5-1 or a dated claude-opus-5-20260101.
  new RegExp(`(?:haiku${S}?4${V}5|opus${S}?4${V}[57]|(?:opus|sonnet|fable)${S}?5(?!${V}\\d(?!\\d)))(?!\\d)`),
  // claude-4.5-haiku, claude-4.5-opus, claude-4.7-opus, claude-5-sonnet; not claude-5.5-sonnet.
  new RegExp(`(?<![\\d.p])(?:4${V}5${S}(?:haiku|opus)|4${V}7${S}opus|(?<!\\d${V})5${S}(?:opus|sonnet|fable))`),
  // claude-fable-5-2-fast; not claude-fable-5-2.
  new RegExp(`fable${S}?5${V}2${S}fast`),
  // gpt-6-sol (not gpt-6.1-sol), gpt-5.6-terra, gpt-5.5, gpt-55-pro, gpt-5.3-codex-spark, gpt-6-cyber and
  // gpt-5.6-cyber (not gpt-6.1-cyber).
  new RegExp(`gpt${S}?(?:6${S}sol|5${V}?6${S}terra|5${V}?[35](?!\\d)|(?:5${V}?6|6)${S}cyber)`),
  // glm-4.5 to glm-4.7, glm-5, glm-5.1 and glm-5.2 with their suffixes; glm-5.3 stays.
  new RegExp(`glm${S}?(?:5${V}[12]|4${V}[5-7]|5(?!${V}?\\d))(?!\\d)`),
  /glm.*turbo/,
  /kimi[-._]?k2(?:[-._]|p)6(?!\d)/,
]

export const hidden = (modelID: string) => {
  const id = modelID.toLowerCase()
  return HIDDEN.some((pattern) => pattern.test(id))
}

export const FreeModels = define({
  id: "tandem.hidden-models.free",
  effect: Effect.fn("HiddenModelsPlugin.freeModels")(function* () {
    process.env.OPENCODE_DISABLE_FREE_MODELS ??= "1"
  }),
})

export const Plugin = define({
  id: "tandem.hidden-models",
  effect: Effect.fn("HiddenModelsPlugin")(function* (ctx) {
    yield* ctx.model.transform((models) => {
      for (const model of [...models.list()]) {
        if (hidden(model.id) || (model.modelID !== undefined && hidden(model.modelID)))
          models.remove(model.providerID, model.id)
      }
    })
  }),
})
