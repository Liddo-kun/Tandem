# PRD: `/compact-image` — Image-Based Context Compaction

Status: implemented (v1, 2026-07-06 — see §12 Implementation notes). Owner: Jon. Target: `packages/opencode` (+ small `packages/session-ui` display work).
Read `contextL.md` and `log.md` before starting. This is a Tandem personal enhancement (`personal:` commit prefix, `UPSTREAM-DIVERGENCE` comments, update `log.md` when the divergence surface changes).

## 1. Summary

Add a manually triggered slash command, `/compact-image`, that compacts the current session's context by rendering older conversation turns into dense PNG images ("optical compaction") instead of asking a model to write a summary. The model then reads prior context off the images at roughly 3× fewer tokens, with uniform perceptual fidelity loss instead of editorial loss.

This is a native, in-process reimplementation of the effect demonstrated by the pxpipe proxy (github.com/teamchong/pxpipe) on 2026-07-05. **No runtime dependency on pxpipe, no proxy, no `ANTHROPIC_BASE_URL` redirection** — rendering happens inside the Tandem server and the imaged pages become durable session content. pxpipe is MIT-licensed; vendoring/adapting its pure-JS renderer (`src/core/render.ts`, `atlas.ts`, `png.ts`) with attribution is an acceptable implementation path (Option A), as is a clean implementation (Option B). A local clone exists at `~/code/pxpipe` for reference.

## 2. Motivation and evidence (measured on this machine, 2026-07-05)

- A 252,654-token session (baseline, measured via `count_tokens`) was served in ~37k tokens when history was imaged: **~85% reduction**, 30 pages.
- Gist fidelity was **4/4** on an adversarial recall quiz across imaged history (decisions, structure, repeated values, file contents).
- Verbatim fidelity was **2.5/4**: a session ID misread (`O`→`0`, `0J2`→`32` glyph confusions), and a source line confabulated by language prior (`sys.environment(model),` recalled as `sys.environment(model())`) — **at high self-reported confidence**. Misses are silent and plausible, never flagged.
- Summary compaction is editorial loss (unrecoverable, compounding, costs output tokens at 5×); image compaction is perceptual loss (everything present at gist fidelity, deterministic, no model in the loop). They compose: image at ~3:1 now, summarize much later or never.
- Jon runs with `compaction.auto: false` precisely because summaries discard the wrong things. This feature is the compaction he actually wants.

These findings drive hard requirements §5.4 (verbatim sidecar) and §5.5 (model gate).

## 3. Goals / Non-goals

Goals:

- Manual `/compact-image` command available in TUI and web/mobile UI (server-side command registry, so all clients get it).
- All-but-recent-tail turns rendered to dense PNG pages, injected as a durable synthetic message; original messages excluded from future model context exactly like existing summary compaction (they remain in storage and UI).
- Verbatim transcript sidecar on disk, with a pointer carried as text alongside the images (v2; v1 shipped an in-context fact sheet — see §12).
- Report savings to the user (turns imaged, pages, estimated tokens before/after).

Non-goals (explicitly out of scope for v1):

- Automatic/threshold-triggered image compaction.
- Per-request reversible imaging (that's the proxy's trick; this is real compaction).
- Progressive-resolution "fading memory" gradients (interesting follow-up, not v1).
- Imaging tool_results in live turns, system-prompt imaging, or any wire-level transformation.
- GPT/Gemini support. v1 is Anthropic-model-only, gated (§5.5).

## 4. UX

1. User types `/compact-image` in any client. No arguments in v1 (optional `keep <N>` tail override is a stretch goal).
2. Server renders, injects, and replies with a feedback line in the session, e.g.:
   `Imaged 212 turns (241,830 chars raw, 168,400 rendered after junk passes) into 28 pages ≈ 34,900 tokens (was ≈ 236,400). Tail of 4 turns kept as text.`
