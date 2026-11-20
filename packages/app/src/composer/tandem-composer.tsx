// Tandem-owned (not in upstream): Tandem v1's composer-footer context button and shorter model labels.
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionMessageAssistant } from "@opencode/client/promise"
import { TandemCache } from "@opencode/schema/tandem-cache"
import { usePluginAttachment } from "@/runtime/plugin/attachment"
import { usePluginHost } from "@/runtime/plugin/host"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import * as Pulse from "./tandem-cache-pulse-machine"
import "./tandem-composer.css"

/** `Claude Opus 4.8` reads `Opus 4.8` in the composer's model button. */
export function tandemModelLabel(name: string) {
  return name.replace(/^Claude\s+/, "")
}

const DURATION_SECONDS = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 } as const

/** Anthropic's prompt cache lifetime when no `cache.ttl` is set. The server's Claude plugin assumes the same. */
const CLAUDE_CACHE_SECONDS = 300

/**
 * How long a model's prompt cache lives after its last read: its `cache.ttl` provider or model setting, such as "1h",
 * or Anthropic's default for a Claude model without one. The default of other models is not reported by the server,
 * so they show no countdown rather than a wrong one.
 */
export function cacheTtlSeconds(
  model: { id: string },
  info: { modelID?: string; settings?: { cache?: { ttl?: string } } } | undefined,
) {
  const match = info?.settings?.cache?.ttl?.match(/^(\d+)(ms|s|m|h|d)$/)
  if (match) return Number(match[1]) * DURATION_SECONDS[match[2] as keyof typeof DURATION_SECONDS]

  return /claude/i.test(model.id) || /claude/i.test(info?.modelID ?? "") ? CLAUDE_CACHE_SECONDS : undefined
}

/**
 * When the server's Claude plugin last read `assistantID`'s prompt cache again: shortly before a large idle session's
 * cache expires it asks for the compaction summary, which keeps the cache alive for another lifetime and is held for
 * the next compaction. Undefined when there is none, or it is for another response.
 */
export function tandemHeld(metadata: Readonly<Record<string, unknown>> | undefined, assistantID: string) {
  const value = metadata?.tandemHeld
  if (!value || typeof value !== "object" || !("assistantID" in value) || value.assistantID !== assistantID) return
  if (!("at" in value) || typeof value.at !== "number") return

  return { at: value.at }
}

/** What the server's Claude plugin reports went wrong with an idle compaction or a trim, until the next turn ends. */
export function tandemHeldFailed(metadata: Readonly<Record<string, unknown>> | undefined) {
  const value = metadata?.tandemHeldFailed
  if (!value || typeof value !== "object" || !("at" in value) || !("message" in value)) return
  if (typeof value.at !== "number" || typeof value.message !== "string") return

  return { at: value.at, message: value.message }
}

/** Reports already shown, so a report is not shown again each time its session is. */
const reported = new Set<string>()

type Usage = SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> }

/**
 * How much of the previous request's cache a request read, so a large new write does not lower the score. The first
 * request falls back to its own hit ratio.
 */
function cacheHealth(cache: { read: number; write: number }, input: number, previous: Usage | undefined) {
  const before = previous ? previous.tokens.cache.read + previous.tokens.cache.write : 0
  if (before > 0) return Math.min(1, cache.read / before)
  const all = cache.read + cache.write + input
  return all > 0 ? cache.read / all : undefined
}

/**
 * `48,213t  52m`: the last request's context tokens and the minutes left on its prompt cache. When a request's
 * response starts in the shown session (or, without the server's early report, when it completes) it briefly reads
 * `cache 94%`, tinted green, amber or red, then fades back.
 * Opens the Context panel.
 */
