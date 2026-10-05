# Image generation

The `imagegen` tool and bundled skill generate or edit raster images with OpenAI.
They appear only when a supported image credential exists. Results contain paths and
metadata, never image bytes or attachments. The UI loads the saved image separately.

## Credentials and configuration

Credential priority is:

1. The latest stored `openai` API key.
2. `OPENAI_API_KEY`.
3. The active `tandem-openai-images` OAuth connection using method `codex`.

The normal OpenAI conversation OAuth credential is not used. The separate image
integration does not register chat models or change the active conversation login.

- `TANDEM_IMAGEGEN=0|false|off|no` disables the tool and bundled skill. The auth integration remains available. The default is enabled when credentials exist.
- `TANDEM_IMAGEGEN_OAUTH_MODEL` is the host model for masked OAuth Responses edits. Default: `gpt-5.5`.
- `TANDEM_IMAGEGEN_JPEG_QUALITY` controls the optional opaque display copy. It is clamped to 1–100. Default: `90`.

The OAuth flow uses manual callback mode. Start the `OpenAI Images (ChatGPT)` / `codex`
integration, authorize its URL, then submit the complete
`http://localhost:1455/auth/callback?...` URL within five minutes. No callback server
is started, so a connection-refused browser page is expected. Do not run another
Codex listener on port 1455 during authorization. Attempts are in memory and must be
completed on the same running host and Location. Invalid or expired submissions may
require a new attempt.

OAuth refresh is delegated to the integration host. Image calls serialize refresh
and persistence per credential within one process. Separate processes sharing a
credential database are not coordinated. JWT claims are routing hints only. Never
log callback URLs, authorization codes, or tokens.

## Tool contract

Both modes accept a prompt, up to ten source images, an optional PNG alpha mask for
the first source, and `transparent` (default false). Input paths use normal Location
and file-access policy. A mask must match the first source dimensions and contain
transparent editable pixels.

API-key mode also requires width and height. Each must be a positive multiple of 16
and at most 3840; aspect ratio is limited to 3:1 and total area to
655360–8294400 pixels. Quality is `medium`, `high`, `xhigh`, or `max`, defaulting to
`high`. It uses `gpt-image-2.5-sunburst` through OpenCode's public image API.

OAuth generation and unmasked edits use native Codex Images with backend-managed
size, quality, and serving model. Masked OAuth edits use the Responses image tool.
Masked OAuth edits with transparency are rejected. Requested values and
backend-reported values remain separate; absent backend values are omitted from
durable metadata.

The full PNG is saved under `<session directory>/imagegen/` without overwriting
existing files. An optional same-dimension JPEG display copy is made for opaque
images, or WebP for images with alpha. Codec or compression failure keeps the PNG as
the display path. A requested transparent image must contain real alpha pixels.

Credential updates reload the tool and skill. A mode change invalidates a stale
schema; an already-advertised call fails and asks the caller to retry. A user-defined
`imagegen` skill overrides the bundled skill.

## Implementation

- `plugin.ts` owns credential selection, dynamic tool and skill registration, permissions, refresh locking, schema selection, and path-only results.
- `auth.ts` registers manual PKCE login and token refresh for `tandem-openai-images`.
- `imagegen.ts` validates inputs, calls the API-key or OAuth transport, verifies PNG and alpha data, and saves artifacts.
- `photon.ts` lazily loads the packaged Photon codec.
- `description.md` and `imagegen-skill.md` are model-facing bundled text.
- `packages/session-ui/src/tools/imagegen.tsx` renders the authenticated local preview and lightbox.

## Debugging

If the tool is absent, check the active credential type and `TANDEM_IMAGEGEN` value.
API-key mode advertises required `width` and `height`; OAuth mode does not. Transport
errors identify authorization, rejected requests, invalid output, mask mismatch, or
missing alpha. Inspect the saved PNG and tool metadata for observed dimensions,
alpha, route, IDs, and backend-reported settings. `TANDEM_DUMP_REQUEST` does not
capture imagegen's direct image API calls.
