// UPSTREAM-DIVERGENCE: Tandem-only module (image-based context compaction).
// `/compact-image` orchestration: gate → boundary selection → transcript → render →
// inject a durable compaction pair (user message carrying the pages + fabricated
// summary assistant) → report savings. See ImageCompaction-PRD.md.
//
// The compaction boundary mechanism mirrors summary compaction exactly (verified against
// message-v2.ts filterCompacted and compaction.ts completedCompactions): a user message
// with a `compaction` part (tail_start_id set), paired via parentID with a later
// assistant message that has summary: true, a clean finish, and no error. No processor
// or model run is involved — the pages ARE the summary.

import path from "path"
import fs from "fs/promises"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Global } from "@opencode-ai/core/global"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session } from "../session"
import { SessionID, MessageID, PartID } from "../schema"
import { MessageV2 } from "../message-v2"
import { SessionCompactionEvent } from "@opencode-ai/schema/session-compaction-event"
import { Config } from "@/config/config"
import { Token } from "@/util/token"
import { InstanceState } from "@/effect/instance-state"
import { EventV2Bridge } from "@/event-v2-bridge"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { NotFoundError } from "@/storage/storage"
import { NamedError } from "@opencode-ai/core/util/error"
import { Effect, Layer, Context } from "effect"

import { reflow, renderTranscriptPages, pageTokens } from "./render"
import { serializeTranscript, buildJunkContext, stripAnsi } from "./transcript"
import { PART_MARKER } from "./marker"

/** Model-ID substrings allowed to read dense transcript pages. Empirical (pxpipe
 *  FINDINGS): Fable 5 reads them at ~100% gist / ~87% verbatim; Opus 4.8 at 0/15
 *  verbatim with silent confabulation. Keep conservative; override via config
 *  `compaction.image.models`. */
export const DEFAULT_MODELS = ["claude-fable-5"]

/** Max turns kept as text after the imaged range (the token budget usually binds
 *  first; raised from 4 when straddler-stubbing freed budget headroom). Shrinks on
 *  sessions with few (giant) turns so at least two turns stay imageable. */
export const TAIL_TURNS = 6
/** Tools whose outputs are never stub-cleared. Mirrors the non-exported
 *  PRUNE_PROTECTED_TOOLS in session/compaction.ts. */
const STUB_PROTECTED_TOOLS = ["skill"]
/** Rough token estimate for tail budgeting. 3.3 measured on real code/tool-heavy
 *  sessions (chars/4 under-priced the tail by ~20%). */
export const CHARS_PER_TOKEN = 3.3
/** Base64 thinking-block signatures tokenize worse than prose. */
export const SIGNATURE_CHARS_PER_TOKEN = 2.5
/** Token budget for the text tail. The budget only moves WHOLE turns across the image
 *  boundary — it never cuts inside a turn, so the model never sees a mid-sentence or
 *  mid-tool-call seam. A single oversized turn in the tail window lands on the imaged
 *  pages instead (where junk passes elide with explicit markers). The newest turn is
 *  always kept whole, even when it alone exceeds the budget. */
export const TAIL_TOKEN_BUDGET = 8_000
/** Refuse when fewer raw chars than this would be imaged — not worth a boundary.
 *  (A turn-count minimum was dropped: real agent sessions are few huge turns.) */
export const MIN_CHARS = 20_000
/** Page budget per compaction INCLUDING pages carried forward from previous image
 *  compactions, so repeated compactions ratchet toward refusal predictably. Leaves
 *  generous headroom under the API's 100-images-per-request limit. */
export const MAX_PAGES = 40

/** Marker metadata on the synthetic text parts of an image compaction. Lives in the
 *  dependency-free ./marker leaf so message-v2.ts can share it without a cycle. */
export { PART_MARKER } from "./marker"

export interface Result {
  ok: boolean
  message: string
}

export interface RunInput {
  sessionID: SessionID
  providerID: ProviderV2.ID
  modelID: ModelV2.ID
  agent: string
}

/** A user message that is the boundary of a completed image compaction: carries both a
 *  compaction part and rendered page file parts. */
export function isImageCompactionMessage(msg: SessionV1.WithParts): boolean {
  return (
    msg.info.role === "user" &&
    msg.parts.some((p) => p.type === "compaction") &&
    msg.parts.some((p) => p.type === "file")
  )
}

