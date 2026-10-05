// UPSTREAM-DIVERGENCE: Tandem-owned terminal wordmark renderer.
import { BrandLogo } from "../brand-logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"

// UPSTREAM-DIVERGENCE: Remove the upstream glyph renderer; delegate to Tandem's gradient/plain art.
function wordmark(pad = "") {
  return BrandLogo.render(pad).split(/\r?\n/)
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    // UPSTREAM-DIVERGENCE: Tandem session resume command.
    `  ${weak("Continue")}${bold}tandem -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
