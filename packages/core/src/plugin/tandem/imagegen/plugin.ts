export * as ImagegenPlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import { Tool } from "@opencode/schema/tool"
import { Skill } from "@opencode/schema/skill"
import { AbsolutePath } from "@opencode/schema/schema"
import { Effect, Schema, Semaphore, Stream } from "effect"
import { Bus } from "../../../bus.js"
import { Credential } from "../../../credential.js"
import { Integration } from "../../../integration.js"
import { Location } from "../../../location.js"
import { FileAccess } from "../../../file-access.js"
import { Permission } from "../../../permission.js"
import { ImageGen } from "./imagegen.js"
import { ImagegenAuth } from "./auth.js"
import { KeyedMutex } from "../../../effect/keyed-mutex.js"

const Common = {
  prompt: Schema.String.annotate({ description: "What to generate or edit. Describe each reference image's role." }),
  image_paths: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMaxLength(10))).annotate({
    description: "Up to ten local source/reference images, resolved against the session directory.",
  }),
  mask_path: Schema.optionalKey(Schema.String).annotate({
    description: "PNG alpha mask matching the first input. Transparent pixels mark the editable region.",
  }),
  transparent: Schema.optionalKey(Schema.Boolean).annotate({
    description: "Native transparent background, default false.",
  }),
}
const OAuthInput = Schema.Struct(Common)
const Edge = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(3840), Schema.isMultipleOf(16))
const ApiInput = Schema.Struct({
  ...Common,
  width: Edge.annotate({ description: "Required width in pixels. Ratio at most 3:1; 655360–8294400 total pixels." }),
  height: Edge.annotate({ description: "Required height in pixels." }),
  quality: Schema.optionalKey(Schema.Literals(ImageGen.QUALITIES)).annotate({
    description: "Image quality, default high.",
  }),
})
const integrationID = Integration.ID.make("openai")
// Shared across Location plugin instances. The host rereads and persists inside this lock.
const resolution = KeyedMutex.makeUnsafe<string>()

function failure(error: unknown) {
  return new Tool.Error({ message: error instanceof Error ? error.message : "Image generation failed", error })
}