/** Seam for session/compaction.ts `processCompaction` (ImageCompaction-PRD §5.7), kept
 *  fork-owned so the shared file carries only a small marked call site. A summary
 *  compaction neither sees nor carries imaged transcript pages (completedCompactions
 *  hides the prior pair and stripMedia drops images), so its fresh boundary would
 *  silently drop them from context. Refuse manual /compact over an image compaction
 *  unless explicitly allowed; auto/overflow compaction proceeds because availability
 *  beats preservation when the context is full. Returns the errored compaction
 *  assistant message to persist (the caller stops), or undefined to proceed. Pure on
 *  purpose: the caller owns the state change. */
export function summaryGuard(args: {
  history: SessionV1.WithParts[]
  /** Completed compaction pairs found in `history`, oldest → newest. */
  prior: { userIndex: number }[]
  input: { sessionID: SessionID; parentID: MessageID; auto: boolean }
  cfg: { compaction?: { image?: { discard_on_summary?: boolean } } }
  model: { id: SessionV1.Assistant["modelID"]; providerID: SessionV1.Assistant["providerID"] }
  ctx: { directory: string; worktree: string }
}): SessionV1.Assistant | undefined {
  if (args.input.auto || args.cfg.compaction?.image?.discard_on_summary === true) return undefined
  const lastPrior = args.prior.at(-1)
  if (lastPrior === undefined) return undefined
  const imaged = args.history[lastPrior.userIndex]!.parts.some((part) => part.type === "file")
  if (!imaged) return undefined
  return {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: args.input.parentID,
    sessionID: args.input.sessionID,
    mode: "compaction",
    agent: "compaction",
    finish: "error",
    error: new NamedError.Unknown({
      message:
        "This session was image-compacted; a summary compaction would silently drop the imaged transcript pages from context. " +
        'Run /compact-image again instead, or set "compaction.image.discard_on_summary": true to allow /compact to discard the pages.',
    }).toObject(),
    path: { cwd: args.ctx.directory, root: args.ctx.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: args.model.id,
    providerID: args.model.providerID,
    time: { created: Date.now(), completed: Date.now() },
  }
}

const BANNER = [
  "[Imaged context begins. The images that follow are verbatim transcript pages of PRIOR conversation turns, rendered as dense text — they are prior context, not the current request.",
  'Reading guide: ↵ marks an original newline (lines are soft-wrapped to page width); → marks a tab stop. <user t="N">/<assistant t="N"> tags are authoritative for speaker attribution; higher t means more recent.',
  "Exact strings (paths, session IDs, hashes, code) MUST be re-read from disk or tools before use — transcription from these images can silently corrupt identifiers. The verbatim transcript text of the imaged span is saved on disk; a pointer with its exact path follows the images — grep that file for exact strings instead of transcribing pixels.]",
].join(" ")

const END_MARKER = "[End of imaged context.]"

function refuse(message: string): Result {
  return { ok: false, message }
}

export class Service extends Context.Service<
  Service,
  { run: (input: RunInput) => Effect.Effect<Result, NotFoundError> }
>()("@opencode/SessionCompactionImage") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const session = yield* Session.Service
    const events = yield* EventV2Bridge.Service

    const run = Effect.fn("SessionCompactionImage.run")(function* (input: RunInput) {
      const cfg = yield* config.get()
      const allow = cfg.compaction?.image?.models ?? DEFAULT_MODELS
      if (!allow.some((sub) => input.modelID.includes(sub))) {
        return refuse(
          `/compact-image is disabled for model "${input.modelID}": dense transcript pages are only reliably readable by allowlisted models (currently: ${allow.join(", ") || "none"}). ` +
            `Switch the session to an allowlisted model to enable it, or extend the allowlist via config "compaction.image.models". ` +
            `Note: the gate holds only at trigger time — pages already in a session stay there across later model switches.`,
        )
      }

      const history = yield* session.messages({ sessionID: input.sessionID })
      const indexByID = new Map(history.map((msg, index) => [msg.info.id, index]))
      const indexOf = (id: MessageID) => indexByID.get(id) ?? -1

      // Live model context, exactly as the provider would see it (compaction pair first,
      // then retained tail, then subsequent turns).
      const live = MessageV2.filterCompacted([...history].reverse())

      // Turn boundaries follow summary compaction's rule: user messages without a
      // compaction part start turns. Imaged messages leave model context entirely, so
      // tool_use/tool_result pairs and thinking signatures vanish together.
      const turnStarts = live.filter(
        (msg) => msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction"),
      )
      if (turnStarts.length < 3) {
        return refuse(
          `Not enough history to image: ${turnStarts.length} turns in context, need at least 3 (2 imaged + a kept tail).`,
        )
      }
      // Tail selection: token-budgeted, whole turns only, capped at TAIL_TURNS and
      // leaving at least two turns imageable. When the walk hits a turn too big to
      // fit whole (the straddler), it is still kept as text IF clearing its oldest
      // completed tool outputs (upstream prune mechanism: `state.time.compacted` →
      // "[old tool result content cleared]") brings it under budget — and the
      // straddler is then ALSO rendered onto the pages, so cleared outputs stay
      // recoverable in pixels. Turn boundaries and whole tool outputs are the only
      // granularity: no mid-sentence or mid-tool-call seams ever. The newest turn
      // is always kept (softened as far as possible) even when it alone exceeds
      // the budget.
      const budgetChars = TAIL_TOKEN_BUDGET * CHARS_PER_TOKEN
      const maxTail = Math.min(TAIL_TURNS, Math.max(1, turnStarts.length - 2))
      const turnSlice = (turn: number) => {
        const start = live.findIndex((m) => m.info.id === turnStarts[turn]!.info.id)
        const end =
          turn + 1 < turnStarts.length
            ? live.findIndex((m) => m.info.id === turnStarts[turn + 1]!.info.id)
            : live.length
        return { start, end }
      }
      // Estimated REQUEST chars for a turn: serialized text/tool-io PLUS the turn's
      // reasoning text and thinking-block signatures. Reasoning is replayed to the
      // API (message-v2 toModelMessage) but deliberately absent from pages and
      // serialization, so without this it is invisible to the budget — live-measured
      // at ~13k tokens of hidden weight on a single tool-heavy tail turn (17 blocks,
      // 46k chars of base64 signatures). Signatures are weighted up to express them
      // in CHARS_PER_TOKEN units.
      const turnChars = (turn: number) => {
        const { start, end } = turnSlice(turn)
        const msgs = live.slice(start, end)
        let reasoning = 0
        for (const m of msgs)
          for (const p of m.parts) {
            if (p.type !== "reasoning") continue
            const signature = (p.metadata?.anthropic as { signature?: string } | undefined)?.signature?.length ?? 0
            reasoning += p.text.length + Math.round(signature * (CHARS_PER_TOKEN / SIGNATURE_CHARS_PER_TOKEN))
          }
        return serializeTranscript(msgs, indexOf).text.length + reasoning
      }
      const STUB_CHARS = "[tool_result]\n[old tool result content cleared]".length
      // Plan which of the straddler's tool outputs to clear, oldest first, until the
      // turn's estimated cost fits the remaining budget. `fits: false` when even
      // clearing everything clearable is not enough (e.g. giant text parts).
      const stubPlan = (turn: number, chars: number, used: number) => {
        const { start, end } = turnSlice(turn)
        const clearable = live
          .slice(start, end)
          .flatMap((m) => (m.info.role === "assistant" ? m.parts : []))
          .filter(
            (p): p is SessionV1.ToolPart =>
              p.type === "tool" &&
              p.state.status === "completed" &&
              !p.state.time.compacted &&
              !STUB_PROTECTED_TOOLS.includes(p.tool),
          )
        let projected = chars
        const clear: SessionV1.ToolPart[] = []
        for (const part of clearable) {
          if (used + projected <= budgetChars) break
          if (part.state.status !== "completed") continue
          projected -= Math.max(0, part.state.output.length - STUB_CHARS)
          clear.push(part)
        }
        if (clear.length === 0) return undefined
        return { clear, fits: used + projected <= budgetChars }
      }
      let tailTurns = 0
      let tailChars = 0
      let stub: { turn: number; clear: SessionV1.ToolPart[] } | undefined
      for (let k = 1; k <= maxTail; k++) {
        const turn = turnStarts.length - k
        const chars = turnChars(turn)
        if (tailChars + chars <= budgetChars) {
          tailTurns = k
          tailChars += chars
          continue
        }
        const plan = stubPlan(turn, chars, tailChars)
        if (plan?.fits) {
          tailTurns = k
          stub = { turn, clear: plan.clear }
        } else if (k === 1) {
          // Newest-turn floor: kept whole over budget, softened as far as possible.
          tailTurns = 1
          if (plan) stub = { turn, clear: plan.clear }
        }
        break
      }
      const tailStart = turnStarts[turnStarts.length - tailTurns]!
      const tailIndex = live.findIndex((msg) => msg.info.id === tailStart.info.id)
      const imaged = live.slice(0, tailIndex)

      // Carry forward pages and sidecar pointers of any previous image compaction in
      // range — never re-render images of images (§5.2). Legacy "factsheet" parts from
      // pre-sidecar compactions carry forward the same way.
      const carriedFiles: SessionV1.FilePart[] = []
      const carriedPointers: string[] = []
      const skip = new Set<MessageID>()
      for (const msg of imaged) {
        if (!isImageCompactionMessage(msg)) continue
        skip.add(msg.info.id)
        for (const part of msg.parts) {
          if (part.type === "file") carriedFiles.push(part)
          if (
            part.type === "text" &&
            (part.metadata?.[PART_MARKER] === "sidecar" || part.metadata?.[PART_MARKER] === "factsheet")
          )
            carriedPointers.push(part.text)
        }
        const summary = imaged.find(
          (m) => m.info.role === "assistant" && m.info.summary && m.info.parentID === msg.info.id,
        )
        if (summary) skip.add(summary.info.id)
      }
      const serializable = imaged.filter((msg) => !skip.has(msg.info.id))
      const imagedTurns = serializable.filter(
        (msg) => msg.info.role === "user" && !msg.parts.some((part) => part.type === "compaction"),
      ).length

      // Raw (pre-junk-pass) serialization: drives the refusal metrics, the savings
      // estimate, and the verbatim sidecar, so elision never loses an identifier.
      const raw = serializeTranscript(serializable, indexOf)
      if (imagedTurns < 1 || raw.text.length < MIN_CHARS) {
        return refuse(
          `Not enough history to image: ${imagedTurns} turns / ${raw.text.length} chars would be imaged, need at least ${MIN_CHARS} chars.`,
        )
      }

      // The straddler (if any) is rendered onto the pages too — its soon-to-be-cleared
      // outputs must stay recoverable in pixels — but it is NOT part of the removed
      // span: the refusal metrics above and carried-page scan stay on `imaged`.
      const renderSource = stub ? [...serializable, ...live.slice(tailIndex, turnSlice(stub.turn).end)] : serializable
      const rawRender = stub ? serializeTranscript(renderSource, indexOf) : raw
      const junk = buildJunkContext(renderSource, indexOf)
      const rendered = serializeTranscript(renderSource, indexOf, junk)
      const pages = yield* Effect.promise(() => renderTranscriptPages(reflow(rendered.text), reflow(rendered.slotText)))
      if (carriedFiles.length + pages.length > MAX_PAGES) {
        return refuse(
          `Refusing: this compaction would produce ${carriedFiles.length + pages.length} pages (${carriedFiles.length} carried forward), over the ${MAX_PAGES}-page budget. ` +
            `Run /compact to summary-compact instead (set "compaction.image.discard_on_summary": true first — a summary discards the imaged pages).`,
        )
      }

      // Verbatim sidecar (§5.4): the raw pre-elision transcript written to disk with
      // real newlines, so exact strings are recovered by grep instead of transcribed
      // from pixels. ANSI is stripped (never an identifier); everything else — including
      // outputs the junk passes elide from the pages — is byte-faithful. The message ID
      // is generated early so the file lands (and can fail) before any state change.
      const userMsgID = MessageID.ascending()
      const sidecarPath = path.join(Global.Path.data, "compaction", input.sessionID, `${userMsgID}.txt`)
      const sidecarText = [
        `Verbatim transcript (raw serialization, before elision passes; ANSI stripped) of the span imaged by compaction ${userMsgID} in session ${input.sessionID}.`,
        `Speaker tags: <user t="N">…</user> / <assistant t="N">…</assistant>; t is the absolute message index within the session.`,
        "",
        stripAnsi(rawRender.text),
        "",
      ].join("\n")
      yield* Effect.promise(async () => {
        await fs.mkdir(path.dirname(sidecarPath), { recursive: true })
        await fs.writeFile(sidecarPath, sidecarText, "utf8")
      })
      const pointerText =
        `[Exact strings must not be transcribed from the images — transcription can silently corrupt identifiers. ` +
        `The verbatim transcript of the span imaged above is saved as plain text (real newlines, greppable) at ${sidecarPath} — ` +
        `grep it for any string needed exactly; it holds the full pre-elision content, including outputs the pages elided.]`

      const bannerText = stub
        ? `${BANNER} [The imaged span ends mid-turn: the final imaged turn continues after the images as live text, with its older tool outputs cleared — the cleared outputs are preserved on the pages above.]`
        : BANNER
      const imageTokens = pages.reduce((sum, page) => sum + pageTokens(page), 0) + carriedFiles.length * 1522
      const beforeTokens = Token.estimate(raw.text)
      const afterTokens =
        imageTokens + Token.estimate([bannerText, ...carriedPointers, pointerText, END_MARKER].join("\n"))
      const feedback =
        `Imaged ${imagedTurns} turns (${rawRender.text.length.toLocaleString("en-US")} chars raw, ${rendered.text.length.toLocaleString("en-US")} rendered after junk passes) ` +
        `into ${pages.length} pages${carriedFiles.length > 0 ? ` (+${carriedFiles.length} carried forward)` : ""} ` +
        `≈ ${afterTokens.toLocaleString("en-US")} tokens (was ≈ ${beforeTokens.toLocaleString("en-US")}). ` +
        `Tail of ${tailTurns} turn${tailTurns === 1 ? "" : "s"} kept as text` +
        (stub
          ? `; the oldest tail turn straddles the boundary — ${stub.clear.length} old tool output${stub.clear.length === 1 ? "" : "s"} cleared from text (full content on the pages).`
          : ".")

      // --- durable injection (the only state change) ---------------------------------
      const now = Date.now()
      const userMsg = yield* session.updateMessage({
        id: userMsgID,
        role: "user",
        model: { providerID: input.providerID, modelID: input.modelID },
        sessionID: input.sessionID,
        agent: input.agent,
        time: { created: now },
      })
      const base = () => ({ id: PartID.ascending(), messageID: userMsg.id, sessionID: input.sessionID })
      const textPart = (text: string, marker: string): SessionV1.TextPart => ({
        ...base(),
        type: "text",
        text,
        synthetic: true,
        metadata: { [PART_MARKER]: marker },
        time: { start: now, end: now },
      })

      yield* session.updatePart({
        ...base(),
        type: "compaction",
        auto: false,
        tail_start_id: tailStart.info.id,
      } satisfies SessionV1.CompactionPart)
      yield* session.updatePart(textPart(bannerText, "banner"))
      for (const file of carriedFiles) {
        yield* session.updatePart({
          ...base(),
          type: "file",
          mime: file.mime,
          filename: file.filename,
          url: file.url,
        } satisfies SessionV1.FilePart)
      }
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i]!
        yield* session.updatePart({
          ...base(),
          type: "file",
          mime: "image/png",
          filename: `context-page-${String(carriedFiles.length + i + 1).padStart(2, "0")}.png`,
          url: `data:image/png;base64,${Buffer.from(page.png).toString("base64")}`,
        } satisfies SessionV1.FilePart)
      }
      for (const text of carriedPointers) yield* session.updatePart(textPart(text, "sidecar"))
      yield* session.updatePart(textPart(pointerText, "sidecar"))
      yield* session.updatePart(textPart(END_MARKER, "end"))

      // Paired summary assistant: summary+finish+no-error is what completedCompactions,
      // filterCompacted, and the prune loop all key on. Its text becomes previousSummary
      // for any later summary compaction, so make it a real sentence.
      const ctx = yield* InstanceState.context
      const assistantMsg: SessionV1.Assistant = {
        id: MessageID.ascending(),
        role: "assistant",
        parentID: userMsg.id,
        sessionID: input.sessionID,
        mode: "compaction",
        agent: "compaction",
        summary: true,
        finish: "stop",
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: input.modelID,
        providerID: input.providerID,
        time: { created: now, completed: now },
      }
      yield* session.updateMessage(assistantMsg)
      yield* session.updatePart({
        id: PartID.ascending(),
        messageID: assistantMsg.id,
        sessionID: input.sessionID,
        type: "text",
        text:
          `Context before this point was compacted into ${carriedFiles.length + pages.length} transcript-page images carried in the preceding message. ` +
          feedback,
        time: { start: now, end: now },
      })

      // Clear the straddler's old tool outputs LAST — pages carrying the full content
      // are durably in place above, and rendering already happened from live outputs.
      if (stub) {
        for (const part of stub.clear) {
          if (part.state.status === "completed") {
            part.state.time.compacted = now
            yield* session.updatePart(part)
          }
        }
      }

      yield* events.publish(SessionCompactionEvent.Compacted, { sessionID: input.sessionID })
      return { ok: true, message: feedback }
    })

    return Service.of({ run })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, Session.node, EventV2Bridge.node],
})

export * as SessionCompactionImage from "./compaction-image"
