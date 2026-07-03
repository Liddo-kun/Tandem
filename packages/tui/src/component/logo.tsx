import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { gradientColor, tuiShape } from "../brand-logo"

// UPSTREAM-DIVERGENCE: Tandem brand home logo. Upstream renders logo.left/right with theme colors;
// Tandem renders the unsplit slanted "Tandem" wordmark (tuiShape) with the teal→sky→violet brand
// gradient (gradientColor). A fixed left/right split would cut through the slanted rows, so the whole
// wordmark stays on tuiShape.left. Animation was dropped upstream (#33633); this stays static. See
// brand-logo.ts.
export function Logo() {
  const rows = tuiShape.left
  const width = Math.max(...rows.map((row) => [...row].length))

  const renderLine = (line: string): JSX.Element[] =>
    Array.from(line).map((char, column) => {
      if (char === " ") {
        return <text selectable={false}> </text>
      }
      const [r, g, b] = gradientColor(width <= 1 ? 0 : column / (width - 1))
      return (
        <text fg={RGBA.fromInts(r, g, b)} attributes={TextAttributes.BOLD} selectable={false}>
          {char}
        </text>
      )
    })

  return (
    <box>
      <For each={rows}>{(line) => <box flexDirection="row">{renderLine(line)}</box>}</For>
    </box>
  )
}
