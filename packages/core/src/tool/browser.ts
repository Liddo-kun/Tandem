export * as BrowserTool from "./browser"

import { ToolFailure } from "@opencode-ai/llm"
import { DateTime, Effect, Layer, Schema } from "effect"
import { Browser } from "../browser"
import { BrowserMedia } from "../browser-media"
import { Catalog } from "../catalog"
import { Location } from "../location"
import { PermissionV2 } from "../permission"
import { SessionStore } from "../session/store"
import { SessionMessage } from "../session/message"
import { SessionEvent } from "../session/event"
import { EventV2 } from "../event"
import { makeLocationNode } from "../effect/app-node"
import { Tool } from "./tool"
import { Tools } from "./tools"
import { ToolRegistry } from "./registry"

const Output = Schema.Struct({
  title: Schema.String,
  text: Schema.String,
  metadata: Browser.Metadata,
  image: Schema.optional(
    Schema.Struct({
      uri: Schema.TemplateLiteral([BrowserMedia.PREFIX, Schema.String]),
      mime: Schema.Literal("image/png"),
      width: Schema.Number,
      height: Schema.Number,
    }),
  ),
})

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const { owner } = yield* Browser.Service
    if (!owner) return
    const location = Browser.locationKey(yield* Location.Service, "v2")
    const tools = yield* Tools.Service
    const permission = yield* PermissionV2.Service
    const media = yield* BrowserMedia.Service
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service
    const catalog = yield* Catalog.Service
    yield* tools
      .register({
        browser: Tool.make({
          description: Browser.description,
          input: Browser.Input,
          output: Output,
          toModelOutput: ({ output }) => [
            { type: "text", text: output.text },
            ...(output.image
              ? [{ type: "file" as const, uri: output.image.uri, mime: output.image.mime, name: "browser.png" }]
              : []),
          ],
          execute: (input, context) =>
            Effect.gen(function* () {
              const recorded = yield* store.message(context.assistantMessageID)
              const assistant =
                recorded?.sessionID === context.sessionID && recorded.message.type === "assistant"
                  ? recorded.message
                  : undefined
              const model = assistant
                ? yield* catalog.model.get(assistant.model.providerID, assistant.model.id)
                : undefined
              const execution = yield* Effect.try({
                try: () => owner.current({ runtime: "v2", location, sessionID: context.sessionID }),
                catch: () => new ToolFailure({ message: "unsupported_execution" }),
              })
              const result = yield* Browser.execute(execution, input, {
                messageID: context.assistantMessageID,
                callID: context.toolCallID,
                vision: model?.capabilities.input.includes("image") === true,
                metadata: (result) =>
                  Effect.gen(function* () {
                    if (!result.metadata.code) return
                    yield* events.publish(SessionEvent.Synthetic, {
                      sessionID: context.sessionID,
                      timestamp: yield* DateTime.now,
                      messageID: SessionMessage.ID.create(),
                      text: Browser.failureText(result.metadata),
                    })
                  }),
                authorize: (request) =>
                  permission.assert({
                    ...Browser.permissionRequest(request),
                    sessionID: context.sessionID,
                    agent: context.agent,
                    source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
                  }),
              }).pipe(Effect.mapError(() => new ToolFailure({ message: "Browser permission denied" })))
              const capture = result.image
              const image = capture
                ? yield* Effect.promise(() => media.store(context.sessionID, capture.bytes))
                : undefined
              return { title: result.title, text: result.modelText ?? result.text, metadata: result.metadata, image }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/browser",
  layer,
  deps: [
    Browser.node,
    EventV2.node,
    Browser.locationNode,
    Location.node,
    ToolRegistry.node,
    PermissionV2.node,
    SessionStore.node,
    Catalog.node,
  ],
})
