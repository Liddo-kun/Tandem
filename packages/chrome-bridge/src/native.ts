import { randomUUID } from "node:crypto"
import type { Readable, Writable } from "node:stream"
import { BrowserError } from "./errors"

export const MAX_READ_BYTES = 16 * 1024 * 1024
export const MAX_WRITE_BYTES = 1024 * 1024

export class RpcTimeoutError extends Error {
  constructor(_method: string, timeoutMs: number) {
    super(`RPC request timed out after ${timeoutMs}ms`)
    this.name = "RpcTimeoutError"
  }
}
export const MAX_PENDING_REQUESTS = 64
export const MAX_QUEUED_WRITE_BYTES = 32 * 1024 * 1024

type RpcID = string | number | null
type RpcError = { code: number; message: string; data?: unknown }

export type Message =
  | { jsonrpc: "2.0"; id: RpcID; method: string; params?: unknown }
  | { jsonrpc: "2.0"; method: string; params?: unknown; id?: never }
  | { jsonrpc: "2.0"; id: RpcID; result: unknown; error?: never }
  | { jsonrpc: "2.0"; id: RpcID; error: RpcError; result?: never }
  | { jsonrpc: "2.0"; id: RpcID; result?: never; error?: never }

type Options = {
  maxRead?: number
  maxWrite?: number
  allowVoidResponses?: boolean
  onRequest?: (method: string, params: unknown) => unknown | Promise<unknown>
  onNotification?: (method: string, params: unknown) => void
  onClose?: (error: Error) => void
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
  dispose?: () => void
  onDispatch?: () => void
  deadline?: number
  expire?: () => void
}

type WriteEntry = {
  frame: Buffer
  requestID?: string
  resolve: () => void
  reject: (error: Error) => void
}

export class RpcPeer {
  readonly #input: Readable
  readonly #output: Writable
  readonly #maxRead: number
  readonly #maxWrite: number
  readonly #allowVoidResponses: boolean
  readonly #onRequest?: Options["onRequest"]
  readonly #onNotification?: Options["onNotification"]
  readonly #onClose?: Options["onClose"]
  readonly #prefix = `tandem:${randomUUID()}`
  readonly #pending = new Map<string, Pending>()
  readonly #writes: WriteEntry[] = []
  readonly #header = Buffer.alloc(4)
  #headerBytes = 0
  #payload: Buffer | undefined
  #payloadBytes = 0
  #queuedWriteBytes = 0
  #counter = 0
  #heartbeats = 0
  #writing = false
  #closed = false

