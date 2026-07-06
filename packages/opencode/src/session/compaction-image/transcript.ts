// UPSTREAM-DIVERGENCE: Tandem-only module (image-based context compaction).
// Transcript serialization for `/compact-image`: turns stored session messages into a
// tagged text transcript (`<user t="N">…</user>` / `<assistant t="N">…</assistant>`)
// plus a lockstep role-slot string for the renderer, applies the deterministic
// transcript-only junk passes of the PRD (§5.3.1), and never mutates stored messages.
// Turn-tag serialization shape follows pxpipe's history.ts (MIT).

import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { MessageID } from "../schema"
import { SLOT_MARK_USER, SLOT_MARK_ASSISTANT, roleSlotSegment } from "./render"

/** Junk-pass 5 head/tail caps: outputs longer than HEAD+TAIL+20 lines are elided. */
const OUTPUT_HEAD_LINES = 40
const OUTPUT_TAIL_LINES = 20
/** Junk-pass 5: ≥ this many consecutive identical lines collapse to one + marker. */
const REPEAT_COLLAPSE_MIN = 3
/** Junk-pass 6: standalone base64-ish runs at least this long become placeholders. */
const BASE64_RUN_MIN = 240

export interface TranscriptSegment {
  role: "user" | "assistant"
  /** Absolute message index within the full session history (recency anchor). */
  t: number
  body: string
}

export interface Transcript {
  /** Tagged transcript text (pre-reflow). */
  text: string
  /** Width-identical role-slot string (see render.ts). */
  slotText: string
}

// --- junk passes (pure string transforms; deterministic) ---------------------

/** Pass 7: strip ANSI escape/control sequences — the glyph atlas cannot render them. */
export function stripAnsi(text: string): string {
  // CSI, OSC (BEL or ST terminated), and lone ESC-char sequences.
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[@-Z\\-_]/g, "")
}

/** Pass 6: data URLs and long standalone base64 runs become typed placeholders. */
export function stripBinaryPayloads(text: string): string {
  return text
    .replace(/data:([\w.+-]+\/[\w.+-]+)?;base64,[A-Za-z0-9+/=]+/g, (m, mime) => {
      const kb = Math.max(1, Math.round((m.length * 3) / 4 / 1024))
      return `[${mime ?? "binary"} data-url ~${kb}KB]`
    })
    .replace(new RegExp(`[A-Za-z0-9+/]{${BASE64_RUN_MIN},}={0,2}`, "g"), (m) => {
      const kb = Math.max(1, Math.round((m.length * 3) / 4 / 1024))
      return `[base64 ~${kb}KB]`
    })
}

/** Pass 5b: collapse ≥3 consecutive identical non-empty lines to one + `[repeated ×N]`. */
export function collapseRepeatedLines(text: string): string {
  const lines = text.split("\n")
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    let j = i + 1
    while (j < lines.length && lines[j] === line) j++
    const run = j - i
    if (run >= REPEAT_COLLAPSE_MIN && line.trim() !== "") {
      out.push(line, `[repeated ×${run}]`)
    } else {
      for (let k = i; k < j; k++) out.push(line)
    }
    i = j
  }
  return out.join("\n")
}

/** Pass 5a: head+tail cap for giant tool outputs. */
export function capOutputLines(text: string): string {
  const lines = text.split("\n")
  // Only elide when it saves a meaningful amount, so short outputs stay verbatim.
  if (lines.length <= OUTPUT_HEAD_LINES + OUTPUT_TAIL_LINES + 20) return text
  const elided = lines.length - OUTPUT_HEAD_LINES - OUTPUT_TAIL_LINES
  return [
    ...lines.slice(0, OUTPUT_HEAD_LINES),
    `[… ${elided} lines elided …]`,
    ...lines.slice(lines.length - OUTPUT_TAIL_LINES),
  ].join("\n")
}

function cleanToolOutput(text: string): string {
  return capOutputLines(collapseRepeatedLines(stripBinaryPayloads(stripAnsi(text))))
}

// --- cross-message junk state -------------------------------------------------

const READ_TOOLS = new Set(["read"])

function readPath(part: SessionV1.ToolPart): string | undefined {
  if (!READ_TOOLS.has(part.tool)) return undefined
  if (part.state.status !== "completed") return undefined
  const input = part.state.input as Record<string, unknown>
  const path = input["filePath"] ?? input["file_path"] ?? input["path"]
  return typeof path === "string" ? path : undefined
}

/**
 * Junk-pass state precomputed across the whole imaged range:
 * - pass 2: for repeated reads of the same path, only the newest keeps its content;
 *   older ones map to the turn index of the superseding read.
 * - pass 8: repeated identical `<system-reminder>` blocks keep only their first
 *   occurrence (matched on exact block text).
 */
export interface JunkContext {
  supersededReads: Map<SessionV1.ToolPart, number>
  seenReminders: Set<string>
}