3. The session timeline shows a compact block ("Context imaged — 28 pages", expandable to view pages) instead of 28 raw image bubbles. Keep this display work minimal and shared (`packages/ui/src/components/message-part.tsx` `PART_MAPPING`, collapse UI in `basic-tool.tsx` conventions — see contextL "Tool Call Display").
4. On unsupported models the command replies with a refusal + explanation instead of degrading silently.

## 5. Functional requirements

### 5.1 Command

- Register `/compact-image` beside the built-in `/compact`. Find the existing command registry by locating how `/compact` is defined and surfaced to the web composer's slash popover; mirror that wiring. Both TUI and web must list it.

### 5.2 Boundary selection

- Cut at a **user-turn boundary** (same rule as summary compaction's tail selection — `compaction.ts` `turns()` keys on user messages): the imaged range ends where the kept tail's first user message begins. Imaged messages leave model context entirely, so `tool_use`/`tool_result` pairs and thinking signatures inside the range vanish together — nothing can be orphaned. Do **not** port pxpipe's `findClosedPrefixBoundary`; it exists only because the proxy must splice its imaged span back into a live wire request (§7's stateless-proxy problem).
- Keep a text tail of the last **4 turns** (constant in v1).
- Minimum: refuse (with a friendly message) if fewer than ~10 turns or below ~20k chars would be imaged — not worth a boundary.
- If a previous `/compact-image` message exists in range, carry its image parts forward untouched — never re-render images of images, never OCR-launder previous pages.

### 5.3 Transcript serialization and rendering

- Serialize imaged turns as a tagged transcript: `<user t="N">…</user>` / `<assistant t="N">…</assistant>` with absolute turn indices; include tool_use args and tool_result content; drop thinking blocks. Reference: pxpipe `history.ts` `blocksToText`.
- Reflow before rendering: pack soft-wrapped lines, mark hard newlines with a visible `↵` sentinel (pxpipe-validated: +1pp char accuracy, removes blank-row waste on newline-heavy transcripts).
- Rendering must be **pure-JS at runtime under Bun** (pre-rasterized glyph atlas + PNG encoder; no native canvas dependency — the server runs on the tablet). Use pxpipe's proven geometry as the starting point: ~5px glyph monospace atlas, ~313 columns, page width ~1573px, and **clamp page dimensions under Anthropic's resample cap (~1568px long edge)** so billed pixels actually reach the vision encoder (see pxpipe `docs/LEGIBILITY-AUDIT-2026-07-01.md`).
- Deterministic output: same input turns → byte-identical PNGs (no timestamps in pixels), so retried requests stay cache-friendly.
- Respect API limits: ≤100 images/request budget (leave generous headroom: cap ~40 pages per compaction **including pages carried forward from previous image compactions per §5.2**, refuse beyond with guidance to run `/compact` first — carried pages counting against the cap makes repeated compactions ratchet toward the refusal predictably instead of surprisingly), ≤5MB per image.

### 5.3.1 Pre-imaging junk passes (transcript-only, non-destructive)

Before reflow/rendering, run deterministic rule-based passes over the serialized transcript to discard content that is bulk without recall value. These passes touch only the transcript string being rendered — stored messages are never modified. Do **not** run the durable `SessionCompaction.prune` as a pre-step: it deletes tool outputs from storage, while imaging preserves them at 3:1; junk passes must stay strictly transcript-side. Every pass must be deterministic to keep §5.3's byte-identical guarantee. Pipeline order: serialize → write verbatim sidecar (§5.4, from the **raw** transcript, so elision never loses an identifier) → junk passes → reflow → render.

In rough order of value:

