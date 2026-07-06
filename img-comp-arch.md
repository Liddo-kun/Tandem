# `/compact-image` — Implementation Architecture

Accurate to the working tree as of 2026-07-06 (post-sidecar, post-filler-fix, post merge-seam hardening: shared-file logic extracted behind small marked call sites). This describes **what is built**; motivation, empirical evidence, and decision history live in `ImageCompaction-PRD.md`. Tandem-only feature (`UPSTREAM-DIVERGENCE` markers; divergence surface listed in `log.md` under "Image Compaction").

## 1. Concept

`/compact-image` compacts a session by rendering all-but-the-newest turns of live model context into dense PNG "transcript pages" (optical compaction) instead of asking a model to write a summary. The pages are injected as a durable compaction message; the originals leave model context exactly like summary compaction (they stay in storage and the UI timeline). The model subsequently reads its own history off the images at roughly 3:1 token savings with perceptual — not editorial — loss. No model runs during compaction; the whole pipeline is deterministic string/pixel transformation.

Three artifacts protect fidelity:

- **Pages** — the dense PNGs (gist recall).
- **Sidecar** — the raw serialized transcript written to disk, greppable, for exact-string recovery (pixel transcription silently corrupts identifiers; the model is instructed never to trust it).
- **Envelope text** — banner, sidecar pointer, and end marker riding as plain text around the images, telling the resumed model what it is looking at and how to recover verbatim content.

## 2. Module map

Fork-owned core — `packages/opencode/src/session/compaction-image/`:

