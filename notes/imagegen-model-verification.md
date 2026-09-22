# Image model identity verification

Investigation: September 17, 2026 local time; probe response timestamps are
September 16, 2026 at approximately 21:11 UTC.

## Conclusion

**Sunburst requested; serving model unverified.** Successful OAuth generation
does not establish explicit model selection. Embedded C2PA provenance labels all
eleven inspected originals as `gpt-image` version `2.0`, but no authoritative mapping
between this label and current API model IDs was found. It may describe the
serving model or be a legacy label. Do not claim verified Sunburst or definitively
infer old weights from this label alone.

## Official client

Inspected official OpenAI Codex main commit
`47c27cbffa6e17bce3548d87440484e36e1cbfc3`, dated 2026-09-16 21:08:43 UTC.

- `codex-rs/ext/image-generation/src/tool.rs`: still hardcodes
  `IMAGE_MODEL = "gpt-image-2"`; requests automatic quality and size.
- `codex-rs/codex-api/src/endpoint/images.rs`: posts to `images/generations`
  and `images/edits`; captures `x-codex-imagegen-request-id`.
- `codex-rs/ext/image-generation/src/backend.rs`: sends
  `x-codex-image-turn-id` and originator headers.
- `codex-rs/codex-api/src/images.rs`: response carries image bytes,
  generation ID, background, quality, and dimensions; no effective model field.
- No caller-selectable Sunburst control was found in these image tool files.

## Live controls

Three native OAuth requests used the same prompt, automatic quality/size,
opaque background, the existing account, Bun fetch, and the native turn-ID header.
Only the model name differed. No host-model hop.

Prompt: `A single small blue circle centered on a plain white background. No text.`

| Requested model | HTTP | Reported quality | Decoded dimensions |
| --- | --- | --- | --- |
| `gpt-image-2.5-sunburst` | 200 | low | 1254×1254 |
| `gpt-image-2` | 200 | low | 1254×1254 |
| `tandem-intentionally-nonexistent-image-model` | 200 | low | 1448×1086 |

All three JSON responses and complete response-header sets lacked serving-model,
snapshot, or model-routing identifiers. They contained generation/request IDs,
usage, quality, dimensions, background, and ordinary HTTP/account-limit metadata.
Invalid-name success could represent ignored selection or fallback behavior;
it does not establish that all valid model names are ignored.

Sunburst-request identifiers for an OpenAI support trace:

- UTC: `2026-09-16T21:11:12Z`
- `x-codex-imagegen-request-id` / `x-oai-request-id`:
  `0ccd3fa9-cae7-480d-a4af-a3c7388f1f01`
- Generation ID: `13adf46a-1bd9-46ec-b947-b0205165c5be`

## Embedded provenance

Inspected original PNGs, not recompressed JPEG comparison sheets: all six previous
comparison images plus the three new controls and two authenticated ChatGPT
Images generations (simple and complex).

Every `c2pa.created` action includes:

```json
{"softwareAgent": {"name": "gpt-image", "version": "2.0"}}
```

The `c2pa-python` reader reports `is_valid=true`, validation state `Valid`,
and issuer fields naming OpenAI OpCo, LLC / OpenAI Media Service for all eleven.
The default validator reports `signingCredential.untrusted`; certificate trust
was not established against an independently configured trust list. Valid
signatures/image bindings authenticate the manifest contents under the supplied
certificate, not the semantic equivalence of `2.0` to a particular API model.

## Documentation and browser checks

The [Sunburst model documentation](https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst)
lists `gpt-image-2.5-sunburst` and dated snapshot
`gpt-image-2.5-sunburst-2026-09-08` for public Images and Responses APIs. It does
not guarantee selection through ChatGPT/Codex OAuth or define C2PA version labels.

After Jon logged in, inspected `chatgpt.com/images/` and generated one blue-circle
image through its normal composer while recording the network request. The
visible `6 Pro` dropdown opens host-model/thinking-effort controls, not an
explicit Sunburst/Flare picker.

