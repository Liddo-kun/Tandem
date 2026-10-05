// Tandem-owned (not in upstream): opt-in redacted final-send request diagnostics.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Context, Effect, Option, Schema } from "effect"
import type { HttpClientRequest } from "effect/unstable/http"

/** Diagnostic attribution is fiber-local and never becomes provider request data. */
export interface Attribution {
  readonly sessionID: string
  readonly agent: string
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly kind: string
}

export const Current = Context.Reference<Attribution | undefined>("tandem/RequestDump", {
  defaultValue: () => undefined,
})

export const enabled = () => Boolean(process.env.TANDEM_DUMP_REQUEST?.trim())

const json = Schema.fromJsonString(Schema.Unknown)
const decode = Schema.decodeUnknownOption(json)
const encode = Schema.encodeSync(json)
const credential =
  /^(?:authorization|proxy[-_]authorization|cookie|set[-_]cookie|(?:x[-_])?api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|client[-_]?secret|password|credential|secret|x-amz-security-token)$/i
let warned = false

// Headers are deliberately absent. URLs retain only origin/path, never userinfo or query credentials.
const endpoint = (url: string) => {
  const parsed = new URL(url)
  return {
    url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    auth:
      /(?:^|\/)(?:oauth2?|auth|authorize|authorization|token|login|refresh)(?:\/|$)/i.test(parsed.pathname) ||
      /^(?:auth|login|accounts)\./i.test(parsed.hostname),
  }
}

const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        // Provider signatures and redacted thinking are opaque round-trip data, not auth.
        key === "signature" || ("type" in value && value.type === "redacted_thinking" && key === "data")
          ? item
          : credential.test(key) && (item === null || typeof item !== "object")
            ? "[REDACTED]"
            : redact(item),
      ]),
    )
  if (typeof value === "string" && /^(?:https?|wss?):\/\//i.test(value)) return endpoint(value).url
  return value
}

export const write = (input: {
  readonly transport: "http" | "websocket"
  readonly url: string
  readonly method?: string
  readonly body?: string
  readonly omission?: string
  readonly boundary?: string
}) =>
  Effect.suspend(() => {
    const directory = process.env.TANDEM_DUMP_REQUEST?.trim()
    if (!directory) return Effect.void
    return Effect.gen(function* () {
      const attribution = yield* Current
      // Only attributed model sends are eligible; integration login/refresh and asset downloads
      // must not be inspected, including custom auth endpoints with unrecognizable paths.
      if (!attribution) return
      yield* Effect.try(() => {
        const target = endpoint(input.url)
        if (target.auth) return
        const decoded = input.body === undefined ? undefined : Option.getOrUndefined(decode(input.body))
        if (
          decoded !== null &&
          typeof decoded === "object" &&
          ("grant_type" in decoded ||
            ("type" in decoded &&
              typeof decoded.type === "string" &&
              /^(?:auth|authenticate|authorization)$/i.test(decoded.type)))
        )
          return
        // Do not persist opaque strings: they may be auth frames or non-JSON credential bodies.
        const record = {
          version: 1,
          boundary: input.boundary ?? "final-send-attempt",
          time: new Date().toISOString(),
          transport: input.transport,
          url: target.url,
          method: input.method,
          attribution,
          body: decoded === undefined ? undefined : redact(decoded),
          omission: input.omission ?? (input.body !== undefined && decoded === undefined ? "non-JSON body" : undefined),
          redaction: "headers omitted; URL userinfo/query omitted; credential fields redacted",
        }
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        writeFileSync(path.join(directory, `${Date.now()}-${crypto.randomUUID()}.json`), encode(record) + "\n", {
          flag: "wx",
          mode: 0o600,
        })
        return true
      }).pipe(
        Effect.catch(() => {
          if (warned) return Effect.void
          warned = true
          // Never log an exception that could contain a credential-bearing URL/body.
          return Effect.logWarning("TANDEM_DUMP_REQUEST could not write diagnostics; provider requests continue")
        }),
      )
    })
  })

export const http = (request: HttpClientRequest.HttpClientRequest) => {
  if (!enabled()) return Effect.void
  const body = request.body
  return write({
    transport: "http",
    url: request.url,
    method: request.method,
    body:
      body._tag === "Uint8Array"
        ? new TextDecoder().decode(body.body)
        : body._tag === "Raw" && typeof body.body === "string"
          ? body.body
          : undefined,
    omission:
      body._tag === "Empty" || body._tag === "Uint8Array" || (body._tag === "Raw" && typeof body.body === "string")
        ? undefined
        : `${body._tag} body not consumed by diagnostics`,
  })
}

export const webSocket = (url: string, message: string) => write({ transport: "websocket", url, body: message })

export * as RequestDumpRecord from "./record.js"
