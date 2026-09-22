# Tandem imagegen

Tandem-owned internal plugin in `packages/opencode/src/plugin/openai/imagegen/`.
This documents the September 2026 native Codex Images implementation and live
verification. Earlier implementation history is retained in git.

## Tool contract

- One image per call. Required `prompt`; no model selector.
- **ChatGPT OAuth:** exposes only `prompt`, `image_paths`, `mask_path`, and
  `transparent`. Model, quality, and dimensions are backend-managed. Express
  composition, aspect ratio, and desired detail in the prompt.
- **API key:** additionally requires `width`/`height` and exposes optional
  `quality` (`medium|high|xhigh|max`, default high). Dimensions are positive
  multiples of 16, each ≤3840, ratio ≤3:1, 655,360–8,294,400 total pixels.
  This path requests `gpt-image-2.5-sunburst` through the public Images API.
- Optional `image_paths`: ≤10 local input/reference files, resolved against the
  session directory. Inputs dispatch to editing; prompts identify reference roles.
- Optional `mask_path`: PNG alpha mask for the first input, transparent areas
  editable. Requires input images. Masks guide editing, not pixel-exact compositing.
- Optional `transparent`: native transparent background, default false/opaque.
  The decoded result must contain non-opaque alpha pixels before a transparent
  request can succeed. No chroma-key prompt, removal, or defringe remains.
- A one-line tool description delegates guidance to a compact embedded skill.

OAuth quality/dimension controls were removed after live probes showed that
requests, including invalid values, could be accepted without enforcement.
OAuth serving-model identity is unverified; the tool and skill advertise image
generation rather than Sunburst. Prompt aspect cues can steer composition but
do not guarantee pixels. Original dimensions are preserved without resize/crop.
See [model verification](imagegen-model-verification.md) for headers, controls,
C2PA inspection, and authenticated ChatGPT investigations. Undocumented internal
`gen_size` fields are not exposed as controls.

## Transport

| Auth / operation     | Endpoint and body                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| API key, generation  | `api.openai.com/v1/images/generations`, JSON                                                       |
| API key, edits/masks | `api.openai.com/v1/images/edits`, multipart `image[]` and optional `mask`                          |
| OAuth, generation    | `chatgpt.com/backend-api/codex/images/generations`, JSON                                           |
| OAuth, edits         | `chatgpt.com/backend-api/codex/images/edits`, JSON with `images:[{image_url:...}]`                 |
| OAuth, masked edits  | `chatgpt.com/backend-api/codex/responses`, image_generation tool with `input_image_mask.image_url` |

Native OAuth uses the official client's compatibility model name `gpt-image-2`
and `quality:auto`, `size:auto`, with the requested prompt/background. The model
field is not a verified serving-model selection. There is no host-model hop or prompt
rewriting instruction for ordinary generation/editing. Headers carry OAuth bearer
token, account ID when present, JSON content/accept, and `originator:opencode`.

Masked OAuth edits retain the verified Responses path because a native edits
control accepted deliberately invalid `mask.image_url` bytes without error. Do
not silently pass that unverified mask field to native Images. Responses requests
use `stream:true`, `store:false`, forced image tool, source images as data URLs,
and verbatim-prompt instructions. The image tool uses automatic quality/size
without an explicit image-model selection. The host defaults to `gpt-5.5`, configurable
with `TANDEM_IMAGEGEN_OAUTH_MODEL`. This route currently rejects native transparent
backgrounds; masked transparent OAuth edits surface the backend error.

The SSE parser records the effective `response.tools` image-model/route identifier
when present. `gpt-image-2-codex` is reported honestly, not treated as proof of old
weights or rejected. Native Images responses do not currently identify the model.

API-key calls explicitly request PNG and low moderation. Native Codex uses its own
defaults for these; its observed output is PNG. API-key behavior follows the public
contract but is not live-verified here because no API key is configured.

## Auth, output, and UI

Credential precedence: stored OpenAI API key, `OPENAI_API_KEY`, then ChatGPT OAuth.
The plugin reads `OPENCODE_AUTH_CONTENT` or the XDG auth store; expiring OAuth
tokens are refreshed and persisted with `client.auth.set`. Tool/skill visibility
uses the same credential resolver and `TANDEM_IMAGEGEN` opt-out. The schema is
selected by auth mode at instance construction; changing credential mode requires
project reinitialization, and execution detects a stale mode rather than silently
using the wrong controls. Refreshing an OAuth token does not change the schema.