| File                  | Role                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compaction-image.ts` | Orchestration + Effect service: gate → boundary → serialize → render → sidecar → durable injection. All constants for tail/budget/refusal live here. Also exports pure `summaryGuard` — the manual-`/compact` refusal logic behind `compaction.ts`'s marked call site (§8).                                                                                            |
| `marker.ts`           | Dependency-free leaf holding `PART_MARKER`, so upstream-shared files (`message-v2.ts`) can key on it without importing `compaction-image.ts` (which imports `message-v2` — a cycle otherwise).                                                                                                                                                                         |
| `transcript.ts`       | Message → tagged-text serialization, lockstep role-slot string, deterministic junk passes, cross-message junk state.                                                                                                                                                                                                                                                   |
| `render.ts`           | Reflow (↵ sentinel, tab expansion), wrapping, paging, glyph blitting, role tinting, page geometry. Pure JS.                                                                                                                                                                                                                                                            |
| `png.ts`              | Minimal deterministic PNG encoder (8-bit gray/RGB, filter=None, single IDAT, `CompressionStream("deflate")`). No native deps.                                                                                                                                                                                                                                          |
| `atlas-gray.ts`       | ~4 MB vendored pre-rasterized 5×8 grayscale glyph atlas (Spleen 5×8 + Unifont fallback, 35,501 BMP codepoints, wide-flag table, binary-searched codepoint index). AUTO-GENERATED — the generator (`gen-atlas.ts`) lives in the pxpipe repo, not here. Note: its header's "EVAL-ONLY artifact" line is stale vendored text; in Tandem this **is** the production atlas. |

Integration surfaces (all `UPSTREAM-DIVERGENCE`-marked):

- `packages/core/src/v1/config/config.ts` — `compaction.image.models`, `compaction.image.discard_on_summary`.
- `packages/opencode/src/session/message-v2.ts` — `toModelMessage` suppresses the legacy `"What did we do so far?"` compaction filler when a sibling text part carries `compactionImage` metadata (keyed on `PART_MARKER` from the `marker.ts` leaf — cycle-free).
- `packages/opencode/src/session/compaction.ts` — manual-`/compact` guard call site only; the logic is fork-owned `summaryGuard` (§8 below).
- HTTP: `POST /session/{sessionID}/compact-image` (`groups/session.ts`, `handlers/session.ts`, node registration in `server.ts`); payload `{providerID, modelID}`, result `{ok, message}`; regenerated SDK (`packages/sdk/openapi.json`, `packages/sdk/js/src/v2/gen/*`).
- Clients: web slash command (`packages/app/src/pages/session/use-session-commands.tsx` + `i18n/en.ts`), TUI slash command (`packages/tui/src/routes/session/index.tsx`). The agent picked up for the run is the last user message's agent (falls back to the default agent).
- Display: a user message with a compaction part **and** file attachments renders as one collapsed `<details>` block ("Context imaged — N pages") with `loading="lazy"` page images, so mobile WebViews never eagerly decode dozens of PNGs. The block is the fork-owned component `packages/session-ui/src/components/imaged-context.tsx` (`isImagedContext` + `ImagedContextBlock`); `message-part.tsx` carries only a small marked seam, and the styles are a marked block in `message-part.css`.

Tests: `packages/opencode/test/session/compaction-image.test.ts` (junk passes, serialization/slot lockstep, render determinism and bounds, full `run()` integration, sidecar, carry-forward, gate, refusals, `/compact` guard) and a filler-suppression regression test in `test/session/message-v2.test.ts`. An httpapi-exercise refusal scenario covers the endpoint.

## 3. The `run()` pipeline (`compaction-image.ts`)

`SessionCompactionImage.Service.run({sessionID, providerID, modelID, agent})` → `Result {ok, message}`. Everything before "durable injection" is pure computation; refusals return `ok: false` with a human-readable reason and change nothing.

### 3.1 Model gate

`compaction.image.models` (default `DEFAULT_MODELS = ["claude-fable-5"]`) is a list of model-ID **substrings**; the triggering session model must match one or the command refuses. Dense pages are only reliably readable by allowlisted models — others gist-fail or silently confabulate. The gate holds **only at trigger time**: pages already in a session stay there across later model switches (documented in the refusal text).

### 3.2 Live context and turn boundaries

History is fetched and passed through `MessageV2.filterCompacted` to obtain live model context exactly as a provider request would see it (any previous compaction pair first, then its retained tail, then subsequent turns). Turns are keyed the same way summary compaction keys them: a **user message without a compaction part** starts a turn. Fewer than 3 turns in context → refuse (need ≥2 imaged + a kept tail).

Because imaged messages leave model context entirely, `tool_use`/`tool_result` pairs and thinking signatures inside the range vanish together — nothing can be orphaned.

### 3.3 Tail selection (token-budgeted, whole turns only)

The kept-as-text tail is chosen by walking back from the newest turn under two caps: at most `TAIL_TURNS = 6` turns and `TAIL_TOKEN_BUDGET = 8_000` estimated tokens (`CHARS_PER_TOKEN = 3.3`). On few-giant-turn sessions the turn cap shrinks (`max(1, turnStarts - 2)`) so at least two turns stay imageable.

Per-turn cost estimation (`turnChars`) prices what the **API request** would carry, not just the visible transcript: serialized text/tool-io **plus** reasoning text **plus** thinking-block base64 signatures (weighted at `SIGNATURE_CHARS_PER_TOKEN = 2.5`, converted into 3.3-chars/token units). Reasoning is replayed to the API by `toModelMessage` but deliberately absent from pages and serialization, so without this term it would be invisible to the budget (measured ~13k hidden tokens on one thinking-heavy turn).

The walk only ever moves **whole turns** across the image boundary — never a mid-sentence or mid-tool-call seam. Three cases:

1. Turn fits → keep in tail, continue walking.
2. Turn doesn't fit (the **straddler**) but clearing its oldest completed tool outputs would make it fit → it stays in the tail _softened_: a stub plan (`stubPlan`) selects outputs to clear via the upstream prune mechanism (`state.time.compacted` → rendered as `[old tool result content cleared]`), oldest first, skipping `STUB_PROTECTED_TOOLS = ["skill"]`. The straddler is then **also rendered onto the pages**, so the cleared outputs stay recoverable in pixels. The walk stops there.
3. Turn doesn't fit and can't be softened enough → the tail stops at the turn boundary before it; the turn is imaged intact. Exception: the **newest turn is always kept** as text, softened as far as possible, even when it alone exceeds the budget.

### 3.4 Carry-forward of earlier compactions

If the imaged range contains a previous image-compaction pair, its page `FilePart`s and its pointer text parts (marker `sidecar`, or legacy `factsheet` sheets from v1) are carried onto the new compaction message **verbatim** — pages are never re-rendered from pixels, and every carried page batch keeps its own exact-string recovery path. The old pair itself is skipped from serialization.

### 3.5 Serialization forms and refusal floor

Two serializations of the imaged span are produced by `serializeTranscript` (§4):

- **raw** — no junk passes. Drives the refusal metrics, the before-tokens estimate, and the sidecar.
- **rendered** — junk passes applied (§5). This is what gets reflowed and rasterized.

When a straddler exists, the render/sidecar source additionally includes the straddler turn (`rawRender`); the refusal metrics and carried-page scan stay on the strictly-imaged span. Below `MIN_CHARS = 20_000` raw chars (or zero imaged turns) → refuse; the char floor, not a turn count, is the "not worth a boundary" signal.

### 3.6 Page budget

`carriedFiles + newPages > MAX_PAGES = 40` → refuse, with guidance to run `/compact` (with `discard_on_summary`) instead. Carried pages counting against the cap makes repeated compactions ratchet toward refusal predictably. 40 pages leaves generous headroom under the API's 100-images-per-request limit; each page is well under the 5 MB image cap (~130–200 KB).

### 3.7 Verbatim sidecar

Before any state change, the raw transcript is written to:

```
<Global.Path.data>/compaction/<sessionID>/<compactionMessageID>.txt
```

(`~/.local/share/tandem/compaction/...` in production; tests are isolated because the preload points XDG at a tmp dir.) The compaction message ID is generated early (`MessageID.ascending()`) so the write can fail **before** injection — a failed write defects the run with the session untouched.

Content: a two-line header (span identity + tag legend) and then `stripAnsi(rawRender.text)` — real newlines, ordinarily greppable. Only ANSI is stripped (escape sequences are never identifiers); all content the junk passes elide from the pages — capped outputs, superseded reads, base64 placeholders — is present in full here. The in-context **pointer part** (§6) tells the model the exact path.

### 3.8 Savings estimate and feedback

- Per-page cost: `pageTokens = ceil(width×height / 750)` (Anthropic pixel-area billing; 1568×728 ≈ 1,522 tokens/page). Carried pages are counted flat at 1,522.
- Text parts: `Token.estimate` (chars/4).
- Feedback line (also the receipt text, §6): `Imaged N turns (X chars raw, Y rendered after junk passes) into P pages (+C carried forward) ≈ A tokens (was ≈ B). Tail of T turns kept as text[; straddler note].`

### 3.9 Durable injection

The only state change, and the last thing that happens (event `SessionCompactionEvent.Compacted` published at the end):

1. **User message** (the compaction boundary) with parts in order:
   - `compaction` part (`auto: false`, `tail_start_id` = first tail user message);
   - banner text part (marker `banner`);
   - carried page `FilePart`s, then new pages as `FilePart`s (`data:image/png;base64,...` URLs, filenames `context-page-NN.png`, numbered after the carried ones);
   - carried pointer text parts, then the new sidecar pointer (marker `sidecar`);
   - end-marker text part (marker `end`).
     All text parts are `synthetic: true` with metadata `{compactionImage: <marker>}` (`PART_MARKER = "compactionImage"`).
2. **Fabricated assistant message** paired via `parentID`: `summary: true`, `finish: "stop"`, no error, mode/agent `"compaction"`, zero cost/tokens, no processor or model run. Its text is the receipt: `"Context before this point was compacted into N transcript-page images carried in the preceding message. " + feedback`. This text also becomes `previousSummary` for any later summary compaction.
3. **Straddler clearing last**: only after the pages are durably in place are the planned tool outputs stamped `state.time.compacted` (rendering already read the live outputs).

Why data URLs and not blob files: `Image.normalize` hard-fails on non-`data:` URLs and clients only render data-URL file parts — data URLs are the only form that both reaches the provider and renders everywhere. The estimator-poisoning risk of ~100 KB base64 blobs is contained because `SessionCompaction.select()` hides completed compaction pairs before estimating, and overflow gating uses provider-reported token counts (which bill images by pixels).

## 4. Transcript serialization (`transcript.ts`)

`serializeTranscript(messages, indexOf, junk?)` → `{text, slotText}`.

Tagged form: each message with non-empty serialized body becomes `<user t="N">…</user>` or `<assistant t="N">…</assistant>`, where `t` is the **absolute message index within the full session history** — an explicit recency anchor (the model can tell turn 3 from turn 60 instead of pattern-matching salience).

Part rendering:

- `text` — verbatim (render form: ANSI/base64 stripped, repeated `<system-reminder>` blocks deduped). Ignored/empty parts skipped.
- `tool` — `[tool_use <name>]\n<json args>` + `[tool_result]\n<output>`; error states render `[tool_result (error)]`; interrupted executions get a stub; already-pruned outputs (`state.time.compacted`) render `[old tool result content cleared]`; attachments become `[attachment <mime>: <name>]` lines.
- `file` — `[attachment <mime>: <name>]` (images never render as pixels-of-base64).
- `compaction` — `[context compaction request]`.
- `subtask` — `[subtask → <agent>] <description>`.
- `reasoning` — **dropped** (thinking is not worth pixels; but see §3.3 — its cost is priced into tail selection).

**Slot string**: a width-identical copy of the transcript where every character of the structural role tags is replaced by a C0 marker (`\x01` user, `\x02` assistant) and body content is copied verbatim (any literal `\x01`/`\x02` in body text is neutralized to `\x03`). Because markers share the width class of the tag characters, `reflow`/`wrapLines` mutate text and slot string in lockstep, and the renderer reads role attribution **by position**. A body that literally quotes `"<user>"` can never forge a role tint.

## 5. Junk passes (render form only; deterministic; stored messages never touched)

Numbered per the PRD; state shared across the walk lives in `JunkContext`:

| Pass | What                   | Mechanism                                                                                                                                                                                          |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Already-pruned outputs | `state.time.compacted` → one-line stub                                                                                                                                                             |
| 2    | Superseded reads       | `buildJunkContext` maps older `read`s of the same path (tool `read`, input `filePath\|file_path\|path`) to `[read of <path> superseded by the read at turn N]`; only the newest read keeps content |
| 5a   | Giant outputs          | head 40 + tail 20 lines, `[… N lines elided …]`, only when it saves >20 lines (`OUTPUT_HEAD_LINES`/`OUTPUT_TAIL_LINES`)                                                                            |
| 5b   | Repeated lines         | ≥3 consecutive identical non-empty lines → one + `[repeated ×N]` (`REPEAT_COLLAPSE_MIN`)                                                                                                           |
| 6    | Binary payloads        | data URLs → `[<mime> data-url ~NKB]`; standalone base64 runs ≥240 chars → `[base64 ~NKB]` (`BASE64_RUN_MIN`); applied to tool outputs **and** message text                                         |
| 7    | ANSI/control           | CSI/OSC/lone-ESC sequences stripped (atlas can't render them)                                                                                                                                      |
| 8    | Reminder dedup         | identical `<system-reminder>` blocks keep first occurrence, repeats → `[system-reminder repeated — see first occurrence]`                                                                          |

Passes 3 (stale-by-edit reads) and 4 (state-snapshot tools) from the PRD are **not implemented** (deferred: cross-session edit tracking for marginal savings). Tool outputs get the full chain (`stripAnsi → stripBinaryPayloads → collapseRepeatedLines → capOutputLines`); message text gets ANSI/base64/reminder treatment only.

## 6. The context envelope (what a resumed model sees)

After compaction, `filterCompacted` reorders model context to `[compaction-user, receipt-assistant, tail…]`. Rendered through `toModelMessage`, the compaction user message yields, in order:

1. **Banner** — declares the images are verbatim transcript pages of _prior_ turns (not the current request); reading guide (`↵` = original newline, `→` = tab stop, role tags authoritative, higher `t` = more recent); instruction that exact strings MUST be re-read from disk/tools, with a forward reference to the sidecar pointer. When a straddler exists, an extra bracketed sentence explains that the final imaged turn continues after the images as live text with older outputs cleared.
2. **Pages** — the PNGs (carried batches first, chronological).
3. **Pointer part(s)** — one per page batch: exact sidecar path + "grep it for any string needed exactly; it holds the full pre-elision content, including outputs the pages elided."
4. **End marker** — `[End of imaged context.]`, sealing the archive off from live conversation.
5. **Receipt** (the fabricated assistant message) — the feedback line. Being assistant-voiced keeps user/assistant alternation valid before the tail resumes.

The legacy summary-compaction filler (`"What did we do so far?"`) is **suppressed** for image compactions in `message-v2.ts` (`toModelMessage` checks sibling parts for `compactionImage` metadata); it still renders for plain summary compactions.

## 7. Rendering (`render.ts`, `png.ts`, `atlas-gray.ts`)

**Geometry.** 312 columns × 5 px/cell + 2×4 px padding = **1568 px wide exactly**; page height ≤ 728 px (90 rows of 8 px + padding); ≤ `CHARS_PER_PAGE = 28,080` source chars per page. The Anthropic API downscales any image to fit both long-edge ≤1568 **and** ~1.15 MP before billing ≈ px/750 — a 1568×728 page fits both bounds, so billed pixels reach the vision encoder unresampled (WYSIWYG glyphs). 313 columns would trigger a 0.997× resample that blurs every glyph.

**Reflow.** `reflow()` = neutralize (any pre-existing `↵` in content becomes `⏎` so the sentinel stays unambiguous — necessary when the transcript is _about_ image compaction) → minify (strip trailing whitespace per line, collapse ≥4 blank lines to 3; leading indent untouched) → expand tabs to a visible `→` + padding to 4-col stops (U+0009 has no glyph) → join lines with the `↵` sentinel. `wrapLines` then wraps to 312 columns by **visual width** (East Asian Wide glyphs advance 2 cells; codepoint iteration handles surrogate pairs).

**Blitting.** For each glyph, binary-search the codepoint table (`atlasGrayRank`), max-blend its coverage bytes into a grayscale framebuffer, invert to black-on-white, then tint pixels whose lockstep slot marker names a role: green for `<user>` tags, blue for `<assistant>` tags; body ink stays black. Codepoints missing from the atlas advance one cell (wrap stability) and increment `droppedChars` (telemetry on `RenderedPage`).

**Encoding.** `encodeRgbPng`: 8-bit truecolor, filter None on every scanline, one zlib IDAT via `CompressionStream("deflate")`, CRC32 handrolled. No timestamps anywhere → same input text ⇒ **byte-identical PNGs** (asserted in tests), so exact request retries stay prompt-cache-friendly.

**Atlas.** Pre-rasterized at build time in pxpipe (Spleen 5×8 for ASCII/code, Unifont fallback, full BMP: 35,501 codepoints), stored as four base64 blobs decoded once at module init (~4 MB source file). Regenerating it requires pxpipe's `gen-atlas.ts`; Tandem treats it as a vendored artifact.

## 8. Interplay with summary compaction (`compaction.ts`)

A later summary compaction neither sees nor carries imaged pages (`completedCompactions` hides the prior pair from the summarizer's input; `stripMedia` drops images anyway), so its fresh boundary would silently drop them from context. Therefore:

- **Manual `/compact`** over an active image compaction **refuses**: it emits an errored compaction assistant message ("This session was image-compacted…") visible in every client, and stops. Implementation: pure `summaryGuard` (compaction-image.ts) returns the errored assistant message or `undefined`; `processCompaction` persists it and stops — the shared file carries only the marked import + call site.
- **Escape hatch**: `compaction.image.discard_on_summary: true` lets manual `/compact` proceed (and is what the page-cap refusal recommends).
- **Auto/overflow compaction always proceeds** — availability beats preservation when context is actually full.

Conversely `/compact-image` composes fine over prior compactions of either kind: previous summary pairs are simply part of live context (their compaction-user messages don't start turns), and previous image pairs are carried (§3.4).

## 9. Constants reference

| Constant                                  | Value                | Where                                                | Meaning                                                                             |
| ----------------------------------------- | -------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `DEFAULT_MODELS`                          | `["claude-fable-5"]` | compaction-image.ts                                  | model-gate substrings (config `compaction.image.models`)                            |
| `TAIL_TURNS`                              | 6                    | compaction-image.ts                                  | max text-tail turns                                                                 |
| `TAIL_TOKEN_BUDGET`                       | 8,000                | compaction-image.ts                                  | text-tail token budget                                                              |
| `CHARS_PER_TOKEN`                         | 3.3                  | compaction-image.ts                                  | tail estimator (measured on code-heavy sessions)                                    |
| `SIGNATURE_CHARS_PER_TOKEN`               | 2.5                  | compaction-image.ts                                  | thinking-signature weight                                                           |
| `MIN_CHARS`                               | 20,000               | compaction-image.ts                                  | refusal floor (raw chars imaged)                                                    |
| `MAX_PAGES`                               | 40                   | compaction-image.ts                                  | page cap incl. carried pages                                                        |
| `PART_MARKER`                             | `"compactionImage"`  | marker.ts (leaf; re-exported by compaction-image.ts) | metadata key on synthetic text parts (`banner`/`sidecar`/`end`; legacy `factsheet`) |
| `STUB_PROTECTED_TOOLS`                    | `["skill"]`          | compaction-image.ts                                  | never stub-cleared (mirrors `PRUNE_PROTECTED_TOOLS`)                                |
| `OUTPUT_HEAD_LINES` / `OUTPUT_TAIL_LINES` | 40 / 20              | transcript.ts                                        | junk-pass 5a cap                                                                    |
| `REPEAT_COLLAPSE_MIN`                     | 3                    | transcript.ts                                        | junk-pass 5b threshold                                                              |
| `BASE64_RUN_MIN`                          | 240                  | transcript.ts                                        | junk-pass 6 threshold                                                               |
| `COLS`                                    | 312                  | render.ts                                            | columns per page                                                                    |
| `MAX_HEIGHT_PX`                           | 728                  | render.ts                                            | page height ceiling                                                                 |
| `CHARS_PER_PAGE`                          | 28,080               | render.ts                                            | paging granularity                                                                  |
| `PIXEL_TOKEN_DIVISOR`                     | 750                  | render.ts                                            | Anthropic pixels-per-token                                                          |

## 10. Recovery workflows (operational)

- **Exact strings**: grep the sidecar named in the pointer part. It is a superset of what the pages show (pre-elision).
- **Re-reading page regions**: pages are stored as data-URL file parts; they can be extracted from the `part` table and cropped/upscaled (2× nearest-neighbor makes dense regions fully readable to an allowlisted model). No first-class tooling for this yet — deliberately skipped in favor of the sidecar.
- **Originals**: never deleted; full messages remain in the session DB and UI timeline regardless of compaction.

## 11. Known limits and sharp edges

- **Model-gate temporal hole**: pages persist across later switches to non-allowlisted models, which may read them poorly. Accepted; documented in the refusal text.
- **Multiple pointer parts** after repeated compactions aren't explicitly mapped to their page batches; the intended use is "grep all listed sidecars," which is cheap.
- **Sidecar is machine-local**: it doesn't travel with a synced/shared session. The raw material to regenerate it (original messages) does, but no regeneration tool exists yet.
- **Reasoning is unrecoverable by design**: dropped from pages and sidecar both; only its token weight is modeled.
- **`atlas-gray.ts` regeneration** depends on the external pxpipe repo, and its auto-generated header still carries pxpipe's "EVAL-ONLY" note despite being Tandem's production atlas.
- **Estimates are heuristics**: chars/4 for text, chars/3.3 for tail turns, px/750 for pages — good enough for feedback lines and budget walks, not exact billing.
