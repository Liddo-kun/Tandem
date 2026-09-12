import { describe, expect, test } from "bun:test"
import { PassThrough, Writable } from "node:stream"
import { BrowserError } from "../src/errors"
import {
  MAX_PENDING_REQUESTS,
  MAX_QUEUED_WRITE_BYTES,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  RpcPeer,
  type Message,
} from "../src/native"

function frame(message: unknown) {
  const payload = Buffer.from(JSON.stringify(message), "utf8")
  const result = Buffer.alloc(payload.length + 4)
  result.writeUInt32LE(payload.length, 0)
  payload.copy(result, 4)
  return result
}

function pair(
  optionsA: ConstructorParameters<typeof RpcPeer>[2] = {},
  optionsB: ConstructorParameters<typeof RpcPeer>[2] = {},
) {
  const inputA = new PassThrough()
  const outputA = new PassThrough()
  const inputB = new PassThrough()
  const outputB = new PassThrough()
  outputA.pipe(inputB)
  outputB.pipe(inputA)
  const a = new RpcPeer(inputA, outputA, optionsA)
  const b = new RpcPeer(inputB, outputB, optionsB)
  return { a, b, inputA, outputA, inputB, outputB }
}

function messages(stream: PassThrough) {
  const found: Message[] = []
  let buffered = Buffer.alloc(0)
  stream.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    while (buffered.length >= 4) {
      const size = buffered.readUInt32LE(0)
      if (buffered.length < size + 4) return
      found.push(JSON.parse(buffered.subarray(4, size + 4).toString("utf8")))
      buffered = buffered.subarray(size + 4)
    }
  })
  return found
}

async function waitFor(check: () => boolean) {
  for (let attempts = 0; attempts < 100; attempts++) {
    if (check()) return
    await Bun.sleep(2)
  }
  throw new Error("condition was not reached")
}

describe("native framing", () => {
  test("exports Chrome-direction defaults", () => {
    expect(MAX_READ_BYTES).toBe(16 * 1024 * 1024)
    expect(MAX_WRITE_BYTES).toBe(1024 * 1024)
    expect(MAX_PENDING_REQUESTS).toBe(64)
    expect(MAX_QUEUED_WRITE_BYTES).toBe(32 * 1024 * 1024)
  })

  test("reads fragmented and coalesced UTF-8 frames", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const seen: [string, unknown][] = []
    const peer = new RpcPeer(input, output, { onNotification: (method, params) => seen.push([method, params]) })
    const first = frame({ jsonrpc: "2.0", method: "note", params: "héllo 🌍" })
    const second = frame({ jsonrpc: "2.0", method: "next", params: { ok: true } })

    input.write(first.subarray(0, 2))
    input.write(first.subarray(2, 9))
    input.write(Buffer.concat([first.subarray(9), second]))
    await waitFor(() => seen.length === 2)

    expect(seen).toEqual([
      ["note", "héllo 🌍"],
      ["next", { ok: true }],
    ])
    peer.close()
  })

  test("reads a large payload fragmented across many chunks", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let received = 0
    const peer = new RpcPeer(input, output, {
      maxRead: 1024 * 1024,
      onNotification: (_method, params) => (received = String(params).length),
    })
    const bytes = frame({ jsonrpc: "2.0", method: "large", params: "x".repeat(512 * 1024) })
    for (let offset = 0; offset < bytes.length; offset += 257) input.write(bytes.subarray(offset, offset + 257))
    await waitFor(() => received > 0)
    expect(received).toBe(512 * 1024)
    peer.close()
  })

  test.each([
    ["zero length", Buffer.alloc(4), "Invalid native message length"],
    [
      "oversized",
      (() => {
        const value = Buffer.alloc(4)
        value.writeUInt32LE(9)
        return value
      })(),
      "exceeds read limit",
    ],
    [
      "malformed JSON",
      (() => {
        const value = Buffer.from("{")
        const header = Buffer.alloc(4)
        header.writeUInt32LE(value.length)
        return Buffer.concat([header, value])
      })(),
      "Malformed native JSON",
    ],
    ["invalid envelope", frame({ jsonrpc: "2.0", id: 1 }), "Invalid JSON-RPC envelope"],
  ])("closes on %s", async (_name, bytes, expected) => {
    const input = new PassThrough()
    const output = new PassThrough()
    let closed: Error | undefined
    const peer = new RpcPeer(input, output, {
      maxRead: expected === "exceeds read limit" ? 8 : 64,
      onClose: (error) => (closed = error),
    })
    input.write(bytes)
    await waitFor(() => peer.closed)
    expect(closed?.message).toContain(expected)
  })

  test("rejects a truncated frame at EOF", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let closed: Error | undefined
    const peer = new RpcPeer(input, output, { onClose: (error) => (closed = error) })
    const header = Buffer.alloc(4)
    header.writeUInt32LE(5)
    input.end(Buffer.concat([header, Buffer.from("ab")]))
    await waitFor(() => peer.closed)
    expect(closed?.message).toBe("Truncated native message")
  })
})

