import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Schema } from "effect"
import { Browser } from "@opencode-ai/core/browser"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BrowserTool } from "../../src/tool/browser"
import { Tool } from "../../src/tool/tool"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "../../src/tool/truncate"
import { InstanceState } from "../../src/effect/instance-state"
import { MessageID, SessionID } from "../../src/session/schema"
import { browserFixture } from "../../../core/test/lib/browser-fixture"
import { testEffect } from "../lib/effect"
import { Session } from "../../src/session/session"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionInterruption } from "@opencode-ai/core/session/interruption"
import { SessionRunCoordinator } from "@opencode-ai/core/session/run-coordinator"
import { SessionRunState } from "../../src/session/run-state"

const it = testEffect(LayerNode.compile(LayerNode.group([Agent.node, Truncate.node, Session.node])))

it.instance("deletion awaits legacy foreground and V2 coordinator finalizers before removing history", () =>
  Effect.gen(function* () {
    const layer = LayerNode.compile(
      LayerNode.group([Session.node, SessionProjector.node, SessionRunState.node, SessionInterruption.node]),
    )
    yield* Effect.gen(function* () {
      const sessions = yield* Session.Service
      const runtime = yield* SessionRunState.Service
      const interruption = yield* SessionInterruption.Service
      const session = yield* sessions.create({})
      const readyLegacy = yield* Deferred.make<void>(),
        readyV2 = yield* Deferred.make<void>()
      const closingLegacy = yield* Deferred.make<void>(),
        closingV2 = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const completed: string[] = []
      const finalizer = (name: string, started: Deferred.Deferred<void>) =>
        Effect.gen(function* () {
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(release)
          completed.push(name)
        }).pipe(Effect.uninterruptible)
      const legacy = yield* runtime
        .ensureRunning(
          session.id,
          Effect.interrupt,
          Deferred.succeed(readyLegacy, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(finalizer("legacy", closingLegacy)),
          ),
        )
        .pipe(Effect.forkChild)
      const coordinator = yield* SessionRunCoordinator.make<SessionID, never>({
        drain: () =>
          Deferred.succeed(readyV2, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(finalizer("v2", closingV2)),
          ),
      })
      yield* interruption.register({ interrupt: coordinator.interrupt })
      const v2 = yield* coordinator.run(session.id).pipe(Effect.forkChild)
      yield* Deferred.await(readyLegacy)
      yield* Deferred.await(readyV2)
      const removing = yield* sessions.remove(session.id).pipe(Effect.forkChild)
      yield* Deferred.await(closingLegacy)
      yield* Deferred.await(closingV2)
      expect(removing.pollUnsafe()).toBeUndefined()
      expect((yield* sessions.get(session.id)).id).toBe(session.id)
      expect(completed).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(removing)
      expect(completed.sort()).toEqual(["legacy", "v2"])
      expect((yield* coordinator.active).has(session.id)).toBe(false)
      yield* Fiber.await(legacy)
      yield* Fiber.await(v2)
    }).pipe(Effect.provide(layer))
  }),
)

it.instance("session deletion closes both runtime leases without touching another session", () =>
  Effect.gen(function* () {
    const fixture = yield* browserFixture
    const layer = LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node]), [
      [Browser.node, Layer.succeed(Browser.Service, { owner: fixture.owner })],
    ])
    yield* Effect.gen(function* () {
      const sessions = yield* Session.Service
      const session = yield* sessions.create({})
      const location = Browser.locationKey(session, "v2")
      const legacyLocation = Browser.locationKey(session, "legacy")
      const legacy = fixture.owner.begin({ runtime: "legacy", location: legacyLocation, sessionID: session.id })
      const canonical = fixture.owner.begin({ runtime: "v2", location, sessionID: session.id })
      const other = fixture.owner.begin({ runtime: "v2", location, sessionID: "unrelated" })
      const invocation = { messageID: "message", callID: "call", vision: false, authorize: () => Effect.void }
      for (const execution of [legacy, canonical, other])
        yield* Browser.execute(execution, { action: "create", browser: "fixture" }, invocation)
      expect(fixture.tabs.size).toBe(3)
      yield* sessions.remove(session.id)
      expect(fixture.tabs.size).toBe(3)
      expect(fixture.tabs.get(10)?.session).toBeUndefined()
      expect(fixture.tabs.get(11)?.session).toBeUndefined()
      expect(fixture.tabs.get(12)?.session).toBeDefined()
      expect(fixture.owner.current({ runtime: "v2", location, sessionID: "unrelated" })).toBe(other)
      expect(() =>
        fixture.owner.current({ runtime: "legacy", location: legacyLocation, sessionID: session.id }),
      ).toThrow()
      expect(() => fixture.owner.current({ runtime: "v2", location, sessionID: session.id })).toThrow()
    }).pipe(Effect.provide(layer))
  }),
)

