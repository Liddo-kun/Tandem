// Tandem-owned (not in upstream): request attribution and terminal transport diagnostics.
import { RequestExecutor, type StreamOptions, type WebSocketConnector } from "@opencode/ai/route"
import { Effect, Layer, Stream } from "effect"
import { HttpClient } from "effect/unstable/http"
import { RequestDumpRecord, type Attribution } from "./record.js"

// The executor invokes this client only AFTER its per-request middleware calls handler(sent).
// The platform dependency is FetchHttpClient, which performs no further body rewriting.
export const executorLayer = RequestExecutor.layer.pipe(
  Layer.provide(
    Layer.effect(
      HttpClient.HttpClient,
      Effect.map(HttpClient.HttpClient, (client) =>
        HttpClient.transform(client, (send, request) => RequestDumpRecord.http(request).pipe(Effect.andThen(send))),
      ),
    ),
  ),
)

// Connection sends run in the exchange's fiber, not the socket-open fiber. This preserves
// current attribution when a persistent socket is reused by later steps or other agents.
export const connector = (inner: WebSocketConnector): WebSocketConnector => ({
  open: (input) =>
    inner.open(input).pipe(
      Effect.map((connection) => ({
        ...connection,
        sendText: (message: string) =>
          RequestDumpRecord.webSocket(input.url, message).pipe(Effect.andThen(connection.sendText(message))),
      })),
    ),
})

export const options = (
  scope: {
    readonly sessionID: string
    readonly agent: string
    readonly model: { readonly providerID: string; readonly id: string }
    readonly kind: string
  },
  input: StreamOptions,
): StreamOptions => {
  if (!RequestDumpRecord.enabled()) return input
  const attribution: Attribution = {
    ...scope,
    model: { providerID: scope.model.providerID, modelID: scope.model.id },
  }
  const webSocket = input.webSocket
  return {
    ...input,
    http: (request, handler) => {
      const send: typeof handler = (sent) =>
        handler(sent).pipe(Effect.provideService(RequestDumpRecord.Current, attribution))
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
