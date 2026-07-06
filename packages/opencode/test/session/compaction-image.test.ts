// UPSTREAM-DIVERGENCE: Tandem-only tests for /compact-image (image-based context compaction).
import { describe, expect, test } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { Session as SessionNs } from "@/session/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionCompactionImage } from "../../src/session/compaction-image/compaction-image"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Effect, Layer, Schema } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"
import { SessionCompaction } from "../../src/session/compaction"
import * as SessionProcessorModule from "../../src/session/processor"
import { Provider } from "@/provider/provider"
import { ProviderTest } from "../fake/provider"
import { RuntimeFlags } from "@/effect/runtime-flags"
import {
  reflow,
  renderTranscriptPages,
  pageTokens,
  wrapLines,
  NL_SENTINEL,
  COLS,
  MAX_HEIGHT_PX,
} from "../../src/session/compaction-image/render"
import {
  stripAnsi,
  stripBinaryPayloads,
  collapseRepeatedLines,
  capOutputLines,
  serializeTranscript,
  buildJunkContext,
} from "../../src/session/compaction-image/transcript"
import { Global } from "@opencode-ai/core/global"
import fs from "fs/promises"
import path from "path"

function msg(
  role: "user" | "assistant",
  id: string,
  parts: Partial<SessionV1.Part>[],
  info: Record<string, unknown> = {},
): SessionV1.WithParts {
  return {
    info: { id, role, sessionID: "ses_test", time: { created: 1 }, ...info } as SessionV1.Info,
    parts: parts.map(
      (part, index) => ({ id: `prt_${id}_${index}`, sessionID: "ses_test", messageID: id, ...part }) as SessionV1.Part,
    ),
  }
}

function textPart(text: string): Partial<SessionV1.Part> {
  return { type: "text", text }
}

function toolPart(tool: string, input: Record<string, unknown>, output: string, extra?: { compacted?: number }) {
  return {
    type: "tool",
    tool,
    callID: "call_1",
    state: {
      status: "completed",
      input,
      output,
      title: tool,
      metadata: {},
      time: { start: 1, end: 2, ...(extra?.compacted ? { compacted: extra.compacted } : {}) },
    },
  } satisfies Partial<SessionV1.ToolPart>
}

describe("junk passes", () => {
  test("stripAnsi removes escape sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m plain \x1b]0;title\x07tail")).toBe("red plain tail")
  })

  test("stripBinaryPayloads replaces data urls and base64 runs", () => {
    const data = "data:image/png;base64," + "A".repeat(4000)
    const out = stripBinaryPayloads(`before ${data} after`)
    expect(out).toContain("[image/png data-url ~3KB]")
    expect(out).not.toContain("AAAA")

    const blob = "Zm9vYmFy".repeat(40) // 320 chars of base64-ish
    expect(stripBinaryPayloads(blob)).toMatch(/^\[base64 ~\d+KB\]$/)
  })

  test("collapseRepeatedLines keeps short runs and collapses long ones", () => {
    expect(collapseRepeatedLines("a\na\nb")).toBe("a\na\nb")
    expect(collapseRepeatedLines("x\nx\nx\nx\ny")).toBe("x\n[repeated ×4]\ny")
    // blank runs are left alone (minify handles those)
    expect(collapseRepeatedLines("\n\n\n\n")).toBe("\n\n\n\n")
  })

  test("capOutputLines elides the middle of giant outputs only", () => {
    const short = Array.from({ length: 70 }, (_, i) => `line ${i}`).join("\n")
    expect(capOutputLines(short)).toBe(short)

    const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n")
    const out = capOutputLines(long)
    expect(out).toContain("line 0")
    expect(out).toContain("line 39")
    expect(out).toContain("[… 140 lines elided …]")
    expect(out).toContain("line 199")
    expect(out).not.toContain("line 100")
  })
})

