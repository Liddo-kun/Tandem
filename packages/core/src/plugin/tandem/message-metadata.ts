// Tandem-owned (not in upstream): read session-message metadata for model-request messages.
export * as TandemMessageMetadata from "./message-metadata.js"

import type { Message } from "@opencode/ai/effect"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Session } from "@opencode/schema/session"
import { Effect } from "effect"

type Metadata = Readonly<Record<string, unknown>> | undefined

/**
 * Model-request messages keep their session message ID but not its metadata. A lookup loads the
 * session's context through the public plugin API only for wanted IDs it has not seen, then caches
 * their metadata: it is final once the message reaches a model request.
 */
export const make = (ctx: Context) => {
  const cache = new Map<string, Metadata>()
  return Effect.fn("TandemMessageMetadata.lookup")(function* (
    sessionID: Session.ID,
    messages: ReadonlyArray<Message>,
    wanted: (message: Message) => boolean,
  ) {
    const ids = messages.flatMap((message) => (message.id && wanted(message) ? [message.id] : []))
    const missing = ids.filter((id) => !cache.has(id))
    if (missing.length > 0) {
      const loaded = yield* ctx.session.context({ sessionID }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Unable to load session message metadata", error).pipe(Effect.as(undefined)),
        ),
      )
      if (loaded) {
        const metadata = new Map(loaded.map((message) => [message.id as string, message.metadata as Metadata]))
        for (const id of missing) cache.set(id, metadata.get(id))
      }
    }
    return (message: Message): Metadata => (message.id ? cache.get(message.id) : undefined)
  })
}
