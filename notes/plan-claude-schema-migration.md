# Plan: Move Claude Code schema disguise into Tandem source

Status: ready to execute. Author handoff for another agent; results reviewed afterward.

Repos involved:
- `~/Tandem` — opencode fork (primary changes).
- `~/opencode-anthropic-auth` — the `@ex-machina/opencode-anthropic-auth` OAuth plugin fork (trim only).

---

## Background / why

**Goal (performance):** make Anthropic requests use Claude Code's exact tool **names**
(PascalCase: `Bash`, `Edit`, `Read`…) and **parameter keys** (snake_case: `file_path`,
`old_string`, `new_string`, `replace_all`…) so Opus sees the tool surface it was trained
on. opencode's internal contract stays camelCase everywhere (registry ids, zod schemas,
UI renderers, storage, SDK types, other providers). We add a **Claude-only disguise at
the provider boundary**, not a global rename.

**Bug being fixed (confirmed):** the plugin (`~/opencode-anthropic-auth/src/transform.ts`)
does the reverse mapping by regex-rewriting the **entire SSE response byte stream**
(`stripToolPrefix` / `createStrippedStream`). That rewrite also mutates `thinking_delta`
text (e.g. a quoted `"old_string"` in the model's reasoning becomes `"oldString"`) while
the `signature_delta` is left untouched. The resent thinking block then no longer matches
its signature, and Anthropic rejects the next turn with:

```
messages.<n>.content.<m>: 'thinking' or 'redacted_thinking' blocks in the latest
assistant message cannot be modified. These blocks must remain as they were in the
original response.
```

It is intermittent because it only fires when the model quotes one of those snake_case
tokens *inside its reasoning* — most often when asked to read/analyze a Claude Code prompt
dump (dense with quoted snake_case tool params) or during edit-heavy turns. The same
rewrite also silently corrupts the model's visible output and tool-result display, which
can make the model think its environment is broken (e.g. spamming `echo hello`).

**Fix principle:** translate on **structured objects** at the provider boundary
(request: tool defs + historical tool parts; response: structured `tool-call` stream
parts). Never rewrite raw bytes. Never touch `reasoning`/thinking or `text` parts.

---

## Current Tandem baseline (ALREADY DONE — do not redo)

The original effort already landed the source-side prompt work (see `log.md:83`). Verify
these are present before starting; build on them, don't duplicate:

- **AGENTS.md / instruction files → first-user `<system-reminder>`**: `prompt.ts:1440-1453`,
  already gated to `model.api.id.includes("claude")`. For Claude, instructions are removed
  from the `system` array (`prompt.ts:1455`) and injected into the first user message.
- **`anthropic.txt` `# Harness` rewrite**: `packages/opencode/src/session/prompt/anthropic.txt`
  already opens with the official identity (`You are Claude Code, Anthropic's official CLI for
  Claude.`) and contains NO `OpenCode` / `opencode.ai/docs` / `github.com/anomalyco` anchors.

Consequences for the plugin's current behavior (relevant to trimming it):
- The plugin's `prependClaudeCodeIdentity` is already a **no-op** — the
  `CLAUDE_CODE_OFFICIAL_IDENTITY` detection (added in plugin commit `e51ae1b`) sees the official
  identity in `anthropic.txt` and does not prepend the Agent SDK identity.
- `sanitizeSystemText`'s anchor-paragraph removal has nothing to match in `anthropic.txt`.
- The only `TEXT_REPLACEMENTS` rule still doing real work is the env-intro phrase, which is
  still emitted verbatim at `packages/opencode/src/session/system.ts:53`:
  `Here is some useful information about the environment you are running in:`
  (the plugin rewrites it to `Environment context you are running in:` to dodge a content
  filter). `if OpenCode honestly` does not appear in source (moot).

**Gating consistency:** reuse the existing predicate `model.api.id.includes("claude")` for the
tool disguise so Item 1 matches the already-shipped instruction-reminder gating.

---

## Key code seam (already exists)

`packages/opencode/src/session/llm.ts` (~lines 311-329) builds the model via
`wrapLanguageModel({ model: language, middleware: [...] })`. The single middleware today
only rewrites the prompt:

```ts
async transformParams(args) {
  if (args.type === "stream") {
    // @ts-expect-error
    args.params.prompt = ProviderTransform.message(
      args.params.prompt, input.model, prepared.messageTransformOptions,
    )
  }
  return args.params
}
```

This is where the request-side tool disguise goes, and where a response hook
(`wrapStream` / `wrapGenerate`) is added. `tools` reach the call as
`streamText({ ..., tools: prepared.tools })` (camelCase opencode tools, jsonSchema built
in `packages/opencode/src/session/prompt.ts:1768-1772`). The middleware-transformed tools
go only to the provider; `streamText` validates tool-call results against the original
camelCase `tools`, so the response hook MUST map results back to camelCase before they
bubble up.

`packages/opencode/src/provider/transform.ts` already has a `claude` message branch
(`:187`) and an anthropic branch (`:215`) operating on structured `ModelMessage[]` — extend
these rather than adding a new pass.

---

## Item 1 — Source-side tool name + parameter mapping (essential)

### `packages/opencode/src/provider/transform.ts`
Port from the plugin's `src/transform.ts` (commit `e51ae1b`):
- `TOOL_NAME_TO_CLAUDE_CODE` + reverse map.
- `TOOL_INPUT_TO_CLAUDE_CODE` (`edit`/`read`/`write` key maps) + reverse map.
- `toClaudeCodeToolName` / `fromClaudeCodeToolName` (keep `StructuredOutput` passthrough and
  `mcp_` handling), `capitalizeName` / `uncapitalizeName`, `renameKeys`,
  `rewriteJsonSchemaKeys`, `rewriteDescriptionKeys`.

Add exports:
- `toolsToClaudeCode(tools, model)` — rename `name`, rewrite `inputSchema` keys + `description`.
  **Verify the LanguageModelV2 tool part shape** (`{ type: "function", name, description,
  inputSchema }`) for the installed `ai` version first.

**`eager_input_streaming` — probably nothing to do.** This is an Anthropic tool-def flag the
`@ai-sdk/anthropic` provider only adds when `providerOptions.anthropic.eagerInputStreaming` is
true (SDK default is `false`; see `anthropic-prepare-tools.ts`). No Tandem source sets it, so the
field is most likely never emitted now — the plugin's strip was a no-op against the current SDK.
Action: capture one real outbound opencode request and check for `eager_input_streaming`. If
absent, drop it from this plan. If present, do NOT re-add a strip — instead ensure
`eagerInputStreaming` is left unset/false so the SDK never adds it (cleaner than stripping a
field after the fact). It does not affect the thinking bug or tool correctness; it's purely
Claude Code fingerprint matching.
- Extend the **claude branch** in `message()` / `normalizeMessages()` to rename historical
  tool parts to Claude shape: assistant `tool-call` parts (`toolName` → Claude name,
  `input` keys → snake_case) and `tool-result` parts (`toolName` → Claude name). Keeps stored
  history consistent with the renamed tool definitions.

### `packages/opencode/src/session/llm.ts` (middleware ~311-329)
- In `transformParams`, after the existing prompt rewrite, also rename `args.params.tools`
  via `ProviderTransform.toolsToClaudeCode(...)` (gated — see Gating).
- Add response remapping to the **same middleware** via `wrapStream` (and `wrapGenerate` for
  non-streaming). Map over structured `LanguageModelV2StreamPart`s:
  - `tool-call`: `toolName` Claude→opencode; parse `input`, rename keys snake→camel, re-stringify.
  - `tool-input-start`: rename `toolName`.
  - `tool-input-delta`: OPTIONALLY apply key-name remap **scoped to these parts only**
    (safe — exclusively tool input) for live-UI arg fidelity; otherwise rely on final `tool-call.input`.
  - **Leave `reasoning`, `text`, `tool-result`, and every other part untouched.** ← the whole point.
- Review `experimental_repairToolCall` (`llm.ts:278`): its `toLowerCase()` currently back-maps
  Claude names by accident (`TodoWrite`→`todowrite`, etc.). Once `wrapStream` does the real
  mapping, confirm it no longer fires spuriously; keep as a fallback but do not rely on it for
  key remapping (it only fixes names).

---

## Item 2 — Delete stream rewriting + trim the plugin (lockstep with Item 1)

Must land in the **same testing session** as Item 1 to avoid double-mapping or no-mapping windows.

End state: the plugin is **pure auth/transport** and no longer parses or rewrites the request
body or the response stream at all. All tool + system shaping lives in Tandem source (Items 1
and 3).

### `~/opencode-anthropic-auth/src/transform.ts`
- Delete the response-stream rewriting: `createStrippedStream`, `stripToolPrefix`.
- Delete the body-rewriting: `rewriteRequestBody`, `prefixToolNames`, `prependClaudeCodeIdentity`,
  `sanitizeSystemText`, and all the tool-name/tool-input/JSON-schema helpers + tables.
- Delete the system-shaping helpers now living in source (see Item 3): identity/anchor/text-
  replacement logic.
- Keep only: `mergeHeaders`, `mergeBetaHeaders`, `setOAuthHeaders`, `rewriteUrl`, `resolveBaseUrl`,
  `isInsecure`.

### `~/opencode-anthropic-auth/src/index.ts`
- Stop wrapping the response: `return response` instead of `createStrippedStream(response)`.
- Remove the `rewriteRequestBody(body)` call; send `init.body` through unchanged.

### Delete entirely
- `~/opencode-anthropic-auth/src/cch.ts` (ported to source in Item 3).
- The cch / identity / anchor / text-replacement constants in `src/constants.ts` that are no
  longer referenced (keep `CLIENT_ID`, OAuth URLs/scopes, `REQUIRED_BETAS`, `USER_AGENT`).

### Keep in plugin (the auth bones)
OAuth flow, token refresh/retry, `setOAuthHeaders` (authorization/anthropic-beta/user-agent,
`x-api-key` delete), `mergeBetaHeaders`, `rewriteUrl` (`?beta=true` + `ANTHROPIC_BASE_URL`
override), `isInsecure`, cost zeroing.

### Tests
Remove now-dead cases + snapshots in `src/tests/transform.test.ts` and `src/tests/cch.test.ts`
for deleted functions; keep auth/header/url tests.

---

## Item 3 — Move ALL system-prompt shaping to source

Decision (Jon): system-prompt edits belong in Tandem source — Tandem already owns opencode's
prompts, so the plugin should not shape system content at all. After this item the plugin does
NOT touch the request body. Most of the original Item 3 is already handled by the baseline
above, so what remains is:

1. **Env-intro phrase (the only live sanitization):** change `packages/opencode/src/session/system.ts:53`
   from `Here is some useful information about the environment you are running in:` to
   `Environment context you are running in:` (matches the plugin's `TEXT_REPLACEMENTS`, dodges
   the content filter). Gate on `model.api.id.includes("claude")` if you want to limit blast
   radius; the phrase is innocuous for other providers, so a global change is also acceptable —
   Jon's call.
2. **Move the `cch` billing block into source.** Port the plugin's `cch.ts`
   (`extractFirstUserMessageText` / `computeCCH` / `computeVersionSuffix` /
   `buildBillingHeaderValue`) and the `CLAUDE_CODE_VERSION` / `CLAUDE_CODE_ENTRYPOINT` /
   `CCH_SALT` / `CCH_POSITIONS` constants. On the Claude path, build the billing string and
   insert it as the **first** `system` block.
   - **Locate the base-prompt assembly first.** The `system` array at `prompt.ts:1455` is only
     `[...env, ...skills]`; the `anthropic.txt` base/identity block is prepended elsewhere (trace
     `handle.process` / the model prompt loader). The billing block must end up *before* the
     `anthropic.txt` block so the final order matches what the plugin produces today:
     `[billing, anthropic.txt(identity+harness), env, skills]`. Report the assembly site before
     editing — do not guess.
   - **Hash-input subtlety:** the plugin computes the hash from the first user message's first
     text block *as sent*. Because the instruction `<system-reminder>` is unshifted to the front
     of the first user message (`prompt.ts:1444`), that block is currently the hash input. Decide
     deliberately whether to hash the system-reminder block (preserves current plugin behavior)
     or the real user text, and document the choice. Safest default: preserve current behavior.
3. **Plugin cleanup** (done in the Item 2 trim): remove `prependClaudeCodeIdentity`,
   `sanitizeSystemText`, `TEXT_REPLACEMENTS`, `PARAGRAPH_REMOVAL_ANCHORS`, `cch.ts`, the cch
   constants, and the entire body-rewriting path so the plugin no longer parses/rewrites the
   request body at all (see Item 2).

---

## Gating (DECIDED — name-only)

Single predicate: `model.api.id.includes("claude")`. Nothing else — no npm check, no
OAuth/auth-type check. This is the **same predicate already used by the instruction-reminder**
(`prompt.ts:1440`) and by the existing claude branch in `transform.ts:187`, so all Claude-path
shaping stays consistent and the implementation is one expression with no auth state threaded in.

Trade-off accepted deliberately: this also fires for Claude routed through non-Anthropic
providers (OpenRouter / Copilot / Gateway / Bedrock), where the disguise gives no benefit and
could in theory misalign tool names for those routes. We accept that for simplicity. If a
non-Anthropic Claude route ever breaks tool calls because of the rename, narrow this predicate
to also require `model.api.npm` ∈ {`@ai-sdk/anthropic`, `@ai-sdk/google-vertex/anthropic`} —
but do not pre-emptively add that unless a real breakage appears.

---

## Known limitation — native runtime NOT covered (MUST DOCUMENT)

The disguise lives in the `wrapLanguageModel` middleware (`llm.ts:311-329`), which only the
**default AI SDK path** flows through. The experimental **native runtime** (`LLMNativeRuntime.stream`,
`llm.ts:220-259`, opted in via `OPENCODE_EXPERIMENTAL_NATIVE_LLM=true`) builds its request through
`native-request.ts` and **bypasses the middleware entirely** — so on that path a Claude model gets
**no tool-name/param disguise and no response remap**, and the thinking-block bug could recur.

In practice this is currently almost unreachable: the native runtime **refuses Anthropic OAuth**
(`native-runtime.ts:52`) and only supports Anthropic via a plain API key, so subscription/OAuth
Claude requests fall back to the AI SDK path where the disguise works. It only matters for
plain-API-key Claude with the experimental flag on.

**Required action (not optional):** document this gap explicitly so it is not a silent divergence.
- Add a clear note to `~/Tandem/log.md` (and a one-line pointer in `context.md` if appropriate)
  stating: the Claude Code tool/param disguise and response remap are applied **only on the AI SDK
  runtime**, NOT on the experimental native runtime; native Claude (API-key) requests are
  undisguised and can regress the thinking-block bug.
- Include a TODO: if/when the native runtime is wired up for Claude (especially Anthropic OAuth),
  the disguise + response remap must be ported onto that path too (e.g. inside `native-request.ts`
  message lowering and the native tool/stream adapters), reusing the same `ProviderTransform`
  helpers from Item 1.
- Also confirm the Item 2 plugin trim does not leave the native path **worse** than today (it must
  not become half-translated). If the plugin previously did any shaping that the native path
  relied on, note that the native path now does none.

---

## Verification

- Port the plugin's tool-mapping tests into a Tandem provider-transform test under
  `packages/opencode` (round-trip names, input keys, schema, descriptions; `StructuredOutput`
  and unknown/MCP tool passthrough).
- Add a regression test asserting `reasoning`/thinking and `text` stream parts pass through the
  middleware **unmodified**.
- `cd packages/opencode && bun typecheck`; run the focused transform test.
- Build a single CLI (`context.md` "Verification Commands"); smoke-test the original repro:
  read + analyze a Claude Code prompt dump and an edit-heavy session on BOTH desktop and the
  Y700. Confirm no signature error and that snake_case tokens in visible output are no longer mangled.
- Update `~/Tandem/log.md` with the new provider-transform divergence (per `context.md`), AND
  the native-runtime limitation called out in "Known limitation — native runtime NOT covered".

---

## Sequencing

1. Item 1 in Tandem source.
2. Item 2 (plugin trim) in the same session; build/install both.
3. Verify the bug is gone (desktop + tablet).
4. Item 3 as a separate follow-up once 1+2 are confirmed stable.

## Hand back for review
Diffs in `transform.ts` + `llm.ts`, the trimmed plugin `transform.ts`/`index.ts`, the new
tests, `bun typecheck` output, and the result of the prompt-dump repro on the tablet.