describe("transcript serialization", () => {
  const history = [
    msg("user", "msg_a", [textPart("read the config please")]),
    msg("assistant", "msg_b", [toolPart("read", { filePath: "/tmp/config.json" }, '{"port": 4096}')], {
      parentID: "msg_a",
    }),
    msg("user", "msg_c", [textPart("read it again")]),
    msg("assistant", "msg_d", [toolPart("read", { filePath: "/tmp/config.json" }, '{"port": 4096, "v": 2}')], {
      parentID: "msg_c",
    }),
  ]
  const indexOf = (id: string) => history.findIndex((m) => m.info.id === id)

  test("tags turns with absolute indices and includes tool calls", () => {
    const raw = serializeTranscript(history, indexOf as never)
    expect(raw.text).toContain('<user t="0">\nread the config please\n</user>')
    expect(raw.text).toContain('<assistant t="1">')
    expect(raw.text).toContain("[tool_use read]")
    expect(raw.text).toContain('{"filePath":"/tmp/config.json"}')
    expect(raw.text).toContain('{"port": 4096}')
    // slot string is width-identical to the text
    expect(raw.slotText.length).toBe(raw.text.length)
  })

  test("superseded reads are stubbed in render form but not raw form", () => {
    const raw = serializeTranscript(history, indexOf as never)
    expect(raw.text).toContain('{"port": 4096}')

    const junk = buildJunkContext(history, indexOf as never)
    const rendered = serializeTranscript(history, indexOf as never, junk)
    expect(rendered.text).toContain("[read of /tmp/config.json superseded by the read at turn 3]")
    expect(rendered.text).toContain('{"port": 4096, "v": 2}') // newest read kept
    expect(rendered.text).not.toContain('{"port": 4096}\n') // older content gone
    expect(rendered.slotText.length).toBe(rendered.text.length)
  })

  test("already-pruned tool outputs render as stubs", () => {
    const pruned = [
      msg("user", "msg_a", [textPart("run it")]),
      msg("assistant", "msg_b", [toolPart("bash", { command: "make" }, "huge output", { compacted: 123 })], {
        parentID: "msg_a",
      }),
    ]
    const rendered = serializeTranscript(pruned, ((id: string) => pruned.findIndex((m) => m.info.id === id)) as never)
    expect(rendered.text).toContain("[tool_use bash]")
    expect(rendered.text).toContain("[old tool result content cleared]")
    expect(rendered.text).not.toContain("huge output")
  })

  test("repeated system reminders keep only the first occurrence", () => {
    const reminder = "<system-reminder>\nAlways re-read files.\n</system-reminder>"
    const msgs = [
      msg("user", "msg_a", [textPart(`${reminder}\nfirst`)]),
      msg("user", "msg_b", [textPart(`${reminder}\nsecond`)]),
    ]
    const idx = (id: string) => msgs.findIndex((m) => m.info.id === id)
    const junk = buildJunkContext(msgs, idx as never)
    const rendered = serializeTranscript(msgs, idx as never, junk)
    expect(rendered.text.split("Always re-read files.").length).toBe(2) // one occurrence
    expect(rendered.text).toContain("[system-reminder repeated — see first occurrence]")
  })

  test("file parts become typed placeholders, never pixels of base64", () => {
    const msgs = [
      msg("user", "msg_a", [
        textPart("look at this"),
        { type: "file", mime: "image/png", filename: "shot.png", url: "data:image/png;base64,AAAA" },
      ]),
    ]
    const rendered = serializeTranscript(msgs, ((id: string) => 0) as never)
    expect(rendered.text).toContain("[attachment image/png: shot.png]")
    expect(rendered.text).not.toContain("base64,AAAA")
  })

  test("junk passes are deterministic", () => {
    const junk1 = buildJunkContext(history, indexOf as never)
    const junk2 = buildJunkContext(history, indexOf as never)
    const a = serializeTranscript(history, indexOf as never, junk1)
    const b = serializeTranscript(history, indexOf as never, junk2)
    expect(a.text).toBe(b.text)
    expect(a.slotText).toBe(b.slotText)
  })
})

