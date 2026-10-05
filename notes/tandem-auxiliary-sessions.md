# Tandem auxiliary-session contract

Shared foundation for Corrector and browser-backed webfetch. It uses normal session
create/admit/execute/history and cleanup APIs; it does not introduce a second session engine or alter
public HTTP endpoints.

## Imports and identities

Browser-safe metadata and IDs:

```ts
import { TandemAuxiliary } from "@opencode/util/tandem-auxiliary"
```

The leaf module exports `Metadata` (Effect Schema and same-name type), `Role`, `CorrectorRange`,
`CorrectorMetadata`, `isBareContext`, and these string constants:

| Export | Value | Configuration entry |
| --- | --- | --- |
| `correctorAgent` | `tandem-corrector` | `agents["tandem-corrector"]` |
| `readerAgent` | `web-fetcher` | `agents["web-fetcher"]` |
| `fetchTool` | `fetch_page` | Native internal follow-up tool name |

Core bundled registration imports `TandemAuxiliaryPlugin` from `./tandem/auxiliary.js` relative to
`packages/core/src/plugin/internal.ts`. It has two registrations, `Defaults` and `Policy`.

## Session metadata

Create every auxiliary with an explicit metadata object before prompting:

```ts
{
  tandemAuxiliary: "corrector", // or "browser-reader"
  tandemBareContext: true,
  tandemCorrectorDisabled: true,
  tandemAuxiliaryOwner: parentID,
}
```

`Metadata` validates the two role literals, literal true flags and a nonempty owner string. The
public session API validates the actual Session ID fields. Decode unknown metadata at the owning
feature boundary; do not treat arbitrary JSON as a typed auxiliary record.

The shared instruction policy recognizes only literal `tandemBareContext === true`. This is an
explicit opt-in, including for debug roots; missing/false/string-valued flags do not opt in. Normal
sessions start in default mode. Corrector must separately exclude both auxiliary roles and literal
`tandemCorrectorDisabled === true` to prevent recursive correction.

Supply explicit metadata, permissions, agent and selected model when creating a child. Omitting
metadata or permissions inherits the parent's values. Do not copy normal prompt/session metadata
wholesale. Use fresh sessions only: neither this hook nor changing metadata erases previously
admitted instruction history, and auxiliary mode must stay fixed for the session's lifetime.

## Public instruction hook and ordering

Both APIs export `SessionInstructions` from their `session` leaf:

```ts
import type { SessionInstructions } from "@opencode/plugin/effect/session"
// Promise equivalent: "@opencode/plugin/promise/session"

// ctx.session.hook("instructions", callback)
// readonly sessionID: Session.ID
// readonly agent: Agent.ID
// mutable mode: "default" | "agent-only"
```

Hooks run sequentially in registration order, with no typed failure channel. Each invocation starts
with `mode: "default"`. The shared Policy hook reads durable session metadata through
`ctx.session.get` and selects `agent-only` for literal bare-context opt-in.

Core invokes the hook after activation and agent selection, before loading ambient instruction
producers in `SessionContext.select`. Agent-only returns `Instructions.empty`, with the ordinary
permission-filtered tool snapshot. It skips discovery, built-ins, skills, references, MCP guidance,
CodeMode catalog instructions and API-managed instruction entries. Ordinary `InstructionState`
processing establishes an empty durable epoch baseline before input promotion; the selected agent's
system prompt and normal child transcript remain. It does not rewrite context late or clear history.

Core invokes the same hook in `SessionInstructions.load` before path claims, file reads or synthetic
admission. Agent-only returns immediately, so Read's automatic nearby `AGENTS.md` injection cannot
occur. Explicitly reading a file still returns that file's content; this policy suppresses automatic
instruction discovery, not requested file data.

A hook defect/interruption is not an ambient fallback. Selection stops before promotion/dispatch;
Read's existing discovery-error handling may retain the successful read, but no instruction is
injected. Feature code should recover expected correction failures without swallowing interruption.

## Registration and defaults

Boot order is built-in `pre` → external plugins → built-in `post`.

1. `TandemAuxiliaryPlugin.Defaults` (`tandem.auxiliary.defaults`) is in `pre`, immediately after the
   upstream Agent plugin. It creates hidden, primary-mode agents. Corrector defaults to no tools and
   has no hard-coded model. Reader defaults to `openai/gpt-5.6-sol#medium`, wildcard deny, then allow
   `fetch_page` and `read`. Neither default supplies feature system instructions yet.
2. Feature default agent/system/tool transforms belong before `ConfigAgentPlugin`. Configuration
   then overrides model, system and request settings through existing agent configuration.
3. `TandemAuxiliaryPlugin.Policy` (`tandem.auxiliary.policy`) is last in `post`. It registers the
   instruction policy, enforces hidden primary-mode for existing auxiliary agents, and appends
   `fetch_page` deny to all other agents. It does not recreate explicitly disabled agents or change
   user model/system/request overrides. Do not register a later hook that re-enables ambient sources.

Primary mode excludes these agents from the general subagent catalog and rejects guessed calls
through the subagent tool. Hidden is agent-catalog visibility, not a server session access restriction.
Linked children are absent from root session lists. Full auxiliary child-UI visibility filtering is
separate coordinated work; do not bypass session storage/execution to implement hiding.