/** Register in pre after ProviderPlugins/SkillPlugin, before ConfigSkillPlugin (user overrides). */
export const Plugin = define({
  id: "tandem.imagegen",
  effect: Effect.fn("ImagegenPlugin")(function* (ctx) {
    const credentials = yield* Credential.Service
    const bus = yield* Bus.Service
    const location = yield* Location.Service
    const access = yield* FileAccess.Service
    const permission = yield* Permission.Service
    const lock = Semaphore.makeUnsafe(1)

      // Read current v2 credentials without refreshing during tool/skill discovery.
    const resolve = Effect.fn("ImagegenPlugin.resolve")(function* () {
      if (ImageGen.disabledByFlag()) return undefined
      const stored = (yield* credentials.list(integrationID)).findLast(
        (entry) => entry.value.type === "key" && !!entry.value.key,
      )
      if (stored?.value.type === "key") return { mode: "api" as const, key: stored.value.key }
      if (process.env.OPENAI_API_KEY) return { mode: "api" as const, key: process.env.OPENAI_API_KEY }
      const connection = yield* ctx.integration.connection.active(ImagegenAuth.integrationID)
      if (connection?.type !== "credential") return undefined
      const value = (yield* credentials.get(Credential.ID.make(connection.id)))?.value
      if (!ImagegenAuth.compatible(value)) return undefined
      return { mode: "oauth" as const, value, connection }
    })
    let mode = (yield* resolve())?.mode
    const reload = () =>
      lock.withPermit(
        Effect.gen(function* () {
          const next = (yield* resolve())?.mode
          if (next === mode) return
          mode = next
          yield* ctx.tool.reload()
          yield* ctx.skill.reload()
        }),
      )

    const execute = (input: ImageGen.Args, context: Tool.Context, advertised: "api" | "oauth") =>
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* resolve()
          if (!live)
            return yield* new Tool.Error({
              message: "Image generation is disabled or no image credential is available. Connect OpenAI Images (ChatGPT) or an OpenAI API key.",
            })
          if (live.mode !== advertised) {
            yield* reload()
            return yield* new Tool.Error({
              message:
                "OpenAI authentication mode changed during this request. Retry with the refreshed imagegen schema.",
            })
          }
          const creds = yield* Effect.gen(function* () {
            if (live.mode === "api") return live
            // Keep refresh + persistence together even if this image call is cancelled.
            // The auth HTTP request is bounded; waiters remain interruptible.
            const refreshed = yield* ctx.integration.connection.resolve(live.connection).pipe(
              Effect.uninterruptible,
              resolution.withLock(live.connection.id),
              Effect.mapError(failure),
            )
            if (!ImagegenAuth.compatible(refreshed))
              return yield* new Tool.Error({ message: "OpenAI Images credential changed or was removed. Reconnect OpenAI Images (ChatGPT)." })
            return {
              mode: "oauth" as const,
              access: refreshed.access,
              clientID: ImagegenAuth.clientID,
              accountId: typeof refreshed.metadata?.accountId === "string" ? refreshed.metadata.accountId : undefined,
            }
          })
          const paths = yield* Effect.forEach(input.image_paths ?? [], (file) => access.authorizeRead(file, context))
          const mask = input.mask_path ? yield* access.authorizeRead(input.mask_path, context) : undefined
          yield* permission.assert({
            action: "imagegen",
            resources: ["*"],
            save: ["*"],
            metadata: { prompt: input.prompt },
            sessionID: context.sessionID,
            agent: context.agent,
            source: { type: "tool", messageID: context.messageID, id: context.id },
          })
          const request: ImageGen.Args = {
            ...input,
            quality: creds.mode === "api" ? (input.quality ?? "high") : undefined,
            image_paths: paths.map((target) => target.absolute),
            mask_path: mask?.absolute,
            transparent: input.transparent ?? false,
          }
          const image = yield* Effect.tryPromise({
            try: (signal) => ImageGen.run(request, creds, signal),
            catch: failure,
          })
          const saved = yield* Effect.tryPromise({
            try: () => ImageGen.saveImage(image.png, location.directory, context.id, image.observed?.alpha),
            catch: failure,
          })
          const size = ImageGen.pngDimensions(image.png) ?? null
          const revisedPrompt =
            image.revisedPrompt?.trim() && image.revisedPrompt.trim() !== request.prompt.trim()
              ? image.revisedPrompt
              : null
          const metadata = {
            ...saved,
            size,
            requested: {
              transparent: request.transparent,
              ...(creds.mode === "api"
                ? {
                    width: request.width,
                    height: request.height,
                    quality: request.quality,
                    model: ImageGen.IMAGE_MODEL,
                  }
                : {}),
            },
            reported: image.reported ?? null,
            observed: image.observed ?? null,
            quality: image.reported?.quality ?? null,
            requestId: image.requestId ?? null,
            generationId: image.generationId ?? null,
            transparent: image.observed?.alpha ?? null,
            alphaVerified: image.observed !== undefined,
            mode: creds.mode,
            transport: image.transport ?? "images",
            revisedPrompt,
          }
          return {
            content: [
              `Saved image (${size ?? "dimensions unknown"}): ${saved.path}`,
              `Original PNG: ${saved.originalPath}`,
              `Observed quality: ${metadata.quality ?? "unknown"}; route: ${metadata.transport}.`,
              image.reported?.model ? `Backend-reported model: ${image.reported.model}` : "",
              creds.mode === "api"
                ? `Requested: ${request.width}x${request.height}, quality ${request.quality}, model ${ImageGen.IMAGE_MODEL}.`
                : "OAuth model, size and quality are backend-managed; request fields do not verify the serving model.",
              revisedPrompt ? `Image prompt used (revised by the model): ${JSON.stringify(revisedPrompt)}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            metadata,
          }
        }),
      ).pipe(Effect.mapError(failure))

    yield* ctx.tool.transform((editor) => {
      if (!mode || ImageGen.disabledByFlag()) return
      const advertised = mode
      const description = `${ImageGen.DESCRIPTION} Saves one original PNG plus an optional display copy; returns paths/metadata only.`
      // Separate registrations preserve schema-derived input types at the boundary.
      if (mode === "api") {
        editor.add({
          name: "imagegen",
          options: { codemode: false },
          description,
          input: ApiInput,
          execute: (input, context) =>
            execute(
              { ...input, image_paths: input.image_paths ? [...input.image_paths] : undefined },
              context,
              advertised,
            ),
        })
        return
      }
      editor.add({
        name: "imagegen",
        options: { codemode: false },
        description,
        input: OAuthInput,
        execute: (input, context) =>
          execute(
            { ...input, image_paths: input.image_paths ? [...input.image_paths] : undefined },
            context,
            advertised,
          ),
      })
    })
    yield* ctx.skill.transform((editor) => {
      if (!mode || ImageGen.disabledByFlag() || editor.get("imagegen")) return
      editor.add(
        Skill.Info.make({
          id: Skill.ID.make("imagegen"),
          name: Skill.Name.make("imagegen"),
          description: ImageGen.SKILL.description,
          path: AbsolutePath.make("/builtin/imagegen.md"),
          content: ImageGen.SKILL.content,
        }),
      )
    })
    yield* bus
      .subscribe(Credential.Event.Updated)
      .pipe(Stream.runForEach(reload), Effect.forkScoped({ startImmediately: true }))
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID || event.data.integrationID === ImagegenAuth.integrationID),
      Stream.runForEach(reload),
      Effect.forkScoped({ startImmediately: true }),
    )
    // Close the initial read/subscription gap without retaining token material.
    yield* reload()
    yield* ctx.session.hook("prompt", () => reload())
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        yield* reload()
        // A credential change after this step's tool snapshot must not advertise stale controls.
        // Do not add definitions here: the snapshot also owns permissions and execution.
        const required = event.tools.imagegen?.input.required
        const apiSchema = Array.isArray(required) && required.includes("width") && required.includes("height")
        if (!mode || (mode === "api") !== apiSchema || ImageGen.disabledByFlag()) delete event.tools.imagegen
      }),
    )
  }),
})
