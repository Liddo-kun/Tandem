// Tandem-owned (not in upstream): a request's prompt-cache usage, sent to clients as soon as its response starts.
export * as ClaudeCacheStart from "./cache-start.js"

import type * as Plugin from "@opencode/plugin/effect/plugin"
import { TandemCache } from "@opencode/schema/tandem-cache"
import { Effect } from "effect"

/** Characters of a response read for its first event before giving up. */
const LIMIT = 64_000

/** `message_start`'s input usage, from one server-sent event. */
const usage = (event: string) => {
  const data = event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n")
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== "object" || !("type" in parsed) || parsed.type !== "message_start") return undefined
    const usage = "message" in parsed && parsed.message && typeof parsed.message === "object" && "usage" in parsed.message
      ? parsed.message.usage as Record<string, unknown>
      : undefined
    const count = (key: string) => typeof usage?.[key] === "number" ? usage[key] as number : 0
    return usage
      ? { read: count("cache_read_input_tokens"), write: count("cache_creation_input_tokens"), input: count("input_tokens") }
      : undefined
  } catch {
    return undefined
  }
}

/**
 * Anthropic reports a request's input usage in its response's first event, `message_start`, but the session publishes
 * usage only when the request completes, which can be minutes later. Each main request's response is read as it
 * passes, up to that event, and its usage goes to clients on `TandemCache.Definition`.
 */
export const make = Effect.fn("ClaudeCacheStart.make")(function* (ctx: Plugin.Context) {
  const rpc = yield* ctx.rpc.register(TandemCache.Definition, {}).pipe(Effect.orDie)
  const run = Effect.runForkWith(yield* Effect.context<never>())
  yield* ctx.session.hook(
    "http.response",
    (event) =>
      Effect.sync(() => {
        const response = event.response
        if (event.kind !== "primary" || response.status !== 200 || !response.body) return
        if (!response.headers.get("content-type")?.includes("text/event-stream")) return
        const decoder = new TextDecoder()
        let text: string | undefined = ""
        const found = (started: Omit<TandemCache.Started, "sessionID">) =>
          run(
            rpc.events
              .emit("started", { sessionID: event.sessionID, ...started })
              .pipe(Effect.catchCause((cause) => Effect.logWarning("Unable to publish a request's cache usage", { cause }))),
          )
        event.response = new Response(
          response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                controller.enqueue(chunk)
                if (text === undefined) return
                text += decoder.decode(chunk, { stream: true }).replaceAll("\r\n", "\n")
                // `message_start` is the first event, possibly after pings.
                for (let end = text.indexOf("\n\n"); end >= 0; end = text.indexOf("\n\n")) {
                  const block = text.slice(0, end)
                  text = text.slice(end + 2)
                  if (/^event:\s*ping\s*$/m.test(block)) continue
                  const started = usage(block)
                  text = undefined
                  if (started) found(started)
                  return
                }
                if (text.length > LIMIT) text = undefined
              },
            }),
          ),
          { status: response.status, statusText: response.statusText, headers: response.headers },
        )
      }),
    { providerID: "anthropic" },
  )
})