The original PNG is saved to `<session directory>/imagegen/<callID>.png`. A smaller
same-dimension JPEG (opaque) or WebP (transparent) is saved beside it when useful;
the returned path is the smaller copy. Names are non-destructive. Photon handles
decoding/recompression, not background removal. JPEG quality defaults to 90 via
`TANDEM_IMAGEGEN_JPEG_QUALITY`. Use the original PNG for subsequent edits.

Results contain text paths and small metadata, never image attachments/base64.
The UI fetches thumbnails through the worktree-scoped file endpoint, so images
enter model context only when explicitly read. Preserve `ImagegenThumb`'s local
Suspense boundary to avoid route/virtualizer remount loops (see `log.md`).

Metadata records decoded `size`, backend-reported `quality` (null when unknown),
`mode`, `transport`, available `requestId`/`generationId`, and backend `reported`
model/quality/background/action. Only API-key results include `requestedSize`,
`requestedQuality`, and `requestedModel`, with output notes for discrepancies.
OAuth output simply reports actual dimensions and available quality/route values;
it never falls back to a requested setting as if it were observed. Returned prompt
revisions are surfaced only when different from the requested prompt.

## Live verification

Latest simplified-tool smoke check: real source CLI session
`ses_f37dec2c8ffe6fBs6rsQWeFs64`, artifacts/transcripts under
`/tmp/tandem/imagegen-simplified/`:

- Agent saw exactly the four OAuth arguments; prompt-only mug generation returned
  low/1254² through native Images, with request and generation IDs.
- Relative-path edit changed the mug to red with native transparency; returned
  medium/1254², passed decoded-alpha validation, and retained a WebP preview.
- Relative-path masked edit used Responses and placed a yellow star in the left
  strip; returned low/1254² and `gpt-image-2-codex`. The editable strip's background
  also changed; masking remains a generative edit, not exact compositing.
- No OAuth requested quality/dimensions/model metadata or mismatch warnings.
- Focused backend typecheck passed. Public API-key generation remains unverified
  because no API key is configured.

### Earlier explicit-control probes

Earlier artifacts were under `/tmp/tandem/imagegen-25-live/` (temporary storage).
These probes describe the superseded schema, not current OAuth controls.

Controlled native generation used the same simple mug prompt for every case:

| Requested                                   | Response                 |
| ------------------------------------------- | ------------------------ |
| Sunburst, high, 1536×864                    | HTTP 200, low, 1254×1254 |
| Sunburst, xhigh, 1536×864                   | HTTP 200, low, 1254×1254 |
| Sunburst, max, 1536×864                     | HTTP 200, low, 1254×1254 |
| Sunburst, high, 864×1536                    | HTTP 200, low, 1254×1254 |
| Nonexistent model, invalid quality and size | HTTP 200, low, 1254×1254 |

Real agent sessions exercised the updated source and normal skill/tool flow:

- Detailed water-cycle poster: requested max/2048², returned medium/1254².
- Native edit: mug glaze blue→red, preserving composition; requested high,
  returned medium. Relative source paths worked.
- Native transparency: glass perfume bottle and white feather; requested xhigh,
  returned medium/1310×1200. PNG and WebP both retained 776,407 fully transparent
  and 795,591 partially transparent pixels. Visually inspected over checkerboard.
- Masked edit through Responses: yellow star in the left editable strip; returned
  low/1254², route `gpt-image-2-codex`. Visually inspected.

Thus this account is **not low-only**; native responses have returned low and
medium. The selection algorithm is unknown. Results are consistent with backend
automatic selection, not client-enforced quality. No high/xhigh/max output was
verified. The earlier Responses route explicitly normalized requested settings
to `gpt-image-2-codex`, quality auto, size auto. A public Images API request using
the OAuth token returned 401, missing `api.model.images.request` scope.

No low-level tests were added/run. Only obsolete chroma fixtures/imports were
removed. Focused backend typechecking supplements the real-session checks.

## References

- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [GPT Image 2.5 prompting](https://developers.openai.com/api/docs/guides/image-prompting)
- [Sunburst model](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
- [Sam Saffron's subscription demonstration](https://community.openai.com/t/introducing-gpt-images-2-5-in-the-api-and-chatgpt/1395897/9)
- [term-llm native OAuth implementation](https://github.com/SamSaffron/term-llm/blob/main/internal/image/chatgpt.go)
- [Codex model-selection issue #43965](https://github.com/openai/codex/issues/43965)
- [Responses normalization report](https://github.com/NousResearch/hermes-agent/issues/107233)

Official Codex clone: `~/code/codex/codex`, inspected commit `b9bfc0a` (2026-09-14).
Its standalone image tool still hardcodes `gpt-image-2` with auto size/quality.
Public documentation names Flare and Sunburst; subscription rollout does not
establish explicit model/setting enforcement on every Codex account.
