import { Browser } from "@opencode-ai/core/browser"
import { BrowserMedia } from "@opencode-ai/core/browser-media"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { EffectBridge } from "@/effect/bridge"
import { Session } from "@/session/session"
import { PartID } from "@/session/schema"
import { Tool } from "./tool"

export const BrowserTool = Tool.define<typeof Browser.Input, typeof Browser.Metadata.Type, Browser.Service | Session.Service>(
  "browser",
  Effect.gen(function* () {
    const { owner } = yield* Browser.Service
    const media = yield* BrowserMedia.Service
    const session = yield* Session.Service
    return {
      description: Browser.description,
      parameters: Browser.Input,
      execute: (input, context) =>
        Effect.gen(function* () {
          if (!owner || !context.callID) return yield* Effect.die(new Error("unsupported_execution"))
          const location = Browser.locationKey(
            {
              directory: (yield* InstanceState.context).directory,
              workspaceID: yield* InstanceState.workspaceID,
            },
            "legacy",
          )
          const bridge = yield* EffectBridge.make()
          const model = context.extra?.model
          const vision =
            !!model &&
            typeof model === "object" &&
            "capabilities" in model &&
            !!model.capabilities &&
            typeof model.capabilities === "object" &&
            "input" in model.capabilities &&
            !!model.capabilities.input &&
            typeof model.capabilities.input === "object" &&
            "image" in model.capabilities.input &&
            model.capabilities.input.image === true
          const result = yield* Browser.execute(
            owner.current({ runtime: "legacy", location, sessionID: context.sessionID }),
            input,
            {
              messageID: context.messageID,
              callID: context.callID,
              vision,
              signal: context.abort,
              metadata: (result) =>
                Effect.gen(function* () {
                  yield* context.metadata({ title: result.title, metadata: result.metadata })
                  if (!result.metadata.code) return
                  // Error history omits tool metadata; persist progress without replacing the denial cause.
                  yield* session.updatePart({
                    id: PartID.ascending(),
                    sessionID: context.sessionID,
                    messageID: context.messageID,
                    type: "text",
                    text: Browser.failureText(result.metadata),
                    synthetic: true,
                  })
                }),
              authorize: (request) => {
                const policy = Browser.permissionRequest(request)
                return bridge.run(
                  context.ask({
                    permission: policy.action,
                    patterns: policy.resources,
                    always: policy.save,
                    metadata: policy.metadata,
                    signal: request.signal,
                  }),
                )
              },
            },
          )
          const capture = result.image
          const image = capture ? yield* Effect.promise(() => media.store(context.sessionID, capture.bytes)) : undefined
          return {
            title: result.title,
            output: result.modelText ?? result.text,
            metadata: result.metadata,
            attachments: image
              ? [{ type: "file" as const, mime: image.mime, filename: "browser.png", url: image.uri }]
              : undefined,
          }
        }),
    }
  }),
)
