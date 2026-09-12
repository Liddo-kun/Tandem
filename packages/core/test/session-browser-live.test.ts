import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Queue, Schema, Scope } from "effect"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import type { Model } from "@opencode-ai/llm"
import { BrowserToolOwner } from "@tandem/chrome-bridge/tools"
import { sessionFixture } from "../../chrome-bridge/script/session-fixture"
import { lifecycleCases, lifecycleScenario } from "../../chrome-bridge/script/session-lifecycle"
import { Browser } from "../src/browser"
import { AgentV2 } from "../src/agent"
import { EventV2 } from "../src/event"
import { BrowserMedia } from "../src/browser-media"
import { Catalog } from "../src/catalog"
import { Config } from "../src/config"
import { Database } from "../src/database/database"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Location } from "../src/location"
import { ModelV2 } from "../src/model"
import { PermissionV2 } from "../src/permission"
import { Project } from "../src/project"
import { ProjectTable } from "../src/project/sql"
import { ProviderV2 } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionExecution } from "../src/session/execution"
import { Prompt } from "../src/session/prompt"
import { SessionProjector } from "../src/session/projector"
import { SessionRunner } from "../src/session/runner"
import { SessionMessage } from "../src/session/message"
import { SessionRunCoordinator } from "../src/session/run-coordinator"
import { node } from "../src/session/runner/llm"
import { SessionRunnerModel } from "../src/session/runner/model"
import { SessionTable } from "../src/session/sql"
import { SessionStore } from "../src/session/store"
import { Snapshot } from "../src/snapshot"
import { SkillGuidance } from "../src/skill/guidance"
import { ReferenceGuidance } from "../src/reference/guidance"
import { SystemContext } from "../src/system-context"
import { SystemContextRegistry } from "../src/system-context/registry"
import { BrowserTool } from "../src/tool/browser"
import { ToolRegistry } from "../src/tool/registry"
import { ToolOutputStore } from "../src/tool-output-store"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const live = process.env.TANDEM_PHASE3_RUN_DIR ? it.live : it.live.skip

