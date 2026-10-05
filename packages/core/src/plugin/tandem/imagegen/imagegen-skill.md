# Image generation

Use `imagegen` to generate or edit raster images. Prefer SVG/HTML/CSS for deterministic diagrams, simple shapes, and existing vector systems.

## Parameters

- `prompt`: concrete description of the desired result or edit.
- `image_paths`: up to 10 local source/reference images. Omit for text-only generation. Include references even when creating a new composition; identify each image's role in the prompt.
- `mask_path`: optional PNG with alpha, matching the first source image's dimensions. Transparent areas mark the editable region. Applies to the first image; requires `image_paths`. Masks guide the model, not pixel-exact compositing.
- `transparent`: true for native alpha output; false (opaque) by default. Works for generation and edits. No chroma-key background or local removal is needed.

**OAuth:** these are the only four controls. The retained legacy Codex transport selects the image model, quality, and dimensions automatically. Describe the desired aspect ratio, composition, and level of detail in the prompt; exact dimensions are not guaranteed. No automatic resize or crop is applied. Generation and ordinary edits use native Codex Images. Masked edits use Responses because native masks cannot be relied on. Masked transparent OAuth requests are rejected explicitly.

**Image login:** OAuth uses the separate **OpenAI Images (ChatGPT)** integration. The normal ChatGPT conversation login uses token sharing and does not enable this tool. Connect the image integration through its browser/manual callback flow, or supply an OpenAI API key. Stored OpenAI keys take priority over `OPENAI_API_KEY`, then the separate image login. Conversation credentials are never sent to image endpoints.

**API-key sign-in:** the public Images API requests GPT Image 2.5 Sunburst and exposes these additional controls in the tool schema:

- `width`, `height`: required pixel dimensions, each a positive multiple of 16 and at most 3840. Aspect ratio between 1:3 and 3:1; total pixels 655,360–8,294,400. Examples: 1024×1024, 1536×864, 2048×2048, 3840×2160. Above 3,686,400 pixels is experimental.
- `quality`: `medium`, `high` (default), `xhigh`, or `max`.

Only pass controls exposed by the current tool schema. Do not claim a specific serving model on ChatGPT sign-in.

## Prompting

Write a complete prompt from the user's intent. Preserve their words exactly when requested. Add useful composition, lighting, material, and intended-use details without inventing unrelated objects or creative requirements. Plain prose or a short labeled spec both work; no mandatory template.

- Specify subject, composition/framing, style, visible details, and important constraints.
- For exact text, quote it and specify placement, typography, and whether additional text is forbidden. Inspect spelling and legibility afterward.
- For reference images, state each role: subject/identity, style, clothing, background, or layout. Explain how to combine them.
- For edits, say **change only X; preserve Y**. Name critical identity, geometry, labels, framing, lighting, and layout constraints. Restate them on subsequent edits.
- For masked OAuth edits, describe the complete intended appearance of the editable region, including its background and preserved details. Short change-only prompts have produced unwanted black fill; explicit full-region reconstruction avoided it in a live check. Inspect the result when local fidelity matters.
- Pass the prior full-quality PNG as the next edit input. Make one targeted change at a time. If a region must remain pixel-identical, composite the approved edited region into the original programmatically.
- For transparency, describe the subject and request preserved fine edges/soft shadows where appropriate. Repeat transparency requirements on edits; inspect actual alpha rather than trusting a checkerboard appearance.

Each call produces one image. A shared sheet can suit related assets when it provides enough detail; request separation and margins if elements will be cropped. Use separate calls for independent compositions or assets needing individual resolution/control. Independent calls may run in parallel.

## Examples

Generate:
`imagegen({ prompt: "Wide landscape studio photograph of a blue ceramic mug, soft side lighting, fine ceramic texture, no text" })`

Edit:
`imagegen({ prompt: "Change only the mug's glaze to red; preserve its geometry, lighting, and framing", image_paths: ["/abs/path/mug.png"] })`

Cutout:
`imagegen({ prompt: "An isolated glass perfume bottle with a silver cap, preserve translucent glass and fine edges", transparent: true })`

These examples use the OAuth-shaped schema and require the separate OpenAI Images (ChatGPT) login. With an API key, also supply `width` and `height`, and optionally `quality`.

## Results

The tool saves the original PNG under `imagegen/` in the session directory, plus a smaller same-dimension JPEG (observed opaque) or WebP (observed alpha) when useful. It returns both the display path and original PNG path. The UI fetches a thumbnail separately, so image bytes do not enter model context automatically.

Use `read` to inspect results when necessary. Report the saved path; do not claim details you haven't checked. For project assets, place the appropriate original/copy at its intended location and wire up references.

The output reports actual dimensions and quality when the backend supplies it. Missing quality remains unknown. API-key output notes discrepancies from requested settings. Available request/generation IDs are retained in metadata for tracing. OAuth masked edits use a host model; a changed reported prompt is surfaced as “Image prompt used.” Treat that as the rendering prompt, not the host model's prose.

On errors, report the concrete failure and correct the invalid input or request. Do not retry an unchanged rejected request.
