# Image generation

The `imagegen` tool and bundled skill generate or edit raster images with OpenAI.
They appear only when a supported image credential exists. Results contain paths and
metadata, never image bytes or attachments. The UI loads the saved image separately.

## Credentials and configuration

Credential priority is:

1. The latest stored `openai` API key.
2. `OPENAI_API_KEY`.
3. The active `openai` connection when it is the Codex ChatGPT login (`chatgpt-browser`
   or `chatgpt-headless`), the same login the conversation uses. Its `accountID`
   metadata becomes the `ChatGPT-Account-Id` header.

The "Sign in with ChatGPT" token-sharing login (`chatgpt-token-sharing`) is not
accepted by Codex Images, so it does not enable the tool.

- `TANDEM_IMAGEGEN=0|false|off|no` disables the tool and bundled skill. The default is enabled when credentials exist.
- `TANDEM_IMAGEGEN_OAUTH_MODEL` is the host model for masked OAuth Responses edits. Default: `gpt-5.5`.
- `TANDEM_IMAGEGEN_JPEG_QUALITY` controls the optional opaque display copy. It is clamped to 1–100. Default: `90`.

Sign-in and token refresh belong to the upstream OpenAI provider plugin. Image calls
resolve the active connection through the integration host and serialize refresh and
persistence per credential within one process. Separate processes sharing a credential
database are not coordinated. Never log tokens.

## Tool contract

Both modes accept a prompt, up to ten source images, an optional PNG alpha mask for
the first source, and `transparent` (default false). Input paths use normal Location
and file-access policy. A mask must match the first source dimensions and contain
transparent editable pixels.

API-key mode also requires width and height. Each must be a positive multiple of 16
and at most 3840; aspect ratio is limited to 3:1 and total area to
655360–8294400 pixels. Quality is `medium`, `high`, `xhigh`, or `max`, defaulting to
`high`. It requests `gpt-image-2.5-sunburst` directly from OpenAI's
`/v1/images/generations` and `/v1/images/edits` endpoints.

OAuth generation and unmasked edits use native Codex Images with backend-managed
size, quality, and serving model. Masked OAuth edits use the Responses image tool.
Masked OAuth edits with transparency are rejected. Requested values and
backend-reported values remain separate; absent backend values are omitted from
durable metadata. A `revised_prompt` returned by the backend is always shown, even
when it matches the prompt sent.

The full PNG is saved under `<session directory>/imagegen/` without overwriting
existing files. An optional same-dimension JPEG display copy is made for opaque
images, or WebP for images with alpha. Codec or compression failure keeps the PNG as
the display path. A requested transparent image must contain real alpha pixels.

Credential updates reload the tool and skill. A mode change invalidates a stale
schema; an already-advertised call fails and asks the caller to retry. A user-defined
`imagegen` skill overrides the bundled skill.

## Implementation

- `plugin.ts` owns credential selection, dynamic tool and skill registration, permissions, refresh locking, schema selection, and path-only results.
- `imagegen.ts` validates inputs, calls the API-key or OAuth transport, verifies PNG and alpha data, and saves artifacts.
- `photon.ts` lazily loads the packaged Photon codec.
- `description.md` and `imagegen-skill.md` are model-facing bundled text.
- `packages/session-ui/src/tools/imagegen.tsx` renders the authenticated local preview and lightbox.

## Debugging

If the tool is absent, check the active OpenAI credential's method and `TANDEM_IMAGEGEN`.
API-key mode advertises required `width` and `height`; OAuth mode does not. Transport
errors identify authorization, rejected requests, invalid output, mask mismatch, or
missing alpha. Inspect the saved PNG and tool metadata for observed dimensions,
alpha, route, IDs, and backend-reported settings. `TANDEM_DUMP_REQUEST` does not
capture imagegen's direct image API calls.