describe("render", () => {
  test("reflow marks hard newlines and expands tabs", () => {
    const packed = reflow("a\nb\tc")
    expect(packed).toBe(`a${NL_SENTINEL}b→  c`)
  })

  test("wrapLines respects column budget", () => {
    const lines = wrapLines("x".repeat(700), COLS)
    expect(lines.length).toBe(3)
    expect(lines[0]!.length).toBe(COLS)
  })

  test("pages are byte-identical across runs and within API bounds", async () => {
    const text = reflow(Array.from({ length: 400 }, (_, i) => `line ${i}: some transcript content here`).join("\n"))
    const slot = text // plain body: slot string equals text when no role tags present
    const a = await renderTranscriptPages(text, slot)
    const b = await renderTranscriptPages(text, slot)
    expect(a.length).toBe(b.length)
    expect(a.length).toBeGreaterThan(0)
    for (let i = 0; i < a.length; i++) {
      expect(Buffer.from(a[i]!.png).equals(Buffer.from(b[i]!.png))).toBe(true)
      expect(a[i]!.width).toBeLessThanOrEqual(1568)
      expect(a[i]!.height).toBeLessThanOrEqual(MAX_HEIGHT_PX)
      expect(a[i]!.png.length).toBeLessThan(5 * 1024 * 1024)
      expect(a[i]!.droppedChars).toBe(0)
    }
  })

  test("pageTokens uses the pixel-area formula", () => {
    expect(pageTokens({ width: 1568, height: 728 })).toBe(Math.ceil((1568 * 728) / 750))
  })
})

// --- integration: full run() against a seeded session ---------------------------

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function cfg(image?: { models?: string[]; discard_on_summary?: boolean }) {
  const base = Schema.decodeUnknownSync(ConfigV1.Info)({}) as ConfigV1.Info
  return Layer.succeed(
    Config.Service,
    TestConfig.make({ get: () => Effect.succeed({ ...base, compaction: { image } }) }),
  )
}

const nodeGroup = LayerNode.group([
  SessionCompactionImage.node,
  SessionNs.node,
  SessionProjector.node,
  Database.node,
  EventV2Bridge.node,
  CrossSpawnSpawner.node,
])

const it = testEffect(AppNodeBuilder.build(nodeGroup, [[Config.node, cfg({ models: ["test-model"] })]]))
const itGated = testEffect(AppNodeBuilder.build(nodeGroup))

function seedTurn(sessionID: SessionID, index: number, root: string, repeat = 60) {
  return Effect.gen(function* () {
    const ssn = yield* SessionNs.Service
    const user = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: user.id,
      sessionID,
      type: "text",
      text: `turn ${index}: please inspect module-${index}.ts and report findings. ${"filler content ".repeat(repeat)}`,
    })
    const assistant = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      path: { cwd: root, root },
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      parentID: user.id,
      time: { created: Date.now() },
      finish: "end_turn",
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID,
      type: "text",
      text: `inspected module-${index}.ts at /repo/src/module-${index}.ts — looks fine. ${"analysis detail ".repeat(60)}`,
    })
  })
}

/** A turn whose weight is in completed TOOL OUTPUTS (stub-clearable), unlike
 *  seedTurn's giant-user-text turns (not clearable). */
function seedToolTurn(sessionID: SessionID, index: number, root: string, outputRepeat = 1250, calls = 3) {
  return Effect.gen(function* () {
    const ssn = yield* SessionNs.Service
    const user = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: user.id,
      sessionID,
      type: "text",
      text: `turn ${index}: run the heavy diagnostics.`,
    })
    const assistant = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      path: { cwd: root, root },
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      parentID: user.id,
      time: { created: Date.now() },
      finish: "end_turn",
    })
    for (let call = 0; call < calls; call++) {
      yield* ssn.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID,
        type: "tool",
        tool: "bash",
        callID: `call_${index}_${call}`,
        state: {
          status: "completed",
          input: { command: `diagnostic --step ${call}` },
          output: "result data ".repeat(outputRepeat),
          title: "bash",
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
        },
      })
    }
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID,
      type: "text",
      text: `diagnostics complete for turn ${index}.`,
    })
  })
}

/** A turn whose weight is REASONING (thinking text + base64 signatures): replayed to
 *  the API but absent from the serialized transcript, so only the reasoning-aware
 *  estimator can see it. */
