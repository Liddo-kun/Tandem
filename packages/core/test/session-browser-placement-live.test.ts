import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer, Queue, Schema } from "effect"
import { writeFile } from "node:fs/promises"
import { AgentV2 } from "../src/agent"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { LayerNode } from "../src/effect/layer-node"
import { Database } from "../src/database/database"
import { EventV2 } from "../src/event"
import { Location } from "../src/location"
import { LocationServiceMap } from "../src/location-service-map"
import { ModelV2 } from "../src/model"
import { PermissionV2 } from "../src/permission"
import { ProviderV2 } from "../src/provider"
import { AbsolutePath } from "../src/schema"
import { SessionV2 } from "../src/session"
import { SessionExecution } from "../src/session/execution"
import { SessionExecutionLocal } from "../src/session/execution/local"
import { SessionProjector } from "../src/session/projector"
import { Prompt } from "../src/session/prompt"
import { ToolRegistry } from "../src/tool/registry"
import { browserPlacementFixture } from "./lib/browser-placement-fixture"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const live = process.env.TANDEM_PLACEMENT_RUN_DIR ? it.live : it.live.skip
const poll = <A, E, R>(effect: Effect.Effect<A | undefined, E, R>) =>
  Effect.gen(function* () {
    while (true) {
      const value = yield* effect
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
  }).pipe(Effect.timeout("20 seconds"))

live(
  "real V2 placement, transport retry, ownership and unsupported delegation",
  () =>
    Effect.gen(function* () {
      const directory = process.env.TANDEM_PLACEMENT_RUN_DIR ?? ""
      const fixture = yield* Effect.acquireRelease(
        Effect.promise(() => browserPlacementFixture(directory)),
        (value) => Effect.sync(value.close),
      )
      const layer = AppNodeBuilder.build(
        LayerNode.group([
          SessionV2.node,
          SessionExecution.node,
          LocationServiceMap.node,
          SessionProjector.node,
          Database.node,
          EventV2.node,
        ]),
        [[SessionExecution.node, SessionExecutionLocal.node]],
      )
      yield* Effect.gen(function* () {
        const session = yield* SessionV2.Service
        const execution = yield* SessionExecution.Service
        const locations = yield* LocationServiceMap.Service
        const a = Location.Ref.make({ directory: AbsolutePath.make(`${fixture.artifacts}/a`) })
        const b = Location.Ref.make({ directory: AbsolutePath.make(`${fixture.artifacts}/b`) })
        const model = { providerID: ProviderV2.ID.make("fixture"), id: ModelV2.ID.make("fixture") }
        const stages: unknown[] = []
        const asked = yield* Queue.unbounded<PermissionV2.Request>()
        const unsubscribe = yield* (yield* EventV2.Service).listen((event) =>
          event.type === PermissionV2.Event.Asked.type
            ? Queue.offer(asked, Schema.decodeUnknownSync(PermissionV2.Request)(event.data)).pipe(Effect.asVoid)
            : Effect.void,
        )
        yield* Effect.addFinalizer(() => unsubscribe)
        const record = (name: string, data: unknown) =>
          Effect.promise(async () => {
            stages.push({ name, data })
            await writeFile(`${fixture.artifacts}/stages.json`, JSON.stringify(stages, null, 2), { mode: 0o600 })
          })
        const retry = yield* session.create({ location: a, model, agent: AgentV2.ID.make("allowed") })
        const retryPlan = fixture.plan(retry.id, "retry")
        yield* session.prompt({
          sessionID: retry.id,
          prompt: Prompt.make({ text: "Execute the local browser fixture once." }),
          resume: false,
        })
        expect((yield* execution.active).size).toBe(0)
        const retryExit = yield* session.resume(retry.id).pipe(Effect.exit)
        yield* record("retry-exit", {
          exit: retryExit._tag,
          cause: Exit.isFailure(retryExit) ? Cause.pretty(retryExit.cause) : undefined,
          transcript: yield* session.context(retry.id),
        })
        expect(retryExit._tag).toBe("Success")
        expect(retryPlan.attempts.map((item) => item.status)).toEqual([200, 200, 200, 503, 200])
        expect(retryPlan.attempts[3]?.hash).toBe(retryPlan.attempts[4]?.hash)
        expect(fixture.effects).toEqual([{ trusted: true, clicks: 1 }])
        const afterRetry = yield* Effect.promise(fixture.native)
        expect(afterRetry.filter((item) => item.method === "createTab")).toHaveLength(1)
        expect(afterRetry.filter((item) => item.inputType === "mousePressed")).toHaveLength(1)
        expect(afterRetry.filter((item) => item.inputType === "mouseReleased")).toHaveLength(1)
        expect(JSON.stringify(yield* session.context(retry.id))).toContain("Browser cleanup: confirmed")
        yield* record("503-retry-single-mutation", {
          native: afterRetry,
          effects: fixture.effects,
          attempts: retryPlan.attempts,
        })

        const parent = yield* session.create({ location: a, model, agent: AgentV2.ID.make("allowed") })
        const parentPlan = fixture.plan(parent.id, "hold")
        yield* session.prompt({
          sessionID: parent.id,
          prompt: Prompt.make({ text: "Hold browser ownership until interrupted." }),
        })
        yield* poll(Effect.sync(() => (parentPlan.ready ? true : undefined)))
        expect((yield* execution.active).has(parent.id)).toBe(true)
        expect(typeof parentPlan.tab).toBe("string")
        const joined = yield* session.resume(parent.id).pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))

        const foreign = yield* session.create({ location: b, model, agent: AgentV2.ID.make("allowed") })
        expect(foreign.projectID).not.toBe(parent.projectID)
        const foreignPlan = fixture.plan(foreign.id, "foreign", parentPlan.tab)
        yield* session.prompt({
          sessionID: foreign.id,
          prompt: Prompt.make({ text: "Attempt the foreign alias once." }),
          resume: false,
        })
        yield* session.resume(foreign.id)
        expect(
          foreignPlan.results.some((item) => item.code === "stale_handle" && item.outcome === "not_dispatched"),
        ).toBe(true)
        const placedA = yield* Location.Service.pipe(Effect.provide(locations.get(a)))
        const placedB = yield* Location.Service.pipe(Effect.provide(locations.get(b)))
        expect(placedA.project.id).toBe(parent.projectID)
        expect(placedB.project.id).toBe(foreign.projectID)
        expect(yield* locations.contextEffect(a)).toBe(
          yield* locations.contextEffect(Location.Ref.make({ directory: a.directory })),
        )
        yield* record("cross-project-alias-rejected", {
          parent,
          foreign,
          placedA,
          placedB,
          transcript: yield* session.context(foreign.id),
        })

        const own = yield* session.create({ location: b, model, agent: AgentV2.ID.make("unapproved") })
        fixture.plan(own.id, "create")
        const beforeApproval = (yield* Effect.promise(fixture.native)).filter(
          (item) => item.method === "createTab",
        ).length
        yield* session.prompt({
          sessionID: own.id,
          prompt: Prompt.make({ text: "Request an independently owned tab." }),
        })
        const request = yield* Queue.take(asked).pipe(Effect.timeout("20 seconds"))
        expect(request.sessionID).toBe(own.id)
        expect(request.source?.type).toBe("tool")
        expect(request.source?.type === "tool" ? request.source.callID : undefined).toBe("placement-1")
        expect((yield* execution.active).has(parent.id)).toBe(true)
        expect((yield* Effect.promise(fixture.native)).filter((item) => item.method === "createTab")).toHaveLength(
          beforeApproval,
        )
        const ownJoin = yield* session.resume(own.id).pipe(Effect.exit, Effect.forkScoped({ startImmediately: true }))
        yield* PermissionV2.Service.use((permission) =>
          permission.reply({ requestID: request.id, reply: "once" }),
        ).pipe(Effect.provide(locations.get(b)))
        expect((yield* Fiber.join(ownJoin))._tag).toBe("Success")
        expect((yield* Effect.promise(fixture.native)).filter((item) => item.method === "createTab")).toHaveLength(
          beforeApproval + 1,
        )
        yield* record("independent-ownership-needs-explicit-approval", {
          request,
          transcript: yield* session.context(own.id),
        })

        const task = yield* session.create({ location: a, model, agent: AgentV2.ID.make("allowed") })
        fixture.plan(task.id, "task", parentPlan.tab)
        const beforeTask = (yield* Effect.promise(fixture.native)).length
        const sessionsBefore = yield* session.list()
        const definitions = yield* ToolRegistry.Service.use((registry) => registry.materialize()).pipe(
          Effect.provide(locations.get(a)),
        )
        expect(definitions.definitions.some((item) => item.name === "task")).toBe(false)
        yield* session.prompt({
          sessionID: task.id,
          prompt: Prompt.make({ text: "Attempt unsupported delegation without fallback." }),
          resume: false,
        })
        yield* session.resume(task.id)
        const taskTranscript = yield* session.context(task.id)
        expect(JSON.stringify(taskTranscript)).toContain("Unknown tool: task")
        expect((yield* session.list()).length).toBe(sessionsBefore.length)
        expect((yield* Effect.promise(fixture.native)).length).toBe(beforeTask)
        yield* record("unsupported-v2-task-rejected", {
          nativeDispatches: 0,
          childrenCreated: 0,
          transcript: taskTranscript,
        })

        yield* session.interrupt(parent.id)
        parentPlan.release()
        expect((yield* Fiber.join(joined))._tag).toBe("Failure")
        expect((yield* execution.active).size).toBe(0)
        expect(JSON.stringify(yield* session.context(parent.id))).toContain("Browser cleanup: confirmed")
        const beforeIdleWake = (yield* Effect.promise(fixture.native)).length
        yield* execution.wake(parent.id)
        yield* poll(execution.active.pipe(Effect.map((active) => (active.size === 0 ? true : undefined))))
        expect((yield* Effect.promise(fixture.native)).length).toBe(beforeIdleWake)
        expect(parentPlan.attempts).toHaveLength(2)
        expect(fixture.errors).toEqual([])
        yield* record("public-interrupt-and-idle-wake-no-replay", {
          parent: parent.id,
          transcript: yield* session.context(parent.id),
        })
        const native = yield* Effect.promise(fixture.native)
        const nativeCounts = {
          createTab: native.filter((item) => item.method === "createTab").length,
          mousePressed: native.filter((item) => item.inputType === "mousePressed").length,
          mouseReleased: native.filter((item) => item.inputType === "mouseReleased").length,
        }
        expect(nativeCounts).toEqual({ createTab: 3, mousePressed: 1, mouseReleased: 1 })
        yield* Effect.promise(() =>
          writeFile(
            `${fixture.artifacts}/report.json`,
            JSON.stringify(
              {
                passed: true,
                realSessionExecutionLocal: true,
                realLocationServiceMap: true,
                noRunnerModelCatalogPermissionMocks: true,
                realProjects: [parent.projectID, foreign.projectID],
                stages,
                native,
                nativeCounts,
                fixtureEffects: fixture.effects,
                fixtureCommands: fixture.commands,
                unsupported: [
                  "V2 task delegation is not implemented; actual tool call rejected without a child or native dispatch",
                  "No automatic durable post-crash recovery introduced",
                ],
              },
              null,
              2,
            ),
            { mode: 0o600 },
          ),
        )
      }).pipe(Effect.provide(layer))
    }),
  240000,
)
