import { Effect, Fiber, Layer } from "effect"
import { expect } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { BrowserToolOwner } from "@tandem/chrome-bridge/tools"
import { Browser } from "@opencode-ai/core/browser"
import { BrowserMedia } from "@opencode-ai/core/browser-media"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { sessionFixture } from "../../../chrome-bridge/script/session-fixture"
import { lifecycleCases, lifecycleScenario } from "../../../chrome-bridge/script/session-lifecycle"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionSummary } from "../../src/session/summary"
import { InstanceStore } from "../../src/project/instance-store"
import { Permission } from "../../src/permission"
import { provideInstance, testInstanceStoreLayer } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const live = process.env.TANDEM_PHASE3_RUN_DIR ? it.live : it.live.skip

live(
  `legacy ${process.env.TANDEM_PHASE3_MODEL_PROVIDER ? "genuine model" : "scripted provider"} drives real browser through prompt and PNG projection`,
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => sessionFixture("legacy")),
        (value) => Effect.sync(value.close),
      )
      const owner = new BrowserToolOwner({ connections: fixture.connections })
      yield* Effect.addFinalizer(() => Effect.promise(() => owner.close()).pipe(Effect.asVoid))
      yield* Effect.promise(() =>
        writeFile(
          `${fixture.artifacts}/opencode.json`,
          JSON.stringify({
            permission: fixture.genuine
              ? {
                  "*": "deny",
                  browser: {
                    "*": "deny",
                    ...Object.fromEntries(fixture.permissionResources.map((resource) => [resource, "allow"])),
                  },
                }
              : { browser: "allow" },
            provider: {
              fixture: {
                name: "Scripted local fixture",
                env: [],
                npm: fixture.genuine ? "@ai-sdk/openai" : "@ai-sdk/openai-compatible",
                options: { baseURL: fixture.url, apiKey: "fixture-not-a-credential" },
                models: {
                  text: {
                    id: "fixture",
                    name: "Text-only fixture",
                    tool_call: true,
                    attachment: false,
                    modalities: { input: ["text"], output: ["text"] },
                    limit: { context: 100000, output: 10000 },
                  },
                  fixture: {
                    id: fixture.genuine?.apiID ?? "fixture",
                    name: "Fixture",
                    tool_call: true,
                    attachment: true,
                    modalities: { input: ["text", "image"], output: ["text"] },
                    limit: { context: 100000, output: 10000 },
                    options: fixture.genuine ? { store: false } : {},
                  },
                },
              },
            },
          }),
          { mode: 0o600 },
        ),
      )
      const layer = LayerNode.compile(
        LayerNode.group([SessionPrompt.node, Session.node, SessionProjector.node, Permission.node]),
        [
          [Browser.node, Layer.succeed(Browser.Service, { owner })],
          [
            SessionSummary.node,
            Layer.mock(SessionSummary.Service, {
              summarize: () => Effect.void,
              diff: () => Effect.succeed([]),
              computeDiff: () => Effect.succeed([]),
            }),
          ],
        ],
      )
      yield* Effect.gen(function* () {
        const session = yield* Session.Service
        const chat = yield* session.create({})
        yield* (yield* SessionPrompt.Service).prompt({
          sessionID: chat.id,
          model: { providerID: ProviderV2.ID.make("fixture"), modelID: ModelV2.ID.make("fixture") },
          parts: [{ type: "text", text: fixture.task }],
        })
        const transcript = yield* session.messages({ sessionID: chat.id })
        yield* Effect.promise(() => fixture.finish(transcript))
        if (fixture.genuine) return
        let copied: string | undefined
        let retained: typeof chat.id | undefined
        for (const name of lifecycleCases) {
          if (name === "admission-retry") continue // Legacy has no durable admission inbox.
          const effectsBefore = fixture.effects().length
          const scenario = yield* Effect.promise(() =>
            lifecycleScenario(fixture.directory, name, copied, fixture.pageURL),
          )
          fixture.setScenario(scenario.fetch)
          const chat =
            name === "fork-alias" && retained
              ? yield* session.fork({ sessionID: retained })
              : yield* session.create({
                  title: `Lifecycle ${name}`,
                  ...(name === "denied-keep"
                    ? {
                        permission: [
                          {
                            permission: "browser",
                            pattern: "66697874757265:68616e646f6666:*",
                            action: "deny" as const,
                          },
                        ],
                      }
                    : {}),
                })
          const prompt = yield* SessionPrompt.Service
          const execution = yield* prompt
            .prompt({
              sessionID: chat.id,
              model: {
                providerID: ProviderV2.ID.make("fixture"),
                modelID: ModelV2.ID.make(name === "text-only" ? "text" : "fixture"),
              },
              parts: [{ type: "text", text: "Execute the bounded lifecycle fixture. Never retry a mutation." }],
            })
            .pipe(Effect.exit, Effect.forkScoped)
          let steering: Fiber.Fiber<unknown, unknown> | undefined
          if (name === "stop" || name === "shutdown" || name === "steering") {
            yield* Effect.promise(scenario.wait)
            if (name === "stop") yield* prompt.cancel(chat.id)
            if (name === "shutdown") yield* (yield* InstanceStore.Service).disposeDirectory(fixture.artifacts)
            if (name === "steering") {
              steering = yield* prompt
                .prompt({
                  sessionID: chat.id,
                  model: { providerID: ProviderV2.ID.make("fixture"), modelID: ModelV2.ID.make("fixture") },
                  parts: [{ type: "text", text: "LIFECYCLE_STEER_SENTINEL" }],
                })
                .pipe(Effect.exit, Effect.forkScoped)
              yield* pollWithTimeout(
                session
                  .messages({ sessionID: chat.id })
                  .pipe(
                    Effect.map((messages) =>
                      JSON.stringify(messages).includes("LIFECYCLE_STEER_SENTINEL") ? true : undefined,
                    ),
                  ),
                "Legacy steer not durably admitted",
              )
            }
            scenario.release()
          }
          const exit = yield* Fiber.join(execution).pipe(Effect.timeout("90 seconds"))
          if (steering) yield* Fiber.await(steering)
          if (name === "retained-provider-failure") {
            copied = scenario.tab
            retained = chat.id
          }
          const messages = yield* session.messages({ sessionID: chat.id })
          const childSessions = name === "subagent-alias" ? yield* session.children(chat.id) : []
          if (name === "subagent-alias") expect(childSessions).toHaveLength(1)
          const children = yield* Effect.forEach(childSessions, (child) =>
            session.messages({ sessionID: child.id }).pipe(Effect.map((messages) => ({ session: child, messages }))),
          )
          yield* Effect.promise(() =>
            scenario.finish(
              fixture.artifacts,
              children.length ? { messages, children } : messages,
              exit._tag,
              fixture.effects().slice(effectsBefore),
            ),
          )
        }
        const pendingDirectory = `${fixture.artifacts}/pending-instance`
        const otherDirectory = `${fixture.artifacts}/other-instance`
        for (const directory of [pendingDirectory, otherDirectory])
          yield* Effect.promise(async () => {
            await mkdir(directory, { mode: 0o700 })
            await writeFile(`${directory}/opencode.json`, await readFile(`${fixture.artifacts}/opencode.json`), {
              mode: 0o600,
            })
          })
        const pendingScenario = yield* Effect.promise(() => lifecycleScenario(fixture.directory, "normal"))
        const otherScenario = yield* Effect.promise(() => lifecycleScenario(fixture.directory, "normal"))
        fixture.setScenario((body) =>
          JSON.stringify(body).includes("OTHER_INSTANCE_SENTINEL")
            ? otherScenario.fetch(body)
            : pendingScenario.fetch(body),
        )
        const pendingChat = yield* session
          .create({ title: "Pending instance", permission: [{ permission: "browser", pattern: "*", action: "ask" }] })
          .pipe(provideInstance(pendingDirectory))
        const prompt = yield* SessionPrompt.Service
        const pendingExecution = yield* prompt
          .prompt({
            sessionID: pendingChat.id,
            model: { providerID: ProviderV2.ID.make("fixture"), modelID: ModelV2.ID.make("fixture") },
            parts: [{ type: "text", text: "PENDING_INSTANCE_SENTINEL" }],
          })
          .pipe(provideInstance(pendingDirectory), Effect.exit, Effect.forkScoped)
        const permission = yield* Permission.Service
        const request = yield* pollWithTimeout(
          permission.list().pipe(
            provideInstance(pendingDirectory),
            Effect.map((items) => items.find((item) => item.sessionID === pendingChat.id)),
          ),
          "Pending browser approval never appeared",
        )
        const nativeBefore = yield* Effect.promise(() => readFile(`${fixture.directory}/native-dispatch.jsonl`, "utf8"))
        const otherTranscript = yield* Effect.gen(function* () {
          const chat = yield* session.create({ title: "Independent instance" })
          yield* prompt.prompt({
            sessionID: chat.id,
            model: { providerID: ProviderV2.ID.make("fixture"), modelID: ModelV2.ID.make("fixture") },
            parts: [{ type: "text", text: "OTHER_INSTANCE_SENTINEL" }],
          })
          return yield* session.messages({ sessionID: chat.id })
        }).pipe(provideInstance(otherDirectory))
        yield* (yield* InstanceStore.Service).disposeDirectory(otherDirectory)
        expect(
          (yield* permission.list().pipe(provideInstance(pendingDirectory))).some((item) => item.id === request.id),
        ).toBe(true)
        yield* prompt.cancel(pendingChat.id).pipe(provideInstance(pendingDirectory))
        yield* Fiber.await(pendingExecution)
        expect((yield* permission.list().pipe(provideInstance(pendingDirectory))).length).toBe(0)
        const late = yield* permission
          .reply({ requestID: request.id, reply: "once" })
          .pipe(provideInstance(pendingDirectory), Effect.flip)
        const nativeAfter = yield* Effect.promise(() => readFile(`${fixture.directory}/native-dispatch.jsonl`, "utf8"))
        const dispatch = nativeAfter
          .slice(nativeBefore.length)
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
        expect(dispatch.filter((item) => item.method === "createTab")).toHaveLength(1)
        expect(JSON.stringify(otherTranscript)).toContain("Browser cleanup: confirmed")
        const pendingTranscript = yield* session
          .messages({ sessionID: pendingChat.id })
          .pipe(provideInstance(pendingDirectory))
        yield* Effect.promise(() =>
          writeFile(
            `${fixture.artifacts}/concurrent-instances.json`,
            JSON.stringify(
              {
                passed: true,
                request,
                lateReply: late._tag,
                otherInstanceDisposedWhilePending: true,
                pendingDirectory,
                otherDirectory,
                nativeCreateCount: 1,
                dispatch,
                otherTranscript,
                pendingTranscript,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          ),
        )
        yield* (yield* InstanceStore.Service).disposeDirectory(pendingDirectory)
      }).pipe(
        provideInstance(fixture.artifacts),
        Effect.provide(layer),
        Effect.provide(testInstanceStoreLayer),
        Effect.provideService(BrowserMedia.Service, BrowserMedia.make({ directory: `${fixture.artifacts}/media` })),
      )
    }),
  480000,
)
