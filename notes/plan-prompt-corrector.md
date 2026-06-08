# Plan: Prompt Corrector + RePrompt (opencode plugin)

Handoff plan for a fresh session to implement a Tandem prompt-correction feature.
This file separates **agreed decisions**, **code-verified facts**, and **open
decisions still to be made**. Do not treat open decisions as settled.

## Goal (agreed)

Add a Tandem feature that runs the user's outgoing prompt through an LLM
"corrector" and, for short prompts, a deterministic "RePrompt" repetition.
It improves prompt quality for both voice-dictated and typed input.

## Background / motivation (why this exists)

- Tandem currently uses Google's on-device STT (see the voice/punctuation work in
  `log.md`). Wispr Flow produces noticeably higher-quality dictation, and its edge
  is **not a better speech model** — it's an **LLM cleanup/formatting layer on top
  of raw transcription** (filler removal, punctuation, grammar, casing). The user
  wants a similar capability, but more integrated.
- The user's framing: clean up grammar and punctuation, and **make the prompt
  unambiguous** so the agent receives a clearer instruction — e.g. putting commas
  in the right place or moving misplaced ones — and not limited to that.
- This is wanted for **typed input too**, not just voice: typing still has
  spelling/punctuation slips and ambiguous structure; voice adds transcription
  artifacts on top. Hence one unified feature.
- RePrompt is included because **repeating a short prompt improves both the
  model's adherence to terse instructions and its reasoning on tricky/niche
  logic** (the "re-reading" effect). On certain reasoning problems models snap to
  a default heuristic answer instead of engaging with the actual logic; a second
  pass helps them catch it. Example: *"I want to wash my car. The car wash is
  about 50 meters away. Should I walk or drive?"* — most models answer **"walk"**
  (short-distance heuristic), but the correct answer is **"drive"**, because the
  car has to be taken to the car wash to be washed. RePrompt helps the model reach
  the correct answer. This only helps for short prompts; repeating long prompts
  wastes context and can degrade results — which is why it is gated to short
  prompts.

## Agreed decisions

- Implement as an **opencode plugin / hook** (not a `packages/app` UI fork, not a
  `packages/opencode` request-pipeline rewrite).
  *Why:* hooks let us rewrite the outgoing message with the least fork divergence,
  and (verified) `chat.message` rewrites the message *before persistence*, so the
  corrected text is what gets stored and shown — which the safety model below
  depends on. A `packages/app` change would touch shared UI across all platforms;
  a request-pipeline rewrite would be deeper core divergence.
- **One unified feature** used for **both voice transcription and typed input**.
  *Why:* typed input still has spelling/punctuation/ambiguous-structure issues;
  voice has those plus transcription artifacts. One corrector covers both.
- Corrector behavior:
  - fix spelling errors,
  - fix punctuation errors (e.g. comma placement: add, remove, or move),
  - fix common voice-transcription artifacts,
  - do **basic sentence-structure correction to solidify meaning only when
    necessary**. The aggressiveness of this is tuned via the instruction/prompt
    fed to the corrector LLM.
    *Why "only when necessary":* aggressive restructuring of an **agent prompt**
    risks changing its intent or scope; the corrector should fix clarity without
    altering what the user is actually asking for. Making it tunable via the
    instruction lets that line be adjusted without code changes.
- **RePrompt**: for **short prompts only**, repeat the **corrected** prompt in the
  form `"<corrected>. Repeated again: <corrected>"`. Order is **correct first,
  then repeat** (the repetition uses the corrected text).
  *Why:* repeating a short prompt improves both adherence to terse instructions
  and reasoning on tricky/niche logic (re-reading effect) — see the car-wash
  example in Background. Long prompts are excluded because repetition wastes
  context and can hurt. Correcting before repeating means the model sees the clean
  version twice, not the raw one.
- The corrector LLM has **zero or very little system prompt** — essentially just
  its job description — to save tokens.
- **Enabled by default; opt-out** (not opt-in).
- The toggle is an **env var or an `opencode.jsonc` config setting** (no in-app
  toggle). Note the verified constraint below: opencode rejects unknown
  `opencode.json` keys, so a `.jsonc` key would require a fork schema change,
  while an env var needs none — env var is therefore the simpler, lower-
  divergence option of the two.
- Implementation must **minimize fork divergence** and be **as easy as possible
  for future upstream merges**.
- **No pre-send confirmation.** Safety model: the user can see the transformed
  prompt after it is sent and stop the conversation if needed.
- Added **latency is accepted**.

## Proposed by user, NOT yet finalized

- Possibly feed the corrector LLM **surrounding conversation context** so it can
  make better decisions. (Raised as "perhaps"; not committed.)

## Code-verified facts (with file:line)

These were confirmed by reading the repo; rely on them.

- **`chat.message` hook rewrites the stored AND visible user message.** It fires
  at `packages/opencode/src/session/prompt.ts:1078`, before the message is
  persisted at `:1125-1126`. Mutating `output.parts[].text` (or `output.message`)
  changes what is recorded and shown in the conversation.
  Signature: `packages/plugin/src/index.ts:234-243`, `output = { message:
  UserMessage, parts: Part[] }`, mutated in place.
- **`experimental.chat.messages.transform` is model-only (not persisted).** Fires
  at `packages/opencode/src/session/prompt.ts:1443` on a fresh in-memory array
  that is converted and sent to the provider (`:1464-1468`) but never written
  back to storage. Signature: `packages/plugin/src/index.ts:282-290`,
  `output = { messages: { info, parts }[] }`.