  constructor(input: Readable, output: Writable, options: Options = {}) {
    this.#input = input
    this.#output = output
    this.#maxRead = limit(options.maxRead, MAX_READ_BYTES, "maxRead")
    this.#maxWrite = limit(options.maxWrite, MAX_WRITE_BYTES, "maxWrite")
    this.#allowVoidResponses = options.allowVoidResponses ?? false
    this.#onRequest = options.onRequest
    this.#onNotification = options.onNotification
    this.#onClose = options.onClose

    input.on("data", this.#handleData)
    input.on("end", this.#handleEnd)
    input.on("close", this.#handleInputClose)
    input.on("error", this.#handleInputError)
    output.on("error", this.#handleOutputError)
    output.on("close", this.#handleOutputClose)
  }

  get closed() {
    return this.#closed
  }

  get heartbeats() {
    return this.#heartbeats
  }

  request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number,
    options: {
      signal?: AbortSignal
      onDispatch?: () => void
      deadline?: number
    } = {},
  ): Promise<T> {
    if (options.signal?.aborted) return Promise.reject(new BrowserError("cancelled", "", "not_dispatched"))
    if (this.#closed) return Promise.reject(new Error("RPC peer is closed"))
    if (typeof method !== "string" || method.length === 0)
      return Promise.reject(new TypeError("RPC method must be non-empty"))
    if (this.#pending.size >= MAX_PENDING_REQUESTS) return Promise.reject(new Error("Too many pending RPC requests"))
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
      return Promise.reject(new RangeError("timeoutMs must be a non-negative finite number"))
    }

    const id = `${this.#prefix}:${++this.#counter}`
    const message: Message =
      params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params }

    return new Promise<T>((resolve, reject) => {
      let dispatched = false
      const pending: Pending = {
        resolve: resolve as (value: unknown) => void,
        reject,
        deadline: options.deadline ?? (timeoutMs === undefined ? undefined : Date.now() + timeoutMs),
        onDispatch: () => {
          dispatched = true
          options.onDispatch?.()
        },
      }
      const cancel = (error: Error) => {
        if (!this.#pending.delete(id)) return
        if (pending.timer) clearTimeout(pending.timer)
        pending.dispose?.()
        this.#cancelQueuedWrite(id, error)
        reject(error)
      }
      const abort = () => cancel(new BrowserError("cancelled", "", dispatched ? "unknown" : "not_dispatched"))
      options.signal?.addEventListener("abort", abort, { once: true })
      pending.dispose = () => options.signal?.removeEventListener("abort", abort)
      pending.expire = () => cancel(new RpcTimeoutError(method, timeoutMs ?? 0))
      if (timeoutMs !== undefined) {
        pending.timer = setTimeout(pending.expire, timeoutMs)
      }
      this.#pending.set(id, pending)
      void this.#send(message, id).catch((error: Error) => {
        if (!this.#pending.delete(id)) return
        if (pending.timer) clearTimeout(pending.timer)
        pending.dispose?.()
        reject(error)
      })
    })
  }

  notify(method: string, params?: unknown): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("RPC peer is closed"))
    if (typeof method !== "string" || method.length === 0)
      return Promise.reject(new TypeError("RPC method must be non-empty"))
    return this.#send(params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params })
  }

  close(error = new Error("RPC peer closed")): void {
    if (this.#closed) return
    this.#closed = true
    this.#removeListeners()

    for (const pending of this.#pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.dispose?.()
      pending.reject(error)
    }
    this.#pending.clear()
    for (const entry of this.#writes.splice(0)) entry.reject(error)
    this.#queuedWriteBytes = 0
    this.#writing = false
    this.#headerBytes = 0
    this.#payload = undefined
    this.#payloadBytes = 0

    this.#input.destroy()
    if (this.#output !== (this.#input as unknown)) this.#output.destroy()
    this.#onClose?.(error)
  }

  readonly #handleData = (chunk: Buffer | string) => {
    if (this.#closed) return
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (incoming.length === 0) return
    let offset = 0
    while (!this.#closed && offset < incoming.length) {
      if (!this.#payload) {
        const count = Math.min(4 - this.#headerBytes, incoming.length - offset)
        incoming.copy(this.#header, this.#headerBytes, offset, offset + count)
        offset += count
        this.#headerBytes += count
        if (this.#headerBytes < 4) return
        const size = this.#header.readUInt32LE(0)
        if (size === 0) return this.close(new Error("Invalid native message length: 0"))
        if (size > this.#maxRead)
          return this.close(new Error(`Native message exceeds read limit: ${size} > ${this.#maxRead}`))
        this.#payload = Buffer.allocUnsafe(size)
        this.#payloadBytes = 0
        this.#headerBytes = 0
      }
      const count = Math.min(this.#payload.length - this.#payloadBytes, incoming.length - offset)
      incoming.copy(this.#payload, this.#payloadBytes, offset, offset + count)
      offset += count
      this.#payloadBytes += count
      if (this.#payloadBytes < this.#payload.length) return
      const payload = this.#payload
      this.#payload = undefined
      this.#payloadBytes = 0
      let value: unknown
      try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload))
      } catch {
        return this.close(new Error("Malformed native JSON message"))
      }
      if (!isMessage(value, this.#allowVoidResponses)) return this.close(new Error("Invalid JSON-RPC envelope"))
      this.#route(value)
    }
  }

  readonly #handleEnd = () => {
    this.close(
      this.#headerBytes === 0 && this.#payload === undefined
        ? new Error("Native input ended")
        : new Error("Truncated native message"),
    )
  }

  readonly #handleInputClose = () => this.close(new Error("Native input closed"))
  readonly #handleInputError = (error: Error) => this.close(error)
  readonly #handleOutputError = (error: Error) => this.close(error)
  readonly #handleOutputClose = () => this.close(new Error("Native output closed"))

  #route(message: Message) {
    if ("method" in message) {
      if ("id" in message) void this.#handleRequest(message as Extract<Message, { method: string; id: RpcID }>)
      else {
        try {
          this.#onNotification?.(message.method, message.params)
        } catch {
          // Notification failures have no JSON-RPC response channel.
        }
      }
      return
    }

    if (typeof message.id !== "string") return
    const pending = this.#pending.get(message.id)
    if (!pending) return
    this.#pending.delete(message.id)
    if (pending.timer) clearTimeout(pending.timer)
    pending.dispose?.()
    if ("error" in message && message.error !== undefined) pending.reject(rpcError(message.error))
    else pending.resolve("result" in message ? message.result : undefined)
  }

  async #handleRequest(message: Extract<Message, { method: string; id: RpcID }>) {
    if (message.method === "ping") {
      if (await this.#reply({ jsonrpc: "2.0", id: message.id, result: "pong" })) this.#heartbeats++
      return
    }
    if (!this.#onRequest) {
      await this.#reply({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" },
      })
      return
    }
    try {
      const result = await this.#onRequest(message.method, message.params)
      await this.#reply({ jsonrpc: "2.0", id: message.id, result: result === undefined ? null : result })
    } catch (cause) {
      const data =
        cause instanceof BrowserError
          ? {
              browserError: {
                code: cause.code,
                operationId: cause.operationId,
                outcome: cause.outcome,
                diagnosticCode: cause.diagnosticCode,
              },
            }
          : undefined
      await this.#reply({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "RPC handler failed", data },
      })
    }
  }

  async #reply(message: Message) {
    try {
      await this.#send(message)
      return true
    } catch (cause) {
      if (!this.#closed) this.close(cause instanceof Error ? cause : new Error(String(cause)))
      return false
    }
  }

  #send(message: Message, requestID?: string): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("RPC peer is closed"))
    let payload: Buffer
    try {
      payload = Buffer.from(JSON.stringify(message), "utf8")
    } catch (cause) {
      return Promise.reject(cause instanceof Error ? cause : new Error(String(cause)))
    }
    if (payload.length === 0 || payload.length > this.#maxWrite) {
      return Promise.reject(new Error(`Native message exceeds write limit: ${payload.length} > ${this.#maxWrite}`))
    }
    const frame = Buffer.allocUnsafe(payload.length + 4)
    frame.writeUInt32LE(payload.length, 0)
    payload.copy(frame, 4)
    if (this.#queuedWriteBytes + frame.length > MAX_QUEUED_WRITE_BYTES) {
      return Promise.reject(new Error("Native write queue limit exceeded"))
    }

    return new Promise<void>((resolve, reject) => {
      this.#queuedWriteBytes += frame.length
      this.#writes.push({ frame, requestID, resolve, reject })
      this.#writeNext()
    })
  }

  #writeNext() {
    if (this.#closed || this.#writing) return
    const entry = this.#writes[0]
    if (!entry) return
    const pending = entry.requestID ? this.#pending.get(entry.requestID) : undefined
    if (pending?.deadline !== undefined && Date.now() >= pending.deadline) {
      pending.expire?.()
      this.#writeNext()
      return
    }
    this.#writing = true
    try {
      pending?.onDispatch?.()
      this.#output.write(entry.frame, (cause?: Error | null) => {
        if (this.#closed) return
        this.#writes.shift()
        this.#queuedWriteBytes -= entry.frame.length
        this.#writing = false
        if (cause) {
          entry.reject(cause)
          this.close(cause)
          return
        }
        entry.resolve()
        this.#writeNext()
      })
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      entry.reject(error)
      this.close(error)
    }
  }

  #cancelQueuedWrite(requestID: string, error: Error) {
    const start = this.#writing ? 1 : 0
    const index = this.#writes.findIndex((entry, position) => position >= start && entry.requestID === requestID)
    if (index === -1) return
    const [entry] = this.#writes.splice(index, 1)
    if (!entry) return
    this.#queuedWriteBytes -= entry.frame.length
    entry.reject(error)
  }

  #removeListeners() {
    this.#input.removeListener("data", this.#handleData)
    this.#input.removeListener("end", this.#handleEnd)
    this.#input.removeListener("close", this.#handleInputClose)
    this.#input.removeListener("error", this.#handleInputError)
    this.#output.removeListener("error", this.#handleOutputError)
    this.#output.removeListener("close", this.#handleOutputClose)
  }
}

function limit(value: number | undefined, fallback: number, name: string) {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0 || result > 0xffff_ffff) {
    throw new RangeError(`${name} must be a positive 32-bit integer`)
  }
  return result
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isID(value: unknown): value is RpcID {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value))
}

