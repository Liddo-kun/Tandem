// UPSTREAM-DIVERGENCE: Tandem-owned terminal wordmark renderer.
import { BrandLogo } from "../brand-logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

// UPSTREAM-DIVERGENCE: Remove the upstream glyph renderer; delegate to Tandem's gradient/plain art.
function wordmark(pad = "") {
  return BrandLogo.render(pad).split(/\r?\n/)
}

export type SessionEpilogue = { readonly title: string; readonly sessionID?: string }

// Printed after the TUI closes.
export function epilogue(input: { readonly session?: SessionEpilogue; readonly updatedVersion?: string }) {
  if (!input.session && !input.updatedVersion) return
  const row = (label: string, value: string) => `  ${dim}${label.padEnd(10, " ")}${reset}${bold}${value}${reset}`
  return [
    ...wordmark("  "),
    "",
    ...(input.updatedVersion
      ? [
          // UPSTREAM-DIVERGENCE: Tandem's command.
          `  ${dim}Run ${reset}${bold}tandem${reset}${dim} to use ${reset}${bold}${input.updatedVersion}${reset}`,
          "",
        ]
      : []),
    ...(input.session
      ? // UPSTREAM-DIVERGENCE: Tandem session resume command.
        [row("Session", input.session.title), row("Continue", `tandem -s ${input.session.sessionID}`), ""]
      : []),
  ].join("\n")
}
