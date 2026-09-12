export * as BrowserMedia from "./browser-media"

import { createHash, randomBytes } from "node:crypto"
import { constants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Context, Effect, Layer, Schedule, Schema } from "effect"
import { Global } from "./global"

export const PREFIX = "tandem-browser-image:"
export const RETENTION_MS = 24 * 60 * 60 * 1000
export const MAX_BYTES = 8 * 1024 * 1024
const HEADER_BYTES = 40
const ID = /^[a-f0-9]{48}$/
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

export type URI = `tandem-browser-image:${string}`
export const Capture = Schema.Struct({
  uri: Schema.TemplateLiteral([PREFIX, Schema.String]).check(Schema.isPattern(/^tandem-browser-image:[a-f0-9]{48}$/)),
  mime: Schema.Literal("image/png"),
  width: Schema.Number,
  height: Schema.Number,
})
export type Capture = typeof Capture.Type
export type ReadResult =
  | { ok: true; data: string; mime: "image/png"; width: number; height: number; expiresAt: number }
  | { ok: false; reason: "missing" | "expired" | "unauthorized" | "invalid" | "unavailable" }
export interface Interface {
  store(sessionID: string, bytes: Uint8Array): Promise<Capture>
  read(sessionID: string, uri: string): Promise<ReadResult>
  cleanup(): Promise<void>
}

export const isReference = (uri: string): uri is URI => uri.startsWith(PREFIX)
export const unavailableText = (reason: Extract<ReadResult, { ok: false }>["reason"]) =>
  `[Browser screenshot unavailable: ${reason}. Capture a fresh screenshot before visual actions.]`

function dimensions(bytes: Buffer) {
  if (
    bytes.length < 45 ||
    bytes.length > MAX_BYTES ||
    !bytes.subarray(0, 8).equals(PNG) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND"
  )
    throw new Error("Invalid browser PNG capture")
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (!width || !height || width * height > 32 * 1024 * 1024) throw new Error("Browser PNG exceeds pixel limit")
  return { width, height }
}

/** Private binary files contain expiry and an owner digest, never a caller-selected path. */
export function make(input: { directory: string; now?: () => number; retentionMs?: number }): Interface {
  const now = input.now ?? Date.now
  const retention = input.retentionMs ?? RETENTION_MS
  if (!Number.isSafeInteger(retention) || retention <= 0 || retention > RETENTION_MS)
    throw new Error("Invalid browser media retention")
  const owner = (sessionID: string) => createHash("sha256").update(sessionID).digest()
  const filename = (id: string) => path.join(input.directory, `${id}.bin`)

  async function cleanup() {
    const entries = await fs.readdir(input.directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      if (!/^[a-f0-9]{48}\.(bin|pending)$/.test(entry)) continue
      const file = path.join(input.directory, entry)
      if (entry.endsWith(".pending")) {
        const stat = await fs.lstat(file).catch(() => undefined)
        if (stat && stat.mtimeMs + RETENTION_MS <= now()) await fs.unlink(file).catch(() => {})
        continue
      }
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
      if (!handle) continue
      try {
        const header = Buffer.alloc(HEADER_BYTES)
        const { bytesRead } = await handle.read(header, 0, header.length, 0)
        if (bytesRead === HEADER_BYTES && Number.isFinite(header.readDoubleBE(0)) && header.readDoubleBE(0) > now())
          continue
        await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error
        })
      } finally {
        await handle.close()
      }
    }
  }

  return {
    cleanup,
    async store(sessionID, inputBytes) {
      if (!sessionID || sessionID.length > 256) throw new Error("Invalid browser media owner")
      if (inputBytes.byteLength > MAX_BYTES) throw new Error("Browser PNG exceeds byte limit")
      const bytes = Buffer.from(inputBytes)
      const size = dimensions(bytes)
      await fs.mkdir(input.directory, { recursive: true, mode: 0o700 })
      await cleanup()
      const id = randomBytes(24).toString("hex")
      const header = Buffer.alloc(HEADER_BYTES)
      header.writeDoubleBE(now() + retention, 0)
      owner(sessionID).copy(header, 8)
      // Publish atomically so a simultaneous sweep cannot delete a partially written capture.
      const pending = path.join(input.directory, `${id}.pending`)
      try {
        await fs.writeFile(pending, Buffer.concat([header, bytes]), { flag: "wx", mode: 0o600 })
        await fs.rename(pending, filename(id))
      } finally {
        await fs.unlink(pending).catch(() => {})
      }
      return { uri: `${PREFIX}${id}`, mime: "image/png", ...size }
    },
    async read(sessionID, uri) {
      if (!isReference(uri) || !ID.test(uri.slice(PREFIX.length))) return { ok: false, reason: "invalid" }
      const file = filename(uri.slice(PREFIX.length))
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => undefined)
      if (!handle) return { ok: false, reason: "missing" }
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > HEADER_BYTES + MAX_BYTES || stat.size < HEADER_BYTES)
          return { ok: false, reason: "invalid" }
        const data = await handle.readFile()
        if (!data.subarray(8, HEADER_BYTES).equals(owner(sessionID))) return { ok: false, reason: "unauthorized" }
        const expires = data.readDoubleBE(0)
        if (!Number.isFinite(expires)) return { ok: false, reason: "invalid" }
        if (expires <= now()) {
          await fs.unlink(file)
          return { ok: false, reason: "expired" }
        }
        const bytes = data.subarray(HEADER_BYTES)
        return {
          ok: true,
          data: `data:image/png;base64,${bytes.toString("base64")}`,
          mime: "image/png",
          expiresAt: expires,
          ...dimensions(bytes),
        }
      } catch {
        return { ok: false, reason: "unavailable" }
      } finally {
        await handle.close()
      }
    },
  }
}

const managed = make({ directory: path.join(Global.Path.data, "browser-media") })
export const store = managed.store
export const read = managed.read
export const cleanup = managed.cleanup
export const Service = Context.Reference<Interface>("@tandem/BrowserMedia", { defaultValue: () => managed })

// UPSTREAM-DIVERGENCE: bounded idle retention, owned by the serving scope rather than a detached timer.
export const cleanupEffect = Effect.gen(function* () {
  const media = yield* Service
  yield* Effect.tryPromise(() => media.cleanup()).pipe(
    Effect.catch(() => Effect.logWarning("Browser media retention sweep failed")),
  )
})
export const cleanupLayer = Layer.effectDiscard(
  cleanupEffect.pipe(Effect.repeat(Schedule.spaced("1 hour")), Effect.forkScoped),
)