export function TandemContextButton() {
  const language = useLanguage()
  const attachment = usePluginAttachment()
  const host = usePluginHost()
  const session = () => attachment.current()

  // Each assistant message is one model request with its own usage.
  const requests = createMemo(() => {
    const current = session()
    if (!current?.id) return []
    const found: Usage[] = []
    const messages = current.server.data.session.message.list(current.id) ?? []
    for (let i = messages.length - 1; i >= 0 && found.length < 2; i--) {
      const message = messages[i]
      if (message?.type === "assistant" && message.tokens) found.push(message as Usage)
    }
    return found
  })

  const last = () => requests()[0]

  const total = createMemo(() => {
    const tokens = last()?.tokens
    if (!tokens) return 0
    return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
  })

  const health = createMemo(() => {
    const [message, previous] = requests()
    return message ? cacheHealth(message.tokens.cache, message.tokens.input, previous) : undefined
  })

  const [store, setStore] = createStore({ now: Date.now() })

  const ttl = createMemo(() => {
    const current = session()
    const model = last()?.model
    if (!current || !model) return
    const info = current.server.data.location.model
      .list(current.location)
      ?.find((item) => item.providerID === model.providerID && item.id === model.id)
    return cacheTtlSeconds(model, info)
  })

  // Anthropic refreshes the lifetime on every read, so the countdown restarts at each request's completion, and at the
  // server's request shortly before a large idle session's cache expires. It reads
  // the clock, so it stays right across app suspends; the timer only runs while a countdown shows.
  createEffect(() => {
    if (!ttl()) return
    const timer = setInterval(() => setStore("now", Date.now()), 5000)
    onCleanup(() => clearInterval(timer))
  })

  const countdown = createMemo(() => {
    const seconds = ttl()
    const current = session()
    const message = last()
    const completed = message?.time.completed
    if (!seconds || !completed || !current) return undefined
    const held = tandemHeld(current.server.data.session.get(current.id)?.metadata, message.id)
    return Math.max(0, Math.floor((seconds * 1000 - (store.now - Math.max(completed, held?.at ?? 0))) / 60_000))
  })

  // Pulses when a request's response starts (Claude models, through the server's `TandemCache` event), or else when it
  // completes. Only requests seen running in the shown session pulse (see the machine).
  const [pulse, setPulse] = createSignal<Pulse.State>(Pulse.initial)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const dispatch = (event: Pulse.Event) => {
    const state = untrack(pulse)
    const result = Pulse.transition(state, event)
    if (result.state !== state) setPulse(result.state)
    for (const effect of result.effects) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        dispatch({ type: "faded", attempt: effect.attempt })
      }, 1700)
      timers.add(timer)
    }
  }
  onCleanup(() => timers.forEach(clearTimeout))

  createEffect(() => dispatch({ type: "shown", sessionID: session()?.id }))

  // The shown session's newest request, measured or not.
  const latest = createMemo(() => {
    const current = session()
    if (!current?.id) return
    const messages = current.server.data.session.message.list(current.id) ?? []
    return messages.findLast((message) => message.type === "assistant")
  })

  createEffect(() => {
    const sessionID = session()?.id
    const message = latest()
    if (!sessionID || !message) return
    if (!message.time.completed) return dispatch({ type: "running", sessionID, id: message.id })
    dispatch({ type: "completed", sessionID, id: message.id, health: last()?.id === message.id ? health() : undefined })
  })

  const server = createMemo(() => session()?.server)
  createEffect(() => {
    const client = server()?.client
    if (!client) return
    const stop = client.rpc(TandemCache.Definition).events.on("started", (event) => {
      const { sessionID, read, write, input } = event.data
      // The request is still running, so the newest measured one is the one before it.
      dispatch({ type: "started", sessionID, health: cacheHealth({ read, write }, input, last()) })
    })
    onCleanup(stop)
  })

  const shown = createMemo(() => pulse().pulse)
  // The last pulse's value stays while its text fades out.
  const value = createMemo((previous: number | undefined) => shown() ? shown()!.health : previous, undefined)

  const band = createMemo(() => {
    const health = value()
    if (health === undefined) return undefined
    return health >= 0.9 ? "good" : health >= 0.5 ? "warn" : "bad"
  })

  // A report usually arrives while nobody is looking, so it stays until dismissed. Every open tab reports its own
  // session, so the toast names it.
  createEffect(() => {
    const current = session()
    if (!current?.id) return
    const info = current.server.data.session.get(current.id)
    const failure = tandemHeldFailed(info?.metadata)
    const key = `${current.id}:${failure?.at}`
    if (!failure || reported.has(key)) return
    reported.add(key)
    showToast({ variant: "error", title: info?.title, description: failure.message, persistent: true })
  })

  const open = () => {
    const current = session()
    if (current?.id) host.context("context")?.layout.toggle("context:main", current)
  }

  return (
    <Show when={session()?.id && last()}>
      <button
        type="button"
        data-component="tandem-context-button"
        data-cache-band={band()}
        data-cache-pulse={shown() ? "" : undefined}
        class="ms-1 inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-md border-0 bg-transparent px-1 text-[13px] leading-4 font-[440] tabular-nums text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
        aria-label={language.t("prompt.context.view")}
        onClick={open}
      >
        <span class="grid">
          <span
            class="[grid-area:1/1] transition-opacity duration-[400ms]"
            classList={{ "opacity-0": !!shown() }}
          >
            <span class="text-v2-text-text-faint">
              {language.t("prompt.context.tokens", { count: total().toLocaleString(language.intl()) })}
            </span>
            <Show when={countdown() !== undefined}>
              <span class="ms-2 text-v2-text-text-faint">
                {countdown() === 0
                  ? language.t("prompt.context.expired")
                  : language.t("prompt.context.ttl", { minutes: countdown()! })}
              </span>
            </Show>
          </span>
          <span
            class="[grid-area:1/1] transition-opacity duration-[400ms]"
            classList={{ "opacity-0": !shown() }}
          >
            {language.t("prompt.context.cacheHit")}{" "}
            <span data-slot="tandem-cache-tint">
              {value() === undefined ? "—" : `${Math.round(value()! * 100)}%`}
            </span>
          </span>
        </span>
      </button>
    </Show>
  )
}
