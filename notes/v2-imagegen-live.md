# Imagegen bounded live acceptance — 2026-10-04

## Result

**Native reference editing, native transparent generation, persisted terminal results, text-only model results, and the explicit unsupported mask+transparent rejection passed. Masked Responses transport completed, but the localized edit failed visual acceptance: it added an unwanted black rectangle around the requested yellow dot.** Do not mark masked editing fully accepted.

Used the existing isolated server at `http://127.0.0.1:4098` (assigned PID 659), saved separate `tandem-openai-images` OAuth and normal `openai` conversation login. All four agent sessions selected `openai/gpt-5.6-sol`, used normal create/prompt/wait through `/tmp/tandem/v2/live-session.py` (`api`/`unwrap`), and ran in `/tmp/tandem/v2/acceptance-workspace`. Each loaded the bundled imagegen skill and called imagegen exactly once, without retries or image reads. All four are idle with session outcome `succeeded`; the deliberately invalid case has tool status `error`, as expected.

No application source changes or rebuild are needed for the passing cases. No demonstrated client transport defect was isolated for the masked visual failure, so no speculative fix was made. Master should retain this failure as an open acceptance item. No builds, restarts, browser/device controls, low-level tests, authentication changes, or daily-key copies were performed.

## Inputs and prior acceptance

- Prior metadata-omission-fix acceptance, supplied by master: session `ses_efa948758ffeCT7sSxxpfvTwNX`, call `call_qK9YR9s9qryUB6JTUwZLb5y0`, completed original PNG 1254×1254, metadata 1186 bytes, text-only output, next conversation request zero input images.
- Copied that green-triangle-on-white original byte-for-byte to `/tmp/tandem/v2/acceptance-workspace/reference inputs/green triangle.png`. Actual input paths containing spaces were passed to the tool in the reference, mask and validation cases.
- Created one mask at `/tmp/tandem/v2/acceptance-workspace/reference inputs/center mask.png`: RGBA PNG, 1254×1254 matching source, alpha 255 outside inclusive rectangle `(480,510)–(770,800)`, alpha 0 inside, 84,681 editable pixels. Alpha extrema `(0,255)`. This was input preparation with Pillow, not a low-level test or a substitute for live image generation.

## Sessions and artifacts

All artifact paths below are relative to `/tmp/tandem/v2/acceptance-workspace/`.

| Case | Session | Tool call | Persisted result |
| --- | --- | --- | --- |
| Native reference edit | `ses_efa818c15ffextwN56UUOZ5qjz` | `call_YUZUxdDcvkkj1ZutUbtKucy4` | completed, OAuth `images`, PNG/JPEG 1254×1254 |
| Native transparent generation | `ses_efa82496affe5shSDCeICCiAkR` | `call_vuWt8hF5rOPDdqlrvI1qOJGa` | completed, OAuth `images`, PNG/WebP 1312×1199 |
| Masked edit | `ses_efa824987ffeJ84XND1qW1CRld` | `call_H1AcBsKQLN9nug48KGDVq1a1` | completed, OAuth `responses`, PNG/JPEG 1254×1254; visual failure |
| Mask + transparent validation | `ses_efa824971ffe7MpM6rdZKSUUSt` | `call_ftvKGxrFiEHBlFJ0JfSnvwRS` | error, expected rejection, no artifact |

### Native reference edit — pass

Requested only green → royal blue, preserving triangle geometry, position, white background and framing. Independent visual inspection confirms a blue triangle on white with the original composition preserved. Original and display images are opaque RGB, same 1254×1254 dimensions.

- Original: `imagegen/call_YUZUxdDcvkkj1ZutUbtKucy4.png`; display: same stem `.jpg`.
- Backend-reported quality `low`, background `opaque`; no reported model, no invented serving-model claim.
- Request ID `9461d103-24b2-4abc-86b5-486b7d492f29`; generation ID `1ef09b60-838d-4af5-9838-884aa1282fdc`.

### Native transparency — pass

Requested a polished red ceramic apple with brown stem and green leaf, isolated on native transparency. Independent visual inspection shows the requested apple. Pillow verifies **real alpha**, not a checkerboard depiction:

- Original: `imagegen/call_vuWt8hF5rOPDdqlrvI1qOJGa.png`; display: same stem `.webp`.
- PNG and WebP both RGBA, 1312×1199, alpha extrema `(0,255)`.
- Both have 1,038,003 fully transparent pixels, 534,798 partial-alpha pixels, and 1,572,801 total nonopaque pixels. Most foreground alpha is 253 (470,456 pixels); this is genuine partial alpha, not an entirely opaque foreground. No local background removal or image alteration was performed.
- Backend-reported quality `medium`, background `transparent`; no reported model.
- Request ID `42833da5-c541-4eae-8aff-6791696cac86`; generation ID `e98e0fe7-ebae-4a7c-aea5-73d8ecba01ab`.

### Masked Responses edit — transport/persistence pass, visual failure

Requested a single small yellow dot at the triangle center, restricted to the editable region, preserving the surrounding triangle and white background. The output has the yellow dot **on an unwanted black rectangle corresponding to the editable mask region**. Triangle and background outside that region remain broadly visually recognizable, but are not pixel-identical.