describe("JSON-RPC", () => {
  test("handles requests, notifications, handler errors, and unknown methods", async () => {
    const notices: unknown[] = []
    const peers = pair(
      {},
      {
        onNotification: (method, params) => notices.push([method, params]),
        onRequest: (method, params) => {
          if (method === "echo") return params
          throw new Error("handler failed")
        },
      },
    )

    await expect(peers.a.request("echo", { text: "ok" })).resolves.toEqual({ text: "ok" })
    await peers.a.notify("event", 42)
    await waitFor(() => notices.length === 1)
    expect(notices).toEqual([["event", 42]])
    await expect(peers.a.request("fail")).rejects.toMatchObject({ message: "RPC handler failed", code: -32603 })
    peers.a.close()
    peers.b.close()

    const unsupported = pair()
    await expect(unsupported.a.request("missing")).rejects.toMatchObject({ code: -32601 })
    unsupported.a.close()
    unsupported.b.close()
  })

  test("answers ping while an incoming request is still running", async () => {
    let finish!: (value: string) => void
    const slow = new Promise<string>((resolve) => (finish = resolve))
    const peers = pair({}, { onRequest: (method) => (method === "slow" ? slow : null) })
    const waiting = peers.a.request("slow")

    await expect(peers.a.request("ping", undefined, 100)).resolves.toBe("pong")
    expect(peers.b.heartbeats).toBe(1)
    finish("done")
    await expect(waiting).resolves.toBe("done")
    peers.a.close()
    peers.b.close()
  })

  test("counts a heartbeat only after its response is flushed", async () => {
    const input = new PassThrough()
    let flush!: (error?: Error | null) => void
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        flush = callback
      },
    })
    const peer = new RpcPeer(input, output)
    input.write(frame({ jsonrpc: "2.0", id: 1, method: "ping" }))
    await waitFor(() => flush !== undefined)
    expect(peer.heartbeats).toBe(0)
    flush()
    await waitFor(() => peer.heartbeats === 1)
    expect(peer.heartbeats).toBe(1)
    peer.close()
  })

  test("uses unique tandem UUID IDs and ignores unknown and duplicate responses", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const sent = messages(output)
    const peer = new RpcPeer(input, output)
    const first = peer.request("one")
    await waitFor(() => sent.length === 1)
    const firstID = sent[0]!.id
    expect(firstID).toMatch(/^tandem:[0-9a-f-]{36}:1$/)

    input.write(frame({ jsonrpc: "2.0", id: "unknown", result: "wrong" }))
    input.write(frame({ jsonrpc: "2.0", id: firstID, result: "right" }))
    input.write(frame({ jsonrpc: "2.0", id: firstID, result: "duplicate" }))
    await expect(first).resolves.toBe("right")

    const second = peer.request("two")
    await waitFor(() => sent.length === 2)
    expect(sent[1]!.id).toBe(String(firstID).replace(/:1$/, ":2"))
    input.write(frame({ jsonrpc: "2.0", id: sent[1]!.id, result: "second" }))
    await expect(second).resolves.toBe("second")
    peer.close()
  })

  test("times out without retrying and ignores a late response", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const sent = messages(output)
    const peer = new RpcPeer(input, output)
    const late = peer.request("mutate", undefined, 10)
    await waitFor(() => sent.length === 1)
    await expect(late).rejects.toThrow("timed out")
    expect(sent).toHaveLength(1)

    input.write(frame({ jsonrpc: "2.0", id: sent[0]!.id, result: "late" }))
    const next = peer.request("read", undefined, 100)
    await waitFor(() => sent.length === 2)
    input.write(frame({ jsonrpc: "2.0", id: sent[1]!.id, result: "fresh" }))
    await expect(next).resolves.toBe("fresh")
    expect(sent).toHaveLength(2)
    peer.close()
  })

  test("accepts omitted results only when explicitly enabled", async () => {
    const strictInput = new PassThrough()
    const strictOutput = new PassThrough()
    const strictSent = messages(strictOutput)
    const strict = new RpcPeer(strictInput, strictOutput)
    const rejected = strict.request("void")
    await waitFor(() => strictSent.length === 1)
    strictInput.write(frame({ jsonrpc: "2.0", id: strictSent[0]!.id }))
    await expect(rejected).rejects.toThrow("Invalid JSON-RPC envelope")

    const input = new PassThrough()
    const output = new PassThrough()
    const sent = messages(output)
    const peer = new RpcPeer(input, output, { allowVoidResponses: true })
    const accepted = peer.request("void")
    await waitFor(() => sent.length === 1)
    input.write(frame({ jsonrpc: "2.0", id: sent[0]!.id }))
    await expect(accepted).resolves.toBeUndefined()
    peer.close()
  })

  test("rejects non-integer JSON-RPC error codes", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const sent = messages(output)
    const peer = new RpcPeer(input, output)
    const pending = peer.request("bad-error")
    await waitFor(() => sent.length === 1)
    input.write(frame({ jsonrpc: "2.0", id: sent[0]!.id, error: { code: 1.5, message: "bad" } }))
    await expect(pending).rejects.toThrow("Invalid JSON-RPC envelope")
  })
})

