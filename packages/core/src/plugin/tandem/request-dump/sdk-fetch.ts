// Tandem-owned (not in upstream): observe SDK custom-fetch rewrites at the actual global fetch call.
import { AsyncLocalStorage } from "node:async_hooks"
import { Effect } from "effect"
import { RequestDumpRecord, type Attribution } from "./record.js"

type Fetch = (input: Parameters<typeof fetch>[0], init?: BunFetchRequestInit) => Promise<Response>
const current = new AsyncLocalStorage<{ attribution: Attribution; observed: boolean }>()

const capture = async (
  attribution: Attribution,
  input: Parameters<Fetch>[0],
  init?: BunFetchRequestInit,
  unobserved = false,
) => {
  // This entire diagnostic operation is fallible; even body conversion must never fail a send.
  return Boolean(
    await Effect.runPromise(
      Effect.tryPromise(async () => {
        const body = init?.body
        const text =
          typeof body === "string"
            ? body
            : body instanceof ArrayBuffer
              ? new TextDecoder().decode(body)
              : ArrayBuffer.isView(body)
                ? new TextDecoder().decode(body)
                : body instanceof Blob
                  ? await body.text()
                  : undefined
        return Effect.runPromise(
          RequestDumpRecord.write({
            transport: "http",
            url: input instanceof Request ? input.url : String(input),
            method: init?.method ?? (input instanceof Request ? input.method : "GET"),
            body: text,
            boundary: unobserved ? "custom-fetch-input-unverified" : "final-send-attempt",
            omission: unobserved
              ? "Custom fetch did not call the observed global fetch; final body and internal retries are unobservable"
              : text === undefined && (body != null || (input instanceof Request && input.body !== null))
                ? "Streaming or non-materialized fetch body not consumed by diagnostics"
                : undefined,
          }).pipe(Effect.provideService(RequestDumpRecord.Current, attribution)),
        )
      }).pipe(Effect.catch(() => Effect.succeed(false))),
    ),
  )
}

// A customFetch is an opaque callback, not an injectable HttpClient: wrapping its INPUT
// misses auth-plugin rewrites and internal retries. Observe its terminal global fetch instead.
// ALS restricts observation to the attributed SDK call; other process traffic is untouched.
// Install at module evaluation when enabled, before providers normally capture their fetch.
// Proxy preserves Bun's fetch properties (including preconnect) without copying them.
const install = () => {
  if (!RequestDumpRecord.enabled() || installed) return
  const original = globalThis.fetch
  const observed: Fetch = async (input, init) => {
    const scope = current.getStore()
    if (scope) {
      scope.observed = (await capture(scope.attribution, input, init)) || scope.observed
    }
    return original(input, init)
  }
  globalThis.fetch = new Proxy(original, {
    apply: (_target, _receiver, args: Parameters<Fetch>) => observed(...args),
  })
  installed = true
}
let installed = false
Effect.runSync(Effect.try(install).pipe(Effect.ignore))

export const bind = (send: Fetch) =>
  Effect.gen(function* () {
    const attribution = yield* RequestDumpRecord.Current
    if (!attribution || !RequestDumpRecord.enabled()) return send
    yield* Effect.try(install).pipe(Effect.ignore)
    return ((input, init) => {
      const scope = { attribution, observed: false }
      return current.run(scope, async () => {
        try {
          return await send(input, init)
        } finally {
          // Never falsely label the pre-transform input as final if a custom implementation
          // bypassed global fetch (e.g. a captured old fetch, undici, or its own HTTP client).
          if (!scope.observed) await capture(attribution, input, init, true)
        }
      })
    }) satisfies Fetch
  })

export * as RequestDumpFetch from "./sdk-fetch.js"
