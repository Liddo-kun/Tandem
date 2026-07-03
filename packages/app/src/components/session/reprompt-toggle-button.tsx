import { createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useSettings } from "@/context/settings"

// UPSTREAM-DIVERGENCE: Tandem-only composer toggle for the built-in RePrompt
// duplication (prompt-corrector plugin). When off, outgoing prompts are stamped
// with a metadata marker (see build-request-parts.ts) that the plugin reads to
// skip its "Read it again" reinforcement — a live opt-out, no server restart.
// Kept in its own component so prompt-input.tsx only needs a one-line insertion
// per layout (minimal merge surface).

export function RepromptToggleButton(props: { legacy?: boolean }) {
  const language = useLanguage()
  const settings = useSettings()
  const enabled = createMemo(() => settings.general.reprompt())
  const label = () => language.t(enabled() ? "prompt.reprompt.disable" : "prompt.reprompt.enable")
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
      class={`inline-flex shrink-0 items-center whitespace-nowrap rounded border-0 bg-transparent px-1 transition-colors ${tone()}`}
      classList={{ "opacity-50 line-through": !enabled() }}
      onClick={() => settings.general.setReprompt(!enabled())}
      aria-pressed={enabled()}
      aria-label={label()}
      title={label()}
    >
      RePrompt
    </button>
  )
}