describe("lifecycle and writes", () => {
  test("cancels a queued write without dispatch and removes abort listeners", async () => {
    const input = new PassThrough()
    let flush!: () => void
    let count = 0
    const output = new Writable({
      write(_chunk, _encoding, done) {
        count++
        flush = done
      },
    })
    const peer = new RpcPeer(input, output)
    const blocker = peer.notify("block")
    const abort = new AbortController()
    let dispatched = false
    const pending = peer.request("never", {}, 1000, {
      signal: abort.signal,
      onDispatch: () => {
        dispatched = true
      },
    })
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: "cancelled", outcome: "not_dispatched" })
    flush()
    await blocker
    expect(dispatched).toBe(false)
    expect(count).toBe(1)
    peer.close()
  })

  test("marks dispatch before the stream sees bytes and reports abort uncertainty", async () => {
    const input = new PassThrough()
    let dispatched = false
    const output = new Writable({
      write(_chunk, _encoding, done) {
        expect(dispatched).toBe(true)
        done()
      },
    })
    const peer = new RpcPeer(input, output)
    const abort = new AbortController()
    const pending = peer.request("once", {}, 1000, {
      signal: abort.signal,
      onDispatch: () => {
        dispatched = true
      },
    })
    abort.abort()
    await expect(pending).rejects.toMatchObject({ outcome: "unknown" })
    peer.close()
  })

  test("checks absolute deadline before flushing a resumed queued write", async () => {
    const input = new PassThrough()
    let flush!: () => void
    let count = 0
    const output = new Writable({
      write(_chunk, _encoding, done) {
        count++
        flush = done
      },
    })
    const peer = new RpcPeer(input, output)
    const blocker = peer.notify("block")
    const pending = peer.request("expired", {}, 1000, { deadline: Date.now() - 1 })
    flush()
    await blocker
    await expect(pending).rejects.toThrow("timed out")
    expect(count).toBe(1)
    peer.close()
  })

  test("round trips bounded structured errors without raw error payloads", async () => {
    const peers = pair(
      {},
      {
        onRequest: () => {
          throw new BrowserError("cancelled", "operation-1", "unknown", "private input text", -32001)
        },
      },
    )
    await expect(peers.a.request("fail")).rejects.toMatchObject({
      code: "cancelled",
      operationId: "operation-1",
      outcome: "unknown",
      diagnosticCode: -32001,
      message: "Browser operation cancelled",
    })
    peers.a.close()
    peers.b.close()
  })

  test("serializes writes through backpressure", async () => {
    const input = new PassThrough()
    const callbacks: Array<(error?: Error | null) => void> = []
    const chunks: Buffer[] = []
    const output = new Writable({
      highWaterMark: 1,
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callbacks.push(callback)
      },
    })
    const peer = new RpcPeer(input, output)
    const first = peer.notify("one")
    const second = peer.notify("two")
    expect(chunks).toHaveLength(1)
    callbacks.shift()!()
    await first
    await waitFor(() => chunks.length === 2)
    callbacks.shift()!()
    await second
    expect(chunks.map((chunk) => JSON.parse(chunk.subarray(4).toString()).method)).toEqual(["one", "two"])
    peer.close()
  })

  test("rejects oversized writes without truncation", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = new RpcPeer(input, output, { maxWrite: 64 })
    await expect(peer.notify("large", "x".repeat(100))).rejects.toThrow("exceeds write limit")
    expect(output.readableLength).toBe(0)
    expect(peer.closed).toBe(false)
    peer.close()
  })

  test("bounds pending requests", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = new RpcPeer(input, output)
    const pending = Array.from({ length: MAX_PENDING_REQUESTS }, (_, index) => peer.request(`pending-${index}`))
    const settled = pending.map((request) => request.catch((error) => error))
    await expect(peer.request("overflow")).rejects.toThrow("Too many pending RPC requests")
    peer.close()
    await Promise.all(settled)
  })

  test("bounds queued output bytes", async () => {
    const input = new PassThrough()
    const output = new Writable({ write(_chunk, _encoding, _callback) {} })
    const peer = new RpcPeer(input, output)
    const value = "x".repeat(MAX_WRITE_BYTES - 100)
    const queued = Array.from({ length: 32 }, () => peer.notify("large", value))
    const settled = queued.map((write) => write.catch((error) => error))
    await expect(peer.notify("overflow", value)).rejects.toThrow("write queue limit")
    peer.close()
    await Promise.all(settled)
  })

  test("does not submit a queued request after it times out", async () => {
    const input = new PassThrough()
    const callbacks: Array<(error?: Error | null) => void> = []
    const chunks: Buffer[] = []
    const output = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callbacks.push(callback)
      },
    })
    const peer = new RpcPeer(input, output)
    const blocker = peer.notify("block")
    const timed = peer.request("must-not-send", undefined, 10)
    await expect(timed).rejects.toThrow("timed out")
    callbacks.shift()!()
    await blocker
    await Bun.sleep(5)
    expect(chunks).toHaveLength(1)
    expect(JSON.parse(chunks[0]!.subarray(4).toString()).method).toBe("block")
    peer.close()
  })

  test("rejects pending work on EOF and removes owned listeners", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = new RpcPeer(input, output)
    const pending = peer.request("never")
    input.end()
    await expect(pending).rejects.toThrow("Native input ended")
    expect(peer.closed).toBe(true)
    expect(input.listenerCount("data")).toBe(0)
    expect(input.listenerCount("end")).toBe(0)
    expect(output.listenerCount("error")).toBe(0)
    expect(input.destroyed).toBe(true)
    expect(output.destroyed).toBe(true)
  })

  test("rejects all pending requests on a stream error", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    const peer = new RpcPeer(input, output)
    const first = peer.request("one")
    const second = peer.request("two")
    const failure = new Error("pipe failed")
    input.emit("error", failure)
    await expect(first).rejects.toBe(failure)
    await expect(second).rejects.toBe(failure)
    expect(peer.closed).toBe(true)
  })

  test("closes when input closes without ending", async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let closed: Error | undefined
    const peer = new RpcPeer(input, output, { onClose: (error) => (closed = error) })
    input.destroy()
    await waitFor(() => peer.closed)
    expect(closed?.message).toBe("Native input closed")
    expect(output.destroyed).toBe(true)
  })
})
