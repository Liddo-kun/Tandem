// Tandem-owned (not in upstream): contributes Tandem's chat stylesheets. They stay unlayered, so they win over
// upstream's layered session-ui styles as they did when session-ui imported them.
import { Style, type Plugin } from "@opencode/plugin/gui"
import type Tandem from "./index"
import compactStyles from "./compact.css?inline"
import narrationStyles from "./narration.css?inline"
import toolSummaryStyles from "./tool-summary.css?inline"

const setup: Plugin.Setup<typeof Tandem> = (ctx) => {
  ctx.add(Style, compactStyles)
  ctx.add(Style, toolSummaryStyles)
  ctx.add(Style, narrationStyles)
}

export default setup
