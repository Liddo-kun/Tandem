export * as ClaudeHeld from "./held.js"

import type { Effect } from "effect"
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

/** A summary and what its request cost in input: tokens `read` from the prompt cache, out of those `sent`. */
export type Written = { readonly text: string; readonly read: number; readonly sent: number }

/**
 * Sends the request for a session whose last response is `assistantID`. No attempt starts at or after `expires`,
 * when the cache is gone and a retry would pay full price. Undefined when the conversation has moved on; fails with
 * the reason, in words for the user, when no summary could be written.
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
