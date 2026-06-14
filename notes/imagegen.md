# Plan: OpenAI Image Generation Tool (`imagegen`) for Tandem

Status: spec / handoff for a fresh implementation session. This separates
**agreed decisions**, **code-verified facts**, and **open decisions still to be
made**. Do not treat open decisions as settled. Re-`grep` before editing — line
numbers drift.

Author note: scoped from a study of OpenAI Codex's image tooling plus the
extracted Codex `imagegen` skill. References:

- Codex standalone tool (Rust): `~/code/codex/codex/codex-rs/ext/image-generation/` (`tool.rs`, `backend.rs`, `extension.rs`, `imagegen_description.md`).
- Codex Images API client: `~/code/codex/codex/codex-rs/codex-api/src/images.rs` and `endpoint/images.rs`.
- Extracted Codex `imagegen` **skill** (reference only, not ported): `~/win/imagegen/` (`SKILL.md`, `references/image-api.md`, `references/cli.md`, `scripts/image_gen.py`, `scripts/remove_chroma_key.py`).

## Goal

A Tandem-owned tool, `imagegen`, that **generates and edits raster images** via
OpenAI's Images API using **gpt-image-2**, returning a **saved PNG file plus an
inline image**. The tool is **visible only when OpenAI credentials exist**
(OAuth login or API key); otherwise it is hidden. It ships as an **internal
plugin** to minimize fork divergence from upstream OpenCode.

This is a `personal:` Tandem enhancement.

## Why a plugin (not a built-in tool)

Minimizing merge surface is the priority. The repo already has the exact
precedent:

- `internalPlugins()` carries Tandem-only plugins today, e.g. `PromptCorrectorPlugin` marked `UPSTREAM-DIVERGENCE`, and `CodexAuthPlugin` lives at `src/plugin/openai/codex.ts`.
- Plugins contribute tools via a `tool` map consumed by `registry.ts` `fromPlugin(...)`. Plugin tool results already support `attachments` (inline image), Zod args, and a custom `execute`.
- **Merge surface = one import + one array entry** in `plugin/index.ts` (a file Tandem already diverges in), plus a new isolated directory. Zero changes to upstream tool files.

## Packaging & wiring

- New dir: `packages/opencode/src/plugin/openai/imagegen/`
  - `plugin.ts` — exports the plugin function; returns `Hooks` with a `tool` map `{ imagegen: { description, args, execute } }`.
  - `imagegen.ts` — request building, gpt-image-2 size validation, generate/edit dispatch, save + inline return.
  - `imagegen.txt` — model-facing description string.
  - Reuse `refreshAccessToken`, `extractAccountId`, `parseJwtClaims` from `../codex`.
- Wire with **one** `UPSTREAM-DIVERGENCE`-marked entry in `internalPlugins()` (`packages/opencode/src/plugin/index.ts`), mirroring `PromptCorrectorPlugin`.
- Tool surfaces through the plugin `tool` hook → `fromPlugin` → no edits to `registry.ts` `builtin[]`.

## Auth resolution & endpoints

At execute time, resolve OpenAI credentials with this precedence:

1. **API key** — `Auth.get("openai")` type `api`, or `OPENAI_API_KEY` env.
2. **OAuth** — `Auth.get("openai")` type `oauth` (refresh + account id as Codex does).
3. **Neither** — tool is hidden (see Visibility); execute-time guard errors clearly as a fallback.

| Mode | Endpoint | Headers | Model |
|---|---|---|---|
| API key | `https://api.openai.com/v1/images/{generations,edits}` | `Authorization: Bearer <key>` | gpt-image-2 |
| OAuth | `https://chatgpt.com/backend-api/codex/images/{generations,edits}` | `Authorization: Bearer <access>` + `ChatGPT-Account-Id: <accountId>` | gpt-image-2 |

- OAuth refresh + account-id extraction reuse `codex.ts` helpers; persist refreshed tokens via `input.client.auth.set({ path: { id: "openai" }, body: {...} })` exactly as the Codex plugin does.
- The Codex plugin's chat `fetch` only reroutes `/v1/responses` and `/chat/completions`; the Images endpoints are separate, so this tool issues its own `fetch` with its own auth — it does not flow through the Codex chat fetch.

**Visibility (hide when no creds):** plugin tools currently pass through
`registry.ts` `tools()` with `return true`, so they are always offered. Pick one:

