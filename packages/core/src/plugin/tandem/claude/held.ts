export * as ClaudeHeld from "./held.js"

import { createHash } from "node:crypto"
import { Context, Effect } from "effect"
import { type HttpClientRequest, HttpClientResponse } from "effect/http"
import { join } from "path"

/**
 * Idle compaction: the request made shortly before a large idle session's prompt cache expires, on the Claude
 * plugin's timer. It is compaction's own summary request, sent by compaction's own code, so the session's model
 * reads the conversation from the cache, which also keeps that cache alive for another lifetime. The summary is held
 * in a file until a compaction takes it, and the session's metadata records the request under `KEY`, for compaction
 * and for clients.
 */
export const KEY = "tandemHeld"

/** Session metadata, `{ at, message }`: an idle compaction that went wrong, for clients to show. */
export const FAILED = "tandemHeldFailed"

export type Mark = {
  /** The session's last response when the request was made. */
  readonly assistantID: string
  /** When the request finished, in epoch milliseconds: the cache lives one lifetime from here. */
  readonly at: number
}

export const read = (metadata: Readonly<Record<string, unknown>> | undefined): Mark | undefined => {
  const value = metadata?.[KEY]
  if (!value || typeof value !== "object" || !("assistantID" in value) || !("at" in value)) return undefined
  const { assistantID, at } = value
  return typeof assistantID === "string" && typeof at === "number" ? { assistantID, at } : undefined
}

/** Where a session's held summary is kept. It outlives the server, like the cache it was written from. */
export const file = (data: string, sessionID: string) => join(data, "tandem-held-summaries", `${sessionID}.md`)

/**
 * The model's last response. A summary covers everything before it; it and whatever follows it are kept verbatim.
 * So a held summary describes a conversation for as long as this is still the response it was written before.
 */
export const lastResponse = <M extends { readonly id: string; readonly type: string }>(messages: ReadonlyArray<M>) =>
  messages.findLast((message): message is Extract<M, { readonly type: "assistant" }> => message.type === "assistant")

/**
 * A summary and what its request cost in input: tokens `read` from the prompt cache and `written` to it, out of
 * those `sent`.
 */
export type Written = { readonly text: string; readonly read: number; readonly written: number; readonly sent: number }

/**
 * Sends the request for a session whose last response is `assistantID`. No attempt starts at or after `expires`,
 * when the cache is gone and a retry would pay full price. Undefined when the conversation has moved on or the
 * request was stopped before it was sent (see `sending`); fails with the reason, in words for the user, when no
 * summary could be written.
 */
export type Writer = (sessionID: string, assistantID: string, expires: number) => Effect.Effect<Written | undefined, string>

type LocationKey = { readonly directory: string; readonly workspaceID?: string }
const key = (location: LocationKey) => `${location.directory}\n${location.workspaceID ?? ""}`
const writers = new Map<string, Writer>()

/** Core compaction registers each location's writer, built on its own request path; the Claude plugin calls it. */
export const register = (location: LocationKey, writer: Writer) => {
  writers.set(key(location), writer)
}

export const writer = (location: LocationKey) => writers.get(key(location))

/**
 * The request is worth sending only if it reads the cache, which holds the session's last main request as it was
 * sent: the summary request must be that request, unchanged, with the prompt added. Each main request large enough
 * to matter is remembered here as it is sent, as hashes of its settings and of each message. Cache markers move to
 * the newest message and Claude's billing line changes on every request; neither changes what the cache matches, so
 * both are left out, as are `max_tokens`, `stream` and `metadata`. Nothing is remembered across a restart, so after
 * one a session has no idle compaction until its next turn, as its timer is gone too.
 */
type Sent = { readonly head: string; readonly messages: ReadonlyArray<Hashed> }
/** A message as a whole, and each of its content blocks: a prompt added to the last message extends its blocks. */
type Hashed = { readonly whole: string; readonly role: unknown; readonly blocks: ReadonlyArray<string> }

