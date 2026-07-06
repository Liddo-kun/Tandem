// UPSTREAM-DIVERGENCE: Tandem-only module (image-based context compaction).
// Adapted from pxpipe (github.com/teamchong/pxpipe) src/core/render.ts, MIT License,
// Copyright (c) 2026 claude-image-proxy contributors.
//
// Text → PNG renderer for `/compact-image` transcript pages. Blits pre-rasterized 5×8
// grayscale glyphs into a framebuffer, then PNG-encodes — pure JS at runtime under Bun,
// no native canvas. The geometry is pxpipe's audited page shape (2026-07-01 count_tokens
// sweep): the Anthropic API downscales any image to fit BOTH long-edge ≤1568 AND ~1.15 MP,
// then bills ≈ px/750. A 1568×728 page fits both bounds, so billed pixels reach the vision
// encoder unresampled (WYSIWYG glyphs). 312 cols × 5 px + 2×4 px pad = 1568 px exactly;
// 313 cols would trigger a 0.997× resample that blurs every glyph.
//
// Differences from pxpipe: only the production dense path is kept (AA gray atlas +
// colorByRole tags, the configuration behind the measured fidelity numbers); the 1-bit
// atlas, multi-column packing, grid/marker eval styles, and canvas shrinking are dropped.
// Output must stay deterministic: same input text → byte-identical PNGs.

import {
  ATLAS_GRAY_CELL_W,
  ATLAS_GRAY_CELL_H,
  ATLAS_GRAY_PIXELS,
  ATLAS_GRAY_OFFSETS,
  ATLAS_GRAY_WIDE_FLAGS,
  atlasGrayRank,
} from "./atlas-gray"
import { encodeRgbPng } from "./png"

/** Columns per page. 312 × 5 px + 8 px pad = 1568 px — exactly the API's long-edge bound. */
export const COLS = 312
/** Page-height ceiling in px (see module header: 1568×728 ≈ 1.14 MP fits the API's resample bounds). */
export const MAX_HEIGHT_PX = 728
/** Source chars per page: 312 cols × 90 rows. */
export const CHARS_PER_PAGE = 28080
/** Anthropic bills roughly one token per 750 pixels for images under the resample cap. */
export const PIXEL_TOKEN_DIVISOR = 750

const PAD_X = 4
const PAD_Y = 4
const TAB_WIDTH = 4

export interface RenderedPage {
  png: Uint8Array
  width: number
  height: number
  /** Codepoints absent from the atlas, rendered as blank cells (telemetry). */
  droppedChars: number
}

/** Estimated Anthropic token cost of one rendered page (pixel-area formula). */
export function pageTokens(page: { width: number; height: number }): number {
  return Math.ceil((page.width * page.height) / PIXEL_TOKEN_DIVISOR)
}

// --- reflow ----------------------------------------------------------------
//
// Marks each original hard newline with U+21B5 ↵ so the model can distinguish real
// newlines from soft-wraps, then packs lines to full page width. pxpipe-validated:
// +1pp char accuracy and no blank-row waste on newline-heavy transcripts.

/** U+21B5 ↵ sentinel for original hard newlines in reflowed text. */
export const NL_SENTINEL = "↵"
const NL_SENTINEL_CP = 0x21b5

/** Look-alike (U+23CE ⏎) replacing any ↵ already present in source content, so reflow
 *  stays unambiguous even when the transcript is about image compaction itself. */
export const NL_SENTINEL_LITERAL = "⏎"

export function neutralizeSentinel(text: string): string {
  return text.indexOf(NL_SENTINEL) >= 0 ? text.split(NL_SENTINEL).join(NL_SENTINEL_LITERAL) : text
}

/** Strip trailing whitespace per line and collapse 4+ consecutive \n to 3.
 *  Does NOT touch mid-line spaces or leading indent — structure is preserved. */
export function minifyForRender(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
}

/** Minify + tab-expand + join lines with the ↵ sentinel. Callers must
 *  {@link neutralizeSentinel} the input first. */
export function reflow(text: string): string {
  return minifyForRender(neutralizeSentinel(text)).split("\n").map(expandTabsInLine).join(NL_SENTINEL)
}

/** Expand \t to a visible U+2192 → marker + padding to the next 4-col stop. U+0009 has no
 *  atlas glyph, so unexpanded tabs would all be dropped chars. */
