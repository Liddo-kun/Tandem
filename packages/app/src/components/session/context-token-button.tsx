import { createMemo, createSignal, createEffect, onCleanup, Show } from "solid-js"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useLanguage } from "@/context/language"

// UPSTREAM-DIVERGENCE: Tandem-only composer cache-health indicator. Replaces the plain
// context-token button with a token count + cache-TTL countdown that pulses and swaps to
// "cache hit: NN%" on each model request. Kept in its own component so the shared
// prompt-input.tsx only needs a one-line insertion per layout (minimal merge surface).

type Messages = Parameters<typeof getSessionContextMetrics>[0]
type Providers = Parameters<typeof getSessionContextMetrics>[1]

// Cache TTL by provider, mirroring the breakpoints Tandem sends in
// packages/opencode/src/provider/transform.ts (applyCaching). Only list providers whose TTL
// we actually control; anything else hides the countdown rather than show a wrong number.
const CACHE_TTL_SECONDS: Record<string, number> = { anthropic: 3600, openrouter: 3600, alibaba: 3600 }

export function ContextTokenButton(props: {
  messages: Messages
  providers: Providers
  onClick: () => void
  legacy?: boolean
}) {
  const language = useLanguage()
  const contextMetrics = createMemo(() => getSessionContextMetrics(props.messages, props.providers))
  const contextTokenLabel = createMemo(() => (contextMetrics().context?.total ?? 0).toLocaleString(language.intl()))

  // Cache health. Survival metric: how much of the previous request's cache survived into this
  // one (read_now / prevCacheTotal), so a big legitimate new write does not tank the score.
  // Falls back to a per-request hit ratio on the first turn.
  const cacheHealth = createMemo<number | null>(() => {
    const ctx = contextMetrics().context
    if (!ctx) return null
    if (ctx.previousCacheTotal > 0) return Math.min(1, ctx.cacheRead / ctx.previousCacheTotal)
    const denom = ctx.cacheRead + ctx.cacheWrite + ctx.input
    return denom > 0 ? ctx.cacheRead / denom : null
  })
  const cacheBand = createMemo<"good" | "warn" | "bad" | undefined>(() => {
    const h = cacheHealth()
    if (h === null) return undefined
    if (h >= 0.9) return "good"
    if (h >= 0.5) return "warn"
    return "bad"
  })
  const cacheHealthLabel = createMemo(() => {
    const h = cacheHealth()
    return h === null ? undefined : `${Math.round(h * 100)}%`
  })

  const cacheTtlSeconds = createMemo(() => {
    const id = contextMetrics().context?.message.providerID
    if (!id) return undefined
    const key = Object.keys(CACHE_TTL_SECONDS).find((k) => id.includes(k))
    return key ? CACHE_TTL_SECONDS[key] : undefined
  })
  // Anthropic refreshes the cache lifetime on each read, so the countdown anchors to the last
  // request's completion time and resets every turn; it hits 0 only after real idle time. The
  // value is derived from an absolute timestamp, so it stays correct across app suspends — the
  // interval merely forces a re-read of the clock, and only runs while a TTL is actually shown.
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (!cacheTtlSeconds()) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })
  const cacheCountdownLabel = createMemo(() => {
    const ttl = cacheTtlSeconds()
    const completed = contextMetrics().context?.message.time.completed
    if (!ttl || !completed) return undefined
    const remaining = Math.max(0, ttl - Math.floor((now() - completed) / 1000))
    return `${Math.floor(remaining / 60)}:${(remaining % 60).toString().padStart(2, "0")}`
  })

  // Pulse + swap to "cache hit" when a turn COMPLETES in the currently shown session. This button
  // stays mounted across tab/session switches (only `messages` changes), so tracking is scoped to
  // the session id: switching tabs never fires the animation on its own, and never re-shows the
  // session's prior turn as if it just landed. Gated on time.completed so the shown value is the
  // just-finished turn's final cache numbers, not a mid-stream or stale reading. Sticky: while
  // turns keep landing, push back the fade-out instead of toggling off→on (avoids flip-flop).
  const [cachePulse, setCachePulse] = createSignal(false)
  let pulseSessionID: string | undefined
  let lastCompletedID: string | undefined
  let pulseTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const message = contextMetrics().context?.message
    if (!message) return
    if (message.sessionID !== pulseSessionID) {
      // Switched into this session: adopt its current turn without animating. An in-flight turn
      // (no completed timestamp yet) is left unadopted so it still pulses once it finishes.
      pulseSessionID = message.sessionID
      lastCompletedID = message.time.completed ? message.id : undefined
      return
    }
    if (!message.time.completed || message.id === lastCompletedID) return
    lastCompletedID = message.id
    setCachePulse(true)
    clearTimeout(pulseTimer)
    pulseTimer = setTimeout(() => setCachePulse(false), 1700)
  })
  onCleanup(() => clearTimeout(pulseTimer))

  // count = token-count color, ttl = countdown color (differ only between the v2 and legacy themes).
  const tone = createMemo(() =>
    props.legacy
      ? { button: "text-13-regular text-text-weak hover:text-text-base", count: "text-text-base", ttl: "text-text-weak" }
      : {
          button: "text-[13px] font-[440] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base",
          count: "text-v2-text-text-faint",
          ttl: "text-v2-text-text-faint",
        },
  )

  return (
    <button
      type="button"
      data-action="prompt-context-tokens"
      data-component="prompt-context-tokens"
      data-cache-band={cacheBand()}
      data-cache-pulse={cachePulse() ? "true" : undefined}
      class={`inline-flex shrink-0 items-center whitespace-nowrap rounded border-0 bg-transparent px-1 -mx-1 tabular-nums transition-colors ${tone().button}`}
      onClick={() => props.onClick()}
      aria-label={language.t("context.usage.view")}
    >
      <span class="grid">
        <span
          class="[grid-area:1/1] transition-opacity duration-[400ms] [transform:translateZ(0)]"
          classList={{ "opacity-0": cachePulse() }}
        >
          <span>Context: </span>
          <span class={tone().count}>{contextTokenLabel()}</span>
          <span>t</span>
          <Show when={cacheCountdownLabel()}>{(label) => <span class={`ml-2 ${tone().ttl}`}>TTL: {label()}</span>}</Show>
        </span>
        <span
          class="[grid-area:1/1] transition-opacity duration-[400ms] [transform:translateZ(0)]"
          classList={{ "opacity-0": !cachePulse() }}
        >
          cache hit: <span data-slot="cache-tint">{cacheHealthLabel() ?? "—"}</span>
        </span>
      </span>
    </button>
  )
}
