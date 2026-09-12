import { Context, Effect, Layer, Schema, Scope } from "effect"
import { HttpRouter, HttpServer } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { AppNodeBuilder } from "../../core/src/effect/app-node-builder"
import { LayerNode } from "../../core/src/effect/layer-node"
import { httpClient } from "../../core/src/effect/app-node-platform"
import { Database } from "../../core/src/database/database"
import { EventV2 } from "../../core/src/event"
import { Credential } from "../../core/src/credential"
import { PermissionSaved } from "../../core/src/permission/saved"
import { PermissionV2 } from "../../core/src/permission"
import { PtyTicket } from "../../core/src/pty/ticket"
import { SessionV2 } from "../../core/src/session"
import { SessionExecution } from "../../core/src/session/execution"
import { SessionExecutionLocal } from "../../core/src/session/execution/local"
import { LocationServiceMap } from "../../core/src/location-service-map"
import { AbsolutePath } from "../../core/src/schema"
import { Location } from "../../core/src/location"
import { AgentV2 } from "../../core/src/agent"
import { ToolOutputStore } from "../../core/src/tool-output-store"
import { Api } from "../../server/src/api"
import { ServerAuth } from "../../server/src/auth"
import { handlers } from "../../server/src/handlers"
import { authorizationLayer } from "../../server/src/middleware/authorization"
import { schemaErrorLayer } from "../../server/src/middleware/schema-error"
import { PtyEnvironment } from "../../server/src/pty-environment"
import { layer as locationLayer } from "../../server/src/location"
import { sessionLocationLayer } from "../../server/src/middleware/session-location"

/** The production V2 route/service graph, with a fixture-owned permission caller for cancellation. */
export async function liveServer() {
  const scope = Scope.makeUnsafe()
  const context = await Effect.runPromise(
    Layer.build(
      AppNodeBuilder.build(
        LayerNode.group([
          Database.node,
          EventV2.node,
          httpClient,
          ToolOutputStore.cleanupNode,
          SessionV2.node,
          PermissionSaved.node,
          PtyTicket.node,
          Credential.node,
          PtyEnvironment.node,
          LocationServiceMap.node,
        ]),
        [[SessionExecution.node, SessionExecutionLocal.node]],
      ),
    ).pipe(Effect.provideService(Scope.Scope, scope)),
  )
  const routes = HttpApiBuilder.layer(Api).pipe(
    Layer.provide(handlers),
    Layer.provide(sessionLocationLayer),
    Layer.provide(locationLayer),
    Layer.provide(authorizationLayer),
    Layer.provide(schemaErrorLayer),
    Layer.provide(ServerAuth.Config.layer),
    Layer.provide(Layer.succeedContext(context)),
    Layer.provide(HttpServer.layerServices),
  )
  const handler = HttpRouter.toWebHandler(routes, { disableLogger: true })
  const locations = Context.get(context, LocationServiceMap.Service)
  return {
    handler: handler.handler,
    assert(directory: string, input: unknown, signal: AbortSignal) {
      return Effect.runPromise(
        Effect.gen(function* () {
          yield* (yield* AgentV2.Service).transform((editor) =>
            editor.update(AgentV2.defaultID, (agent) => {
              agent.permissions = [{ action: "browser", resource: "*", effect: "ask" }]
            }),
          )
          return yield* (yield* PermissionV2.Service).assert(Schema.decodeUnknownSync(PermissionV2.AssertInput)(input))
        }).pipe(
          Effect.provide(
            locations.get(Location.Ref.make({ directory: AbsolutePath.make(directory), workspaceID: undefined })),
          ),
          Effect.scoped,
        ),
        { signal },
      )
    },
  }
}
