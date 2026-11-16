// Tandem-owned (not in upstream): record final Session WebSocket frames for opt-in request diagnostics.
export * as RequestDumpPlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Effect } from "effect"
import { RequestDumpRecord } from "./record.js"

/**
 * Register last, so both hooks see the handshake URL and frame every other hook produced: the transport opens the
 * socket with that URL and sends that frame as is. Hooks run in the exchange's fiber, so the attribution
 * `RequestDump.options` provides applies, including on reused sockets.
 */
export const Plugin = define({
  id: "tandem.request-dump",
  effect: Effect.fn("RequestDumpPlugin.Plugin")(function* (ctx) {
    // The transport runs each Session's exchanges one at a time, handshake before send, and reuses a socket only
    // for the same URL, so the Session's last handshake URL is the one its socket was opened with.
    const urls = new Map<string, string>()
    yield* ctx.session.hook("experimental.ws.handshake", (event) =>
      Effect.sync(() => {
        if (RequestDumpRecord.enabled()) urls.set(event.sessionID, event.url)
      }),
    )
    yield* ctx.session.hook("experimental.ws.send", (event) =>
      Effect.suspend(() => {
        const url = urls.get(event.sessionID)
        if (url === undefined) return Effect.void
        urls.delete(event.sessionID)
        return RequestDumpRecord.webSocket(url, event.frame)
      }),
    )
  }),
})
