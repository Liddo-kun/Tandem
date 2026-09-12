import { expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { Browser } from "../src/browser"
import { BrowserTool } from "../src/tool/browser"
import { Catalog } from "../src/catalog"
import { Location } from "../src/location"
import { PermissionV2 } from "../src/permission"
import { SessionStore } from "../src/session/store"
import { SessionSchema } from "../src/session/schema"
import { Project } from "../src/project"
import { AbsolutePath } from "../src/schema"
import { ToolRegistry } from "../src/tool/registry"
import { ToolOutputStore } from "../src/tool-output-store"
import { LayerNode } from "../src/effect/layer-node"
import { testEffect } from "./lib/effect"
import { settleTool, toolDefinitions, toolIdentity } from "./lib/tool"
import { browserFixture } from "./lib/browser-fixture"
import { EventV2 } from "../src/event"
import { SessionEvent } from "../src/session/event"

const it = testEffect(Layer.empty)
const sessionID = SessionSchema.ID.make("ses_browser_runtime")
const location = {
  directory: AbsolutePath.make("/tmp/tandem/browser-runtime"),
  project: { id: Project.ID.make("browser-runtime"), directory: AbsolutePath.make("/tmp/tandem/browser-runtime") },
}

it.live("canonical browser leaf binds parallel calls to their own source and preserves permission defects", () =>
  Effect.gen(function* () {
    const fixture = yield* browserFixture
    const requests: PermissionV2.AssertInput[] = []
    const entered = yield* Deferred.make<void>(),
      release = yield* Deferred.make<void>()
    const defect = new Error("permission defect identity")
    const permission = Layer.mock(PermissionV2.Service, {
      assert: (input) =>
        Effect.gen(function* () {
          requests.push(input)
          if (input.source?.type === "tool" && input.source.callID === "a") {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          if (input.source?.type === "tool" && input.source.callID === "dismissed")
            return yield* new PermissionV2.DismissedError()
          if (input.source?.type === "tool" && input.source.callID === "defect") return yield* Effect.die(defect)
          if (
            input.source?.type === "tool" &&
            input.source.callID === "partial" &&
            input.metadata?.origin === "https://partial.test"
          )
            return yield* new PermissionV2.BlockedError({ rules: [] })
        }),
    })
    const layer = LayerNode.compile(
      LayerNode.group([ToolRegistry.node, ToolRegistry.toolsNode, BrowserTool.node, EventV2.node]),
      [
        [Browser.node, Layer.succeed(Browser.Service, { owner: fixture.owner })],
        [Location.node, Layer.succeed(Location.Service, location)],
        [PermissionV2.node, permission],
        [SessionStore.node, Layer.mock(SessionStore.Service, { message: () => Effect.succeed(undefined) })],
        [
          Catalog.node,
          Layer.mock(Catalog.Service, {
            provider: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
            },
            model: {
              get: () => Effect.die("unused"),
              all: () => Effect.die("unused"),
              available: () => Effect.die("unused"),
              default: () => Effect.die("unused"),
              small: () => Effect.die("unused"),
            },
          }),
        ],
        [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
      ],
    )
    const execution = fixture.owner.begin({ runtime: "v2", location: Browser.locationKey(location, "v2"), sessionID })
    const ids = ["a", "b", "dismissed", "after-dismiss", "defect", "stale"]
    ids.forEach((id, index) => fixture.tabs.set(index + 1, { id: index + 1, url: `https://${id}.test`, attached: false }))
    const discovered = yield* Effect.promise(() => execution.execute({ action: "discover", browser: "fixture" }, {
      messageID: "setup", callID: "setup", signal: new AbortController().signal, vision: false, authorize: async () => "allow",
    }))
    const descriptors = JSON.parse(discovered.text).tabs
    yield* Effect.gen(function* () {
      const registry = yield* ToolRegistry.Service
      const events = yield* EventV2.Service
      const notice = yield* Deferred.make<string>()
      const unsubscribe = yield* events.listen((event) => {
        const data = event.data
        if (
          event.type !== SessionEvent.Synthetic.type ||
          !data ||
          typeof data !== "object" ||
          !("text" in data) ||
          typeof data.text !== "string" ||
          !data.text.includes("outcome=confirmed")
        )
          return Effect.void
        return Deferred.succeed(notice, data.text).pipe(Effect.asVoid)
      })
      yield* Effect.addFinalizer(() => unsubscribe)
      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["browser"])
      const call = (id: string) =>
        settleTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id,
            name: "browser",
            input: {
              browser: "fixture",
              ...(id === "partial" ? { action: "create", url: "https://partial.test/denied" } :
                { action: "claim", descriptor: descriptors[ids.indexOf(id)].descriptor }),
            },
          },
        })
      const a = yield* call("a").pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const b = yield* call("b")
      expect(b.output?.structured).toMatchObject({ metadata: { action: "claim" } })
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(a)
      expect(requests.slice(0, 2).map((request) => request.source)).toEqual([
        { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "a" },
        { type: "tool", messageID: toolIdentity.assistantMessageID, callID: "b" },
      ])
      expect(requests.every((request) => request.sessionID === sessionID && request.action === "browser")).toBe(true)
      expect(yield* call("dismissed")).toMatchObject({ result: { type: "error" } })
      expect(yield* call("after-dismiss")).toMatchObject({ result: { type: "text" } })
      const failed = yield* call("defect").pipe(Effect.exit)
      expect(Exit.isFailure(failed)).toBe(true)
      if (Exit.isFailure(failed))
        expect(failed.cause.reasons.some((reason) => reason._tag === "Die" && reason.defect === defect)).toBe(true)
      expect(fixture.calls.filter((call) => call.method === "claimUserTab")).toHaveLength(3)
      expect((yield* call("partial")).result).toMatchObject({ type: "error" })
      const text = yield* Deferred.await(notice)
      const original = yield* Effect.promise(() =>
        execution.execute(
          { action: "create", browser: "fixture", url: "https://partial.test/denied" },
          {
            messageID: toolIdentity.assistantMessageID,
            callID: "partial",
            signal: new AbortController().signal,
            vision: false,
            authorize: async () => "allow",
          },
        ),
      )
      expect(text).toBe(Browser.failureText(original.metadata))
      expect(text).toContain("operation=operation_")
      expect(text).toContain("browser=fixture")
      expect(fixture.calls.filter((call) => call.method === "createTab")).toHaveLength(1)
      expect((yield* Effect.promise(() => execution.end())).every((report) => report.confirmed)).toBe(true)
      const stale = yield* call("stale")
      expect(stale.result).toMatchObject({ type: "error" })
      expect(fixture.calls.filter((call) => call.method === "createTab")).toHaveLength(1)
    }).pipe(Effect.provide(layer))
  }),
)