- Original: `imagegen/call_H1AcBsKQLN9nug48KGDVq1a1.png`; display: same stem `.jpg`, both RGB 1254×1254, opaque.
- 80,916 of 84,681 editable pixels have all RGB channels below 30. Mean absolute RGB difference outside the mask is approximately `(0.673, 1.831, 0.947)` on a 0–255 scale; inside it is `(18.141, 169.755, 9.499)`.
- Persisted metadata explicitly reports transport `responses`, action `edit`, quality `low`, background `opaque`, backend-reported model `gpt-image-2-codex`.
- Request ID `1f0ad26e-8a11-4be8-9516-d6b04a351c20`; generation ID unknown/null.
- Source tracing in `imagegen.ts:278–336` shows the source sent as Responses `input_image`, the original PNG mask encoded without transformation into `tools[0].input_image_mask.image_url`, and the Responses endpoint selected. This pass did **not** capture the plugin's internal image HTTP request body; integrated request dumps cover conversation requests. Exact wire mask bytes are therefore not independently captured/verified. The live mask input, route metadata and spatially matching artifact provide evidence of the path, not proof of its root cause.
- This one observed failure does not establish whether the issue is backend mask processing, generation fidelity, or a transport-contract mismatch. No automatic retry or client-side compositing concealed the result. Further targeted mask investigation is needed before acceptance.

### Unsupported mask + transparent — pass

Called the actual tool with the valid source/mask and `transparent:true`. It persisted this exact error:

> Masked OAuth edits with transparency are unsupported by the retained Responses route; no generation was attempted

No artifact was returned. Source has the explicit guard before image transport. The agent reported the error and stopped, without changing inputs or retrying.

## Persistence and model-context isolation

After waiting, independently fetched each session and its messages again. Each successful imagegen call retains `state.status:"completed"`, populated JSON-safe metadata and `time.completed`; the invalid call retains `error` and completion time. Sessions have idle timestamps. The evidence uses the tool part's `time`, not a nonexistent `state.time`.

Successful tool results contain one text part each, no attachment/image/base64/data URI. JSON-serialized metadata/content sizes with Python's default spacing:

| Case | Metadata bytes | Content bytes |
| --- | ---: | ---: |
| Reference | 546 | 294 |
| Transparent | 555 | 298 |
| Mask | 563 | 340 |

Inspected all three attributed final-send conversation requests per session under `/tmp/tandem/v2/request-dumps/integrated-2/`: **zero image objects and zero `data:image/` strings in all twelve**. The final request in each success session includes the saved-image text result; the validation session's final request includes the expected error. Thus result isolation is verified through a real subsequent model call, including the reference/mask cases whose source image bytes belong only in the image transport.

Final request files:

- Reference: `1791093561759-5f64255a-d5e9-4458-95fc-bf9431a582b0.json`
- Transparent: `1791093530115-c2368a35-1122-4759-902f-fd24e28bbb61.json`
- Mask: `1791093519119-20a86cdc-09cd-4a56-9f68-c49aeeb2b792.json`
- Validation: `1791093496714-33823e83-6822-4de9-b7ce-8fcec9af4ba2.json`

Reviewer image reads occurred in this acceptance worker, not in the tested server sessions. UI thumbnail/lightbox preview isolation was not exercised because browser/device actions were excluded.

## Evidence files

Under `/tmp/tandem/v2/`:

- `imagegen-live-evidence.json` and `.log`: compact session outcomes, tool inputs/status/timestamps/metadata, artifact dimensions/alpha counts, attributed request checks and mask pixel comparison.
- `imagegen-{reference,transparent,mask,mask-transparent}-reloaded.json`: independent API reload snapshots of sessions/messages.
- Matching `-prompt.txt`, `-session.txt`, `-messages.json` and `.log` files: original prompts and helper evidence.
- `inspect-imagegen-acceptance.py`: read-only API/artifact/request-dump inspection script.

An initial one-second tool-shell timeout interrupted waiting/collection; inspection established that three sessions were already admitted and running, so those were waited/reloaded rather than recreated. Reference had not been created and was subsequently created normally. The final four sessions each contain exactly one imagegen call; no duplicate generation was submitted.

## True limits and unverified work

- All calls used OAuth. API-key mode was not exercised; no API key was supplied or imported. Existing active schema exposed OAuth controls. Stored/environment-key priority and API controls remain unverified by this pass.
- OAuth dimensions/quality remain backend-managed. Observed sizes and quality above are returned facts, not guarantees; native serving model remains unknown. The mask's model value is explicitly backend-reported.
- Masked edit visual quality remains failed/open. Masks are not a pixel-exact preservation guarantee.
- Transparent reference editing, multiple references, other mask validation failures, save collisions, forced token expiry/refresh/rotation, credential/schema switching, opt-out/availability permutations and user skill override were not exercised.
- Several calls overlapped with current valid credentials; this does not verify concurrent expired-token refresh safety.
- UI card/lightbox/reload/mobile acceptance and browser-preview context isolation remain master-owned/unverified here. No revised prompt was returned, so revised-prompt presentation is unverified.
- This pass neither repairs nor reclassifies the historical stuck first-generation tool record. It verifies new records with the rebuilt metadata omission fix.
