// Tandem-owned (not in upstream): idle compaction's request, the held summary and the cold-cache request, through
// the real compaction service.
import { afterAll, expect } from "bun:test"
import { AIError, InvalidRequestError, LLMClient, LLMEvent, LanguageModel, type LLMRequest } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Database } from "@opencode/core/database/database"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { llmClient } from "@opencode/core/effect/app-node-platform"
import { Location } from "@opencode/core/location"
import { Model } from "@opencode/core/model"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { Project } from "@opencode/core/project"
import { Provider } from "@opencode/core/provider"
import { ProjectTable } from "@opencode/core/project/sql"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionCompaction } from "@opencode/core/session/compaction"
import { SessionContext } from "@opencode/core/session/context"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionHistory } from "@opencode/core/session/history"
import { SessionMessage } from "@opencode/core/session/message"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionMessageTable, SessionTable } from "@opencode/core/session/sql"
import { SessionStore } from "@opencode/core/session/store"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { mkdirSync, mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { ClaudeCold } from "../src/plugin/tandem/claude/cold.js"
import { ClaudeHeld } from "../src/plugin/tandem/claude/held.js"
import { testEffect } from "./lib/effect"

let requests: LLMRequest[] = []
let reject: ((request: LLMRequest) => boolean) | undefined
const model = LanguageModel.make({ id: "claude-test", provider: "test", route: OpenAIChat.route })
const client = Layer.mock(LLMClient.Service)({
  stream: (request: LLMRequest) => {
    requests.push(request)
    if (reject?.(request))
      return Stream.fail(new AIError({ reason: new InvalidRequestError({ message: "prompt too long", classification: "context-overflow" }) }))
    return Stream.make(
      LLMEvent.textDelta({ id: "summary", text: "<summary>written by the model</summary>" }),
      LLMEvent.stepFinish({
        index: 0,
        reason: { normalized: "stop" },
        usage: { inputTokens: 100, outputTokens: 6, nonCachedInputTokens: 2, cacheReadInputTokens: 90, cacheWriteInputTokens: 8, reasoningTokens: 0 },
      }),
      LLMEvent.finish({ reason: { normalized: "stop" } }),
    )
  },
  generate: () => Effect.die("unused"),
})
const resolved = SessionRunnerModel.resolved(model, {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 200_000, output: 32_000 },
})
const sonnet = SessionRunnerModel.resolved(LanguageModel.make({ id: ClaudeCold.MODEL, provider: "test", route: OpenAIChat.route }), {
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  cost: [],
  limit: { context: 1_000_000, output: 32_000 },
})
mkdirSync(join(tmpdir(), "tandem"), { recursive: true })
const data = mkdtempSync(join(tmpdir(), "tandem", "held-test-"))
afterAll(() => rmSync(data, { recursive: true, force: true }))
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Database.node, Bus.node, SessionProjector.node, SessionStore.node, SessionCompaction.node, SessionContext.node,
      SessionModelRequest.node, PluginHooks.node, FSUtil.node, Agent.node,
    ]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      llmClient.replace(client),
      Location.node.replace(Location.boundNode({ directory: AbsolutePath.make("/project") })),
      SessionRunnerModel.node.replace(
        Layer.mock(SessionRunnerModel.Service)({
          select: (session) => Effect.fail(new SessionRunnerModel.ModelNotSelectedError({ sessionID: session.id })),
          resolve: (session) => Effect.succeed(session.model?.id === ClaudeCold.MODEL ? sonnet : resolved),
        }),
      ),
      Global.node.replace(Global.layerWith({ data, tmp: data })),
    ],
  ),
)

const user = (text: string) =>
  SessionMessage.User.make({ id: SessionMessage.ID.create(), type: "user", text, time: { created: DateTime.makeUnsafe(0) } })

const assistant = (text: string) =>
  Schema.decodeUnknownSync(SessionMessage.Assistant)({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: Agent.defaultID,
    model: { id: "claude-test", providerID: "test" },
    content: [{ type: "text", text }],
    tokens: { input: 10, output: 5, reasoning: 0, cache: { read: 200_000, write: 0 } },
    time: { created: 0, completed: 1 },
  })