function isMessage(value: unknown, allowVoidResponses: boolean): value is Message {
  if (!isObject(value) || value.jsonrpc !== "2.0") return false
  const hasID = Object.hasOwn(value, "id")
  const hasMethod = Object.hasOwn(value, "method")
  const hasResult = Object.hasOwn(value, "result")
  const hasError = Object.hasOwn(value, "error")

  if (hasMethod) {
    if (typeof value.method !== "string" || value.method.length === 0 || hasResult || hasError) return false
    return !hasID || isID(value.id)
  }
  if (!hasID || !isID(value.id)) return false
  if (!hasResult && !hasError) return allowVoidResponses
  if (hasResult && hasError) return false
  if (!hasError) return true
  return (
    isObject(value.error) &&
    typeof value.error.code === "number" &&
    Number.isInteger(value.error.code) &&
    typeof value.error.message === "string"
  )
}

function rpcError(value: RpcError) {
  const data = isObject(value.data) && isObject(value.data.browserError) ? value.data.browserError : undefined
  if (
    data &&
    typeof data.code === "string" &&
    typeof data.operationId === "string" &&
    (data.outcome === "not_dispatched" || data.outcome === "confirmed" || data.outcome === "unknown")
  ) {
    return new BrowserError(
      data.code,
      data.operationId,
      data.outcome,
      undefined,
      typeof data.diagnosticCode === "number" ? data.diagnosticCode : undefined,
    )
  }
  // The original engine recognizes this category to discard dead context caches.
  // Preserve a canonical message, never arbitrary native/page error text.
  if (value.message === "Debugger unattached" || value.message.includes("Debugger is not attached"))
    return new BrowserError("debugger_unattached", "", "confirmed", undefined, value.code)
  if (/Cannot find context|Execution context was destroyed|context.*destroyed|context.*not found/i.test(value.message))
    return new BrowserError("document_context_lost", "", "confirmed", undefined, value.code)
  return Object.assign(new Error("RPC handler failed"), { code: value.code })
}