/** Characters. A session large enough for idle compaction (see the Claude plugin) sends far more than this. */
const MIN_BODY = 400_000
const BILLING = "x-anthropic-billing-header:"
const sent = new Map<string, Sent>()

const hash = (value: unknown) =>
  createHash("sha1").update(JSON.stringify(value, (key, item) => key === "cache_control" ? undefined : item)).digest("base64")

const fingerprint = (request: HttpClientRequest.HttpClientRequest): Sent | undefined => {
  const body = request.body
  const text = body._tag === "Uint8Array"
    ? new TextDecoder().decode(body.body)
    : body._tag === "Raw" && typeof body.body === "string" ? body.body : undefined
  if (text === undefined || text.length < MIN_BODY) return undefined
  const parsed: unknown = (() => {
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  })()
  if (!parsed || typeof parsed !== "object" || !("messages" in parsed) || !Array.isArray(parsed.messages)) return undefined
  const { messages, max_tokens: _, stream: __, metadata: ___, ...settings } = parsed as Record<string, unknown> & { messages: unknown[] }
  const system = Array.isArray(settings.system)
    ? settings.system.filter((block: unknown) =>
      !(block && typeof block === "object" && "text" in block && typeof block.text === "string" && block.text.startsWith(BILLING)))
    : settings.system
  return {
    head: hash({ ...settings, system }),
    messages: messages.map((message): Hashed => {
      const record: Record<string, unknown> = message && typeof message === "object" ? message as Record<string, unknown> : {}
      const { content, ...rest } = record
      return { whole: hash(message), role: hash(rest), blocks: (Array.isArray(content) ? content : [content]).map(hash) }
    }),
  }
}

/** Why the summary request would not read the cache the last main request left, if it would not. */
const mismatch = (before: Sent | undefined, now: Sent | undefined) => {
  if (!before) return "no main request of this session has been sent since the server started"
  if (!now) return "its request could not be read"
  if (now.head !== before.head) return "its model, settings, tools or system prompt differ from the last main request's"
  const end = before.messages.length - 1
  const index = before.messages.findIndex((message, index) => index < end && now.messages[index]?.whole !== message.whole)
  if (index >= 0) return `its message ${index + 1} differs from the last main request's`
  // The cache holds the last message's blocks; the request may add blocks to it, as well as messages after it.
  const last = before.messages[end]
  const current = now.messages[end]
  if (!last || !current || current.role !== last.role || last.blocks.some((block, index) => current.blocks[index] !== block))
    return `its message ${end + 1} differs from the last main request's`
  if (now.messages.length === before.messages.length && current.blocks.length === last.blocks.length)
    return "it adds nothing to the last main request"
  return undefined
}

/** Set around idle compaction's request. `stopped` says why it was not sent, if it was not. */
export class Guard {
  stopped: string | undefined = undefined
}
export const Idle = Context.Reference<Guard | undefined>("tandem/ClaudeHeld.Idle", { defaultValue: () => undefined })

/**
 * Called with every session request as it is sent, after every hook. Remembers main requests; for idle compaction's
 * request (`Idle` set), returns the response to use in place of sending it when it would not read the cache: an
 * error the provider would give, so the request fails without a retry.
 */
export const sending = (scope: { readonly sessionID: string; readonly kind: string }, request: HttpClientRequest.HttpClientRequest) =>
  Effect.gen(function* () {
    if (scope.kind === "primary") {
      const main = fingerprint(request)
      if (main) sent.set(scope.sessionID, main)
      else sent.delete(scope.sessionID)
      return undefined
    }
    const guard = yield* Idle
    if (!guard) return undefined
    const reason = mismatch(sent.get(scope.sessionID), fingerprint(request))
    if (reason === undefined) return undefined
    guard.stopped = reason
    const error = { type: "error", error: { type: "invalid_request_error", message: `Idle compaction was not sent: ${reason}` } }
    return HttpClientResponse.fromWeb(request, new Response(JSON.stringify(error), { status: 400, headers: { "content-type": "application/json" } }))
  })