live(
  `V2 ${process.env.TANDEM_PHASE3_MODEL_PROVIDER ? "genuine model" : "scripted provider"} drives real browser through durable runner and PNG projection`,
  () =>
    Effect.gen(function* () {
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => sessionFixture("v2")),
        (value) => Effect.sync(value.close),
      )
      const owner = new BrowserToolOwner({ connections: fixture.connections })
      yield* Effect.addFinalizer(() => Effect.promise(() => owner.close()).pipe(Effect.asVoid))
      const location = AbsolutePath.make(fixture.artifacts)
      let model: Model = route.with({ endpoint: { baseURL: fixture.url } }).model({ id: "fixture" })
      let catalogModel = ModelV2.Info.make({
        id: ModelV2.ID.make(fixture.genuine?.apiID ?? model.id),
        providerID: ProviderV2.ID.make(model.provider),
        name: "Scripted fixture",
        api: fixture.genuine
          ? {
              id: ModelV2.ID.make(fixture.genuine.apiID),
              type: "aisdk",
              package: "@ai-sdk/openai",
              url: fixture.url,
              settings: {},
            }
          : { id: ModelV2.ID.make("fixture"), type: "native", settings: {} },
        capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
        request: {
          headers: {},
          body: fixture.genuine
            ? { store: false, instructions: "Use the browser tool only for the supplied local fixture task." }
            : {},
        },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 100000, output: 10000 },
      })
      if (fixture.genuine) model = yield* SessionRunnerModel.fromCatalogModel(catalogModel)
      const approvals: PermissionV2.Request[] = []
      const makeLayer = (directory = location, projectID = Project.ID.global) =>
        AppNodeBuilder.build(
          LayerNode.group([
            node,
            Database.node,
            SessionStore.node,
            SessionV2.node,
            SessionProjector.node,
            BrowserTool.node,
            ToolRegistry.toolsNode,
            PermissionV2.node,
            AgentV2.node,
            EventV2.node,
          ]),
          [
            [Browser.node, Layer.succeed(Browser.Service, { owner })],
            [SessionExecution.node, Layer.mock(SessionExecution.Service, {})],
            [
              Location.node,
              directory === location
                ? Location.boundNode({ directory })
                : Layer.succeed(Location.Service, { directory, project: { id: projectID, directory } }),
            ],
            [Snapshot.node, Snapshot.noopLayer],
            [Config.node, Layer.succeed(Config.Service, { entries: () => Effect.succeed([]) })],
            [SessionRunnerModel.node, SessionRunnerModel.layerWith(() => Effect.succeed(model))],
            [SystemContextRegistry.node, AppNodeBuilder.build(SystemContextRegistry.node)],
            [
              SkillGuidance.node,
              Layer.mock(SkillGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) }),
            ],
            [
              ReferenceGuidance.node,
              Layer.mock(ReferenceGuidance.Service, { load: () => Effect.succeed(SystemContext.empty) }),
            ],
            [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
            [
              Catalog.node,
              Layer.mock(Catalog.Service, {
                provider: {
                  get: () => Effect.die("unused"),
                  all: () => Effect.die("unused"),
                  available: () => Effect.die("unused"),
                },
                model: {
                  get: () => Effect.succeed(catalogModel),
                  all: () => Effect.succeed([catalogModel]),
                  available: () => Effect.succeed([catalogModel]),
                  default: () => Effect.succeed(catalogModel),
                  small: () => Effect.succeed(catalogModel),
                },
              }),
            ],
          ],
        )
      yield* Effect.gen(function* () {
        const { db } = yield* Database.Service
        const permission = yield* PermissionV2.Service
        const events = yield* EventV2.Service
        const permissionEvents: unknown[] = []
        const asked = yield* Queue.unbounded<PermissionV2.Request>()
        const unsubscribe = yield* events.listen((event) => {
          if (event.type.startsWith("permission.")) permissionEvents.push(event)
          if (event.type !== PermissionV2.Event.Asked.type) return Effect.void
          const request = Schema.decodeUnknownSync(PermissionV2.Request)(event.data)
          approvals.push(request)
          return Queue.offer(asked, request).pipe(Effect.asVoid)
        })
        yield* Effect.addFinalizer(() => unsubscribe)
        yield* (yield* AgentV2.Service).transform((editor) =>
          editor.update(AgentV2.ID.make("build"), (agent) => {
            agent.permissions = fixture.genuine
              ? [
                  { action: "*", resource: "*", effect: "deny" },
                  ...fixture.permissionResources.map((resource) => ({
                    action: "browser",
                    resource,
                    effect: "allow" as const,
                  })),
                ]
              : [
                  { action: "*", resource: "*", effect: "allow" },
                  { action: "browser", resource: "*", effect: "ask" },
                ]
          }),
        )
        const responder = yield* Effect.forever(
          Queue.take(asked).pipe(
            Effect.flatMap((request) => permission.reply({ requestID: request.id, reply: "once" })),
          ),
        ).pipe(Effect.forkScoped)
        const sessionID = SessionV2.ID.create()
        yield* db
          .insert(ProjectTable)
          .values({ id: Project.ID.global, worktree: location, sandboxes: [] })
          .onConflictDoNothing()
          .run()
          .pipe(Effect.orDie)
        yield* db
          .insert(SessionTable)
          .values({
            id: sessionID,
            project_id: Project.ID.global,
            slug: sessionID,
            directory: location,
            title: "Phase 3 scripted fixture",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        // Admission is durable; the production runner (not the adapter) owns execution cleanup.
        const session = yield* SessionV2.Service
        yield* session.prompt({
          sessionID,
          prompt: Prompt.make({ text: fixture.task }),
          resume: false,
        })
        yield* (yield* SessionRunner.Service).run({ sessionID, force: true })
        yield* Fiber.interrupt(responder)
        const transcript = yield* (yield* SessionStore.Service).context(sessionID)
        yield* Effect.promise(() => fixture.finish(transcript, approvals))
        if (fixture.genuine) return
        expect(approvals.length).toBeGreaterThan(5)
        expect(approvals.every((item) => item.sessionID === sessionID && item.source?.type === "tool")).toBe(true)
        const scenarios: unknown[] = []
        for (const reply of ["reject", "dismiss", "late"] as const) {
          let turns = 0
          const provider = yield* Effect.acquireRelease(
            Effect.sync(() =>
              Bun.serve({
                hostname: "127.0.0.1",
                port: 0,
                fetch: () => {
                  const first = turns++ === 0
                  const delta = first
                    ? {
                        tool_calls: [
                          {
                            index: 0,
                            id: `permission-${reply}`,
                            type: "function",
                            function: {
                              name: "browser",
                              arguments: JSON.stringify({ action: "create", browser: "fixture" }),
                            },
                          },
                        ],
                      }
                    : { content: "Permission scenario finished without retry." }
                  const chunk = (delta: unknown, finish_reason: string | null) => ({
                    id: "permission-fixture",
                    object: "chat.completion.chunk",
                    created: 1,
                    model: "fixture",
                    choices: [{ index: 0, delta, finish_reason }],
                  })
                  return new Response(
                    [chunk(delta, null), chunk({}, first ? "tool_calls" : "stop")]
                      .map((item) => `data: ${JSON.stringify(item)}\n\n`)
                      .join("") + "data: [DONE]\n\n",
                    { headers: { "content-type": "text/event-stream" } },
                  )
                },
              }),
            ),
            (server) => Effect.sync(() => server.stop(true)),
          )
          model = route.with({ endpoint: { baseURL: `${provider.url}v1` } }).model({ id: "fixture" })
          const deniedSession = SessionV2.ID.create()
          yield* db
            .insert(SessionTable)
            .values({
              id: deniedSession,
              project_id: Project.ID.global,
              slug: deniedSession,
              directory: location,
              title: `Permission ${reply}`,
              version: "test",
            })
            .run()
            .pipe(Effect.orDie)
          yield* session.prompt({
            sessionID: deniedSession,
            prompt: Prompt.make({ text: "Request a browser tab once; do not retry if denied or cancelled." }),
            resume: false,
          })
          const execution = yield* (yield* SessionRunner.Service)
            .run({ sessionID: deniedSession, force: true })
            .pipe(Effect.exit, Effect.forkScoped)
          const request = yield* Queue.take(asked).pipe(Effect.timeout("10 seconds"))
          expect(request.sessionID).toBe(deniedSession)
          expect(request.source?.type === "tool" ? request.source.callID : undefined).toBe(`permission-${reply}`)
          if (reply !== "late") yield* permission.reply({ requestID: request.id, reply })
          // The real controller's deadline expires the real permission wait; no shortened mock clock.
          const exit = yield* Fiber.join(execution).pipe(Effect.timeout("25 seconds"))
          expect(exit._tag).toBe(reply === "reject" ? "Failure" : "Success")
          expect(yield* permission.get(request.id)).toBeUndefined()
          const late = yield* permission.reply({ requestID: request.id, reply: "once" }).pipe(Effect.flip)
          expect(late).toBeInstanceOf(PermissionV2.NotFoundError)
          const transcript = yield* (yield* SessionStore.Service).context(deniedSession)
          const native = yield* Effect.promise(() => readFile(`${fixture.directory}/native-dispatch.jsonl`, "utf8"))
          expect(native.split("\n").filter((line) => line.includes('"method":"createTab"'))).toHaveLength(1)
          scenarios.push({
            reply,
            sessionID: deniedSession,
            request,
            exit: exit._tag,
            providerTurns: turns,
            lateReply: late._tag,
            transcript,
          })
        }
        yield* Effect.promise(() =>
          writeFile(
            `${fixture.artifacts}/permission-scenarios.json`,
            JSON.stringify({ realPermissionService: true, scenarios, events: permissionEvents }, null, 2),
            { mode: 0o600 },
          ),
        )
        yield* (yield* AgentV2.Service).transform((editor) =>
          editor.update(AgentV2.ID.make("build"), (agent) => {
            agent.permissions = [{ action: "browser", resource: "*", effect: "allow" }]
          }),
        )
        model = route.with({ endpoint: { baseURL: fixture.url } }).model({ id: "fixture" })
        let copied: string | undefined
        for (const name of lifecycleCases) {
          if (name === "fork-alias" || name === "subagent-alias" || name === "provider-retry") continue // These cases use legacy-only orchestration surfaces.
          if (process.env.TANDEM_PHASE3_CASES && !process.env.TANDEM_PHASE3_CASES.split(",").includes(name)) continue
          const effectsBefore = fixture.effects().length
          catalogModel = ModelV2.Info.make({
            ...catalogModel,
            capabilities: { ...catalogModel.capabilities, input: name === "text-only" ? ["text"] : ["text", "image"] },
          })
          if (name === "denied-keep")
            yield* (yield* AgentV2.Service).transform((editor) =>
              editor.update(AgentV2.ID.make("build"), (agent) => {
                agent.permissions = [
                  { action: "browser", resource: "*", effect: "allow" },
                  { action: "browser", resource: "66697874757265:68616e646f6666:*", effect: "deny" },
                ]
              }),
            )
          const scenario = yield* Effect.promise(() =>
            lifecycleScenario(fixture.directory, name, copied, fixture.pageURL),
          )
          fixture.setScenario(scenario.fetch)
          const id = SessionV2.ID.create()
          yield* db
            .insert(SessionTable)
            .values({
              id,
              project_id: Project.ID.global,
              slug: id,
              directory: location,
              title: `Lifecycle ${name}`,
              version: "test",
            })
            .run()
            .pipe(Effect.orDie)
          const promptID = SessionMessage.ID.create()
          const admittedPrompt = Prompt.make({ text: "Execute bounded lifecycle fixture; never retry a mutation." })
          yield* session.prompt({
            id: promptID,
            sessionID: id,
            prompt: admittedPrompt,
            resume: false,
          })
          const runner = yield* SessionRunner.Service
          const scope = yield* Scope.make()
          yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void))
          const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
            drain: (sessionID, force) => runner.run({ sessionID, force }),
          }).pipe(Effect.provideService(Scope.Scope, scope))
          const execution = yield* coordinator.run(id).pipe(Effect.exit, Effect.forkScoped)
          let joined: Fiber.Fiber<unknown, unknown> | undefined
          if (name === "stop" || name === "shutdown" || name === "steering" || name === "admission-retry") {
            yield* Effect.promise(scenario.wait)
            expect((yield* coordinator.active).has(id)).toBe(true)
            if (name === "stop") yield* coordinator.interrupt(id)
            if (name === "shutdown") yield* Scope.close(scope, Exit.void)
            if (name === "steering")
              yield* session.prompt({
                sessionID: id,
                prompt: Prompt.make({ text: "LIFECYCLE_STEER_SENTINEL" }),
                delivery: "steer",
                resume: false,
              })
            if (name === "admission-retry") {
              yield* session.prompt({ id: promptID, sessionID: id, prompt: admittedPrompt, resume: false })
              joined = yield* coordinator.run(id).pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
            }
            scenario.release()
          }
          const exit = yield* Fiber.join(execution).pipe(Effect.timeout("90 seconds"))
          yield* Effect.promise(() =>
            writeFile(
              `${fixture.artifacts}/scenario-${name}-exit.json`,
              JSON.stringify({ exit: exit._tag, cause: Exit.isFailure(exit) ? Cause.pretty(exit.cause) : undefined }),
              { mode: 0o600 },
            ),
          )
          if (joined) yield* Fiber.await(joined)
          expect((yield* coordinator.active).size).toBe(0)
          yield* Scope.close(scope, Exit.void)
          if (name === "retained-provider-failure") copied = scenario.tab
          const messages = yield* (yield* SessionStore.Service).context(id)
          if (name === "admission-retry") expect(messages.filter((message) => message.type === "user")).toHaveLength(1)
          yield* Effect.promise(() =>
            scenario.finish(fixture.artifacts, messages, exit._tag, fixture.effects().slice(effectsBefore)),
          )
        }
        // A second real Location graph must make progress and dispose while the first
        // Location's real permission service still owns an unanswered request.
        yield* (yield* AgentV2.Service).transform((editor) =>
          editor.update(AgentV2.ID.make("build"), (agent) => {
            agent.permissions = [{ action: "browser", resource: "*", effect: "ask" }]
          }),
        )
        const pendingScenario = yield* Effect.promise(() => lifecycleScenario(fixture.directory, "normal"))
        const otherScenario = yield* Effect.promise(() => lifecycleScenario(fixture.directory, "normal"))
        fixture.setScenario((body) =>
          JSON.stringify(body).includes("OTHER_PROJECT_SENTINEL")
            ? otherScenario.fetch(body)
            : pendingScenario.fetch(body),
        )
        const pendingID = SessionV2.ID.create()
        yield* db
          .insert(SessionTable)
          .values({
            id: pendingID,
            project_id: Project.ID.global,
            slug: pendingID,
            directory: location,
            title: "Pending project",
            version: "test",
          })
          .run()
          .pipe(Effect.orDie)
        yield* session.prompt({
          sessionID: pendingID,
          prompt: Prompt.make({ text: "PENDING_PROJECT_SENTINEL" }),
          resume: false,
        })
        const runner = yield* SessionRunner.Service
        const coordinator = yield* SessionRunCoordinator.make<SessionV2.ID, SessionRunner.RunError>({
          drain: (sessionID, force) => runner.run({ sessionID, force }),
        })
        const pendingExecution = yield* coordinator.run(pendingID).pipe(Effect.exit, Effect.forkScoped)
        const pendingRequest = yield* Queue.take(asked).pipe(Effect.timeout("10 seconds"))
        expect(pendingRequest.sessionID).toBe(pendingID)
        const nativeBefore = yield* Effect.promise(() => readFile(`${fixture.directory}/native-dispatch.jsonl`, "utf8"))
        const otherDirectory = AbsolutePath.make(`${fixture.artifacts}/other-project`)
        const otherProject = Project.ID.make("phase3-other-project")
        yield* Effect.promise(() => mkdir(otherDirectory, { mode: 0o700 }))
        const otherTranscript = yield* Effect.gen(function* () {
          const { db } = yield* Database.Service
          yield* db
            .insert(ProjectTable)
            .values({ id: otherProject, worktree: otherDirectory, sandboxes: [] })
            .run()
            .pipe(Effect.orDie)
          const id = SessionV2.ID.create()
          yield* db
            .insert(SessionTable)
            .values({
              id,
              project_id: otherProject,
              slug: id,
              directory: otherDirectory,
              title: "Other project while permission pending",
              version: "test",
            })
            .run()
            .pipe(Effect.orDie)
          yield* (yield* AgentV2.Service).transform((editor) =>
            editor.update(AgentV2.ID.make("build"), (agent) => {
              agent.permissions = [{ action: "browser", resource: "*", effect: "allow" }]
            }),
          )
          yield* (yield* SessionV2.Service).prompt({
            sessionID: id,
            prompt: Prompt.make({ text: "OTHER_PROJECT_SENTINEL" }),
            resume: false,
          })
          yield* (yield* SessionRunner.Service).run({ sessionID: id, force: true })
          return yield* (yield* SessionStore.Service).context(id)
        }).pipe(Effect.provide(Layer.fresh(makeLayer(otherDirectory, otherProject))))
        expect(yield* permission.get(pendingRequest.id)).toBeDefined()
        expect((yield* coordinator.active).has(pendingID)).toBe(true)
        expect(JSON.stringify(otherTranscript)).toContain("Browser cleanup: confirmed")
        yield* coordinator.interrupt(pendingID)
        yield* Fiber.await(pendingExecution)
        expect(yield* permission.get(pendingRequest.id)).toBeUndefined()
        const late = yield* permission.reply({ requestID: pendingRequest.id, reply: "once" }).pipe(Effect.flip)
        expect(late).toBeInstanceOf(PermissionV2.NotFoundError)
        const nativeAfter = yield* Effect.promise(() => readFile(`${fixture.directory}/native-dispatch.jsonl`, "utf8"))
        const dispatch = nativeAfter
          .slice(nativeBefore.length)
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
        expect(dispatch.filter((item) => item.method === "createTab")).toHaveLength(1)
        const pendingTranscript = yield* (yield* SessionStore.Service).context(pendingID)
        yield* Effect.promise(() =>
          writeFile(
            `${fixture.artifacts}/concurrent-projects.json`,
            JSON.stringify(
              {
                passed: true,
                pendingID,
                pendingRequest,
                lateReply: late._tag,
                otherProject,
                otherDirectory,
                otherProjectDisposedWhilePending: true,
                dispatch,
                nativeCreateCount: 1,
                otherTranscript,
                pendingTranscript,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          ),
        )
      }).pipe(
        Effect.provide(makeLayer()),
        Effect.provideService(BrowserMedia.Service, BrowserMedia.make({ directory: `${fixture.artifacts}/media` })),
      )
    }),
  480000,
)
