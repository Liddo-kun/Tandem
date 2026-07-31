// UPSTREAM-DIVERGENCE(tandem): fork-owned test. Verifies the session processor
// tags Anthropic narration reasoning parts (`metadata.tandem.narration`) while
// preserving the signature for the provider round-trip, and leaves genuine
// thinking parts untagged. See src/provider/anthropic-narration.ts.
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { LLMEvent } from "@opencode-ai/llm"
import { NARRATION_SIGNATURE, THINKING_SIGNATURE } from "../fixture/anthropic-signatures"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: true,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

// Mirrors the live Anthropic adaptive-thinking stream shape: a signed thinking
// block, a signed narration block (wire-typed `thinking`; the block type lives
// only inside the signature), then visible text. Signatures arrive on an
// empty-text reasoning-delta exactly like @ai-sdk/anthropic emits them.
const narrationLLM = Layer.succeed(
  LLM.Service,
  LLM.Service.of({
    stream: () =>
      Stream.make(
        LLMEvent.stepStart({ index: 0 }),
        LLMEvent.reasoningStart({ id: "block-0" }),
        LLMEvent.reasoningDelta({ id: "block-0", text: "pondering the request" }),
        LLMEvent.reasoningDelta({
          id: "block-0",
          text: "",
          providerMetadata: { anthropic: { signature: THINKING_SIGNATURE } },
        }),
        LLMEvent.reasoningEnd({ id: "block-0" }),
        LLMEvent.reasoningStart({ id: "block-1" }),
        LLMEvent.reasoningDelta({ id: "block-1", text: "Status update addressed to the user." }),
        LLMEvent.reasoningDelta({
          id: "block-1",
          text: "",
          providerMetadata: { anthropic: { signature: NARRATION_SIGNATURE } },
        }),
        LLMEvent.reasoningEnd({ id: "block-1" }),
        LLMEvent.textStart({ id: "text-0" }),
        LLMEvent.textDelta({ id: "text-0", text: "done" }),
        LLMEvent.textEnd({ id: "text-0" }),
        LLMEvent.stepFinish({ index: 0, reason: "stop" }),
        LLMEvent.finish({ reason: "stop" }),
      ),
  }),
)

const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  Provider.node,
  Database.node,
  EventV2Bridge.node,
  SessionStatus.node,
  CrossSpawnSpawner.node,
])
const env = LayerNode.compile(root, [
  [SessionSummary.node, summary],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  [LLM.node, narrationLLM],
])

const it = testEffect(env)

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

it.live("session.processor tags narration reasoning parts and preserves signatures", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const provider = yield* Provider.Service
        const processors = yield* SessionProcessor.Service

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "do the thing")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies SessionV1.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "do the thing" }],
          tools: {},
        })
        expect(value).toBe("continue")

        const parts = yield* MessageV2.parts(msg.id)
        const reasoning = parts.filter((part): part is SessionV1.ReasoningPart => part.type === "reasoning")
        expect(reasoning).toHaveLength(2)

        const thinking = reasoning.find((part) => part.text === "pondering the request")!
        expect(thinking.metadata).toEqual({ anthropic: { signature: THINKING_SIGNATURE } })

        const narration = reasoning.find((part) => part.text === "Status update addressed to the user.")!
        expect(narration.metadata).toEqual({
          anthropic: { signature: NARRATION_SIGNATURE },
          tandem: { narration: true },
        })
      }),
    { config: cfg },
  ),
)
