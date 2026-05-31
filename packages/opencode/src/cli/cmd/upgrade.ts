import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Brand } from "@opencode-ai/core/brand"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

// UPSTREAM-DIVERGENCE: Tandem is a fork of opencode and is not published to the opencode release
// channels or package managers, so the upstream self-upgrade (which would fetch/overwrite with stock
// opencode) is replaced by a pointer to Tandem's own GitHub releases.
const TANDEM_RELEASES_URL = "https://github.com/Liddo-kun/Tandem/releases"

export const UpgradeCommand = {
  command: "upgrade [target]",
  describe: `check for ${Brand.name} updates`,
  builder: (yargs: Argv) => {
    return yargs.positional("target", {
      describe: "ignored; Tandem updates are installed manually from GitHub releases",
      type: "string",
    })
  },
  handler: async () => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Upgrade")
    prompts.log.info(`Current version: ${InstallationVersion}`)
    prompts.log.info(`${Brand.name} updates are released on GitHub, not through the opencode updater.`)
    prompts.note(TANDEM_RELEASES_URL, "Download the latest release")
    prompts.outro("Done")
  },
}