- Related hooks if needed: `experimental.chat.system.transform`
  (`packages/opencode/src/session/llm/request.ts:96-100`), `chat.params`
  (`request.ts:151-169`).
- Hook trigger mutates `output` in place and does not clone:
  `packages/opencode/src/plugin/index.ts:284-298`.
- **A plugin can run its own LLM completion.** `PluginInput` includes a full
  in-process opencode SDK `client` (`packages/plugin/src/index.ts:56-66`).
  `client.session.prompt(...)` (SDK `packages/sdk/js/src/gen/sdk.gen.ts:612-624`;
  body type `packages/sdk/js/src/gen/types.gen.ts:2588-2613`) accepts a custom
  `model`, custom `system` string, `tools` map (can disable tools), `noReply`,
  and `parts`; the response returns `{ info: AssistantMessage, parts: Part[] }`.
  Completions go **through a session** (there is no separate raw-completion
  endpoint).
- **Default/built-in plugins** are the hardcoded `internalPlugins()` array at
  `packages/opencode/src/plugin/index.ts:63-78`, loaded unconditionally unless
  `OPENCODE_DISABLE_DEFAULT_PLUGINS=1` (`packages/opencode/src/effect/runtime-flags.ts:19`).
  Adding a `PluginInstance` entry there ships the plugin enabled-by-default across
  CLI, desktop, and mobile (all run this same server code). Current entries are
  all auth plugins, but the array accepts any `(input, options?) => Promise<Hooks>`.
- **opencode rejects unknown top-level `opencode.json` keys** (`ConfigInvalidError`),
  so a custom config key is not a valid toggle channel.
- **No existing Tandem default-config generation.** The only env-based config
  injection point is the SDK server launcher `OPENCODE_CONFIG_CONTENT`
  (`packages/sdk/js/src/server.ts:38,122`), which defaults to `{}`.

## Open decisions (UNDECIDED — resolve before/while implementing)

1. **Toggle mechanism: env var vs `opencode.jsonc` key.** Both are acceptable.
   An env var (read via `process.env` / the `runtime-flags.ts` `bool(...)` pattern)
   needs no schema change and is the simpler/lower-divergence option. A `.jsonc`
   config key requires extending the config schema in the fork (unknown keys are
   rejected — see verified facts). Pick one and, if env var, choose its name and
   the opt-out value (default ON).
2. **RePrompt visibility.** Decide whether the `"Repeated again: ..."` duplication
   appears in the conversation UI (use `chat.message`, visible) or is sent only to
   the model and hidden from the user (use `experimental.chat.messages.transform`,
   model-only). Both are technically supported (see verified facts).
3. **"Short prompt" threshold** for RePrompt: the metric (chars vs tokens) and the
   value.
4. **Corrector model**: which model the correction completion uses.
5. **Corrector instruction text**: the exact minimal system prompt, and whether it
   is conditioned on input source (voice vs typed). Also: does the plugin need to
   know whether the input came from voice or typing, and if so, how is that signal
   delivered?
6. **Toggle granularity**: whether correction and RePrompt share one toggle or
   have separate toggles.
7. **Session pollution**: how to run the corrector completion without cluttering the
   session list (e.g. a dedicated hidden/ephemeral session, reuse, or cleanup).
8. **Conversation context**: whether to include it (the user's "perhaps"), and if
   so the budget/amount.
9. **Plugin location & registration**: where the plugin module lives and how it is
   added to `internalPlugins()` with minimal merge friction.
10. **Preserve original**: whether to keep the pre-correction text (e.g. as
    metadata) for transparency/undo.

## Implementation outline (grounded in agreed decisions + verified facts)

1. Create a **self-contained plugin module** implementing:
   - correction via the hook that rewrites the visible/stored message
     (`chat.message`), calling `client.session.prompt` with a minimal `system`
     and `tools` disabled, then writing the corrected text back into
     `output.parts[].text`;
   - RePrompt for short prompts (deterministic string transform; placement
     depends on open decision #2).
2. Gate the whole feature behind the env-var (or `.jsonc`) toggle, **default ON**
   (open decision #1 selects which).
3. Register the plugin in `internalPlugins()`
   (`packages/opencode/src/plugin/index.ts:63-78`) so it ships enabled-by-default.
   Keep the core edit to a single import plus one array entry; mark it with an
   `UPSTREAM-DIVERGENCE` comment to survive upstream merges.
4. Keep the plugin logic in its own file so upstream merges only ever touch the
   one-line registration, not the feature code.

## Implementation gotchas (facts/risks, not assumptions)

- **Recursion guard required.** The corrector runs its own `client.session.prompt`
  to produce the correction. That call creates a user message and will itself fire
  the `chat.message` hook — so without a guard the plugin would try to correct its
  own correction prompt (and could loop). The plugin must detect and skip its own
  internal corrector calls (e.g. a dedicated session ID, a flag, or message
  metadata it can recognize).
- **Cost multiplier.** Default-on means an extra (small) model call per submitted
  prompt for every Tandem user. Latency is accepted (per agreed decisions); the
  per-prompt token/cost cost is a related consequence to keep in mind.

## Process reminders (from contextL.md)

- Update `log.md` with this change (required for any mobile/opencode change).
- Preserve `UPSTREAM-DIVERGENCE` comments on the core registration edit.
- Use an appropriate commit prefix (`personal:` for a Tandem-specific
  enhancement, or `mobile:` if mobile-app behavior is touched).
- Config is loaded once at startup and is not hot-reloaded; restart opencode
  after config changes.
- Before any further `packages/opencode` divergence, re-check whether a plugin or
  documented extension point avoids the fork.