function seedThinkingTurn(sessionID: SessionID, index: number, root: string, blocks = 4) {
  return Effect.gen(function* () {
    const ssn = yield* SessionNs.Service
    const user = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: ref,
      time: { created: Date.now() },
    })
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: user.id,
      sessionID,
      type: "text",
      text: `turn ${index}: think hard about the plan.`,
    })
    const assistant = yield* ssn.updateMessage({
      id: MessageID.ascending(),
      role: "assistant",
      sessionID,
      mode: "build",
      agent: "build",
      path: { cwd: root, root },
      cost: 0,
      tokens: { output: 0, input: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: ref.modelID,
      providerID: ref.providerID,
      parentID: user.id,
      time: { created: Date.now() },
      finish: "end_turn",
    })
    for (let b = 0; b < blocks; b++) {
      yield* ssn.updatePart({
        id: PartID.ascending(),
        messageID: assistant.id,
        sessionID,
        type: "reasoning",
        text: "deliberation ".repeat(38),
        metadata: { anthropic: { signature: "U".repeat(8000) } },
        time: { start: Date.now(), end: Date.now() },
      })
    }
    yield* ssn.updatePart({
      id: PartID.ascending(),
      messageID: assistant.id,
      sessionID,
      type: "text",
      text: `plan settled for turn ${index}.`,
    })
  })
}

