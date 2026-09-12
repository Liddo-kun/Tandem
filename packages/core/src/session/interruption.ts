export * as SessionInterruption from "./interruption"

import { Context, Effect, Layer, Scope } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { memoMap } from "../effect/memo-map"
import { SessionSchema } from "./schema"

type Handler = { directory?: string; interrupt: (sessionID: SessionSchema.ID) => Effect.Effect<void> }
export interface Interface {
  readonly register: (handler: Handler) => Effect.Effect<void, never, Scope.Scope>
  readonly interrupt: (sessionID: SessionSchema.ID, directory: string) => Effect.Effect<void>
}
export class Service extends Context.Service<Service, Interface>()("@opencode/SessionInterruption") {}

// A leaf registry avoids a dependency cycle from Session deletion back through either runner.
const resourceLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const handlers = new Set<Handler>()
    return Service.of({
      register: (handler) =>
        Effect.gen(function* () {
          const context = yield* Effect.context<never>()
          const captured: Handler = {
            directory: handler.directory,
            interrupt: (sessionID) => Effect.suspend(() => handler.interrupt(sessionID)).pipe(Effect.provide(context)),
          }
          yield* Effect.acquireRelease(
            Effect.sync(() => {
              handlers.add(captured)
            }),
            () =>
              Effect.sync(() => {
                handlers.delete(captured)
              }),
          )
        }),
      interrupt: (sessionID, directory) =>
        Effect.suspend(() =>
          Effect.forEach(
            [...handlers].filter((handler) => handler.directory === undefined || handler.directory === directory),
            (handler) => handler.interrupt(sessionID),
            { concurrency: "unbounded", discard: true },
          ),
        ),
    })
  }),
)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Context.get(yield* Layer.buildWithMemoMap(resourceLayer, memoMap, yield* Effect.scope), Service)
  }),
)
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
