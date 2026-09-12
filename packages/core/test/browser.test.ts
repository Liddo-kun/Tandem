import { describe, expect, test } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Schema, Scope } from "effect"
import { Browser } from "../src/browser"
import { browserFixture } from "./lib/browser-fixture"
import { testEffect } from "./lib/effect"
import { LayerNode } from "../src/effect/layer-node"
import { Location } from "../src/location"
import { AbsolutePath } from "../src/schema"
import { Project } from "../src/project"
import { PermissionV2 } from "../src/permission"

const it = testEffect(Layer.empty)
const invocation = { messageID: "msg-runtime", callID: "call-runtime", vision: false, authorize: () => Effect.void }

describe("Browser runtime ownership", () => {
  test("configuration is off by default, bounded, and contains no model-controlled transport fields", () => {
    expect(Browser.connections("")).toEqual([])
    expect(() => Browser.connections("{broken")).toThrow("Invalid TANDEM_CHROME_CONNECTIONS")
    expect(() => Browser.connections(JSON.stringify([{ id: "x", label: "X", directory: "relative" }]))).toThrow()
    const connection = { id: "x", label: "X", directory: "/tmp/tandem/browser", screenshotVerified: true }
    expect(Browser.connections(JSON.stringify([connection]))).toEqual([connection])
    expect(() => Browser.connections(JSON.stringify([connection, connection]))).toThrow()
    expect(() => Schema.decodeUnknownSync(Browser.Input)({ action: "inspect", tab: "x".repeat(257) })).toThrow()
  })

  test("permission resources cannot inject wildcard grants and claim cannot save a wildcard", () => {
    const request = {
      browserId: "*?[]",
      browserLabel: "Fixture",
      callerSessionId: "s",
      callerTurnId: "t",
      capability: "claim" as const,
      documentOrigin: "https://example.com",
      operationId: "op-1",
      signal: new AbortController().signal,
    }
    const policy = Browser.permissionRequest(request)
    expect(policy.resources[0]).not.toMatch(/[\*?\[\]]/)
    expect(policy.save).toEqual([])
    expect(Browser.permissionRequest({ ...request, operationId: "op-2" }).resources).not.toEqual(policy.resources)
    expect(
      Browser.permissionRequest({
        ...request,
        capability: "navigation",
        destination: "https://example.com/private?secret=1",
      }).metadata.origin,
    ).toBe("https://example.com")
    const displayPolicy = Browser.permissionRequest({
      ...request,
      tabScope: "tab-7\u0000",
      tabTitle: `${"A".repeat(250)}\n*?[]`,
    })
    expect(displayPolicy.resources).toEqual(policy.resources)
    expect(displayPolicy.metadata).toMatchObject({
      browser: "Fixture",
      capability: "claim",
      origin: "https://example.com",
      tabScope: "tab-7 ",
      tabTitle: `${"A".repeat(250)} *?[]`,
    })
  })

  test("runtime metadata and durable error text preserve original operation and browser aliases", () => {
    const metadata = Schema.decodeUnknownSync(Browser.Metadata)({
      action: "type",
      outcome: "unknown",
      code: "cancelled",
      operation: "operation_original",
      browser: "configured-browser",
    })
    expect(Browser.failureText(metadata)).toContain("operation=operation_original; browser=configured-browser")
    expect(Schema.encodeSync(Browser.Metadata)(metadata)).toMatchObject({
      operation: "operation_original",
      browser: "configured-browser",
    })
  })

  it.live("a real typed permission failure after dispatch retains its original cause and operation alias", () =>
    Effect.gen(function* () {
      const { owner } = yield* browserFixture
      const execution = owner.begin({ runtime: "v2", location: "location", sessionID: "permission-after-dispatch" })
      const failure = new PermissionV2.BlockedError({ rules: [] })
      const results: (typeof Browser.Metadata.Type)[] = []
      const exit = yield* Browser.execute(
        execution,
        { action: "create", browser: "fixture", url: "https://fixture.test/denied" },
        {
          ...invocation,
          authorize: (request) => (request.capability === "site" ? Effect.fail(failure) : Effect.void),
          metadata: (result) =>
            Effect.sync(() => {
              results.push(result.metadata)
            }),
        },
      ).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit))
        expect(exit.cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === failure)).toBe(true)
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ outcome: "confirmed", code: "permission_denied", browser: "fixture" })
      expect(results[0]?.operation).toMatch(/^operation_/)
    }),
  )

  it.live("independent layer graphs share a ref-counted owner until the last scope closes", () =>
    Effect.gen(function* () {
      const fixture = yield* browserFixture
      const original = process.env.TANDEM_CHROME_CONNECTIONS
      process.env.TANDEM_CHROME_CONNECTIONS = JSON.stringify(fixture.connections)
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (original === undefined) delete process.env.TANDEM_CHROME_CONNECTIONS
          else process.env.TANDEM_CHROME_CONNECTIONS = original
        }),
      )
      const a = yield* Scope.make(),
        b = yield* Scope.make()
      const first = Context.get(yield* Layer.buildWithScope(Browser.layer, a), Browser.Service)
      const second = Context.get(yield* Layer.buildWithScope(Layer.fresh(Browser.layer), b), Browser.Service)
      expect(first.owner).toBeDefined()
      expect(first.owner).toBe(second.owner)
      yield* Scope.close(a, Exit.void)
      const execution = second.owner?.begin({ runtime: "v2", location: "B", sessionID: "s" })
      expect(execution).toBeDefined()
      yield* Scope.close(b, Exit.void)
      expect(() => second.owner?.begin({ runtime: "legacy", location: "A", sessionID: "next" })).toThrow()
    }),
  )

  for (const outcome of ["success", "failure", "interrupt"] as const)
    it.live(`execution ${outcome} awaits native cleanup and preserves the primary exit`, () =>
      Effect.gen(function* () {
        const { owner, tabs, calls } = yield* browserFixture
        const messages: string[] = []
        const entered = yield* Deferred.make<void>()
        const failure = new Error("primary runtime failure")
        const work = Effect.gen(function* () {
          const execution = yield* Browser.beginExecution(
            owner,
            { runtime: "v2", location: "location", sessionID: "session" },
            (text) =>
              Effect.sync(() => {
                messages.push(text)
              }),
          )
          if (!execution) return yield* Effect.die("Missing enabled browser execution")
          yield* Browser.execute(execution, { action: "create", browser: "fixture" }, invocation)
          expect(tabs.size).toBe(1)
          yield* Deferred.succeed(entered, undefined)
          if (outcome === "failure") return yield* Effect.fail(failure)
          if (outcome === "interrupt") return yield* Effect.never
        }).pipe(Effect.scoped)
        const fiber = yield* work.pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        if (outcome === "interrupt") yield* Fiber.interrupt(fiber)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(outcome === "success")
        if (outcome === "failure" && Exit.isFailure(exit))
          expect(exit.cause.reasons.some((reason) => reason._tag === "Fail" && reason.error === failure)).toBe(true)
        expect(tabs.size).toBe(1)
        expect([...tabs.values()].every((tab) => !tab.attached)).toBe(true)
        expect(calls.filter((call) => call.method === "turnEnded")).toHaveLength(0)
        expect(calls.filter((call) => call.method === "finalizeTabs")).toHaveLength(1)
        expect(messages).toHaveLength(1)
        expect(messages[0]).toContain("confirmed")
        expect(() => owner.current({ runtime: "v2", location: "location", sessionID: "session" })).toThrow()
      }),
    )

  it.live("closing one project leaves other locations and runtimes usable", () =>
    Effect.gen(function* () {
      const { owner, tabs } = yield* browserFixture
      const a = owner.begin({ runtime: "legacy", location: "A", sessionID: "same" })
      const b = owner.begin({ runtime: "v2", location: "B", sessionID: "same" })
      yield* Browser.execute(a, { action: "create", browser: "fixture" }, invocation)
      yield* Browser.execute(b, { action: "create", browser: "fixture" }, invocation)
      expect(tabs.size).toBe(2)
      yield* Effect.promise(() => owner.closeLocation("A"))
      expect(tabs.size).toBe(2)
      expect(tabs.get(10)?.session).toBeUndefined()
      expect(tabs.get(11)?.session).toBeDefined()
      expect(owner.current({ runtime: "v2", location: "B", sessionID: "same" })).toBe(b)
      yield* Browser.execute(b, { action: "discover", browser: "fixture" }, { ...invocation, callID: "call-next" })
      yield* Effect.promise(() => owner.closeSession({ runtime: "v2", location: "B", sessionID: "same" }))
      expect(tabs.size).toBe(2)
      expect([...tabs.values()].every((tab) => !tab.attached && tab.session === undefined)).toBe(true)
    }),
  )

  it.live("permission cancellation awaits the source finalizer and records the non-dispatch outcome", () =>
    Effect.gen(function* () {
      const { owner, calls } = yield* browserFixture
      const execution = owner.begin({ runtime: "v2", location: "location", sessionID: "cancelled" })
      const entered = yield* Deferred.make<void>()
      let finalized = false
      const outcomes: string[] = []
      const fiber = yield* Browser.execute(
        execution,
        { action: "discover", browser: "fixture" },
        {
          ...invocation,
          authorize: () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(entered, undefined)
              yield* Effect.never
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  finalized = true
                }),
              ),
            ),
          metadata: (result) =>
            Effect.sync(() => {
              outcomes.push(result.metadata.outcome)
            }),
        },
      ).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)
      expect(finalized).toBe(true)
      expect(outcomes).toEqual(["not_dispatched"])
      expect(calls.filter((call) => call.method === "getUserTabs")).toHaveLength(0)
    }),
  )

  it.live("interruption waits for asynchronous cleanup publication, not only native cleanup", () =>
    Effect.gen(function* () {
      const { owner } = yield* browserFixture
      const entered = yield* Deferred.make<void>(),
        publishing = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>()
      let published = false
      const work = Effect.gen(function* () {
        const execution = yield* Browser.beginExecution(
          owner,
          { runtime: "v2", location: "location", sessionID: "publish" },
          () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(publishing, undefined)
              yield* Deferred.await(release)
              published = true
            }),
        )
        if (!execution) return yield* Effect.die("Missing browser execution")
        yield* Browser.execute(execution, { action: "create", browser: "fixture" }, invocation)
        yield* Deferred.succeed(entered, undefined)
        yield* Effect.never
      }).pipe(Effect.scoped)
      const fiber = yield* work.pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const stopping = yield* Fiber.interrupt(fiber).pipe(Effect.forkChild)
      yield* Deferred.await(publishing)
      expect(stopping.pollUnsafe()).toBeUndefined()
      expect(published).toBe(false)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(stopping)
      expect(published).toBe(true)
    }),
  )

  it.live("disposing a V2 Location does not close legacy leases in the same project", () =>
    Effect.gen(function* () {
      const { owner, tabs } = yield* browserFixture
      const location = {
        directory: AbsolutePath.make("/tmp/tandem/shared-project"),
        project: { id: Project.ID.make("shared"), directory: AbsolutePath.make("/tmp/tandem/shared-project") },
      }
      const layer = LayerNode.compile(Browser.locationNode, [
        [Browser.node, Layer.succeed(Browser.Service, { owner })],
        [Location.node, Layer.succeed(Location.Service, location)],
      ])
      const scope = yield* Scope.make()
      yield* Layer.buildWithScope(layer, scope)
      const legacy = owner.begin({
        runtime: "legacy",
        location: Browser.locationKey(location, "legacy"),
        sessionID: "same",
      })
      const v2 = owner.begin({ runtime: "v2", location: Browser.locationKey(location, "v2"), sessionID: "same" })
      yield* Browser.execute(legacy, { action: "create", browser: "fixture" }, invocation)
      yield* Browser.execute(v2, { action: "create", browser: "fixture" }, invocation)
      yield* Scope.close(scope, Exit.void)
      expect(tabs.size).toBe(2)
      expect(tabs.get(10)?.session).toBeDefined()
      expect(tabs.get(11)?.session).toBeUndefined()
      expect(
        owner.current({ runtime: "legacy", location: Browser.locationKey(location, "legacy"), sessionID: "same" }),
      ).toBe(legacy)
      yield* Browser.execute(legacy, { action: "discover", browser: "fixture" }, { ...invocation, callID: "next" })
    }),
  )
})