1. **Already-pruned tool outputs** — parts with `state.time.compacted` set are already erased from model context today; render a one-line stub, not pixels.
2. **Superseded file reads** — for repeated reads of the same path, keep only the newest content; older ones become `[read of <path> superseded at turn N]`. Recoverable from disk; the full content stays in the sidecar.
3. **Stale-by-edit reads** — a read whose file was later edited/written in-session renders as a stub or head-only excerpt; the banner already mandates re-reading before use.
4. **State-snapshot tools** — todo lists, status polls, and other tools where each output supersedes the last: keep the final snapshot, stub the rest.
5. **Giant/noisy tool outputs** — head+tail cap per output (e.g. first 40 + last 20 lines with `[… N lines elided …]`), and collapse consecutive near-duplicate lines (`[repeated ×N]`). Targets build logs, test spam, installer noise.
6. **Binary and base64 payloads** — data URLs, base64 blobs, and non-carried image parts become typed placeholders (`[image/png data-url ~96KB]`, `[image: <name>]`). Extends §5.2's never-image-images rule.
7. **ANSI/control characters** — strip; the glyph atlas cannot render them anyway.
8. **Injected boilerplate** — synthetic reminder parts and repeated `<system-reminder>`/queued-input wrappers that get re-injected fresh each turn: keep at most the first occurrence, drop repeats.

The feedback line (§4) should report the savings honestly: chars in the raw range → chars actually rendered. Collapsing error/retry churn (identical failed-then-retried tool calls) is a plausible follow-up pass, not v1.

### 5.4 Verbatim sidecar (hard requirement — see §2 misread evidence)