/** A session in "/project" whose stored history is two exchanges. Returns the last response's ID. */
const seed = (id: Session.ID, metadata?: (last: SessionMessage.ID) => Record<string, Schema.Json>, selected?: string) =>
  Effect.gen(function* () {
    requests = []
    reject = undefined
    const messages = [user("First question"), assistant("First answer"), user("Second question"), assistant("Second answer")]
    const last = messages[3].id
    yield* (yield* Agent.Service).transform((editor) => {
      editor.update(Agent.defaultID, (agent) => {
        agent.mode = "primary"
      })
    })
    const db = (yield* Database.Service).db
    yield* db
      .insert(ProjectTable)
      .values({ id: Project.ID.global, worktree: AbsolutePath.make("/project"), sandboxes: [] })
      .onConflictDoNothing()
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionTable)
      .values({ id, project_id: Project.ID.global, slug: id, directory: "/project", title: id, version: "test", metadata: metadata?.(last), model: selected === undefined ? undefined : { id: Model.ID.make(selected), providerID: Provider.ID.make("test") } })
      .run()
      .pipe(Effect.orDie)
    yield* db
      .insert(SessionMessageTable)
      .values(
        messages.map((message, index) => {
          const { id: messageID, type, ...rest } = Schema.encodeSync(SessionMessage.Info)(message)
          return { id: SessionMessage.ID.make(messageID), session_id: id, type, seq: index + 1, time_created: 0, data: rest }
        }),
      )
      .run()
      .pipe(Effect.orDie)
    yield* Bus.reserveSequence(db, id, messages.length)
    return last
  })

/** The context the runner loads for `/compact` (see `runner/llm.ts`). */
const load = (id: Session.ID) =>
  Effect.gen(function* () {
    const contexts = yield* SessionContext.Service
    const selected = yield* contexts.select(id)
    const resolvedModel = yield* contexts.resolveModel(selected.session, { kind: "compaction", agent: selected.agent.id })
    const history = yield* SessionHistory.preview((yield* Database.Service).db, id, selected.instructions, resolvedModel.ref)
    return { session: selected.session, agent: selected.agent, tools: selected.tools, model: resolvedModel, initial: history.initial, messages: history.messages }
  })

/** `/compact`, as the runner delivers it. Returns the compaction's message. */
const compact = (id: Session.ID) =>
  Effect.gen(function* () {
    const inputID = SessionMessage.ID.create()
    yield* (yield* Bus.Service).publish(SessionEvent.Compaction.Started, { sessionID: id, reason: "manual", inputID })
    const outcome = yield* (yield* SessionCompaction.Service).compact({ reason: "manual", inputID, context: yield* load(id) })
    expect(outcome).toEqual({ status: "completed" })
    return (yield* (yield* SessionStore.Service).context(id))[0]
  })

const writer = () => {
  const write = ClaudeHeld.writer({ directory: "/project" })
  if (!write) throw new Error("core compaction registered no idle compaction writer for /project")
  return write
}

it.effect("idle compaction sends the request a manual compaction sends", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_held_request")
    const last = yield* seed(id)

    expect(yield* writer()(id, last, 60_000)).toEqual({ text: "Summary:\nwritten by the model", read: 90, written: 8, sent: 100 })
    const idle = requests
    expect(idle).toHaveLength(1)
    // Nothing is published to the session but the usage.
    expect(yield* (yield* SessionStore.Service).context(id)).toHaveLength(4)

    requests = []
    yield* compact(id)
    // As data: a request also carries functions, which are never the same twice.
    expect(JSON.parse(JSON.stringify(requests))).toEqual(JSON.parse(JSON.stringify(idle)))
    expect(JSON.stringify(idle)).toContain("First question")
  }),
)

it.effect("idle compaction is skipped once the conversation has a newer response or another model is selected", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_held_moved")
    yield* seed(id)
    expect(yield* writer()(id, SessionMessage.ID.create(), 60_000)).toBeUndefined()

    // Nothing is cached for the newly selected model, so the request would pay full price.
    const switched = Session.ID.make("ses_held_switched")
    const last = yield* seed(switched, undefined, ClaudeCold.MODEL)
    expect(yield* writer()(switched, last, 60_000)).toBeUndefined()
    expect(requests).toHaveLength(0)
  }),
)

it.effect("idle compaction fails with the reason when its request is rejected as too long or the cache has expired", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_held_too_long")
    const last = yield* seed(id)
    reject = () => true
    expect(yield* Effect.flip(writer()(id, last, 60_000))).toBe("prompt too long")

    // No attempt starts once the cache has expired: it would pay full price.
    requests = []
    yield* TestClock.adjust("1 minute")
    expect(yield* Effect.flip(writer()(id, last, 60_000))).toBe("The prompt cache expired before the request could be sent")
    expect(requests).toHaveLength(0)
  }),
)

