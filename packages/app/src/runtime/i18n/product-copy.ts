// Tandem-owned (not in upstream): centralized Tandem product copy.
import { Brand } from "@opencode/util/brand"
import type en from "./en"

// Product-owned English overrides apply after locale loading until reviewed translations
// exist. Enumerate keys: OpenCode Console/Go credentials, provider names and config tokens
// are upstream identities, not Tandem product copy.
export const productCopy = {
  "provider.connect.chatgptWelcome.description": `Eligible requests in ${Brand.product} can use your ChatGPT plan.`,
  "provider.connect.apiKey.description": `Enter your {{provider}} API key to connect your account and use {{provider}} models in ${Brand.product}.`,
  "server.connect.scan.description": `Point your camera at the QR code shown by ${Brand.command} pair.`,
  "server.connect.scan.invalid": `This is not a ${Brand.product} pairing code. Scan the code shown by ${Brand.command} pair.`,
  "server.connect.link.expired": `This pairing link expired or was already used. Run ${Brand.command} pair to get a new one.`,
  "server.connect.link.invalid": `Paste the full pairing link from ${Brand.command} pair, or from Settings → Pairing on the server's computer.`,
  "server.connect.link.legacy": `This pairing code is from an older version of ${Brand.product}. Update ${Brand.product} on the server, then run ${Brand.command} pair again.`,
  "server.connect.password.hint": `To see it, run ${Brand.command} service get password on the server's computer.`,
  "server.row.incompatible": `This server is running ${Brand.product} {{version}}, which isn't compatible with this app. Upgrade it to ${Brand.product} V2 to continue.`,
  "session.error.incompatible.description": `{{server}} is running ${Brand.product} {{version}}, which isn't compatible with this app. Upgrade the server to ${Brand.product} V2 to continue.`,
  "error.page.report.prefix": `Please report this error to the ${Brand.product} project`,
  "error.page.report.discord": "on GitHub",
  "error.chain.mcpFailed": `MCP server "{{name}}" failed. Note, ${Brand.product} does not support MCP authentication yet.`,
  "settings.about.website": "github.com/Liddo-kun/Tandem",
  "settings.about.description": `${Brand.product}, an open source coding agent based on OpenCode`,
  "settings.about.trademark":
    "OpenCode is a registered trademark of Anomaly Innovations, Inc. Tandem is an independent fork.",
  "settings.about.notices.description": `${Brand.product} includes the following open source software.`,
  "project.settings.name.description": `The name shown for this project throughout ${Brand.product}`,
  "project.settings.extensions.empty.mcps.description": `MCPs available to ${Brand.product} will appear here`,
  "project.settings.extensions.empty.plugins.description": `Plugins available to ${Brand.product} will appear here`,
  "project.settings.extensions.empty.skills.description": `Skills available to ${Brand.product} will appear here`,
  "settings.general.row.language.description": `Change the display language for ${Brand.product}`,
  "settings.general.row.colorScheme.description": `Choose whether ${Brand.product} follows the system, light, or dark theme`,
  "settings.general.row.theme.description": `Customise how ${Brand.product} is themed.`,
  "settings.workspaces.empty.description": `Worktrees created in ${Brand.product} will appear here`,
} satisfies Partial<Record<keyof typeof en, string>>

export const nativeProductCopy = {
  "desktop.menu.app": Brand.product,
  "desktop.menu.documentation": `${Brand.product} Documentation`,
  "desktop.menu.ariaLabel": `${Brand.product} menu`,
  "desktop.recovery.loadFailed": `${Brand.product} failed to load`,
  "desktop.recovery.terminated": `${Brand.product} window terminated unexpectedly`,
  "desktop.recovery.unresponsive": `${Brand.product} is not responding`,
}