- Write the **raw** serialized transcript (before the junk passes of §5.3.1, so elided content is fully covered; ANSI stripped) to a plain-text sidecar file at `<data>/compaction/<sessionID>/<compactionMessageID>.txt`, with real newlines so it is ordinarily greppable, and carry a pointer text part in the synthetic message telling the model to grep that file for any string it needs exactly. Rationale (v2, replacing v1's curated in-context fact sheet): a frequency-ranked token list spends its budget on the most _recoverable_ identifier class (code constants from file reads — greppable in the repo anyway) while session-unique strings (commit hashes in bash output, API-returned IDs, user-typed numbers) miss the budget; no in-context selection can know which strings a future turn will need, but the sidecar keeps all of them at zero context cost.
- Banner text (also plain text, before the images) must state: pages are transcribed prior turns; `↵` marks original newlines; turn tags are authoritative for attribution; highest-`t` turns are most recent; this is prior context, not the current request; **exact strings must be re-read from disk/tools, not recalled from images**.

### 5.5 Model gate

- Config key `compaction.image.models` (array of model ID substrings), default `["claude-fable-5"]`. Empirical basis: Fable 5 reads dense renders ~100% gist / ~87% verbatim; Opus 4.8 reads them at 0/15 verbatim with silent confabulation (pxpipe FINDINGS). On a session whose current model is not allowlisted, refuse with explanation.
- Note in the refusal that switching the session to an allowlisted model re-enables the command.
- **Temporal hole (accepted for v1):** the gate holds only at trigger time. A later model switch — or a future default-model change — leaves existing pages in the context of a model that may read them poorly (§11 model drift, just deferred). v1 documents this in the command's help/refusal text; actively surfacing a warning when a non-allowlisted model runs a session containing image compactions is a stretch goal.

### 5.6 Persistence and compaction semantics

- Boundary mechanism (verified against `message-v2.ts` `filterCompacted` and `compaction.ts` `completedCompactions`): a compaction is a **user** message carrying a `compaction` part, paired via `parentID` with a chronologically later **assistant** message that has `summary: true`, a clean `finish`, and no error. `tail_start_id` on the compaction part selects the retained tail, and `filterCompacted` reorders model context to `[compaction-user, summary-assistant, tail…]`.
- Anthropic forbids images in the assistant role, but the compaction **user** message is itself part of future model context — so the payload lives there: compaction part → banner text part → image file parts → sidecar-pointer text part(s) → `[End of imaged context.]` text part. Mark injected parts `synthetic: true`.
- Fabricate the paired assistant message directly, with **no processor/model run**: `summary: true`, compaction mode/agent (or a distinct `"compaction-image"` — decide), zero cost/tokens, `finish` set, no error. Its text becomes `previousSummary` for any later summary compaction (`compaction.ts` `summaryText`), so make it a real sentence, e.g. "Context before this point was compacted into N transcript-page images carried in the preceding message." Getting `finish`/`parentID`/`time` right so `completedCompactions`, `filterCompacted`, and the prune loop (`compaction.ts:262`) all recognize it as a completed compaction is the core correctness work — verify each consumer of `summary: true`.
- Set `tail_start_id` directly to the first user message of the 4-turn tail; the estimate-driven `select()`/`splitTurn()` machinery of summary compaction is not needed here.
- Original messages remain in storage and in the UI timeline (same as today's summary compaction). Reverting is therefore possible in principle (`/uncompact` — stretch goal, not v1).
- Storage format: **prefer blob files on disk referenced by URL** over `data:` URLs in the DB. Inline data URLs (~50–120KB/page, ~2–4MB per compaction) bloat every message load and poison `JSON.stringify`-based size heuristics — `SessionCompaction.estimate` would score a ~100KB page at ~33k tokens (base64 chars ÷ 4) vs ~1.5k actual (pixels ÷ 750), corrupting any later tail-selection or overflow math that sees the message. Verify at implementation time that file-URL parts survive the provider request path and reach web/mobile clients correctly (`image.normalize` path in `session/prompt.ts`); if they can't, fall back to data URLs **and** teach every estimator that can see the message the pixel formula.

### 5.7 Interplay with summary compaction

- `/compact` (summary) after `/compact-image` must not lose the imaged content silently. Warning from the code: `completedCompactions` hides prior compaction pairs from the summarizer's input, and `toModelMessagesEffect(stripMedia: true)` strips images anyway — so a naive later `/compact` would neither see nor carry the imaged pages, and its fresh boundary would drop them from context entirely. Either carry the image parts forward beneath the new boundary, or refuse/warn when `/compact` would cross an image compaction — decide during implementation, but the failure mode must be designed out, not discovered.
- Auto-compaction overflow checks must count the imaged message's estimated token weight (pixel-area formula: `w×h/750` per page).

## 6. Compatibility constraints (from contextL.md — binding)

- API changes must be additive; JSON payload shapes, SSE semantics, and mobile WebView assumptions must not change. A new command + a new message with existing part types is additive by construction.
- Mobile: the timeline must not freeze rendering 30 images on iOS/Android WebViews — collapse by default, lazy-render pages (respect existing mobile review/diff guard patterns).
- Before touching `packages/opencode` core, confirm no plugin/extension point suffices: check the `experimental.session.compacting` hook first. Expected conclusion: rendering + part injection + boundary control exceeds the hook (it only lets plugins inject context or replace the summary prompt); document that check in the implementation notes/log.md entry.
- Check nested `AGENTS.md` in `packages/opencode` (flat ESM self-export pattern, no barrels) and `packages/ui` before editing.

## 7. Architecture note: what NOT to port from pxpipe (read before opening its code)

pxpipe is referenced throughout as the validated source for **rendering** (atlas, reflow, page geometry) and **serialization** (turn tagging, fact-sheet extraction). Port/adapt those freely — but not its boundary scan (`findClosedPrefixBoundary`), which §5.2 replaces with a plain user-turn cut.

Do **not** port its cache-survival machinery. Roughly half of pxpipe's `history.ts`/`transform.ts` exists only because the proxy is stateless per request — it re-derives the imaged view from unchanged stored history on every call, so it must keep renders byte-identical across requests or the prompt cache shreds. That is the entire reason for:

- `collapseChunk` (the 50-message quantized boundary grid),
- `freezeChunk` (append-only 10-message frozen page chunks),
- the per-request profitability gate and `priorWarmTokens` burn accounting,
- cache-anchor relocation and `HISTORY_SYNTHETIC_INTRO` matcher coupling.

**None of that applies here.** This feature changes durable state once: the pages become stored message parts, so every subsequent request contains literally the same bytes by construction, and prompt caching works automatically — the same way it works for any other stored message. Consequences worth exploiting rather than re-solving:

- Cut the imaged range right up to the keep-tail. No boundary grid — at trigger time this compresses strictly more history than the proxy would (the proxy tolerates up to 49 aged messages as text between gridline jumps; we don't have to).
- No profitability gate; the only guards are the minimums in §5.2 and the model gate in §5.5. The human trigger _is_ the gate.
- The one-time cache re-key after compaction is expected and cheap (a write on the new ~35k prefix, not the old ~250k one). Do not add machinery to avoid it.
- Determinism (§5.3) is still required, but only so an exact retry of the same request stays cacheable — not to survive boundary advancement across turns, which no longer exists.

If an implementation choice seems to need chunking, gating, or anchor-relocation logic, stop — that's the stateless-proxy problem leaking in, and the durable design has made it moot.

## 8. Suggested implementation shape

New module `packages/opencode/src/session/compaction-image/` (follow self-export pattern):

- `render.ts` — glyph atlas, reflow, paging, PNG encode (vendored/adapted MIT pxpipe code with attribution header, or clean-room).
- `transcript.ts` — tail-boundary selection, turn serialization, junk passes (§5.3.1).
- `compaction-image.ts` — orchestration: validate gate → build transcript → render → inject message → set boundary → emit feedback.
- Command registration + config schema addition (`compaction.image.models`).
- UI: one compact collapsed block for the synthetic message in `packages/ui`.

## 9. Verification

- Unit (from `packages/opencode`, `bun test path --timeout 30000`): tail-boundary selection; transcript serialization; each junk pass (§5.3.1), including determinism; sidecar write + pointer (raw pre-junk content, real newlines, carry-forward); render determinism (snapshot PNG bytes); page-cap refusal including carried-forward pages; model-gate refusal.
- Integration: scripted session → `/compact-image` → next-turn `assistant.tokens` input drops accordingly; originals still in DB; UI shows collapsed block. HTTP gates: `bun run test:httpapi` still green.
- Fidelity smoke (manual, once): 250k-char real session, compact, quiz gist + verify an exact identifier is recovered _by grepping the sidecar_ (correct) rather than transcribed from pixels.
- `bun lint`, `bun typecheck` from repo root; mobile spot-check on the Android app (collapsed block, no jank).

## 10. Open questions (answer during implementation, record decisions in the feature doc)

1. Verify the blob-file storage recommendation (§5.6): file-URL image parts must survive the provider request path and render in web/desktop/Android/iOS clients; fall back to data URLs only together with pixel-formula fixes for every estimator that can see the message.
2. `/compact` interplay choice (§5.7): carry pages beneath the new boundary vs. refuse/warn when crossing an image compaction.
3. Whether the synthetic message should pin `cache_control` explicitly or inherit Tandem's existing last-2-messages caching (see `provider/transform.ts` `applyCaching`) — likely inherit; verify cache_read on turn N+2.
4. Page density: ship pxpipe geometry as-is, or add `compaction.image.density: "dense" | "relaxed"` (relaxed ≈ 2:1 but higher verbatim fidelity)?
5. Feedback line's token estimate source: pixel formula only, or a free `count_tokens` probe for honesty?
6. Exact field set for the fabricated summary assistant message (§5.6): enumerate every consumer of `summary: true` (`completedCompactions`, `filterCompacted`, the prune loop at `compaction.ts:262`, UI timeline) and confirm each treats a processor-less compaction pair correctly.

## 11. Risks

- **Silent verbatim corruption** — mitigated by verbatim sidecar + banner instruction + agents' re-read-before-edit habit; residual risk accepted (documented in §2).
- **Model drift** — a future default model that reads renders poorly turns compactions into noise; the gate (§5.5) is the control, and its trigger-time-only nature is documented in §5.5; keep the allowlist conservative.
- **Upstream merge friction** — new module is fork-owned and isolated; the only shared-file touches are command registration, config schema, compaction boundary reuse, and one UI mapping — mark each with `UPSTREAM-DIVERGENCE` and list them in `log.md`.

## 12. Implementation notes (v1, 2026-07-06)

Module: `packages/opencode/src/session/compaction-image/` — `compaction-image.ts` (orchestration + service + sidecar write), `transcript.ts` (serialization + junk passes), `render.ts` + `png.ts` + `atlas-gray.ts` (vendored/adapted pxpipe, MIT attribution headers). Tests: `packages/opencode/test/session/compaction-image.test.ts` (junk passes, serialization + slot lockstep, sidecar write/pointer/carry-forward, render determinism/bounds, full `run()` integration incl. `filterCompacted` reorder, model gate, minimums, and both `/compact` guard behaviors). Shared-file divergences are listed in `log.md`.

Decisions on the open questions (§10):

1. **Storage: data URLs, not blob files.** Verified at implementation time: `Image.normalize` (`image/image.ts:83`) hard-fails on any non-`data:` URL, `resolvePart` has no `http:` branch, and the UI only renders a file part as an attachment when `url.startsWith("data:")` (`session-ui/components/message-file.ts`) — there is no part-serving endpoint. So `data:` URLs are the only form that (a) reaches Anthropic and (b) renders in clients. The estimator-poisoning risk is contained without teaching every estimator the pixel formula: `SessionCompaction.select()` hides completed compaction pairs (`completedCompactions` → `hidden`) before calling `estimate`, so the JSON-stringify estimator never sees the imaged message in the one place it matters (tail selection), and overflow gating uses provider-reported token counts (which bill images by pixels natively). The remaining exposure — a later summary compaction over the pages — is closed by decision 2.
2. **`/compact` interplay: refuse, with a config escape hatch.** Manual `/compact` over an active image compaction creates an errored compaction assistant message ("this session was image-compacted…") and stops — visible in every client's timeline, no wire-error plumbing. `compaction.image.discard_on_summary: true` lets it proceed (this is the escape hatch the §5.3 page-cap refusal points at). Auto/overflow compaction always proceeds: availability beats preservation when context is full.
3. **Caching: inherit.** No explicit `cache_control` pinning; the pages are ordinary stored message parts and byte-identical on every request by construction.
4. **Density: pxpipe dense geometry as-is** (5×8 AA gray atlas, 312 cols, 1568×728 pages, role-tinted turn tags, ↵ reflow). No `density` config in v1.
5. **Feedback token estimate: pixel formula only** (`w×h/750` per page + chars/4 for the text parts). No `count_tokens` probe.
6. **Fabricated summary assistant, consumers verified:** `summary: true`, `finish: "stop"`, no error, `parentID` → compaction user message, zero cost/tokens, `mode`/`agent` `"compaction"`. `completedCompactions` accepts it (summary+finish+no-error), `filterCompacted` reorders `[compaction-user, summary-assistant, tail…]` (asserted in the integration test), the prune loop breaks on it, and `latest()` treats it as finished so the compaction part is never re-processed as a pending task. Its text (feedback line) becomes `previousSummary` for any later summary compaction.

Other deltas from the spec as written:

- **Fact sheet replaced by verbatim sidecar (post-v1 fix #5, 2026-07-06):** the first live resume-on-compacted-context showed the curated fact sheet failing exactly backwards — its 96-token budget was ~100% `SCREAMING_SNAKE` constants and `--flags` harvested from file-read dumps (the most repo-recoverable class), while the session-unique identifiers it existed for (commit hashes in bash output) missed the cut. v2 deletes `factsheet.ts` entirely: the raw pre-elision transcript is written to `<data>/compaction/<sessionID>/<compactionMessageID>.txt` with real newlines (§5.4), and the fact-sheet part becomes a pointer part telling the model to grep that file. Written before any state change, so a failed write aborts the compaction untouched.
- **Sidecar/pointer carry-forward:** §5.2 only said to carry image parts; pointer text parts of prior compactions (marker `sidecar`, or legacy `factsheet` sheets from v1 pages) are carried verbatim onto the new compaction message, so every carried page batch keeps its own exact-string recovery path.
- **Boundary minimums recalibrated on real sessions (post-v1 fix):** §5.2's "4-turn tail + refuse under ~10 imaged turns" assumed many small turns. Real long agent sessions are a handful of _giant_ turns (the first live test session had ~4 user turns at ~250k tokens), which the spec'd gate would always refuse. v1 now keeps the 4-turn tail only when the session has ≥6 turns, shrinking it (to as few as 1) so at least two turns stay imageable; the hard minimum is 3 turns in context plus the 20k-char floor. The 10-turn minimum was dropped — the char floor is the real "not worth a boundary" signal.
- **Junk passes trimmed:** v1 ships passes 1 (pruned-output stubs), 2 (superseded reads), 5 (head 40 + tail 20 line cap; ≥3 consecutive identical lines collapse), 6 (data-URL/base64 placeholders), 7 (ANSI strip), 8 (exact-match `<system-reminder>` dedup, first occurrence kept). Passes 3 (stale-by-edit reads) and 4 (state-snapshot tools) are deferred — they need cross-session edit tracking for marginal savings.
- **Token-budgeted tail (post-v1 fix #2):** turn-count tails let one giant turn silently eat the savings — the first live fork test kept a ~20k-token commit-surgery turn as text (55k context where ~35k was expected). The tail is now additionally budgeted at `TAIL_TOKEN_BUDGET` = 8k estimated tokens (chars/4): walking back from the newest turn, a turn either fits whole or the tail stops at the turn boundary before it and the turn lands on the pages instead. Turn boundaries remain the only cut points — no mid-sentence/mid-tool-call seams for the model; oversized outputs are elided on-page by the junk passes with explicit markers. The newest turn is always kept whole even when it alone exceeds the budget.
- **Straddler stubbing (post-v1 fix #3):** turn-granular tails couldn't be refined further without part-level cuts — one stored assistant message spans all of a turn's request cycles (`step-start` parts), and partial replay of signed thinking is exactly the fragility `message-v2.ts` warns about. Instead, the boundary-straddling turn is softened, not cut: it stays in the tail as text with its oldest completed tool outputs cleared via the upstream prune mechanism (`state.time.compacted` → "[old tool result content cleared]") until it fits the budget, and the turn is additionally rendered onto the pages so cleared outputs stay recoverable in pixels. Tool outputs are the sub-turn granularity; `skill` outputs are protected (mirrors `PRUNE_PROTECTED_TOOLS`); the banner announces the mid-turn page boundary. `TAIL_TURNS` raised 4→6 with the freed headroom. Turn structure, signatures, and tool pairs are never split.
- **Tail budget prices replayed thinking (post-v1 fix #4):** live ledger on a compacted baseline (57.2k observed vs ~44k explained) exposed ~13k tokens of invisible tail weight: reasoning text (10k chars) plus thinking-block base64 _signatures_ (46k chars — Anthropic's per-block authenticity certificates, replayed with history by `toModelMessage`). The transcript serializer deliberately drops reasoning, so `turnChars` was blind to it. The estimator now adds reasoning text + signature chars (signatures weighted at 2.5 chars/token) and `CHARS_PER_TOKEN` drops 4→3.3 (measured on code-heavy sessions). Thinking-heavy turns now overflow onto the pages, where their reasoning + signatures legitimately vanish with the imaged messages. Stubbing still cannot clear reasoning (no prune mechanism exists for it); dropping historical thinking from replay entirely is a separate candidate fix in `message-v2.ts`, not taken here.
- **Extension-point check (§6):** `experimental.session.compacting` only lets plugins inject context strings or replace the summary prompt of a _model-run_ summary compaction. It cannot render pages, inject parts into a durable message, set the boundary, or skip the processor run — core work confirmed necessary.
- **Turn indices** are absolute message indices in the full stored session history (stable across later compactions, consistent with carried pages).
- **Command surface:** built-in client command (like `/compact`), not a server template command: new endpoint `POST /session/{sessionID}/compact-image` (returns `{ok, message}`; refusals are `ok: false` with a human-readable reason, toasted by web/TUI), web entry in `use-session-commands.tsx`, TUI entry in `routes/session/index.tsx`. The feedback line is also the summary assistant's text, so it lands in the timeline in every client.
- **UI:** the compaction message renders its pages as one collapsed `<details>` block ("Context imaged — N pages") with `loading="lazy"` images, so mobile WebViews never eagerly decode 30 PNGs.
