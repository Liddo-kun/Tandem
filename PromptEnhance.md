# Prompt Enhance (Prompt Corrector + RePrompt)

A Tandem-only built-in plugin that quietly improves every outgoing user prompt
before the agent acts on it. It is enabled by default and ships inside the
binary; there is no config file to set up.

It does two things:

1. **Correct** — rewrites the user's message to fix spelling, punctuation,
   capitalization, and speech-to-text artifacts, plus light cleanup of dictated
   technical text (file paths, spoken symbols, etc.) and light clarity edits
   (comma placement, minor word reordering) that preserve the original meaning.
   The corrected text replaces the stored/visible message; the original is
   preserved in metadata.
2. **RePrompt** — for short, substantive prompts, appends a hidden, model-only
   duplication that repeats the message under a `Read it again:` marker (inline
   for single-line prose, on its own line for multiline) to reinforce the
   instruction. This is never stored or shown to the user.

## What gets corrected

- Spelling, punctuation (incl. comma placement), capitalization, run-ons, and
  common voice-transcription mistakes.
- Light clarity edits — adding/moving commas and minor word reordering — when
  they make the intent read more clearly, as long as the meaning is unchanged.
- Dictated technical text **only when the text is clearly a path, filename,
  command, flag, identifier, or URL**:
  - spoken symbols → characters: `dot`→`.`, `slash`→`/`, `dash`→`-`,
    `underscore`→`_`, `tilde`→`~`, `colon`→`:`
    (e.g. `handoff dot md` → `handoff.md`, `dash dash single` → `--single`)
  - strip stray spaces inside a path (`handoff . md` → `handoff.md`)
  - lowercase file extensions (`.Md` → `.md`)
  - lowercase path segments capitalized only by dictation (`code/Random` →
    `code/random`) **while keeping real proper-noun dirs** (`Android`, `README`,
    `Dockerfile`)
  - fix well-known names: `get hub`→`GitHub`, `type script`→`TypeScript`,
    `java script`→`JavaScript`, `node js`→`Node.js`
- Ordinary prose is left alone (e.g. "let's dash to the store" is untouched).

## How it works

The plugin lives entirely in `packages/opencode/src/plugin/prompt-corrector.ts`
and is registered in `internalPlugins()` (`plugin/index.ts`). It uses three
plugin hooks:

- **`chat.message`** — on each outgoing user message (skipped when it exceeds
  the corrector size cap, default 600 chars), spawns a throwaway "Prompt
  corrector (Tandem)" session, sends the **raw** message text to a cheap model
  with all tools disabled, reads back the corrected text, and replaces the
  message part's text (saving the pre-correction text under the
  `tandemPromptCorrectorOriginal` metadata key). The throwaway session is created
  as a **child** (`parentID`) of the session being corrected, so it never appears
  in the UI's root session lists or post-delete navigation — its create/delete
  churn cannot be opened, tabbed, or leave ghost tabs on any client. It is
  deleted afterward; in debug mode it is kept at **root level** instead (visible
  in the session list for inspection), and only the newest few corrector sessions
  are retained (older ones pruned).
- **`experimental.chat.system.transform`** — fully **replaces** the corrector
  session's system prompt with the correction instruction. (A prompt body's
  `system` field only *appends* to the agent prompt, so replacement via this
  hook is what makes the spawned session behave as a pure text corrector instead
  of running as the real coding agent.)
- **`experimental.chat.messages.transform`** — performs the model-only RePrompt
  duplication.

### Why a corrector turn doesn't "do work"

Reusing `session.prompt` runs a full agent turn, so two things are forced:
disabling all tools (`tools: { "*": false }`) and replacing the system prompt
(above). Together these make the spawned session correct text rather than act on
it.

### Safety net (never corrupts your prompt)

The model's output is accepted only if it is a faithful copy-edit of the
original — checked by a length bound plus a bounded edit-distance budget (sized
to still accept heavily dictated text, where spoken symbols written out as
`://`, `/`, `.` shrink the message a lot). Any
reply, refusal, preamble, or echo of injected context is **discarded** and the
original message is kept. The worst case is "no correction this turn", never a
corrupted prompt.

### Process-wide state

opencode constructs the plugin once per project/directory instance, so a single
server can hold several instances. The recursion guard and corrector-session
tracking therefore use **module-level** state shared across all instances in the
process; otherwise a corrector turn re-entering the hooks on a different instance
would recurse and/or run as the real agent.

### Cheap model selection

The corrector uses a small/cheap model, mirroring opencode's `getSmallModel`
priority (Claude Haiku / Gemini Flash / GPT-5-nano, GPT-5-mini for Copilot),
honoring a `small_model` config override when present, and falling back to the
session's model.

### RePrompt gating

RePrompt fires only when the (corrected) message is 10–300 characters, has at
least 3 words, and contains no backtick (so code is skipped). Newlines are
allowed — multiline prose gets the standalone-marker form; one-/two-word answers
are skipped by the word-count rule.

## Configuration (environment variables)

| Variable | Default | Effect |
|---|---|---|
| `TANDEM_PROMPT_CORRECTOR` | on | Master switch; `0`/`false`/`off`/`no` disables the whole feature. Always off for the `tandem run` CLI command (see Notes). |
| `TANDEM_PROMPT_CORRECTOR_MAX` | 600 | Max characters to send to the corrector; longer prompts skip correction entirely. `0` = no cap. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG` | off | Keeps the throwaway corrector sessions (visible in the session list) for inspection. |
| `TANDEM_PROMPT_CORRECTOR_DEBUG_KEEP` | 2 | In debug mode, retain only this many newest corrector sessions (older ones pruned). `0` = keep all. |
| `TANDEM_PROMPT_CORRECTOR_REPROMPT_MAX` | 300 | Max characters for RePrompt; `0` disables RePrompt. |
| `TANDEM_PROMPT_CORRECTOR_REPROMPT_MIN` | 10 | Min characters for RePrompt. |

## Files / divergence

- `packages/opencode/src/plugin/prompt-corrector.ts` — the whole feature (new file).
- `packages/opencode/src/plugin/index.ts` — one import + one `internalPlugins()`
  entry (marked `UPSTREAM-DIVERGENCE`).
- `packages/opencode/src/session/prompt.ts` — a small gate (marked
  `UPSTREAM-DIVERGENCE (Tandem)`) that skips the `AGENTS.md`/instruction
  injection for corrector turns (detected via the `tandemPromptCorrector` part
  metadata marker), so the corrector model receives only the raw user text.

## Notes / limitations

- The corrector adds one extra (cheap) model call per prompt, run synchronously
  before the main turn, so it adds a little latency; a rate-limited corrector
  call can delay the prompt.
- It is intentionally conservative: borderline edits that the safety net rejects
  simply result in no correction rather than a risky rewrite.
- The whole feature is disabled for the `tandem run` CLI command: non-attach
  `run` hosts the server in-process and waits on the prompt request, and the
  corrector's nested `session.prompt` hangs that path (the command never
  returned until Ctrl-C). The plugin detects the `run` command via
  `process.argv` (first non-flag token) at construction and returns no hooks.
  `run --attach` talks to a separate `serve` process, where the corrector stays
  active and works normally.