export function expandTabsInLine(line: string): string {
  if (line.indexOf("\t") < 0) return line
  let out = ""
  let col = 0
  for (const ch of line) {
    if (ch === "\t") {
      const span = TAB_WIDTH - (col % TAB_WIDTH)
      out += "→"
      if (span > 1) out += " ".repeat(span - 1)
      col += span
    } else {
      out += ch
      col += cellsFor(ch.codePointAt(0)!)
    }
  }
  return out
}

/** Visual width of a codepoint in cells (1 = Latin, 2 = East Asian Wide).
 *  Missing codepoints advance 1 cell so wrap math stays stable. */
function cellsFor(codepoint: number): number {
  const rank = atlasGrayRank(codepoint)
  if (rank < 0) return 1
  return ATLAS_GRAY_WIDE_FLAGS[rank] === 1 ? 2 : 1
}

/** Visual width of a line in cells (wide CJK = 2). */
export function measureLineCols(line: string): number {
  let w = 0
  for (const ch of line) w += cellsFor(ch.codePointAt(0)!)
  return w
}

export function wrapLines(text: string, cols: number = COLS): string[] {
  const out: string[] = []
  const minified = minifyForRender(text)
  for (const rawWithTabs of minified.split("\n")) {
    const raw = expandTabsInLine(rawWithTabs)
    if (raw.length === 0) {
      out.push("")
      continue
    }
    let cur = ""
    let curCols = 0
    // Codepoint iteration handles surrogate pairs as one unit. ↵ is an inline glyph.
    for (const ch of raw) {
      const cp = ch.codePointAt(0)!
      const w = cellsFor(cp)
      if (curCols + w > cols) {
        out.push(cur)
        cur = ch
        curCols = w
      } else {
        cur += ch
        curCols += w
      }
    }
    if (cur.length > 0) out.push(cur)
  }
  return out
}

// --- role-tag color slots ----------------------------------------------------
//
// A "slot string" is a width-preserving copy of the rendered text: every structural
// role-tag character is swapped for a C0 control marker, everything else is copied
// verbatim. Because markers share the width class of the ASCII tag chars they stand in
// for, reflow/wrapLines mutate the slot string in lockstep with the text, and the
// renderer reads role attribution BY POSITION — a body that literally quotes "<user>"
// can never forge a role hue.

export const SLOT_MARK_USER = String.fromCharCode(1)
export const SLOT_MARK_ASSISTANT = String.fromCharCode(2)
const SLOT_MARK_RE = new RegExp("[" + SLOT_MARK_USER + SLOT_MARK_ASSISTANT + "]", "g")

/** Non-marker C0 control replacing literal slot markers found in body content. Must not
 *  be ' '/'\t' (minifyForRender strips those trailing, which would desync slot and text). */
const SLOT_NEUTRAL = "\u0003"

export function slotCopyBody(body: string): string {
  if (body.indexOf(SLOT_MARK_USER) < 0 && body.indexOf(SLOT_MARK_ASSISTANT) < 0) return body
  return body.replace(SLOT_MARK_RE, SLOT_NEUTRAL)
}

/** Slot-string segment for one role-wrapped turn, mirroring `<${tag}${attr}>\n${body}\n</${tag}>`. */
export function roleSlotSegment(tag: string, body: string, mark: string, attr = ""): string {
  const open = `<${tag}${attr}>`
  const close = `</${tag}>`
  return `${mark.repeat(open.length)}\n${slotCopyBody(body)}\n${mark.repeat(close.length)}`
}

/** Role-tag tint palette, indexed by slot-1. Body content stays black. */
const ROLE_PALETTE: [number, number, number][] = [
  [20, 120, 50], // slot 1: <user> tags — green
  [30, 70, 180], // slot 2: <assistant> tags — blue
]

function slotForMarkCp(cp: number | undefined): number {
  if (cp === 0x0001) return 1
  if (cp === 0x0002) return 2
  return 0
}

// --- rendering ---------------------------------------------------------------

/** Blit a grayscale atlas glyph at pixel (x, y) using max-blending.
 *  Returns cells advanced (1 or 2), or 0 if absent from the atlas. */