- (A) Plugin contributes the `tool` entry only when a credential is resolvable at build time, re-evaluating on auth change. (Preferred if clean.)
- (B) Add a minimal gate in `registry.ts` `tools()` keyed on the tool id + OpenAI credential presence. (One small upstream touch.)

Decide during implementation; see Open Decisions.

## Tool schema (model-facing, Zod)

| Field | Type | Notes |
|---|---|---|
| `prompt` | string (required) | generation / edit instruction |
| `quality` | enum `low\|medium\|high\|auto` | **default `high`** |
| `size` | enum `auto\|1024x1024\|1536x1024\|1024x1536` (+ optional `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840`) | default `auto`; validated against gpt-image-2 constraints |
| `n` | int 1–4 (capped) | default 1; multiple base64 PNGs are heavy |
| `image_paths` | string[]? (≤ N) | **edit**: local source image file path(s) |
| `mask_path` | string? | **edit**: PNG with alpha; applies to the first image; prompt-guided only (not pixel-exact on gpt-image-2) |

**Fixed / hidden (not exposed to the model):**

- `model = "gpt-image-2"`
- `output_format = "png"`
- `moderation = "low"`  ← fixed at low
- `background` — **dropped entirely** (gpt-image-2 cannot do `transparent`; with PNG fixed there is no useful value)
- `input_fidelity` — omitted (unsupported on gpt-image-2; always high)
- `output_compression` — omitted (jpeg/webp only; N/A with PNG)

### gpt-image-2 size constraints (for validation)

`auto` or `WIDTHxHEIGHT` where: max edge ≤ 3840px; both edges multiples of 16;
long:short ratio ≤ 3:1; total pixels between 655,360 and 8,294,400. Outputs above
2560×1440 are experimental. Exposing a curated enum (rather than free-form `WxH`)
keeps the model from emitting invalid sizes; still validate server-side.

## Generate vs edit

- No `image_paths` → **generate** → `POST .../images/generations`.
- `image_paths` present → **edit** → `POST .../images/edits`, multipart with image file(s) and optional `mask`.
- The mask, when present, applies to the first image and is prompt-guided.
- v1 supports editing **local file paths** only. Editing in-chat images that have
  no local file (the Codex-tool `num_last_images_to_include` mechanism) is
  deferred to v2 unless decided otherwise. See Open Decisions.

## Output handling

- Decode `data[].b64_json` → write PNG to
  `Global.Path.data/imagegen/<sessionID>/<callID>[-<n>].png`; non-destructive
  naming (never overwrite an existing artifact).
- Return one attachment per image:
  `{ type: "file", mime: "image/png", url: "data:image/png;base64,..." }`,
  run through `Image.normalize` to respect UI/model size limits.
- `output` / `title` text: concise (saved path + size). Do **not** dump base64
  into the text channel.

## Model-facing description (`imagegen.txt`)

Adapt Codex's `imagegen_description.md`:

- When to use: user requests a raster image (photo, illustration, diagram,
  mockup, sprite, etc.) or wants to modify an existing image.
- When not to use: vector/SVG/icon systems or code-native output.
- Edit rules: use `image_paths` for local files; supply `mask_path` only when a
  region must be constrained.
- After generating, do not summarize the image, do not mention download, do not
  ask a follow-up — say nothing further.

## UI

The generated image is a file attachment. Verify the tool-card renderer shows it
inline (`packages/ui/src/components/message-part.tsx` `PART_MAPPING["tool"]` /
`basic-tool.tsx`) and reuse existing `data:` image rendering + preview
(`message-file.ts`, `image-preview.tsx`, `file-media.tsx`).

## Errors & limits

Clear, model-actionable messages for: no creds (plus the visibility gate),
content-policy / moderation rejections, invalid size, network/auth failures,
missing edit files, and >cap inputs. Note that generation is slow and costly;
keep `n` capped.

## Config knobs (optional, `opencode.json`)

All optional, with the fixed schema defaults above:

- default `quality` (`high`) and `size` (`auto`)
- save directory override
- `n` cap
- enable/disable the tool

## Risks / verification (do before/while implementing)

1. **OAuth → `/backend-api/codex/images/*`** actually works for OpenCode's OAuth client (Codex CLI uses it; confirm live). The API-key branch is certain.
2. Cleanest **visibility gate** for a plugin tool (option A vs B above).
3. Tool-result image **renders inline** in the tool card on web + Android/iOS.
4. **`client.auth.get`** availability (only `auth.set` is confirmed used today; confirm a read path or read the auth store directly from the internal plugin).

## Merge surface summary

