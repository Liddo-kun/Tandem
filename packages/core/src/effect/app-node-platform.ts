import { LLMClient, RequestExecutor } from "@opencode/ai/route"
import { Socket } from "effect/unstable/socket"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { httpClient } from "@opencode/util/effect/app-node-platform"
import { WebSocketConstructor } from "./websocket-constructor.js"
// UPSTREAM-DIVERGENCE: decorate the injected model HTTP client with owned final-send diagnostics.
import { RequestDump } from "../plugin/tandem/request-dump/transport.js"

export const requestExecutor = makeGlobalNode({
  service: RequestExecutor.Service,
  // UPSTREAM-DIVERGENCE: keep diagnostics out of @opencode/ai's network executor.
  layer: RequestDump.executorLayer,
  deps: [httpClient],
})

export const llmClient = makeGlobalNode({ service: LLMClient.Service, layer: LLMClient.layer, deps: [requestExecutor] })

export const webSocketConstructor = makeGlobalNode({
  service: Socket.WebSocketConstructor,
  layer: WebSocketConstructor.layer,
  deps: [],
})

export * as LayerNodePlatform from "./app-node-platform.js"