describe("SessionCompactionImage.run", () => {
  it.live(
    "images older turns into a durable compaction pair",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        for (let i = 0; i < 16; i++) yield* seedTurn(info.id, i, dir)

        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 10 turns")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const compactionMsg = messages.find((m) => m.parts.some((p) => p.type === "compaction"))!
        expect(compactionMsg).toBeDefined()
        const compactionPart = compactionMsg.parts.find(
          (p): p is SessionV1.CompactionPart => p.type === "compaction",
        )!
        expect(compactionPart.tail_start_id).toBeDefined()
        const files = compactionMsg.parts.filter((p): p is SessionV1.FilePart => p.type === "file")
        expect(files.length).toBeGreaterThan(0)
        expect(files[0]!.url.startsWith("data:image/png;base64,")).toBe(true)
        const markers = compactionMsg.parts
          .filter((p): p is SessionV1.TextPart => p.type === "text")
          .map((p) => p.metadata?.compactionImage)
        expect(markers).toContain("banner")
        expect(markers).toContain("sidecar")
        expect(markers).toContain("end")

        // Sidecar: the pointer part names the on-disk transcript, and the file holds
        // the raw serialization with real newlines (greppable), covering imaged turns.
        const sidecarPath = path.join(Global.Path.data, "compaction", info.id, `${compactionMsg.info.id}.txt`)
        const pointer = compactionMsg.parts.find(
          (p): p is SessionV1.TextPart => p.type === "text" && p.metadata?.compactionImage === "sidecar",
        )!
        expect(pointer.text).toContain(sidecarPath)
        const sidecar = yield* Effect.promise(() => fs.readFile(sidecarPath, "utf8"))
        expect(sidecar).toContain(`session ${info.id}`)
        expect(sidecar).toContain("turn 3: please inspect module-3.ts")
        expect(sidecar).toContain('<user t="')
        expect(sidecar.split("\n").length).toBeGreaterThan(20)
        // imaged turns only — the kept tail (turns 10+) is not in the sidecar
        expect(sidecar).not.toContain("turn 12:")

        const summary = messages.find(
          (m) => m.info.role === "assistant" && m.info.summary && m.info.parentID === compactionMsg.info.id,
        )!
        expect(summary).toBeDefined()
        expect((summary.info as SessionV1.Assistant).finish).toBe("stop")
        expect((summary.info as SessionV1.Assistant).error).toBeUndefined()

        // model context after compaction = [compaction-user, summary-assistant, 6-turn tail]
        const live = MessageV2.filterCompacted([...messages].reverse())
        expect(live[0]!.info.id).toBe(compactionMsg.info.id)
        expect(live[1]!.info.id).toBe(summary.info.id)
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(6)
        expect(live[2]!.info.id).toBe(compactionPart.tail_start_id!)
        // originals remain in storage
        expect(messages.length).toBe(16 * 2 + 2)
      }),
    ),
  )

  it.live(
    "second compaction carries pages and sidecar pointers forward",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        for (let i = 0; i < 16; i++) yield* seedTurn(info.id, i, dir)
        const first = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(first.ok).toBe(true)
        for (let i = 16; i < 26; i++) yield* seedTurn(info.id, i, dir, 150)
        const second = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(second.ok).toBe(true)
        expect(second.message).toContain("carried forward")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const compactions = messages.filter((m) => m.parts.some((p) => p.type === "compaction"))
        expect(compactions.length).toBe(2)
        const [firstMsg, secondMsg] = compactions as [SessionV1.WithParts, SessionV1.WithParts]

        // Both batches' pointers ride on the new compaction message, in page order.
        const pointers = secondMsg.parts.filter(
          (p): p is SessionV1.TextPart => p.type === "text" && p.metadata?.compactionImage === "sidecar",
        )
        expect(pointers.length).toBe(2)
        const pathOf = (msg: SessionV1.WithParts) =>
          path.join(Global.Path.data, "compaction", info.id, `${msg.info.id}.txt`)
        expect(pointers[0]!.text).toContain(pathOf(firstMsg))
        expect(pointers[1]!.text).toContain(pathOf(secondMsg))
        for (const msg of [firstMsg, secondMsg]) {
          const stat = yield* Effect.promise(() => fs.stat(pathOf(msg)))
          expect(stat.size).toBeGreaterThan(1000)
        }

        // Carried pages precede the new batch's pages.
        const files = secondMsg.parts.filter((p): p is SessionV1.FilePart => p.type === "file")
        const firstFiles = firstMsg.parts.filter((p): p is SessionV1.FilePart => p.type === "file")
        expect(files.length).toBeGreaterThan(firstFiles.length)
        expect(files.slice(0, firstFiles.length).map((f) => f.filename)).toEqual(firstFiles.map((f) => f.filename))
      }),
    ),
  )

  it.live(
    "refuses when too little content would be imaged",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        for (let i = 0; i < 6; i++) yield* seedTurn(info.id, i, dir)
        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(false)
        expect(result.message).toContain("Not enough history")
      }),
    ),
  )

  it.live(
    "shrinks the tail on few-giant-turn sessions instead of refusing",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        // 4 huge turns — the realistic shape of a long agent session.
        for (let i = 0; i < 4; i++) yield* seedTurn(info.id, i, dir, 700)
        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 2 turns")
        expect(result.message).toContain("Tail of 2 turns kept as text")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(2)
      }),
    ),
  )

  it.live(
    "token budget moves a giant tail-window turn onto the pages, whole",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        // 8 turns; turn 5 is a ~45k-char monster (giant USER text, nothing stub-clearable)
        // sitting inside the tail
        // window. Budget walk: turn 7 + turn 6 fit, turn 5 blows the budget → tail
        // stops at the turn boundary and the monster is imaged intact.
        for (let i = 0; i < 8; i++) yield* seedTurn(info.id, i, dir, i === 5 ? 3000 : 60)
        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 6 turns")
        expect(result.message).toContain("Tail of 2 turns kept as text")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(2)
        // The giant turn left text context entirely — no truncated remnant.
        for (const msg of live.slice(2))
          for (const part of msg.parts)
            if (part.type === "text") expect(part.text).not.toContain("turn 5:")
      }),
    ),
  )

  it.live(
    "newest turn is kept whole even when it alone exceeds the budget",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        for (let i = 0; i < 13; i++) yield* seedTurn(info.id, i, dir, i === 12 ? 3000 : 60)
        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 12 turns")
        expect(result.message).toContain("Tail of 1 turn kept as text")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(1)
        // Kept verbatim, not cut: the giant user text survives in full.
        const tailText = live
          .slice(2)
          .flatMap((m) => m.parts)
          .filter((p): p is SessionV1.TextPart => p.type === "text")
          .map((p) => p.text)
          .join("\n")
        expect(tailText).toContain("turn 12:")
        expect(tailText).toContain("filler content ".repeat(3000).trimEnd())
      }),
    ),
  )

  it.live(
    "reasoning weight (thinking + signatures) pushes a turn onto the pages",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        // Turn 12 serializes tiny (~1k chars) but carries ~32k chars of signatures +
        // thinking. Only the reasoning-aware estimator sees that; without it the
        // turn would sail under budget and stay in the tail.
        for (let i = 0; i < 12; i++) yield* seedTurn(info.id, i, dir)
        yield* seedThinkingTurn(info.id, 12, dir, 4)
        for (let i = 13; i < 15; i++) yield* seedTurn(info.id, i, dir)

        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 13 turns")
        expect(result.message).toContain("Tail of 2 turns kept as text.")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(2)
        // The thinking-laden turn left text context entirely.
        for (const msg of live.slice(2))
          for (const part of msg.parts) if (part.type === "text") expect(part.text).not.toContain("turn 12:")
      }),
    ),
  )

  it.live(
    "straddling tool-heavy turn stays as text with old outputs cleared and is imaged",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        // 12 small turns, then a ~45k-char tool-output turn, then 2 small turns.
        // Budget walk: turns 14+13 fit; turn 12 is the straddler — clearing its two
        // oldest tool outputs fits it, so it stays in the tail stubbed AND on pages.
        for (let i = 0; i < 12; i++) yield* seedTurn(info.id, i, dir)
        yield* seedToolTurn(info.id, 12, dir, 1250, 3)
        for (let i = 13; i < 15; i++) yield* seedTurn(info.id, i, dir)

        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 12 turns")
        expect(result.message).toContain("Tail of 3 turns kept as text")
        expect(result.message).toContain("2 old tool outputs cleared from text (full content on the pages)")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(3)

        // Oldest two outputs cleared, newest output untouched; originals still stored.
        const toolParts = messages
          .flatMap((m) => m.parts)
          .filter((p): p is SessionV1.ToolPart => p.type === "tool")
          .sort((a, b) => (a.callID < b.callID ? -1 : 1))
        expect(toolParts.length).toBe(3)
        expect(toolParts.map((p) => (p.state.status === "completed" ? !!p.state.time.compacted : null))).toEqual([
          true,
          true,
          false,
        ])
        for (const part of toolParts)
          if (part.state.status === "completed") expect(part.state.output).toContain("result data")

        // Banner announces the mid-turn page boundary.
        const compactionMsg = messages.find((m) => m.parts.some((p) => p.type === "compaction"))!
        const banner = compactionMsg.parts.find(
          (p): p is SessionV1.TextPart => p.type === "text" && p.metadata?.compactionImage === "banner",
        )!
        expect(banner.text).toContain("The imaged span ends mid-turn")
      }),
    ),
  )

  it.live(
    "newest tool-heavy turn over budget is softened, not moved to pages",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        for (let i = 0; i < 12; i++) yield* seedTurn(info.id, i, dir)
        // Newest turn ~36k chars of tool outputs: one cleared output brings it under.
        yield* seedToolTurn(info.id, 12, dir, 1000, 3)

        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(true)
        expect(result.message).toContain("Imaged 12 turns")
        expect(result.message).toContain("Tail of 1 turn kept as text")
        expect(result.message).toContain("1 old tool output cleared from text (full content on the pages)")

        const messages = yield* ssn.messages({ sessionID: info.id })
        const live = MessageV2.filterCompacted([...messages].reverse())
        const tailUsers = live.slice(2).filter((m) => m.info.role === "user")
        expect(tailUsers.length).toBe(1)

        const toolParts = messages
          .flatMap((m) => m.parts)
          .filter((p): p is SessionV1.ToolPart => p.type === "tool")
          .sort((a, b) => (a.callID < b.callID ? -1 : 1))
        expect(toolParts.map((p) => (p.state.status === "completed" ? !!p.state.time.compacted : null))).toEqual([
          true,
          false,
          false,
        ])
      }),
    ),
  )

  itGated.live(
    "refuses non-allowlisted models by default",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const svc = yield* SessionCompactionImage.Service
        const ssn = yield* SessionNs.Service
        const info = yield* ssn.create({})
        yield* seedTurn(info.id, 0, dir)
        const result = yield* svc.run({ sessionID: info.id, ...ref, agent: "build" })
        expect(result.ok).toBe(false)
        expect(result.message).toContain("disabled for model")
      }),
    ),
  )
})

