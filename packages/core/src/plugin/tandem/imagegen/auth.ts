export * as ImagegenAuth from "./auth.js"

import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { Integration } from "@opencode/schema/integration"
import { Effect, Option, Schema } from "effect"

export const integrationID = Integration.ID.make("tandem-openai-images")
export const methodID = Integration.MethodID.make("codex")
export const clientID = "app_EMoamEEZ73f0CkXaXp7hrann"
const issuer = "https://auth.openai.com"
const redirectURI = "http://localhost:1455/auth/callback"
const NonEmpty = Schema.String.check(Schema.isMinLength(1))
const decodeTokens = Schema.decodeUnknownOption(
  Schema.Struct({
    access_token: NonEmpty,
    refresh_token: Schema.optionalKey(NonEmpty),
    id_token: Schema.optionalKey(NonEmpty),
    expires_in: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  }),
)
const decodeClaims = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      chatgpt_account_id: Schema.optionalKey(NonEmpty),
      organizations: Schema.optionalKey(Schema.Array(Schema.Struct({ id: NonEmpty }))),
      "https://api.openai.com/auth": Schema.optionalKey(
        Schema.Struct({ chatgpt_account_id: Schema.optionalKey(NonEmpty) }),
      ),
    }),
  ),
)

export function compatible(value: Credential.Value | undefined): value is Credential.OAuth {
  return value?.type === "oauth" && value.methodID === methodID && value.metadata?.clientID === clientID &&
    !!value.access && !!value.refresh
}

// These unverified JWT claims are routing hints only, as in v1; never an identity/authorization check.
function accountID(token: string | undefined) {
  const parts = token?.split(".")
  if (parts?.length !== 3) return undefined
  const claims = Option.getOrUndefined(decodeClaims(Buffer.from(parts[1], "base64url").toString("utf8")))
  return claims?.chatgpt_account_id ?? claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims?.organizations?.[0]?.id
}

function request(body: URLSearchParams, previous?: Credential.OAuth) {
  return Effect.tryPromise({
    try: async (signal) => {
      const response = await fetch(`${issuer}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      })
      // Never include token response bodies or schema diagnostics containing credentials in errors.
      if (!response.ok) throw new Error(`OpenAI Images token request failed (${response.status}). Sign in again if authorization was revoked.`)
      const tokens = Option.getOrUndefined(decodeTokens(await response.json()))
      if (!tokens) throw new Error("OpenAI Images returned an invalid token response")
      const refresh = tokens.refresh_token ?? previous?.refresh
      if (!refresh) throw new Error("OpenAI Images sign-in did not return a refresh token")
      const accountId = accountID(tokens.id_token) ?? accountID(tokens.access_token) ?? previous?.metadata?.accountId
      return Credential.OAuth.make({
        type: "oauth",
        methodID,
        access: tokens.access_token,
        refresh,
        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        metadata: { clientID, ...(typeof accountId === "string" ? { accountId } : {}) },
      })
    },
    catch: (error) => new Error(error instanceof Error && error.message.startsWith("OpenAI Images")
      ? error.message
      : "OpenAI Images token request failed"),
  })
}

const signIn: IntegrationOAuthMethodRegistration = {
  integrationID,
  method: { id: methodID, type: "oauth", label: "OpenAI Images (ChatGPT) — browser, paste callback URL" },
  authorize: () => Effect.gen(function* () {
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const challenge = yield* Effect.promise(async () => Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ).toString("base64url"))
    const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
    const expiresAt = Date.now() + 5 * 60_000
    return {
      mode: "code" as const,
      expiresAt,
      url: `${issuer}/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientID,
        redirect_uri: redirectURI,
        scope: "openid profile email offline_access",
        code_challenge: challenge,
        code_challenge_method: "S256",
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        state,
        originator: "opencode",
      })}`,
      instructions: "Authorize OpenAI Images in your browser, then paste the FULL http://localhost:1455/auth/callback?... URL here (including code and state). A connection-refused page is expected: no callback listener is started. Finish within five minutes. Do not run another Codex login listening on port 1455. This saves a separate image login; your conversation login stays active.",
      callback: (input: string) => Effect.gen(function* () {
        if (Date.now() >= expiresAt) return yield* Effect.fail(new Error("OpenAI Images sign-in expired. Start again."))
        const url = URL.parse(input.trim())
        if (!url || url.origin !== new URL(redirectURI).origin || url.pathname !== "/auth/callback" ||
          url.username || url.password || url.hash || url.searchParams.getAll("state").length !== 1 ||
          url.searchParams.get("state") !== state)
          return yield* Effect.fail(new Error("Paste the full OpenAI Images callback URL from this sign-in attempt, including its matching state."))
        if (url.searchParams.has("error"))
          return yield* Effect.fail(new Error("OpenAI Images authorization was declined or failed. Start again."))
        const code = url.searchParams.get("code")
        if (!code || url.searchParams.getAll("code").length !== 1)
          return yield* Effect.fail(new Error("OpenAI Images callback is missing a unique authorization code"))
        return yield* request(new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectURI,
          client_id: clientID,
          code_verifier: verifier,
        }))
      }),
    }
  }),
  refresh: (value) => compatible(value)
    ? request(new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: value.refresh,
      client_id: clientID,
    }), value)
    : Effect.fail(new Error("Reconnect OpenAI Images (ChatGPT); this is not its Codex credential.")),
}

/** Authentication only: no provider/model registration or conversation transport hooks. */
export const AuthPlugin = define({
  id: "tandem.imagegen.auth",
  effect: Effect.fn("ImagegenAuth")(function* (ctx) {
    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => { integration.name = "OpenAI Images (ChatGPT)" })
      editor.method.update(signIn)
    })
  }),
})
