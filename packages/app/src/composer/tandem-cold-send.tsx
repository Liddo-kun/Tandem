// Tandem-owned (not in upstream): asks how to send a prompt once the prompt cache no longer holds a large context.
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { For, Show, onCleanup } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { showToast } from "@/shell/notifications/toast"
import { useWorkspaceLocation } from "@/workspaces/location"
import type { ComposerAdapter } from "./adapter"
import { cacheTtlSeconds, tandemHeld, tandemHeldFailed } from "./tandem-composer"
import {
  COLD_SEND_IDLE,
  transitionColdSend,
  type ColdSendChoice,
  type ColdSendEffect,
  type ColdSendEvent,
  type ColdSendState,
} from "./tandem-cold-send-machine"

/** Contexts smaller than this are sent without asking: reading them again costs little. */
const MIN_TOKENS = 80_000
/** A compaction that reports nothing for this long is given up on, and the prompt stays a draft. */
const COMPACTION_TIMEOUT = 5 * 60_000
/** Session metadata the server's Claude plugin reads: the next prompt's earlier tool results are shortened. */
const TRIM_NEXT = "tandemTrimNext"

/**
 * `free`: the server already holds this conversation's summary, written before the cache expired. `failed`: what the
 * server reports went wrong when it tried to write one.
 */
type Cold = { tokens: number; reason: "expired" | "switched"; free: boolean; failed?: string }

function ColdSendDialog(props: Cold & { choose: (choice: ColdSendChoice) => void }) {
  const language = useLanguage()
  const options = ["trim", "compact", "send"] as const

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t(`prompt.cold.title.${props.reason}`)}
          description={language.t("prompt.cold.description", {
            count: props.tokens.toLocaleString(language.intl()),
          })}
        />
      </DialogHeader>
      <DialogBody class="flex max-w-[520px] flex-col gap-2 px-4 text-[13px] leading-[var(--line-height-compact)]">
        <For each={options}>
          {(option) => (
            <p class="text-v2-text-text-muted">
              <span class="font-medium text-v2-text-text-base">{language.t(`prompt.cold.${option}`)}</span>
              {": "}
              {language.t(
                option === "compact" && props.free ? "prompt.cold.compact.free" : `prompt.cold.${option}.description`,
              )}
            </p>
          )}
        </For>
        <Show when={props.failed}>
          <p class="text-v2-state-fg-danger">{props.failed}</p>
        </Show>
      </DialogBody>
      <DialogFooter>
        {/* Wraps onto another row on phones rather than squeezing the labels. */}
        <div class="flex flex-wrap justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button variant="ghost" onClick={() => props.choose(undefined)}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="neutral" onClick={() => props.choose("send")}>
            {language.t("prompt.cold.send")}
          </Button>
          {/* The free compaction is the default choice when there is one. */}
          <Button
            variant={props.free ? "contrast" : "neutral"}
            autofocus={props.free}
            onClick={() => props.choose("compact")}
          >
            {language.t("prompt.cold.compact")}
          </Button>
          <Button
            variant={props.free ? "neutral" : "contrast"}
            autofocus={!props.free}
            onClick={() => props.choose("trim")}
          >
            {language.t("prompt.cold.trim")}
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Returns the composer's send interceptor. Given the action that sends the draft, it returns false when the prompt
 * should go out as usual. On a large context whose prompt cache has expired, or that was last sent to another model,
 * it returns true and asks first: send as is, send with old tool results trimmed, or compact and then send.
 * Cancelling, or a trim or compaction that fails, keeps the draft.
 */