function blitGlyph(fb: Uint8Array, fbW: number, x: number, y: number, codepoint: number): number {
  const rank = atlasGrayRank(codepoint)
  if (rank < 0) return 0
  const wide = ATLAS_GRAY_WIDE_FLAGS[rank] === 1
  const srcW = wide ? 2 * ATLAS_GRAY_CELL_W : ATLAS_GRAY_CELL_W
  const srcOff = ATLAS_GRAY_OFFSETS[rank]!
  for (let gy = 0; gy < ATLAS_GRAY_CELL_H; gy++) {
    const dstRow = (y + gy) * fbW + x
    const srcRow = srcOff + gy * srcW
    for (let gx = 0; gx < srcW; gx++) {
      const coverage = ATLAS_GRAY_PIXELS[srcRow + gx]!
      if (coverage > 0) {
        const idx = dstRow + gx
        if (coverage > fb[idx]!) fb[idx] = coverage
      }
    }
  }
  return wide ? 2 : 1
}

async function renderChunk(lines: string[], slotLines: string[], cols: number): Promise<RenderedPage> {
  const cellW = ATLAS_GRAY_CELL_W
  const cellH = ATLAS_GRAY_CELL_H
  const width = 2 * PAD_X + cols * cellW
  const height = 2 * PAD_Y + lines.length * cellH

  // Black canvas, inverted to black-on-white after blitting.
  const fb = new Uint8Array(width * height)
  // colorSlot per inked pixel (0 = body/black) for role-tag tinting.
  const colorMask = new Uint8Array(width * height)

  let droppedChars = 0
  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]!
    const baseY = PAD_Y + row * cellH
    const slotRow = Array.from(slotLines[row] ?? "")
    let col = 0
    let charIdx = 0
    for (const ch of line) {
      if (col >= cols) break
      const codepoint = ch.codePointAt(0)!
      const baseX = PAD_X + col * cellW
      const colorSlot = slotForMarkCp(slotRow[charIdx]?.codePointAt(0))
      const advance = blitGlyph(fb, width, baseX, baseY, codepoint)
      if (colorSlot > 0 && advance > 0) {
        const srcW = advance * cellW
        for (let gy = 0; gy < cellH; gy++) {
          const py = baseY + gy
          if (py >= height) break
          for (let gx = 0; gx < srcW; gx++) {
            const idx = py * width + baseX + gx
            if (fb[idx]! > 0) colorMask[idx] = colorSlot
          }
        }
      }
      charIdx++
      if (advance === 0) {
        droppedChars++
        col += 1 // missing glyph still occupies 1 cell for wrap stability
      } else {
        col += advance
      }
    }
  }

  // Invert to black-on-white, then tint role-tag pixels.
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < fb.length; i++) {
    const g = 255 - fb[i]! // 0 = ink, 255 = background
    const slot = colorMask[i]!
    if (slot > 0) {
      const coverage = 255 - g
      const [pr, pg, pb] = ROLE_PALETTE[(slot - 1) % ROLE_PALETTE.length]!
      rgb[i * 3] = Math.round(255 - (coverage * (255 - pr)) / 255)
      rgb[i * 3 + 1] = Math.round(255 - (coverage * (255 - pg)) / 255)
      rgb[i * 3 + 2] = Math.round(255 - (coverage * (255 - pb)) / 255)
    } else {
      rgb[i * 3] = g
      rgb[i * 3 + 1] = g
      rgb[i * 3 + 2] = g
    }
  }
  const png = await encodeRgbPng(rgb, width, height)
  return { png, width, height, droppedChars }
}

/**
 * Render a reflowed transcript (+ lockstep slot string) to dense PNG pages.
 * Input should already be reflowed (`reflow()` applied to both text and slot string);
 * this wraps to 312 cols and pages at ≤728 px height / ≤28080 chars.
 */
export async function renderTranscriptPages(text: string, slotText: string): Promise<RenderedPage[]> {
  const cols = COLS
  const lines = wrapLines(text, cols)
  const slotLines = wrapLines(slotText, cols)
  const hardLinesPerPage = Math.max(1, Math.floor((MAX_HEIGHT_PX - 2 * PAD_Y) / ATLAS_GRAY_CELL_H))
  const linesPerPage = Math.min(hardLinesPerPage, Math.max(1, Math.floor(CHARS_PER_PAGE / cols)))

  const pages: RenderedPage[] = []
  for (let start = 0; start < lines.length; start += linesPerPage) {
    const page = lines.slice(start, start + linesPerPage)
    const slotPage = slotLines.slice(start, start + linesPerPage)
    pages.push(await renderChunk(page, slotPage, cols))
  }
  if (pages.length === 0) pages.push(await renderChunk([""], [""], cols))
  return pages
}
