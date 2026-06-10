import { EOL } from "os"

// UPSTREAM-DIVERGENCE: Tandem brand startup logo, isolated in its own fork-owned module so the
// upstream files (cli/ui.ts, cli/logo.ts) stay all-but-untouched and future merges only ever hit a
// one-line delegate. "Tandem" ANSI Shadow wordmark rendered with a teal→sky→violet truecolor
// gradient and a gentle forward slant; plain rows on non-TTY. Shared by the CLI/web startup banner
// and the run-mode entry splash.
const baseWordmark = [
  "████████╗ █████╗ ███╗   ██╗██████╗ ███████╗███╗   ███╗",
  "╚══██╔══╝██╔══██╗████╗  ██║██╔══██╗██╔════╝████╗ ████║",
  "   ██║   ███████║██╔██╗ ██║██║  ██║█████╗  ██╔████╔██║",
  "   ██║   ██╔══██║██║╚██╗██║██║  ██║██╔══╝  ██║╚██╔╝██║",
  "   ██║   ██║  ██║██║ ╚████║██████╔╝███████╗██║ ╚═╝ ██║",
  "   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝     ╚═╝",
]

export const wordmark = baseWordmark.map(
  (row, index) => " ".repeat(Math.round((baseWordmark.length - 1 - index) * 0.6)) + row,
)

// Same wordmark in the split left/right shape expected by the interactive OpenTUI logo component.
// Keep the whole row on the left side: the Tandem gradient already provides the visual treatment,
// and a fixed upstream-style split would cut through the slanted wordmark on some rows.
export const tuiShape = {
  left: wordmark,
  right: wordmark.map(() => ""),
}

// Canonical brand gradient (teal → sky → violet). Mirrored — for non-TS surfaces only — by the
// Android launcher icon (packages/android/generate-icons.py) and its gradient drawable.
const GRADIENT: ReadonlyArray<readonly [number, number, number]> = [
  [45, 212, 191], // teal   #2dd4bf
  [56, 189, 248], // sky    #38bdf8
  [139, 92, 246], // violet #8b5cf6
]

export function gradientColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))
  const scaled = clamped * (GRADIENT.length - 1)
  const i = Math.min(GRADIENT.length - 2, Math.floor(scaled))
  const f = scaled - i
  const [ar, ag, ab] = GRADIENT[i]
  const [br, bg, bb] = GRADIENT[i + 1]
  return [Math.round(ar + (br - ar) * f), Math.round(ag + (bg - ag) * f), Math.round(ab + (bb - ab) * f)]
}

export function render(pad?: string): string {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    const plain: string[] = []
    for (const row of wordmark) {
      if (pad) plain.push(pad)
      plain.push(row, EOL)
    }
    return plain.join("").trimEnd()
  }

  const reset = "\x1b[0m"
  const bold = "\x1b[1m"
  // Per-glyph-column color follows the visual width of the already-slanted rows.
  const width = Math.max(...wordmark.map((row) => [...row].length))
  const result: string[] = []
  wordmark.forEach((row) => {
    if (pad) result.push(pad)
    let column = 0
    for (const char of row) {
      if (char === " ") {
        result.push(" ")
        column += 1
        continue
      }
      const [r, g, b] = gradientColor(width <= 1 ? 0 : column / (width - 1))
      result.push(`\x1b[38;2;${r};${g};${b}m${bold}${char}${reset}`)
      column += 1
    }
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

export * as BrandLogo from "./brand-logo"