// --- /compact interplay guard (ImageCompaction-PRD §5.7) --------------------------

const testModel: Provider.Model = {
  id: "test-model",
  providerID: "test",
  name: "Test",
  limit: { context: 100_000, input: undefined, output: 32_000 },
  cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  capabilities: {
    toolcall: true,
    attachment: false,
    reasoning: false,
    temperature: true,
  },
  options: {},
} as Provider.Model

const processorLayer = Layer.succeed(
  SessionProcessorModule.SessionProcessor.Service,
  SessionProcessorModule.SessionProcessor.Service.of({
    create: Effect.fn("TestSessionProcessor.create")((input) =>
      Effect.succeed({
        get message() {
          return input.assistantMessage
        },
        updateToolCall: Effect.fn("TestSessionProcessor.updateToolCall")(() => Effect.succeed(undefined)),
        completeToolCall: Effect.fn("TestSessionProcessor.completeToolCall")(() => Effect.void),
        process: Effect.fn("TestSessionProcessor.process")(() => Effect.succeed("continue" as const)),
      } satisfies SessionProcessorModule.SessionProcessor.Handle),
    ),
  }),
)

function guardEnv(image?: { models?: string[]; discard_on_summary?: boolean }) {
  return AppNodeBuilder.build(
    LayerNode.group([
      SessionCompaction.node,
      SessionCompactionImage.node,
      SessionNs.node,
      SessionProjector.node,
      Database.node,
      EventV2Bridge.node,
      CrossSpawnSpawner.node,
    ]),
    [
      [Provider.node, ProviderTest.fake({ model: testModel }).layer],
      [SessionProcessorModule.SessionProcessor.node, processorLayer],
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
      [Config.node, cfg(image)],
    ],
  )
}

