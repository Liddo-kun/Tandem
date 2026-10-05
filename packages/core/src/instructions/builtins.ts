export * as InstructionBuiltIns from "./builtins.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Global } from "@opencode/util/global"
import { Location } from "../location.js"
import { Instructions } from "./index.js"

export interface Interface {
  readonly load: () => Effect.Effect<Instructions.List>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/InstructionBuiltIns") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const global = yield* Global.Service
    const location = yield* Location.Service
    return Service.of({
      load: () =>
        Effect.succeed(
          Instructions.combine([
            Instructions.make({
              key: Instructions.Key.make("core/date"),
              codec: Schema.toCodecJson(Schema.String),
              read: DateTime.nowAsDate.pipe(Effect.map((date) => date.toDateString())),
              render: {
                initial: (date) => `Today's date: ${date}`,
                changed: (_previous, date) => `Today's date is now: ${date}`,
              },
            }),
            Instructions.make({
              key: Instructions.Key.make("core/environment"),
              codec: Schema.toCodecJson(Schema.String),
              read: Effect.sync(() =>
                [
                  "<env>",
                  `  Working directory: ${location.directory}`,
                  `  Workspace root folder: ${location.project.directory}`,
                  `  Is directory a git repo: ${location.vcs?.type === "git" ? "yes" : "no"}`,
                  `  Platform: ${process.platform}`,
                  // UPSTREAM-DIVERGENCE: runtime scratch and UI-only image guidance share the durable environment source.
                  `  Use ${global.tmp} for ALL temporary files: intermediate results, throwaway scripts, analysis work, and anything that does not belong in the user's project. It exists and is pre-approved for external access. Use plain /tmp only when the user explicitly requests it.`,
                  "</env>",
                ].join("\n"),
              ),
              // UPSTREAM-DIVERGENCE: include saved-image guidance on initial and changed environments.
              render: {
                initial: (environment) =>
                  ["Here is some useful information about the environment you are running in:", environment, images].join("\n"),
                changed: (_previous, environment) =>
                  ["The environment you are running in is now:", environment, images].join("\n"),
              },
            }),
          ]),
        ),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [Global.node, Location.node] })

// UPSTREAM-DIVERGENCE: explain session-relative image previews and explicit model image inspection.
const images = `# Presenting images
To present a saved image, use ![Description](relative/path.png) with a path resolved against the session working directory. Use forward slashes and URL-encode spaces as %20. The UI reads the saved image for display; do not invent HTTP URLs or inline base64. Markdown image display does not itself inject image bytes into the model's context. To inspect an image, explicitly read it with an available image-capable tool. Inline previews support images only.`