- One import + one array entry in `packages/opencode/src/plugin/index.ts` (already a Tandem-divergent file).
- One new isolated directory `packages/opencode/src/plugin/openai/imagegen/`.
- Optionally one small gate in `registry.ts` `tools()` if visibility option B is chosen.
- No changes to upstream tool files.

---

## Code-verified facts (Tandem `dev`)

- Internal plugins are registered in `internalPlugins(flags)` at `packages/opencode/src/plugin/index.ts:66-84`; loaded in the layer loop at `:167-176`. Tandem already adds `PromptCorrectorPlugin` here (`UPSTREAM-DIVERGENCE`).
- Plugin input context (`PluginInput`) provides `client`, `project`, `worktree`, `directory`, `serverUrl`, `$` (`plugin/index.ts:150-165`).
- Plugin-contributed tools are collected from each plugin's `tool` map: `for (const p of plugins) for (const [id, def] of Object.entries(p.tool ?? {})) custom.push(fromPlugin(id, def))` (`packages/opencode/src/tool/registry.ts`).
- `fromPlugin` accepts Zod `def.args` (converted to JSON Schema for the LLM) and returns `{ title, output, attachments, metadata }`; **`attachments` are passed through** (`registry.ts`).
- Per-request tool gating happens in `registry.ts` `tools({ providerID, modelID, agent })`; default branch is `return true`, so plugin tools are not auto-hidden.
- Codex OAuth plugin facts (`packages/opencode/src/plugin/openai/codex.ts`): `CLIENT_ID=app_EMoamEEZ73f0CkXaXp7hrann`, `ISSUER=https://auth.openai.com`, `CODEX_API_ENDPOINT=https://chatgpt.com/backend-api/codex/responses`; `refreshAccessToken`, `extractAccountId`, `parseJwtClaims` exported helpers; loader sets `Authorization: Bearer <access>` + `ChatGPT-Account-Id`, persists refresh via `input.client.auth.set({ path: { id: "openai" }, ... })`, and reroutes only `/v1/responses` + `/chat/completions`.
- Auth store: `packages/opencode/src/auth/index.ts` — `OAUTH_DUMMY_KEY`, `Info` union (`oauth { refresh, access, expires, accountId? }` | `api { key }`), `Auth.get(providerID)`.
- Tool result shape: `packages/opencode/src/tool/tool.ts` `ExecuteResult.attachments` = file parts `{ type: "file", mime, url, filename? }`.
- Image normalization: `packages/opencode/src/image/image.ts` `Image.normalize(FilePart)` (base64 data URL, auto-resize/recompress; defaults ~2000×2000 / 5 MB).
- Artifact path helper: `packages/core/src/global.ts` `Global.Path.data` (XDG data dir; existing subdir conventions like `tool-output/`, `plans/`).

### Codex reference facts

