import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { DateTime, Deferred, Effect, Layer, Schema } from "effect"
import { TestClock } from "effect/testing"
import { LLM, LLMClient } from "@opencode-ai/llm"
import { OpenAI } from "@opencode-ai/llm/providers"
import { Agent } from "@opencode-ai/schema/agent"
import { SessionID } from "@opencode-ai/schema/session-id"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { BrowserMedia } from "../src/browser-media"
import { Tool } from "../src/tool/tool"
import { SessionMessage } from "../src/session/message"
import { toLLMMessagesEffect } from "../src/session/runner/to-llm-message"
import { it } from "./lib/effect"
import { ToolOutputStore } from "../src/tool-output-store"
import { AppNodeBuilder } from "../src/effect/app-node-builder"
import { Global } from "../src/global"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
)
const sessionID = SessionID.make("ses_browser-media")
const messageID = SessionMessage.ID.make("msg_browser-media")
const model = OpenAI.configure({ apiKey: "fixture" }).responses("gpt-4.1")
const fixture = Effect.gen(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => fs.mkdtemp("/tmp/tandem/browser-media-")),
    (directory) => Effect.promise(() => fs.rm(directory, { recursive: true, force: true })),
  )
  let now = Date.now()
  return {
    directory,
    media: BrowserMedia.make({ directory, now: () => now, retentionMs: 1000 }),
    expire: () => {
      now += 1000
    },
  }
})