Register `fetch_page` with `codemode: false`. Its executor must validate browser-reader role/owner
and enforce budgets; catalog filtering is not execution authorization. The invoking feature supplies
explicit child permissions: Corrector denies all tools; reader allows only fetch/read and any narrowly
required runtime-scratch external-directory access. The shared default does not grant unrestricted
external-directory access. Reader's medium text verbosity belongs to the browser fetch feature's request
hook, preserving explicit user settings; no shared transport/request payload rewrite is installed.

Legacy `small_model` normalization independently supplies `agents["tandem-corrector"].model` and
retains upstream's title-model mapping. Explicit legacy/native Corrector agent configuration wins
over that migration default. A title-specific model override does not populate Corrector. Corrector
can read its configured default publicly with
`ctx.agent.get({ agentID: TandemAuxiliary.correctorAgent })` (the agent is in `.data`); its feature precedence is environment
override → configured Corrector model (including migrated small_model) → available cheap session-
provider model → session/default model. Explicit child model selection is still feature-owned.

## Prompt correction metadata

`CorrectorMetadata` defines the shared schema/type; `readCorrectorMetadata` decodes unknown metadata
at the feature boundary:

| Key | Value | Meaning |
| --- | --- | --- |
| `tandemCorrectorDisabled` | optional boolean | Snapshot true when off, false when on; absence defaults on |
| `tandemPromptCorrectorOriginal` | optional string | Changed authored text before accepted correction |
| `tandemPromptCorrectorRanges` | optional array of `{start,end}` | Ordered, nonoverlapping, half-open UTF-16 authored-text ranges in `PromptInput.text` |
| `tandemPromptCorrectorProcessed` | optional string | SHA-256 fingerprint of correctable text/ranges after processing |

`CorrectorRange` validates nonnegative integer offsets. Bounds, ordering and the fingerprint input
encoding belong to Corrector; the implemented encoding is described in `tandem-corrector.md`.
Do not correct generated attachment references/comment notes appended to text. Each range retains
the per-range trimmed-length limit. After accepted edits, update ranges, presentation `displayText`
and structured mention offsets together; reject an edit that cannot preserve a mention unambiguously.
Attachments and context suffixes retain their content/identities.

Same-ID retries are first-admission-wins and bypass prompt preparation. Queue edits create new IDs,
preserve the disabled snapshot, and invalidate original/processed metadata when authored input
changes. Reorder replacements preserve the fingerprint to avoid reprocessing identical admitted
text. Failed or unchanged correction also marks the processed text so reordering does not retry it.
Undo/resend and restored retry state need feature-owned snapshot plumbing; current draft retry state
does not carry this metadata. Later toggle changes must not alter existing queued/retried intent.

## Owner lifecycle and cancellation

Each feature owns its children. Public APIs are `ctx.session.create`, `prompt`, `wait`, `get`,
`context`, `interrupt`, and `remove`. Prompt returns admission, not an answer. Wait observes idle,
not success: afterward inspect `get().outcome` and the final assistant content in `context()`.

Use an operation scope, not the long-lived plugin scope. Effect's acquire/release pairs creation
with a finalizer even if cancellation arrives immediately after acquisition:

```ts
yield* Effect.scoped(
  Effect.gen(function* () {
    const child = yield* Effect.acquireRelease(
      ctx.session.create({ parentID, agent, model, metadata, permissions }),
      (child) => ctx.session.remove({ sessionID: child.id }).pipe(
        Effect.catch((error) => Effect.logWarning("Auxiliary cleanup failed", error)),
      ),
    )
    yield* ctx.session.prompt({ sessionID: child.id, text })
    yield* ctx.session.wait({ sessionID: child.id })
    const state = yield* ctx.session.get({ sessionID: child.id })
    const transcript = yield* ctx.session.context({ sessionID: child.id })
    // Validate outcome/answer here and return the feature result before removal.
  }),
)
```

`remove` already interrupts, waits for cleanup, closes transport and removes descendants. A separate
interrupt is useful for early cancellation acknowledgement; it does not wait for settlement. Child
execution wakes independently, so interrupting only the waiter does not stop it without this finalizer.
Promise plugins must arrange equivalent awaited cleanup and explicit operation abort handling.

Normal children are removed on success, error, timeout and operation cancellation. Cleanup failures
are reported without replacing the feature result or masking the original interruption. Corrector
debug retention may create visible roots at the invoking Location; retain owner/bare metadata and
stop/wait the child before keeping it. Debug pruning belongs to Corrector and must skip active children.

Parent pre-admission Stop remains limited: a parent may have no active execution while its prompt
hook is correcting, so `session.interrupt(parentID)` can be an idle no-op. Cancel the admission
operation itself to activate its finalizer. No new parent admission-ownership semantics are supplied.
Process death cannot execute finalizers; startup orphan cleanup is not implemented by this foundation.

## Boundaries

Generic Effect/Promise registration forwards the instructions hook, so no HTTP schema or client
regeneration is needed. Feature algorithms, prompts and child result handling live with each feature
(Corrector, browser fetch). Isolation runs before durable instruction preparation and provider request
assembly; request diagnostics observe auxiliary and normal requests after all transformations.