- Codex standalone tool model-facing schema (`ext/image-generation/src/tool.rs`): only `prompt`, `referenced_image_paths` (≤5), `num_last_images_to_include` (1–5); everything else hardcoded to `auto` / `gpt-image-2`. It deliberately hides all knobs.
- Codex `ImageGenerationRequest`/`ImageEditRequest` (`codex-api/src/images.rs`) carry only `prompt, background, model, n, quality, size` — a subset of the public API (no `output_format`, `mask`, `moderation`, `input_fidelity`).
- The extracted Codex **skill** `image_gen.py` is a standalone fallback **CLI** (argparse subcommands `generate`/`edit`/`generate-batch`, OpenAI Python SDK, requires `OPENAI_API_KEY`). It is a reference only; Tandem builds a native tool and does **not** ship or shell out to it.
- Full public Images API param surface (from the skill's `image-api.md` + OpenAI docs): `prompt, model, n (1–10), size, quality (low|medium|high|auto), background (transparent|opaque|auto), output_format (png|jpeg|webp), output_compression (0–100), moderation (auto|low)`; edit adds `image` (≤16), `mask`, `input_fidelity` (not gpt-image-2). gpt-image-2 does **not** support `background: transparent`.

## Decisions (resolved 2026-06-14)

1. **Edit inputs**: v1 ships **local file paths only**. In-chat image editing (Codex-style `num_last_images_to_include`, no local file) is **deferred to v2** ("B later").
2. **Visibility gate**: **Option A** — the plugin self-gates by contributing the `imagegen` tool entry only when an OpenAI credential is resolvable, re-evaluated on auth change. No `registry.ts` edit. Option B (small `tools()` gate) is kept documented as a later fallback if A proves insufficient.
3. **Caps**: `n` ≤ **10** (public API max) and `image_paths` ≤ **10**.
4. **Size enum**: ship the **4 base sizes only** — `auto`, `1024x1024`, `1536x1024`, `1024x1536`. No 2K/4K presets in v1.
5. **OAuth images endpoint**: OAuth **must work**. Live-verify that `https://chatgpt.com/backend-api/codex/images/{generations,edits}` works with OpenCode's OAuth client; this is a **required preflight**, not optional. API-key branch is already certain. **BLOCKED — see Verification log (2026-06-14): the codex backend returns app-level `404 Not Found` for the images route while `/codex/responses` works with the same token.**

## Verification log (2026-06-14, Tandem `dev`, Ubuntu tablet)

Code-fact corrections (verified against source, supersede earlier optimistic spec lines):

- **Auth read path**: the SDK client (`packages/sdk/js/src/v2/gen/sdk.gen.ts`) exposes **only `auth.set` (PUT) and `auth.remove` (DELETE)** — there is **no `auth.get`/`auth.all`**. The internal `Auth.get` is an Effect service the plain-async plugin cannot call. → The plugin must **read the auth store directly**: parse `OPENCODE_AUTH_CONTENT` if set, else read `path.join(Global.Path.data, "auth.json")` (mode 0600 JSON, keyed by provider id, e.g. `openai`), plus `process.env.OPENAI_API_KEY`. `Global` is importable from `@opencode-ai/core/global`.
- **`Image.normalize` is not reachable from a plugin** (Effect service requiring `Image.Service`+`Config`), and tool-result attachments are **not** auto-normalized by the pipeline (`session/tools.ts:95-100,187-192`, `prompt.ts:366-371` only stamp `id/sessionID/messageID`; the `Image.normalize` calls at `prompt.ts:996`/`processor.ts:575` are for user-input parts). → v1 returns the raw PNG `data:` attachment; document that very large high-quality PNGs inflate context. Add normalization later via a server-side path if needed.
- **OAuth edit request shape** (from clean `codex-rs/codex-api/src/endpoint/images.rs` test) is **JSON** `{ images: [{ image_url: "data:image/png;base64,..." }], prompt, model, ... }`, **not multipart**. Multipart is only the `api.openai.com/v1/images/edits` (API-key) shape. Path is `<base>/images/generations` and `<base>/images/edits`.
- **Codex bases/models** confirmed: `CHATGPT_CODEX_BASE_URL = https://chatgpt.com/backend-api/codex` (`model-provider-info/src/lib.rs`); standalone tool model `IMAGE_MODEL = "gpt-image-2"` (`ext/image-generation/src/tool.rs:47`); API client appends `images/generations` / `images/edits` to the provider base (`endpoint/images.rs`).

Live OAuth probes (account: openai `oauth`, accountId present, token valid to 2026-06-24; no `prompt` sent so nothing was generated):

| Request | Result |
|---|---|
| `POST /backend-api/codex/responses` (control, `{}`) | `400` JSON `"The 'None' model is not supported when using Codex with a ChatGPT account."` → **auth valid, codex base works** |
| `POST /backend-api/codex/images/generations` | `404` JSON `{"detail":"Not Found"}` |
| `POST /backend-api/codex/images` · `/v1/images/generations` · `/images/generate` · `/generations` | all `404` JSON `{"detail":"Not Found"}` |
| `GET /backend-api/codex/images/generations`, `POST /backend-api/images/generations` | `403` Cloudflare HTML (edge layer, not the codex app) |

Initial (wrong) conclusion was "OAuth image route missing." **Corrected by ground truth:** Codex CLI v0.139.0 generated an image fine on this same OAuth account. Its own logs (`~/.codex/logs_2.sqlite`, table `logs`) show the image did **not** use a REST images endpoint at all — it came back as an **`image_generation_call` output item inside the `/backend-api/codex/responses` stream**:

- span `...:handle_responses{otel.name="image_generation_call" ...}:handle_output_item_done: Output item item=ImageGenerationCall { id: "ig_...", status: "generating", revised_prompt: Some(...) }`
- request was `{"type":"response.create","model":"gpt-5.5",...}` on `api.path="responses"`, then `response.output_item.added {type:"image_generation_call"}` → `response.image_generation_call.in_progress` → `.generating` → completed; the artifact was saved to `~/.codex/generated_images/<thread>/ig_*.png`.

### Corrected OAuth design (this is the real path)

- **OAuth image generation = OpenAI Responses API built-in `image_generation` tool**, hosted by the chat model (Codex used `gpt-5.5`), over `POST https://chatgpt.com/backend-api/codex/responses` with `Authorization: Bearer <access>` + `ChatGPT-Account-Id: <accountId>`. Parse `output[]` items of `type:"image_generation_call"`; the base64 PNG is in the item's `result` field. There is **no** `/codex/images/{generations,edits}` route on the ChatGPT backend (confirmed 404).
- The standalone `ImagesClient` → `/v1/images/{generations,edits}` (gpt-image-2, multipart edits) in `codex-rs` is the **API-key** path only (`api.openai.com`).
- So the two auth modes need **different transports**:
  - **API key** → simple REST `POST api.openai.com/v1/images/{generations,edits}` (generations JSON; edits multipart). Certain.
  - **OAuth** → Responses API with `tools:[{type:"image_generation", ...size/quality/output_format/moderation}]` (likely `tool_choice` forcing it), `input` carrying the prompt (and `input_image` data URLs for edits), parse `image_generation_call.result`. Proven to work; exact minimal request (streaming vs `stream:false`, allowed model id) still needs one live confirmation.

This satisfies decision 5 (OAuth works) but **reshapes the spec**: OAuth mode is a Responses-tool integration, not a REST images call. `imagegen.txt`, request-building, and edit handling must branch by auth mode. (`rg` output on the codex source tree is garbled — "image" renders as "n"; use `Read`/`sed` and the sqlite logs as ground truth.)

### LOCKED OAuth contract (live-confirmed 2026-06-14, generated a real 1024×1024 PNG)

Request — `POST https://chatgpt.com/backend-api/codex/responses`:
- Headers: `Authorization: Bearer <access>`, `ChatGPT-Account-Id: <accountId>`, `Content-Type: application/json`, `Accept: text/event-stream`. (`originator: codex_cli_rs` + `User-Agent` sent but likely optional.)
- Body **must** include all of: `model` (used `"gpt-5.5"`), **`stream: true`** (400 `"Stream must be set to true"` otherwise), **`store: false`** (400 `"Store must be set to false"` otherwise), `input: [{ role:"user", content:[{ type:"input_text", text:<prompt> }] }]`, `tools: [{ type:"image_generation", size, quality, output_format:"png", moderation:"low" }]`, `tool_choice: { type:"image_generation" }`. For **edits**, add `{ type:"input_image", image_url:"data:image/png;base64,..." }` parts to the user content (to verify during impl).
- The `image_generation` tool params map 1:1 to our schema: `size` (same WxH enum), `quality` (`low|medium|high|auto`), `output_format:"png"`, `moderation:"low"`.

Response — SSE (`text/event-stream`; note `content-type` header came back null but body is SSE). Event sequence observed: `response.created` → `response.in_progress` → `response.output_item.added` → `response.image_generation_call.in_progress` → `.generating` → `.partial_image` (carries `partial_image_b64`) → `response.output_item.done` → `response.completed`.
- **Final base64 PNG**: `response.output_item.done`.`item` where `item.type === "image_generation_call"`, field **`item.result`** (base64). Item also carries `id, status, action:"generate", background:"opaque", output_format, quality, revised_prompt, size`. (Also present in `response.completed`.`response.output[]` as a fallback.)
- The model also emits a text part (`response.output_text.done`) even with `tool_choice` forced — ignore it for output.
- Open impl detail: `n>1` over OAuth (the tool yields one image per call; may need N calls). API-key path uses native `n`. PNG was ~790 KB at `quality:low` 1024² — high quality will be larger (size-limit note above applies).

### GOTCHA: plugin registry does not apply Zod `.default()`

`registry.ts` `fromPlugin` validates plugin tool args only as a **predicate** (`Schema.declare(u => zodParams.safeParse(u).success)`) and passes the **raw** decoded args to `execute` — the parsed/transformed output (where Zod fills defaults) is discarded. So `quality:z.enum(...).default("high")` etc. are NOT applied at runtime; an omitted field arrives as `undefined`. First live call proved this: omitting `n` made `args.n === undefined`, so `for (i=0;i<undefined;i++)` ran zero times → "Saved 0 images". Fix: declare those fields `.optional()` and apply defaults in `execute` (`args.n ?? 1`, etc.), documenting the default in the field description for the model. Re-verified live: OAuth generation produced a valid 1024×1024 PNG (originator `opencode` is accepted on the image_generation responses call).
