<!--
  Built-in skill body for the Tandem imagegen tool. Name and description are
  registered in code at packages/opencode/src/plugin/openai/imagegen/imagegen.ts
  (ImageGen.SKILL); the skill is gated on the same OpenAI-cred check as the tool.
-->

# Image Generation Skill

Guidance for the Tandem `imagegen` tool, which **generates or edits raster images** via OpenAI's image models and **saves a PNG to disk, returning its file path**.

**No transparency:** output is opaque PNG, so don't promise an alpha/transparent cutout. If the user needs one, generate the subject on a flat solid background they can key out in their own editor.

## When to use

- Generate a new image (concept art, product shot, hero image, illustration, sprite, texture, infographic, mockup).
- Generate using one or more images purely as **style/composition/mood references**.
- Edit an existing image (object removal/replacement, recolor, lighting/weather change, background replacement, compositing, restyle).
- Produce several variants or several distinct assets for one task.

## When not to use

- Extending or matching an existing SVG/vector icon set, logo system, or illustration library in the repo.
- Simple shapes, diagrams, wireframes, or icons that are cleaner as SVG/HTML/CSS/canvas.
- A small project-local asset edit when an editable native source already exists.
- Any task where the user clearly wants deterministic, code-native output instead of a bitmap.

## Two questions before you call

1. **Intent — generate or edit?**
   - User wants to modify an existing image while preserving parts of it → **edit** (pass `image_paths`).
   - User provides images only as references for style/composition/mood, or provides none → **generate** (no `image_paths`).
2. **Execution — one asset or many?**
   - One image per concept → one call.
   - Several **distinct** assets → one call **per asset** with its own prompt. Do **not** use `n` for distinct assets; `n` is only for variants of a single prompt.
   - Many variants of the same concept → a single call with `n` > 1 (kept small).

Assume the user wants a new image unless they clearly ask to change an existing one.

## Author the prompt yourself

Turn the user's request into a complete, concrete image prompt — don't just pass their words straight through, unless the user asks you to.

**Specificity policy:**

- If the user's prompt is already specific and detailed, **normalize** it into a clean spec without inventing new creative requirements.
- If the user's prompt is generic, add **tasteful** detail only where it materially improves the result.

**Allowed augmentation** (for generic prompts): composition/framing cues, intended-use or polish-level hints, practical layout guidance, reasonable scene concreteness that supports the request.

**Do not add:** extra characters, props, or objects that aren't implied; brand palettes, slogans, or story beats that aren't implied; arbitrary left/right placement the layout doesn't support.

## Editing

- Edit mode triggers when `image_paths` is present. Inputs must be **local file paths** (this tool does not read images out of the chat). If the only copy of the target lives in the conversation and has no file on disk, save it to a path first, then pass that path.
- Use `mask_path` (a PNG whose transparent areas mark the editable region) **only** when the change must be constrained to part of the image; it applies to the first image and is prompt-guided, not pixel-exact.
- State invariants aggressively: `change only X; keep Y unchanged`, and repeat them on every iteration to reduce drift.
- Saving is non-destructive (the tool writes a new file); don't overwrite a user asset unless asked.

## Use-case taxonomy (pick one; keep wording consistent)

Generate: `photorealistic-natural`, `product-mockup`, `ui-mockup`, `infographic-diagram`, `scientific-educational`, `ads-marketing`, `productivity-visual`, `logo-brand`, `illustration-story`, `stylized-concept`, `historical-scene`.

Edit: `text-localization`, `identity-preserve`, `precise-object-edit`, `lighting-weather`, `background-replace`, `style-transfer`, `compositing`, `sketch-to-render`.

## Prompt scaffolding

Shape the `prompt` as a short labeled spec — use only the lines that help:

```text
Use case: <taxonomy slug>
Asset type: <where the asset will be used>
Primary request: <the main subject/action>
Input images: <Image 1: role; Image 2: role>   (edit/reference only)
Scene/backdrop: <environment>
Subject: <main subject>
Style/medium: <photo / illustration / 3D / etc.>
Composition/framing: <wide / close / top-down; placement; negative space>
Lighting/mood: <lighting + mood>
Color palette: <palette notes>
Materials/textures: <surface details>
Text (verbatim): "<exact text>"
Constraints: <must keep / must avoid>
```

`Asset type` and `Input images` are prompt scaffolding, not tool arguments. Keep it tight; for edits, list invariants explicitly.

## Prompting best practices

- Order: scene/backdrop → subject → key details → constraints → intended use.
- Include intended use (ad, UI mock, infographic) to set polish level.
- Use camera/composition language (lens, framing, lighting) for photorealism; call for real texture (pores, fabric wear, material grain) when realism matters.
- Put literal in-image text in quotes or ALL CAPS, specify typography and placement, and require **verbatim** rendering; spell uncommon words letter-by-letter. Prefer `high` quality for dense text, legends, axes, and small labels.
- Reference multiple input images by index and say how each is used (`place the subject from Image 2 into Image 1`).
- Iterate with one targeted change at a time, re-stating critical constraints; don't rewrite the whole prompt each round.

## Examples

Generation:

```text
Use case: product-mockup
Asset type: landing-page hero
Primary request: a single ceramic coffee mug on a clean surface
Style/medium: clean studio product photography
Composition/framing: wide, with usable negative space on the right for headline copy
Lighting/mood: soft diffused studio light, gentle shadow
Constraints: no logos, no text, no watermark
```

Call: `imagegen({ prompt: "<the spec above>", size: "1536x1024", quality: "high" })`

Edit:

```text
Use case: precise-object-edit
Primary request: replace only the background with a warm sunset gradient
Constraints: change only the background; keep the mug and its edges unchanged; no text; no watermark
```

Call: `imagegen({ prompt: "<the spec above>", image_paths: ["/abs/path/mug.png"] })`

## After the call: output handling

- The tool returns the **saved file path(s)** as text. The image is **deliberately not loaded into your context** (a full PNG would bloat context and be resent every turn), so you have not "seen" it.
- If you genuinely need to inspect the result (verify text, composition, an invariant), use the `read` tool on the returned path — that loads the image.
- **Report the saved path(s)** to the user. Do not invent a description of contents you haven't viewed, and don't claim success on details you can't confirm.
- If the asset is meant for the current project, move/copy it from the returned path into the workspace (the tool controls where it's saved) and wire up any references. Don't leave a project-bound asset only at the tool's default path.
- On OAuth, the model may report a slightly adjusted "prompt used"; the tool surfaces it only when it differs from yours — treat that as the source of truth for what was rendered, not the prose.
- **Size is best-effort on OAuth.** With an OpenAI API key the requested `size` is exact. With ChatGPT (OAuth) sign-in the image backend ignores `size` and auto-sizes from the prompt, so the tool reports the **actual** pixel size and flags when it differs from what you asked for — don't re-call with the same `size` expecting a different result; steer aspect ratio through the prompt (e.g. "wide landscape", "tall portrait", "square") instead.

## Errors

The call fails with a clear message for: missing credentials, content-policy/moderation rejection, invalid size, missing/oversized `image_paths`, or network/auth failure. Surface the message and adjust (rephrase the prompt, fix the path, pick a supported size) rather than retrying verbatim.
