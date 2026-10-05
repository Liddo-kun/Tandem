// Tandem-owned (not in upstream): Responsive interactive terminal logo.
import { RGBA, TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "../context/theme"
import { compactShape, gradientColor, wordmark } from "../brand-logo"
import { Brand } from "@opencode/util/brand"

export function Logo() {
  const dimensions = useTerminalDimensions()
  const theme = useTheme()
  const width = Math.max(...wordmark.map((line) => [...line].length))
  const rows = () =>
    dimensions().width >= width + 2
      ? wordmark
      : dimensions().width >= Brand.product.length
        ? [Brand.product]
        : compactShape.right.slice(1)
  return (
    <box>
      <For each={dimensions().height < 12 ? [] : rows()}>
        {(line) => (
          <box flexDirection="row">
            <For each={[...line]}>
              {(char, column) => (
                <text
                  fg={rows() === wordmark ? RGBA.fromInts(...gradientColor(column() / (width - 1))) : theme.text.base}
                  attributes={TextAttributes.BOLD}
                  selectable={false}
                >
                  {char}
                </text>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
