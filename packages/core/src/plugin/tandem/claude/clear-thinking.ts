// Tandem-owned (not in upstream): ask Anthropic to keep all earlier thinking on Claude requests.
export * as ClaudeClearThinking from "./clear-thinking.js"

import { define } from "@opencode/plugin/effect/plugin"
import { isRecord } from "@opencode/util/record"
import { Effect } from "effect"
import { ClaudePresentation } from "./presentation.js"

const EDIT = "clear_thinking_20251015"
const BETA = "context-management-2025-06-27"
/** Upstream's Anthropic transport always sends this beta first; the edit's beta follows it. */
const AFTER = "interleaved-thinking-2025-05-14"

/**
 * Adds the keep-all thinking edit, ahead of any compaction edits, to a Messages body whose final thinking mode is
 * `enabled` or `adaptive`, and its beta to the header. A body with thinking off loses the edit. Returns nothing when
 * the request is already right, so it is sent as it was built.
 */
export function rewrite(body: string, betas: string | null, model = "") {
  const parsed = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return undefined
    }
  })()
  if (!isRecord(parsed)) return undefined
  if (!ClaudePresentation.isClaude(model) && !ClaudePresentation.isClaude(typeof parsed.model === "string" ? parsed.model : "")) return undefined
  const management = parsed.context_management
  const edits: unknown[] = isRecord(management) && Array.isArray(management.edits) ? management.edits : []
  const others = edits.filter((edit) => !isRecord(edit) || edit.type !== EDIT)
  const on = isRecord(parsed.thinking) && (parsed.thinking.type === "enabled" || parsed.thinking.type === "adaptive")
  if (!on && others.length === edits.length) return undefined
  const list = (betas ?? "").split(",").map((beta) => beta.trim()).filter(Boolean)
  if (on && edits.length === others.length + 1 && isRecord(edits[0]) && edits[0].type === EDIT && list.includes(BETA)) return undefined
  if (on) parsed.context_management = { ...(isRecord(management) ? management : {}), edits: [{ type: EDIT, keep: "all" }, ...others] }
  else if (others.length > 0) parsed.context_management = { ...(isRecord(management) ? management : {}), edits: others }
  else delete parsed.context_management
  if (on && !list.includes(BETA)) list.splice(list.includes(AFTER) ? list.indexOf(AFTER) + 1 : list.length, 0, BETA)
  return { body: JSON.stringify(parsed), betas: list.join(",") }
}

/**
 * Register before configured plugins: a Claude subscription plugin signs the body in its own `http.request` hook, so
 * the edit must already be there. The hook is scoped to Anthropic, so other providers skip the HTTP hook path.
 */
export const Plugin = define({
  id: "tandem.claude.clear-thinking",
  effect: Effect.fn("ClaudeClearThinking.Plugin")(function* (ctx) {
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.gen(function* () {
          const request = event.request
          if (request.method !== "POST" || !new URL(request.url).pathname.endsWith("/v1/messages")) return
          const next = rewrite(yield* Effect.promise(() => request.clone().text()), request.headers.get("anthropic-beta"), event.model.id)
          if (!next) return
          const headers = new Headers(request.headers)
          headers.set("anthropic-beta", next.betas)
          event.request = new Request(request, { headers, body: next.body })
        }),
      { providerID: "anthropic" },
    )
  }),
})