export function useTandemColdSend(adapter: ComposerAdapter) {
  const dialog = useDialog()
  const language = useLanguage()
  const location = useWorkspaceLocation()
  const data = useData()
  const server = useServerSDK()
  let state: ColdSendState = COLD_SEND_IDLE
  let watch: ReturnType<typeof setInterval> | undefined

  const session = () => (adapter.kind === "active-session" ? adapter.session().id : undefined)

  // The size and cache state of the conversation, when sending it now would read a large context again in full.
  const measure = (): Cold | undefined => {
    const current = session()
    if (!current || adapter.working()) return
    // A subagent's conversation is short-lived, and its parent decides when it runs.
    if (data.session.get(current)?.parentID) return
    const messages = data.session.message.list(current) ?? []
    // Each assistant message is one model request. Nothing after a compaction has been measured yet.
    const last = messages.findLast(
      (message) => (message.type === "assistant" && !!message.tokens) || message.type === "compaction",
    )
    if (last?.type !== "assistant" || !last.tokens) return
    const tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    if (tokens < MIN_TOKENS) return
    const selected = adapter.controls().model.selection.current()
    const metadata = data.session.get(current)?.metadata
    const held = tandemHeld(metadata, last.id)
    const free = held !== undefined
    const failed = tandemHeldFailed(metadata)?.message
    if (selected && (selected.id !== last.model.id || selected.provider.id !== last.model.providerID))
      return { tokens, reason: "switched", free, failed }
    // Models whose cache lifetime is not known here show no countdown either.
    const ttl = cacheTtlSeconds(
      last.model,
      data.location.model
        .list(location().ref)
        ?.find((item) => item.providerID === last.model.providerID && item.id === last.model.id),
    )
    // The cache lives one lifetime from its last read: the request's end, or the server's request before expiry.
    if (!ttl || !last.time.completed) return
    if (Date.now() - Math.max(last.time.completed, held?.at ?? 0) < ttl * 1000) return

    return { tokens, reason: "expired", free, failed }
  }

  const unwatch = () => {
    clearInterval(watch)
    watch = undefined
  }

  // The session's compaction messages; one that was not there before the request is the requested one.
  const compactions = () => {
    const current = session()

    return (current ? (data.session.message.list(current) ?? []) : []).filter((message) => message.type === "compaction")
  }

  const ask = (cold: Cold) => {
    // Closing reports a cancel, which the machine ignores once a choice has moved it on.
    const choose = (choice: ColdSendChoice) => {
      dispatch({ type: "chosen", choice })
      dialog.close()
    }
    dialog.show(
      () => <ColdSendDialog {...cold} choose={choose} />,
      () => dispatch({ type: "chosen", choice: undefined }),
    )
  }

  const run = (effect: ColdSendEffect, cold: Cold | undefined) => {
    const current = session()

    if (effect.type === "ask") return cold ? ask(cold) : dispatch({ type: "chosen", choice: undefined })

    if (effect.type === "send") return effect.send()

    if (effect.type === "failed") return showToast({ title: language.t(`prompt.cold.${effect.step}.failed`) })

    if (!current) return dispatch({ type: "prepared", step: effect.type, ok: false })

    if (effect.type === "trim") {
      // Metadata is replaced as a whole, so the session's other entries are sent back with the mark.
      server.api.session
        .update({ sessionID: current, metadata: { ...data.session.get(current)?.metadata, [TRIM_NEXT]: true } })
        .then(
          () => dispatch({ type: "prepared", step: "trim", ok: true }),
          () => dispatch({ type: "prepared", step: "trim", ok: false }),
        )

      return
    }

    const before = new Set(compactions().map((message) => message.id))
    const started = Date.now()
    const selection = adapter.controls().model.selection
    const model = selection.current()
    data.session
      .compact({
        sessionID: current,
        model: model ? { id: model.id, providerID: model.provider.id, variant: selection.variant.current() } : undefined,
      })
      .catch(() => dispatch({ type: "prepared", step: "compact", ok: false }))
    unwatch()
    // The request resolves when the server accepts it; the compaction message reports how it ended.
    watch = setInterval(() => {
      const done = compactions().find((message) => !before.has(message.id) && message.status !== "running")
      if (done) return dispatch({ type: "prepared", step: "compact", ok: done.status === "completed" })
      if (Date.now() - started > COMPACTION_TIMEOUT) dispatch({ type: "prepared", step: "compact", ok: false })
    }, 500)
  }

  function dispatch(event: ColdSendEvent, cold?: Cold) {
    const next = transitionColdSend(state, event)
    if (next.state === state && next.effects.length === 0) return
    state = next.state
    if (state.type !== "preparing") unwatch()
    next.effects.forEach((effect) => run(effect, cold))
  }

  onCleanup(() => {
    unwatch()
    dispatch({ type: "disposed" })
  })

  return (send: () => void) => {
    if (state.type !== "idle") return true
    const cold = measure()
    if (!cold) return false
    dispatch({ type: "requested", send }, cold)

    return true
  }
}
