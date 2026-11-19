// Tandem-owned (not in upstream): request attribution, terminal transport diagnostics, Anthropic trace headers and
// idle compaction's cache check.
import { RequestExecutor, type StreamOptions } from "@opencode/ai/route"
import { Effect, Layer, Stream } from "effect"
import { HttpClient } from "effect/http"
import { ClaudeHeld } from "../claude/held.js"
import { RequestDumpRecord, type Attribution } from "./record.js"

// The executor invokes this client only AFTER its per-request middleware calls handler(sent).
// The platform dependency is FetchHttpClient, which performs no further body rewriting.
export const executorLayer = RequestExecutor.layer.pipe(
  Layer.provide(
    Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.transform(client, (send, request) =>
          RequestDumpRecord.http(request).pipe(
            // Claude Code sends no tracing headers, so Anthropic API requests do not propagate the client span.
            Effect.andThen(request.headers["anthropic-version"] ? send.pipe(Effect.provideService(HttpClient.TracerPropagationEnabled, false)) : send),
          ),
        ),
      ),
    ),
  ),
)

export const options = (
  scope: {
    readonly sessionID: string
    readonly agent: string
    readonly model: { readonly providerID: string; readonly id: string }
    readonly kind: string
  },
  input: StreamOptions,
): StreamOptions => {
  const dump = RequestDumpRecord.enabled()
  // Main and compaction requests also pass idle compaction's cache check (see `ClaudeHeld.sending`).
  const held = scope.kind === "primary" || scope.kind === "compaction"
  if (!dump && !held) return input
  const attribution: Attribution = {
    ...scope,
    model: { providerID: scope.model.providerID, modelID: scope.model.id },
  }
  const webSocket = dump ? input.webSocket : undefined
  return {
    ...input,
    http: (request, handler) => {
      const final: typeof handler = (sent) =>
        dump ? handler(sent).pipe(Effect.provideService(RequestDumpRecord.Current, attribution)) : handler(sent)
      const send: typeof handler = (sent) =>
        held
          ? ClaudeHeld.sending(scope, sent).pipe(
              Effect.flatMap((stopped) => (stopped ? Effect.succeed(stopped) : final(sent))),
            )
          : final(sent)
      return input.http ? input.http(request, send) : send(request)
    },
    ...(webSocket
      ? {
          webSocket: {
            execute: (exchange) =>
              webSocket.execute(exchange).pipe(
                Effect.provideService(RequestDumpRecord.Current, attribution),
                Effect.map((execution) => ({
                  frames: execution.frames.pipe(Stream.provideService(RequestDumpRecord.Current, attribution)),
                  complete: execution.complete,
                  get http() {
                    return execution.http
                  },
                })),
              ),
          },
        }
      : {}),
  }
}

export * as RequestDump from "./transport.js"