export function buildJunkContext(messages: SessionV1.WithParts[], indexOf: (id: MessageID) => number): JunkContext {
  const newestReadByPath = new Map<string, { part: SessionV1.ToolPart; t: number }>()
  const supersededReads = new Map<SessionV1.ToolPart, number>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      const path = readPath(part)
      if (!path) continue
      const t = indexOf(msg.info.id)
      const prev = newestReadByPath.get(path)
      if (prev) supersededReads.set(prev.part, t)
      newestReadByPath.set(path, { part, t })
    }
  }
  return { supersededReads, seenReminders: new Set() }
}

const REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g

/** Pass 8: keep the first occurrence of each identical reminder block, stub repeats.
 *  Stateful across the serialization walk (in message order), still deterministic. */
function dedupeReminders(text: string, ctx: JunkContext): string {
  return text.replace(REMINDER_RE, (block) => {
    if (ctx.seenReminders.has(block)) return "[system-reminder repeated — see first occurrence]"
    ctx.seenReminders.add(block)
    return block
  })
}

// --- serialization -------------------------------------------------------------

function serializeToolPart(part: SessionV1.ToolPart, opts: { junk?: JunkContext }): string {
  let args: string
  try {
    args = JSON.stringify(part.state.status === "pending" ? {} : (part.state.input ?? {}))
  } catch {
    args = "{}"
  }
  const head = `[tool_use ${part.tool}]\n${args}`
  switch (part.state.status) {
    case "completed": {
      // Pass 1: outputs already pruned from model context render as a one-line stub.
      if (part.state.time.compacted) return `${head}\n[tool_result]\n[old tool result content cleared]`
      const superseded = opts.junk?.supersededReads.get(part)
      if (superseded !== undefined) {
        return `${head}\n[tool_result]\n[read of ${readPath(part)} superseded by the read at turn ${superseded}]`
      }
      const attachments = (part.state.attachments ?? [])
        .map((a) => `[attachment ${a.mime}${a.filename ? `: ${a.filename}` : ""}]`)
        .join("\n")
      const output = opts.junk ? cleanToolOutput(part.state.output) : part.state.output
      return [head, `[tool_result]`, output, attachments].filter(Boolean).join("\n")
    }
    case "error":
      return `${head}\n[tool_result (error)]\n${opts.junk ? cleanToolOutput(part.state.error) : part.state.error}`
    default:
      return `${head}\n[tool_result (error)]\n[tool execution was interrupted]`
  }
}

function serializeMessage(msg: SessionV1.WithParts, opts: { junk?: JunkContext }): string {
  const out: string[] = []
  for (const part of msg.parts) {
    switch (part.type) {
      case "text": {
        if (part.ignored || part.text === "") break
        let text = part.text
        if (opts.junk) {
          text = stripBinaryPayloads(stripAnsi(text))
          text = dedupeReminders(text, opts.junk)
        }
        out.push(text)
        break
      }
      case "tool":
        out.push(serializeToolPart(part, opts))
        break
      case "file":
        // Pass 6 for parts: attachments never render as pixels-of-base64.
        out.push(`[attachment ${part.mime}${part.filename ? `: ${part.filename}` : ""}]`)
        break
      case "compaction":
        out.push("[context compaction request]")
        break
      case "subtask":
        out.push(`[subtask → ${part.agent}] ${part.description}`)
        break
      // reasoning is dropped (thinking blocks aren't worth pixels); the rest carry no prose.
      default:
        break
    }
  }
  return out.join("\n\n")
}

/**
 * Serialize messages into a tagged transcript + lockstep slot string.
 * With `junk` set, the §5.3.1 junk passes are applied (render form); without it the
 * output is the raw form written to the on-disk sidecar (and used for refusal
 * metrics), so elision never loses an identifier.
 */
export function serializeTranscript(
  messages: SessionV1.WithParts[],
  indexOf: (id: MessageID) => number,
  junk?: JunkContext,
): Transcript {
  const textOut: string[] = []
  const slotOut: string[] = []
  for (const msg of messages) {
    const body = serializeMessage(msg, { junk })
    if (!body.trim()) continue
    const isAssistant = msg.info.role === "assistant"
    const tag = isAssistant ? "assistant" : "user"
    const mark = isAssistant ? SLOT_MARK_ASSISTANT : SLOT_MARK_USER
    // Absolute index from session start: an explicit recency anchor so the model can
    // tell turn 3 from turn 60 instead of pattern-matching the most salient turn.
    const attr = ` t="${indexOf(msg.info.id)}"`
    textOut.push(`<${tag}${attr}>\n${body}\n</${tag}>`)
    slotOut.push(roleSlotSegment(tag, body, mark, attr))
  }
  return { text: textOut.join("\n\n"), slotText: slotOut.join("\n\n") }
}
