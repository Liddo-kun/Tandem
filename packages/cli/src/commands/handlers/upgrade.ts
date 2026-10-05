// UPSTREAM-DIVERGENCE: Remove upstream release installer/formatters; upgrade points to Tandem releases.
import { log } from "@clack/prompts"
import { Brand } from "@opencode/util/brand"
import { Effect } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(() => Effect.sync(() => log.info(Brand.manualUpdateMessage))),
)