it.instance("legacy internal browser leaf captures invocation asks and retains permission failures", () =>
  Effect.gen(function* () {
    const fixture = yield* browserFixture
    const location = Browser.locationKey(
      {
        directory: (yield* InstanceState.context).directory,
        workspaceID: yield* InstanceState.workspaceID,
      },
      "legacy",
    )
    const sessionID = SessionID.make("ses_browser_runtime")
    const execution = fixture.owner.begin({ runtime: "legacy", location, sessionID })
    const ids = ["a", "b", "dismissed", "after-dismiss", "denied"]
    ids.forEach((id, index) => fixture.tabs.set(index + 1, { id: index + 1, url: `https://${id}.test`, attached: false }))
    const discovered = yield* Effect.promise(() => execution.execute({ action: "discover", browser: "fixture" }, {
      messageID: "setup", callID: "setup", signal: new AbortController().signal, vision: false, authorize: async () => "allow",
    }))
    const descriptors = JSON.parse(discovered.text).tabs
    const requests: { callID: string; request: Parameters<Tool.Context["ask"]>[0] }[] = []
    const entered = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>()
    const defect = new PermissionV1.RejectedError()
    const metadata: (typeof Browser.Metadata.Type)[] = []
    const info = yield* BrowserTool.pipe(Effect.provideService(Browser.Service, { owner: fixture.owner }))
    const tool = yield* info.init()
    const call = (callID: string) =>
      tool.execute(
        {
          browser: "fixture",
          ...(callID === "denied-after-dispatch" ? { action: "create" as const, url: "https://denied-after-dispatch.test/denied" } :
            { action: "claim" as const, descriptor: descriptors[ids.indexOf(callID)].descriptor }),
        },
        {
          sessionID,
          messageID: MessageID.make(`msg_${callID}`),
          callID,
          agent: "build",
          abort: new AbortController().signal,
          messages: [],
          metadata: (input) =>
            Effect.sync(() => {
              if (input.metadata) metadata.push(Schema.decodeUnknownSync(Browser.Metadata)(input.metadata))
            }),
          ask: (request) =>
            Effect.gen(function* () {
              requests.push({ callID, request })
              if (callID === "a") {
                yield* Deferred.succeed(entered, undefined)
                yield* Deferred.await(release)
              }
              if (callID === "dismissed") return yield* Effect.die(new PermissionV1.DismissedError())
              if (callID === "denied") return yield* Effect.die(defect)
              if (callID === "denied-after-dispatch" && request.metadata.origin === "https://denied-after-dispatch.test")
                return yield* Effect.die(defect)
            }),
        },
      )
    const a = yield* call("a").pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    expect((yield* call("b")).metadata.action).toBe("claim")
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(a)
    expect(requests.map((request) => request.callID)).toEqual(["a", "b"])
    expect(requests.every((request) => request.request.permission === "browser")).toBe(true)
    const dismissed = yield* call("dismissed").pipe(Effect.exit)
    expect(Exit.isFailure(dismissed)).toBe(true)
    if (Exit.isFailure(dismissed)) {
      const error = Cause.squash(dismissed.cause)
      expect(error).toBeInstanceOf(PermissionV1.DismissedError)
      expect(error).not.toBeInstanceOf(PermissionV1.RejectedError)
    }
    expect((yield* call("after-dismiss")).metadata.action).toBe("claim")
    const failed = yield* call("denied").pipe(Effect.exit)
    expect(Exit.isFailure(failed)).toBe(true)
    if (Exit.isFailure(failed))
      expect(failed.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === defect)).toBe(true)
    expect(fixture.calls.filter((call) => call.method === "claimUserTab")).toHaveLength(3)
    const partial = yield* call("denied-after-dispatch").pipe(Effect.exit)
    expect(Exit.isFailure(partial)).toBe(true)
    if (Exit.isFailure(partial))
      expect(partial.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === defect)).toBe(true)
    expect(metadata.at(-1)).toMatchObject({ outcome: "confirmed", code: "permission_denied", browser: "fixture" })
    expect(metadata.at(-1)?.operation).toMatch(/^operation_/)
    expect((yield* Effect.promise(() => execution.end())).every((report) => report.confirmed)).toBe(true)
  }),
)
