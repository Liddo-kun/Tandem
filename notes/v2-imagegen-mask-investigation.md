# Masked OAuth black-rectangle investigation — 2026-10-04

## Disposition / master handoff

**The black rectangle reproduced with the original prompt and a conventional alternate mask encoding. The identical original source/mask succeeded when the prompt explicitly requested reconstruction of the entire editable area.** Evidence favors a prompt-sensitive backend masked-generation limitation, not a demonstrated v2 request-construction defect. No application source fix, automatic prompt mutation, mask normalization, or output compositing was made. No deployment is needed for this investigation.

Keep the original masked-preservation failure visible in acceptance. There is now one visually successful masked reconstruction, not a general reliability guarantee. The concrete usable guidance is to describe what must fill **all** of the editable region, including its retained background/geometry, rather than requesting only the new foreground object. This is an observed mitigation, not a proven universal workaround.

Exactly **two additional actual masked imagegen calls** were used, through normal create/prompt/wait agent sessions on the existing isolated `4098` server assigned as PID 659. Both used saved OAuth, `openai/gpt-5.6-sol` conversation sessions, the bundled imagegen skill, and one imagegen call each. No low-level tests/mocks, auth changes, builds, restarts, device controls, commits, production changes, or passing-case reruns. Only this note is a repository change by this worker; the shared ledger and imagegen source remain master/prior-worker owned.

## Exact original evidence

Baseline session `ses_efa824987ffeJ84XND1qW1CRld`, call `call_H1AcBsKQLN9nug48KGDVq1a1`. Inputs and original PNG were independently read and inspected; the defect is present in the original PNG, not introduced by JPEG preview rendering.

Paths below are relative to `/tmp/tandem/v2/acceptance-workspace/`:

| Input | Format | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `reference inputs/green triangle.png` | RGB PNG, 1254×1254 | 724275 | `349843cb011cdcd7ccc36803e08943bfcebfc98903f7413dae3110989601fd10` |
| `reference inputs/center mask.png` | RGBA PNG, 1254×1254 | 9038 | `4ec647ab55d68e6d30bdf3da08c1ea2d41679744d2234702635789e44d0fdcaf` |
| `reference inputs/center mask grayscale alpha.png` | RGBA PNG, 1254×1254 | 9038 | `7641d538f634b5855a2506960bd37d495f2c1f009a718ec019dad9d347c8a68d` |

Both masks have alpha 0 inside inclusive rectangle `(480,510)–(770,800)` (84,681 pixels), alpha 255 elsewhere. Their decoded alpha bytes have identical SHA-256 `04c37a4409d628a459a77ed9fc70d66d26ab411a892dacc17c4182f2937e82d0`.

- Original mask: RGB `(255,255,255)` everywhere, including transparent pixels. It contains **no black RGB**.
- Alternate mask: RGB equals alpha in each channel: transparent black inside, opaque white outside. Prepared with Pillow from the original alpha, equivalent to the public guide's grayscale-to-alpha recipe. This only prepares an input; outputs were never altered.
- The rectangle crosses the triangle's sloping edges near its top. Correct reconstruction therefore needs both green triangle and white background within the editable region.

Baseline prompt (also used verbatim for the alternate-mask call):

> Add one small solid yellow circular dot at the center of the green triangle, confined to the masked editable area. Preserve the surrounding green triangle, its edges, position and dimensions, white background, and framing. No text or other changes.

## Request and output construction

Read `packages/core/src/plugin/tandem/imagegen/{imagegen.ts,plugin.ts,photon.ts,description.md,imagegen-skill.md,README.md}` and the read-only v1 transport at `packages/opencode/src/plugin/openai/imagegen/imagegen.ts:328–384` plus `notes/imagegen.md:97–109` in `/home/jon/code/Tandem`.

- `plugin.ts:118–138` authorizes/resolves source and mask paths and passes them to `ImageGen.run`; no input pixel processing.
- `imagegen.ts:573–593` decodes source/mask to validate dimensions and editable alpha; does not rewrite their bytes.
- `editOAuth` / `oauthOneImage`, lines 278–336, read the source as a PNG data URL in `input[0].content[]` (`type: input_image`). The separate mask is read directly into `tools[0].input_image_mask.image_url` as a PNG data URL. It is not a second reference image and there is no local source/mask flattening.
- Request key shape: `model`, `stream`, `store`, `instructions`, `input`, `tools`, `tool_choice`. Image tool keys: `type:image_generation`, `action:edit`, `size:auto`, `quality:auto`, `background:opaque`, `output_format:png`, `moderation:low`, `input_image_mask:{image_url}`. Endpoint: `https://chatgpt.com/backend-api/codex/responses`. Default host model in source: `gpt-5.5`; no independent runtime host override verification is claimed.
- This request arrangement is retained from v1. V1's prior acceptance already noted a changed editable-strip background, not exact preservation.
- `readImageFromSSE` decodes the completed tool result's base64 PNG; `saveImage` writes those PNG bytes unchanged, then optionally makes a separate display copy. The original PNG cannot acquire this rectangle from the preview encoder.
- No internal image HTTP wire capture was added. These are source-trace findings plus persisted tool inputs/route metadata, **not independent proof of exact wire bytes**. Conversation request dumps are not image transport captures. Tokens and image base64 were never printed.

Public documentation consulted:

- <https://developers.openai.com/api/docs/guides/image-generation>: Responses example puts source in user `input_image` content and mask in the image tool's `input_image_mask`; mask applies to the first source. Requires matching format/dimensions and an alpha channel. Its sample mask conversion copies grayscale into alpha, matching our alternate encoding. Explicitly says masking with GPT Image is entirely prompt-based and mask guidance may not follow the exact shape precisely.
- <https://developers.openai.com/api/docs/guides/tools-image-generation>: image inputs and forced `image_generation` tool choice/action are supported.

These public API docs support the structural contract, but do not certify every behavior of the private Codex OAuth endpoint. No evidence justifies switching fields, inverting alpha, forcing a different model, or returning to native Images for masks.

## Two targeted calls

### 1. Same original mask/source, explicit reconstruction prompt — visual pass

Session `ses_efa78a1f8ffefnhyVJfJkfl2xz`; call `call_06qEvogiEScfZTfl3JPT6jj1`; request ID `2c58ee24-8263-4ea3-afbc-9cfe81e7d869`.

Exact prompt recorded in the persisted tool input:

> Reconstruct the entire masked rectangle seamlessly as the continuation of the original green triangle on white, including the green-to-white triangle edges wherever they cross the rectangle. Then add one small solid yellow circular dot at the triangle center. Every other pixel in the editable rectangle must depict the original continuous green triangle or surrounding white background. The final image must show a complete green triangle on white with one yellow dot, no black area, no rectangle, no patch, no border. Preserve the triangle's original geometry, position, dimensions, and framing. No text.

Original `imagegen/call_06qEvogiEScfZTfl3JPT6jj1.png`, SHA-256 `1153115d00606b48b44af71b3949edf0cae765e594dadc0c8cfcdc4e55c445c0`.

Independent visual read shows a continuous green triangle on white and one yellow dot, no black rectangle. There are **zero** editable-region pixels with all channels below 30. This establishes that the same original mask encoding and retained route can produce a correct-looking result. It does not establish repeatability or pixel-exact preservation.

### 2. Original prompt/source, alternate RGB with identical alpha — visual failure reproduced

Session `ses_efa774694ffe2c3zuaI8FpRdLh`; call `call_Ga46KuPxUQlbHDBJAKwL6WRm`; request ID `95ac3b7f-6ca5-46ff-bfcc-aee51c8e95fd`.

Original `imagegen/call_Ga46KuPxUQlbHDBJAKwL6WRm.png`, SHA-256 `d71a914ed8de624d442dc39f53b0e3baa3d7ea80d4d482274bab4f8ad6dc03c6`.

Independent visual read again shows a yellow dot on a black rectangle matching the editable alpha region. **79,794 / 84,681** editable pixels are below 30 in all channels, versus **80,916 / 84,681** in the baseline. Conventionalizing transparent-pixel RGB therefore did not fix the failure; automatic mask RGB normalization is not supported by this evidence.

### Quantitative comparison and reload

All three originals are opaque RGB PNGs, 1254×1254. All report OAuth `responses`, `action:edit`, quality `low`, background `opaque`, backend-reported model `gpt-image-2-codex`, null generation ID and null changed revised prompt. Null revised prompt does not prove the internal host passed the prompt unchanged.

Mean absolute RGB differences from original source, on the 0–255 scale:

| Case | Inside mask | Outside mask |
| --- | --- | --- |
| Baseline | `(18.141,169.755,9.499)` | `(0.673,1.831,0.947)` |
| Explicit reconstruction | `(9.957,3.488,1.025)` | `(0.683,0.698,0.834)` |
| Alternate mask RGB | `(21.382,167.262,9.477)` | `(0.618,1.623,0.820)` |

Independent API reload confirms all three sessions succeeded, each has one completed imagegen tool with completion time, and only skill/imagegen tools were used. Tested agent sessions did not read images; independent reviewer reads established visual results. The new calls verify the targeted behavior without rerunning the earlier edit/transparency/persistence acceptance matrix.

## Interpretation and limits

The editable-region black fill is reproducible under a preservation-only prompt across white-transparent and black-transparent RGB encodings. Explicitly regenerating the full region removes it using unchanged source/mask bytes and unchanged transport code. Together with the documented prompt-based mask semantics, this fairly establishes a practical backend masked-generation limitation for this case and an observed prompt mitigation.

Whether the private backend first blanks masked source pixels, adds particular mask instructions, or the host/image model interprets preservation incorrectly remains unknown. Those are possible mechanisms, not findings. Two additional calls cannot isolate stochastic effects, quantify reliability, prove byte-exact mask enforcement, or distinguish every private-endpoint contract detail. There is no demonstrated source defect to patch within this assignment.

Master can reference this note in the shared progress ledger: **masked reconstruction demonstrated; ordinary localized-preservation prompt still reproduces unwanted black fill; no transport fix justified; no rebuild required.** The two-call allowance is exhausted.

## Durable evidence locations

Under `/tmp/tandem/v2/`:

- `imagegen-mask-investigation-evidence.json`: compact independently reloaded tool inputs, metadata, IDs, completion times, input/output hashes, dimensions, alpha hashes and pixel comparisons.
- `inspect-mask-investigation.py`: read-only API/artifact evidence collection; no model calls or tests.
- `imagegen-mask-{reconstruct,rgb}-prompt.txt`, matching `-session.txt`, `-messages.json`, and `.log`: normal workflow inputs/results.
- Existing baseline: `imagegen-mask-prompt.txt` and artifacts recorded in `notes/v2-imagegen-live.md`.

All investigation-authored scratch/input files are under `/tmp/tandem/v2`. Public-doc webfetch automatically produced its own screenshot cache under `/tmp/tandem/webfetch`; it was not used for image evidence or device interaction.