const itGuard = testEffect(guardEnv({ models: ["test-model"] }))
const itGuardOff = testEffect(guardEnv({ models: ["test-model"], discard_on_summary: true }))

function imageCompactThenSummarize(dir: string) {
  return Effect.gen(function* () {
    const imageSvc = yield* SessionCompactionImage.Service
    const compactSvc = yield* SessionCompaction.Service
    const ssn = yield* SessionNs.Service
    const info = yield* ssn.create({})
    for (let i = 0; i < 16; i++) yield* seedTurn(info.id, i, dir)
    const imaged = yield* imageSvc.run({ sessionID: info.id, ...ref, agent: "build" })
    expect(imaged.ok).toBe(true)

    yield* compactSvc.create({ sessionID: info.id, agent: "build", model: ref, auto: false })
    const messages = yield* ssn.messages({ sessionID: info.id })
    const marker = messages.at(-1)!
    const outcome = yield* compactSvc.process({
      parentID: marker.info.id,
      messages,
      sessionID: info.id,
      auto: false,
    })
    return { outcome, sessionID: info.id, ssn }
  })
}

describe("summary compaction after image compaction", () => {
  itGuard.live(
    "manual /compact refuses instead of silently dropping imaged pages",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { outcome, sessionID, ssn } = yield* imageCompactThenSummarize(dir)
        expect(outcome).toBe("stop")
        const messages = yield* ssn.messages({ sessionID })
        const last = messages.at(-1)!
        expect(last.info.role).toBe("assistant")
        const err = (last.info as SessionV1.Assistant).error
        expect(err?.name).toBe("UnknownError")
        expect(JSON.stringify(err?.data)).toContain("image-compacted")
      }),
    ),
  )

  itGuardOff.live(
    "proceeds when compaction.image.discard_on_summary is enabled",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const { outcome } = yield* imageCompactThenSummarize(dir)
        expect(outcome).toBe("continue")
      }),
    ),
  )
})