describe("BrowserMedia", () => {
  it.live("generic text bounding preserves managed references without spilling or hydrating image bytes", () =>
    Effect.gen(function* () {
      const { directory, media } = yield* fixture
      const image = yield* Effect.promise(() => media.store(sessionID, png))
      const file = { type: "file" as const, uri: image.uri, mime: image.mime }
      const store = AppNodeBuilder.build(ToolOutputStore.nodeWithoutConfig, [
        [Global.node, Global.layerWith({ data: directory })],
      ])
      const bound = (text: string) =>
        ToolOutputStore.Service.use((output) =>
          output.bound({
            sessionID,
            toolCallID: "call-bounded-capture",
            output: { structured: { image }, content: [{ type: "text", text }, file] },
          }),
        ).pipe(Effect.provide(store))
      expect((yield* bound("x".repeat(ToolOutputStore.MAX_BYTES))).outputPaths).toEqual([])
      const text = "x".repeat(ToolOutputStore.MAX_BYTES + 1)
      const result = yield* bound(text)
      expect(result.outputPaths).toHaveLength(1)
      expect(result.output.content[1]).toEqual(file)
      expect(result.output.structured).toEqual({ image })
      const saved = yield* Effect.promise(() => fs.readFile(result.outputPaths[0]!, "utf8"))
      expect(saved).toBe(text)
      expect(JSON.stringify(result)).not.toContain(png.toString("base64"))
      expect((yield* Effect.promise(() => media.read(sessionID, image.uri))).ok).toBe(true)
    }),
  )
  it.live("stores only opaque captures through canonical output and persisted provider history", () =>
    Effect.gen(function* () {
      const { directory, media, expire } = yield* fixture
      const tool = Tool.make({
        description: "fixture screenshot",
        input: Schema.Struct({}),
        output: Schema.Struct({ text: Schema.String, image: BrowserMedia.Capture }),
        execute: () =>
          Effect.promise(async () => ({
            text: "viewport CSS coordinates; 1x1 PNG",
            image: await media.store(sessionID, png),
          })),
        toModelOutput: ({ output }) => [
          { type: "text", text: output.text },
          { type: "file", uri: output.image.uri, mime: output.image.mime },
        ],
      })
      expect(Tool.definition("browser", tool).outputSchema).toBeDefined()
      const output = yield* Tool.settle(
        tool,
        { type: "tool-call", id: "call_capture", name: "browser", input: {} },
        {
          sessionID,
          assistantMessageID: messageID,
          toolCallID: "call_capture",
          agent: Agent.ID.make("build"),
        },
      )
      const assistant = SessionMessage.Assistant.make({
        type: "assistant",
        id: messageID,
        agent: "build",
        model: { id: Model.ID.make("gpt-4.1"), providerID: Provider.ID.make("openai") },
        time: { created: DateTime.makeUnsafe(0) },
        content: [
          {
            type: "tool",
            id: "call_capture",
            name: "browser",
            time: { created: DateTime.makeUnsafe(0) },
            state: {
              status: "completed",
              input: {},
              content: output.content,
              structured: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(output.structured),
            },
          },
        ],
      })
      const encoded = JSON.stringify(Schema.encodeSync(SessionMessage.Assistant)(assistant))
      expect(encoded).toContain(BrowserMedia.PREFIX)
      expect(encoded).not.toContain(png.toString("base64"))
      expect(encoded).not.toContain("data:image")
      const transcript = path.join(directory, "transcript.json")
      yield* Effect.promise(() => fs.writeFile(transcript, encoded))
      const restored = Schema.decodeUnknownSync(SessionMessage.Assistant)(
        JSON.parse(yield* Effect.promise(() => fs.readFile(transcript, "utf8"))),
      )
      for (const target of [model, OpenAI.configure({ apiKey: "fixture" }).chat("gpt-4.1")]) {
        const messages = yield* toLLMMessagesEffect([restored], target, sessionID).pipe(
          Effect.provideService(BrowserMedia.Service, media),
        )
        const prepared = yield* LLMClient.prepare(LLM.request({ model: target, messages }))
        expect(JSON.stringify(prepared.body)).toContain(`data:image/png;base64,${png.toString("base64")}`)
        expect(JSON.stringify(prepared.body)).toContain(
          target === model ? '"type":"input_image"' : '"type":"image_url"',
        )
      }
      expect(JSON.stringify(Schema.encodeSync(SessionMessage.Assistant)(restored))).toBe(encoded)
      const foreign = yield* toLLMMessagesEffect([restored], model, "ses_foreign").pipe(
        Effect.provideService(BrowserMedia.Service, media),
      )
      const denied = yield* LLMClient.prepare(LLM.request({ model, messages: foreign }))
      expect(JSON.stringify(denied.body)).toContain("Browser screenshot unavailable: unauthorized")
      expect(JSON.stringify(denied.body)).not.toContain("data:image")
      expire()
      const expired = yield* toLLMMessagesEffect([restored], model, sessionID).pipe(
        Effect.provideService(BrowserMedia.Service, media),
      )
      const expiredBody = yield* LLMClient.prepare(LLM.request({ model, messages: expired }))
      expect(JSON.stringify(expiredBody.body)).toContain("Browser screenshot unavailable: expired")
      expect(JSON.stringify(expiredBody.body)).not.toContain("data:image")
      const missing = yield* toLLMMessagesEffect([restored], model, sessionID).pipe(
        Effect.provideService(BrowserMedia.Service, media),
      )
      expect(JSON.stringify(missing)).toContain("Browser screenshot unavailable: missing")
    }),
  )

  it.live("checks ownership, TTL, malformed references, symlinks, and preserves exact bytes", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      const capture = yield* Effect.promise(() => f.media.store(sessionID, png))
      expect(capture).toMatchObject({ mime: "image/png", width: 1, height: 1 })
      const filename = path.join(f.directory, capture.uri.slice(BrowserMedia.PREFIX.length) + ".bin")
      expect((yield* Effect.promise(() => fs.stat(filename))).mode & 0o777).toBe(0o600)
      const invalid = yield* Effect.tryPromise(() => f.media.store(sessionID, new Uint8Array([1, 2, 3]))).pipe(
        Effect.exit,
      )
      expect(invalid._tag).toBe("Failure")
      const result = yield* Effect.promise(() => f.media.read(sessionID, capture.uri))
      expect(result).toMatchObject({ ok: true, data: `data:image/png;base64,${png.toString("base64")}` })
      expect(yield* Effect.promise(() => f.media.read("ses_foreign", capture.uri))).toEqual({
        ok: false,
        reason: "unauthorized",
      })
      expect(yield* Effect.promise(() => f.media.read(sessionID, `${BrowserMedia.PREFIX}../../secret`))).toEqual({
        ok: false,
        reason: "invalid",
      })
      const linkID = "a".repeat(48)
      yield* Effect.promise(() =>
        fs.symlink(
          path.join(f.directory, capture.uri.slice(BrowserMedia.PREFIX.length) + ".bin"),
          path.join(f.directory, linkID + ".bin"),
        ),
      )
      expect((yield* Effect.promise(() => f.media.read(sessionID, `${BrowserMedia.PREFIX}${linkID}`))).ok).toBe(false)
      f.expire()
      expect(yield* Effect.promise(() => f.media.read(sessionID, capture.uri))).toEqual({
        ok: false,
        reason: "expired",
      })
      expect(yield* Effect.promise(() => f.media.read(sessionID, capture.uri))).toEqual({
        ok: false,
        reason: "missing",
      })
      expect(yield* Effect.promise(() => fs.readdir(f.directory))).toEqual([linkID + ".bin"])
    }),
  )

  it.effect("periodic scoped sweep deletes expired bytes without another store or read", () =>
    Effect.gen(function* () {
      const f = yield* fixture
      yield* Effect.promise(() => f.media.store(sessionID, png))
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      let sweeps = 0
      const media = {
        ...f.media,
        async cleanup() {
          await f.media.cleanup()
          Deferred.doneUnsafe(++sweeps === 1 ? first : second, Effect.void)
        },
      }
      yield* Layer.build(BrowserMedia.cleanupLayer).pipe(Effect.provideService(BrowserMedia.Service, media))
      yield* Deferred.await(first)
      f.expire()
      yield* TestClock.adjust("1 hour")
      yield* Deferred.await(second)
      expect(yield* Effect.promise(() => fs.readdir(f.directory))).toEqual([])
    }),
  )
})
