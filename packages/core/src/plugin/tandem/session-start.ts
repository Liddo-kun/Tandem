export * as SessionStartPlugin from "./session-start.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/schema/location"
import { Model } from "@opencode/schema/model"
import { AbsolutePath } from "@opencode/schema/schema"
import { Session } from "@opencode/schema/session"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { stat } from "node:fs/promises"
import path from "node:path"

const Input = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1)),
  directory: Schema.optionalKey(Schema.String).annotate({
    description: "Relative to the current session's directory, or absolute. Supports ~.",
  }),
  model: Schema.optionalKey(Schema.String).annotate({ description: "providerID/modelID from the models tool." }),
  variant: Schema.optionalKey(Schema.String).annotate({
    description: "Reasoning variant from the models tool. A changed model without one uses its default.",
  }),
})

const Output = Schema.Struct({ sessionID: Session.ID, directory: AbsolutePath, model: Schema.String })

function failure(error: unknown) {
  return error instanceof Tool.Error
    ? error
    : new Tool.Error({ message: error instanceof Error ? error.message : "Unable to start session", error })
}

/** Register in pre after OpenCodeTools, which declares the opencode namespace. */
export const Plugin = define({
  id: "tandem.session-start",
  effect: Effect.fn("SessionStartPlugin")(function* (ctx) {
    const global = yield* Global.Service

    yield* ctx.tool.transform((editor) =>
      editor.add({
        name: "session_start",
        description:
          "Start a new session for the user and send it a prompt; returns immediately. Unset options match the current session.",
        input: Input,
        output: Output,
        options: { namespace: "opencode", codemode: true },
        execute: (input, context) =>
          Effect.gen(function* () {
            const current = yield* ctx.session.get({ sessionID: context.sessionID })

            const location = yield* Effect.gen(function* () {
              const value = input.directory?.trim()
              if (!value) return current.location
              const expanded =
                value === "~" ? global.home : value.startsWith("~/") ? path.join(global.home, value.slice(2)) : value
              const directory = AbsolutePath.make(path.resolve(current.location.directory, expanded))
              const info = yield* Effect.promise(() => stat(directory).catch(() => undefined))
              if (!info?.isDirectory()) return yield* new Tool.Error({ message: `Not a directory: ${directory}` })
              return Location.Ref.make({ directory })
            })

            const ref = yield* Effect.gen(function* () {
              if (input.model === undefined && input.variant === undefined) return current.model
              const base = input.model
                ? yield* Effect.try({
                    try: () => Model.Ref.parse(input.model!),
                    catch: () =>
                      new Tool.Error({ message: `Invalid model "${input.model}". Use "providerID/modelID".` }),
                  })
                : current.model
              if (!base) return yield* new Tool.Error({ message: "The current session has no model. Pass a model." })
              const model = (yield* ctx.model.list()).data.find(
                (model) => model.providerID === base.providerID && model.id === base.id,
              )
              if (!model)
                return yield* new Tool.Error({
                  message: `Model "${base.providerID}/${base.id}" is not available. Use the models tool to see what is available.`,
                })
              const unchanged = base.providerID === current.model?.providerID && base.id === current.model?.id
              const variant = input.variant ?? base.variant ?? (unchanged ? current.model?.variant : undefined)
              if (variant !== undefined && !model.variants.some((item) => item.id === variant))
                return yield* new Tool.Error({
                  message:
                    model.variants.length === 0
                      ? `Model "${model.providerID}/${model.id}" has no variants. Omit the variant.`
                      : `Variant "${variant}" is not available for "${model.providerID}/${model.id}". Available: ${model.variants.map((item) => item.id).join(", ")}.`,
                })
              return Model.Ref.make({
                providerID: model.providerID,
                id: model.id,
                ...(variant === undefined ? {} : { variant: Model.VariantID.make(variant) }),
              })
            })

            const session = yield* ctx.session.create({
              location,
              ...(ref ? { model: ref } : {}),
              // Clients open a tab for the new session only where the starting session's tab is open.
              metadata: {
                tandemStartedBy: { sessionID: context.sessionID, messageID: context.messageID, callID: context.id },
              },
            })
            // The prompt was written by the agent, so it skips the Corrector.
            yield* ctx.session.prompt({
              sessionID: session.id,
              text: input.prompt,
              metadata: { tandemCorrectorDisabled: true },
            })
            const model = ref ? `${ref.providerID}/${ref.id}${ref.variant ? `#${ref.variant}` : ""}` : "default"
            return {
              output: { sessionID: session.id, directory: location.directory, model },
              content: `Started session ${session.id} in ${location.directory} with ${model}.`,
              // Code Mode copies this onto the Execute row, which links the new session.
              metadata: { tandemStartedSession: session.id },
            }
          }).pipe(Effect.mapError(failure)),
      }),
    )
  }),
})