- POST `/backend-api/f/conversation`: `model: "gpt-6-pro"`,
  `system_hints: ["picture_v2"]`; no image-model selector.
- GET `/backend-api/conversations/<id>` after completion: image `generation`
  metadata includes generation ID, `gen_size: "smimage"`, `gen_size_v2: "24"`,
  1254×1254 dimensions, and transparency/orientation properties. No image-model ID.
- The `dalle` metadata key and its legacy serialization title are not evidence
  that DALL-E generated this image.
- The original image fetched through the browser also has valid C2PA contents
  labeling `softwareAgent` as `gpt-image`, version `2.0`, with the same default
  trust-store limitation described above.
- Conversation: `https://chatgpt.com/c/6aab0793-3408-83ec-a4fc-ad58fa78fe9e`.
- Image generation ID: `aaf4b4f8-7a50-4817-a49a-2248537fbb53`.

Thus authenticated ChatGPT exposes no more decisive model identity in this
workflow. Its Images 2.5 page title does not establish Sunburst selection, and
matching provenance labels across ChatGPT and Codex do not establish identical
weights. No hidden/internal selector was guessed or injected.

[Codex issue #43965](https://github.com/openai/codex/issues/43965) independently
reports the same selection/metadata ambiguity. Its fetched comments contain no
maintainer clarification; community reports are corroboration, not a contract.

## Complex ChatGPT prompt follow-up

Generated a demanding four-panel lunar-greenhouse engineering poster through the
same authenticated ChatGPT Images composer. The prompt specifies a detailed
isometric cutaway, eight consistently numbered equipment stations, a matching
flow schematic, eight exact equipment-table rows, two labeled technical insets,
fine material detail, and approximately 3840×2560 output. Generation and download
took about 144 seconds including host processing and browser overhead.

| Metadata | Simple circle | Complex poster |
| --- | --- | --- |
| Decoded dimensions | 1254×1254 | 1536×1024 |
| `gen_size` | `smimage` | `xlimage` |
| `gen_size_v2` | `24` | `96` |
| C2PA agent/version | gpt-image / 2.0 | gpt-image / 2.0 |

This is evidence that ChatGPT assigned different internal generation-size
categories for the two requests. These fields are not documented model IDs or
quality settings; `96` should not be interpreted as four times the compute or
proof of Sunburst. The complex result still exposes no serving image-model ID.
Its manifest validates with the same default certificate-trust limitation.

The complex request still selects `gpt-6-pro` with `picture_v2`. WebSocket
message metadata also includes `gpt-5-4-auto-thinking` / `gpt-5-4-thinking`
routing labels; these are chat-side metadata, not identifiers for the image
generator. No visible model switch was made between tests.

Visual inspection: all four panels and eight table rows are present, with
readable technical labels and fine material detail. It adds unrequested slogans,
does not satisfy every geometry/counting constraint, and returns fewer pixels
than requested. Thus the result is detailed but not perfectly prompt-compliant.

- Conversation: `https://chatgpt.com/c/6aab0a07-8b8c-83ec-93e4-a24cf9435471`
- Generation ID: `a11cbbdc-15d5-4ffb-aa11-38459c19b705`
- Prompt, original, metadata, provenance: `imagegen/model-verification/complex-chatgpt/`

## Evidence and remaining verification

Sanitized responses, decoded C2PA manifests, and original probe PNGs are saved
under `imagegen/model-verification/`. Scripts, source snapshots, and full private
headers are under `/tmp/tandem/sunburst-verification/`. Cookies are redacted from
project artifacts; credential headers are not recorded.

OpenAI can resolve the current OAuth serving-model question using the request ID
above. A documented effective-model field or authoritative explanation of the
C2PA version would also resolve it. Authenticated ChatGPT network inspection
is complete but did not expose effective image-model identity. A public API-key request to
the documented dated Sunburst snapshot would exercise supported selection, but
would not retroactively identify the model used by these OAuth requests.
