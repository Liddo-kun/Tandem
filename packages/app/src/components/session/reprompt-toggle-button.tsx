import { createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings, type PromptEnhanceState } from "@/context/settings"

// UPSTREAM-DIVERGENCE: Tandem-only composer toggle for the built-in prompt
// enhance feature (prompt-corrector plugin). Cycles three states:
//   on           -> correction + RePrompt (default)
//   no-reprompt  -> correction only; RePrompt duplication skipped
//   off          -> correction and RePrompt both skipped
// The non-"on" states stamp metadata markers onto outgoing prompts (see
// build-request-parts.ts) that the plugin reads — a live opt-out, no server
// restart. Kept in its own component so prompt-input.tsx only needs a one-line
// insertion per layout (minimal merge surface).

const NEXT: Record<PromptEnhanceState, PromptEnhanceState> = {
  on: "no-reprompt",
  "no-reprompt": "off",
  off: "on",
}

const LABEL_KEY = {
  on: "prompt.enhance.state.on",
  "no-reprompt": "prompt.enhance.state.noReprompt",
  off: "prompt.enhance.state.off",
} as const

export function RepromptToggleButton(props: { legacy?: boolean }) {
  const language = useLanguage()
  const settings = useSettings()
  const state = createMemo(() => settings.general.promptEnhance())
  const label = () => language.t(LABEL_KEY[state()])
  const tone = createMemo(() =>
    props.legacy
      ? "text-13-regular text-text-weak hover:text-text-base"
      : "text-[13px] font-[440] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base",
  )

  return (
    <button
      type="button"
      data-action="prompt-reprompt-toggle"
      data-component="prompt-reprompt-toggle"
      data-state={state()}
      class={`inline-flex shrink-0 items-center whitespace-nowrap rounded border-0 bg-transparent px-1 transition-colors ${tone()}`}
      classList={{ "opacity-50 line-through": state() === "no-reprompt", "opacity-40 line-through": state() === "off" }}
      onClick={() => settings.general.setPromptEnhance(NEXT[state()])}
      aria-label={label()}
      title={label()}
    >
      {state() === "off" ? "✕ RePrompt" : "RePrompt"}
    </button>
  )
}