it.effect("a compaction takes the held summary instead of sending a request", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_held_taken")
    yield* seed(id, (last) => ({ [ClaudeHeld.KEY]: { assistantID: last, at: 0 } }))
    const fs = yield* FSUtil.Service
    const file = ClaudeHeld.file(data, id)
    yield* fs.writeWithDirs(file, "Summary:\nheld before the cache expired")
    // Long after the cache expired: without the held summary this would be the cold-cache request.
    yield* TestClock.adjust("2 hours")

    expect(yield* compact(id)).toMatchObject({ type: "compaction", status: "completed", summary: "Summary:\nheld before the cache expired" })
    expect(requests).toHaveLength(0)
    expect(yield* fs.exists(file)).toBe(false)
  }),
)

it.effect("a held summary for an earlier response is not used", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_held_stale")
    yield* seed(id, () => ({ [ClaudeHeld.KEY]: { assistantID: SessionMessage.ID.create(), at: 0 } }))
    yield* (yield* FSUtil.Service).writeWithDirs(ClaudeHeld.file(data, id), "Summary:\nstale")

    expect(yield* compact(id)).toMatchObject({ summary: "Summary:\nwritten by the model" })
    expect(requests).toHaveLength(1)
  }),
)

it.effect("a compaction on an expired cache sends the pruned transcript, and the usual request if that is too long", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_cold")
    yield* seed(id)
    const usual = (yield* Effect.gen(function* () {
      yield* compact(id)
      return requests
    }))[0]
    expect(usual?.system[0]?.text).not.toBe(ClaudeCold.SYSTEM)

    const cold = Session.ID.make("ses_cold_expired")
    yield* seed(cold)
    yield* TestClock.adjust("6 minutes")
    expect(yield* compact(cold)).toMatchObject({ metadata: { "tandem.compaction-pruned": { model: { id: "claude-sonnet-5-5" } } } })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ system: [{ text: ClaudeCold.SYSTEM }], tools: [], cache: "none" })
    expect(requests[0]?.messages).toHaveLength(1)
    const transcript = requests[0]?.messages[0]?.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")
    // Everything but the last response, which is kept verbatim.
    expect(transcript).toContain("<transcript>\n[User]: First question\n[Assistant]: First answer\n\n[User]: Second question\n</transcript>")
    expect(transcript).toContain(ClaudeCold.NOTE)

    const rejected = Session.ID.make("ses_cold_rejected")
    yield* seed(rejected)
    reject = (request) => request.system[0]?.text === ClaudeCold.SYSTEM
    const message = yield* compact(rejected)
    expect(requests).toHaveLength(2)
    expect(requests[1]?.system[0]?.text).toBe(usual?.system[0]?.text)
    expect(message.metadata).not.toHaveProperty("tandem.compaction-pruned")
  }),
)

it.effect("the cache counts as expired a lifetime after its last read, or once another model is selected", () =>
  Effect.gen(function* () {
    const id = Session.ID.make("ses_expiry")
    const last = yield* seed(id)
    const context = yield* load(id)
    const hour = { ...context, model: { ...context.model, cache: { ttl: "1h" as const } } }

    expect(ClaudeCold.expired(context, 5 * 60_000)).toBe(false)
    expect(ClaudeCold.expired(context, 5 * 60_000 + 1)).toBe(true)
    expect(ClaudeCold.expired(hour, 3_600_000)).toBe(false)
    expect(ClaudeCold.expired(hour, 3_600_001)).toBe(true)
    // Idle compaction read the cache again 57 minutes in.
    const held = { ...hour, session: { ...hour.session, metadata: { [ClaudeHeld.KEY]: { assistantID: last, at: 57 * 60_000 } } } }
    expect(ClaudeCold.expired(held, 117 * 60_000)).toBe(false)
    expect(ClaudeCold.expired(held, 117 * 60_000 + 1)).toBe(true)
    const switched = { ...context, model: { ...context.model, ref: { ...context.model.ref, variant: Model.VariantID.make("high") } } }
    expect(ClaudeCold.expired(switched, 0)).toBe(true)
    // Nothing measured says how long ago an empty conversation was sent.
    expect(ClaudeCold.expired({ ...context, messages: [] }, 3_600_001)).toBe(false)
  }),
)
