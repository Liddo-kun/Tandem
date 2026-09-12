import { describe, expect, test } from "bun:test"
import { createCapturePool, createCaptureView, MAX_RESIDENT_MS, type CaptureState } from "./browser-capture-pool"

const png = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"),
)
const image = (expiresAt = 1_000_000) => ({ blob: new Blob([png], { type: "image/png" }), expiresAt })
function fixture() {
  let now = 1000
  const timers = new Map<() => void, number>()
  const pool = createCapturePool({
    now: () => now,
    schedule: (run, ms) => {
      timers.set(run, now + ms)
      return () => {
        timers.delete(run)
      }
    },
  })
  return {
    pool,
    timers,
    advance(ms: number) {
      now += ms
      for (const [run, deadline] of [...timers])
        if (deadline <= now) {
          timers.delete(run)
          run()
        }
    },
  }
}

describe("browser capture visibility and residency", () => {
  test("hundreds of mounted views do not fetch until visible and share two admission slots", async () => {
    const f = fixture()
    let calls = 0
    const states: CaptureState[] = []
    const ready = Array.from({ length: 200 }, () => Promise.withResolvers<void>())
    const views = ready.map((done, i) =>
      createCaptureView({
        pool: f.pool,
        read: async () => {
          calls++
          return image()
        },
        change: (state) => {
          states[i] = state
          if (state.src) done.resolve()
        },
      }),
    )
    try {
      expect(calls).toBe(0)
      for (const view of views) view.visible(true)
      await Promise.all([ready[0]!.promise, ready[1]!.promise])
      expect(calls).toBe(2)
      expect(states.filter((state) => state?.src)).toHaveLength(2)
      const url = states[0]!.src!
      expect(Buffer.from(await (await fetch(url)).arrayBuffer())).toEqual(Buffer.from(png))
      views[0]!.visible(false)
      expect(states[0]!.src).toBeUndefined()
      await expect(fetch(url)).rejects.toThrow()
      views[2]!.retry()
      await ready[2]!.promise
      expect(calls).toBe(3)
      expect(states.filter((state) => state?.src)).toHaveLength(2)
    } finally {
      views.forEach((view) => view.dispose())
    }
    expect(f.timers.size).toBe(0)
  })

  test("offscreen and disposed views abort pending reads and cannot publish late blobs", async () => {
    const f = fixture()
    const pending = Promise.withResolvers<ReturnType<typeof image>>()
    let signal: AbortSignal | undefined
    let state: CaptureState | undefined
    const view = createCaptureView({
      pool: f.pool,
      read: (input) => {
        signal = input
        return pending.promise
      },
      change: (input) => {
        state = input
      },
    })
    view.visible(true)
    await Promise.resolve()
    view.visible(false)
    expect(signal?.aborted).toBe(true)
    pending.resolve(image())
    await pending.promise
    await Promise.resolve()
    expect(state?.src).toBeUndefined()
    view.dispose()
    view.visible(true)
    view.retry()
    expect(f.timers.size).toBe(0)
    expect(state?.src).toBeUndefined()
  })

  test("server expiry and the short resident deadline revoke URLs without automatic refetch", async () => {
    for (const lifetime of [1000, MAX_RESIDENT_MS]) {
      const f = fixture()
      let calls = 0
      let state: CaptureState | undefined
      const ready = Promise.withResolvers<string>()
      const view = createCaptureView({
        pool: f.pool,
        read: async () => {
          calls++
          return image(lifetime === 1000 ? 2000 : 1_000_000)
        },
        change: (next) => {
          state = next
          if (next.src) ready.resolve(next.src)
        },
      })
      view.visible(true)
      const url = await ready.promise
      f.advance(lifetime)
      expect(state?.src).toBeUndefined()
      expect(calls).toBe(1)
      view.visible(true)
      expect(calls).toBe(1)
      await expect(fetch(url)).rejects.toThrow()
      view.dispose()
      expect(f.timers.size).toBe(0)
    }
  })

  test("explicit priority evicts the oldest lease, and decoded-size or expired images are rejected", async () => {
    const f = fixture()
    const first = f.pool.acquire(() => {})!
    const second = f.pool.acquire(() => {})!
    const url = await first.publish(image())
    const third = f.pool.acquire(() => {}, true)!
    expect(first.signal.aborted).toBe(true)
    await expect(fetch(url!)).rejects.toThrow()
    const huge = Uint8Array.from(png)
    new DataView(huge.buffer).setUint32(16, 32768)
    new DataView(huge.buffer).setUint32(20, 32768)
    expect(await third.publish({ blob: new Blob([huge], { type: "image/png" }), expiresAt: 1_000_000 })).toBeUndefined()
    expect(await third.publish(image(999))).toBeUndefined()
    second.release()
    third.release()
    expect(f.timers.size).toBe(0)
  })

  test("pending requests also expire and a reader exception releases its reservation", async () => {
    const f = fixture()
    const pending = Promise.withResolvers<ReturnType<typeof image>>()
    let signal: AbortSignal | undefined
    const view = createCaptureView({
      pool: f.pool,
      read: (value) => {
        signal = value
        return pending.promise
      },
      change: () => {},
    })
    view.visible(true)
    await Promise.resolve()
    f.advance(MAX_RESIDENT_MS)
    expect(signal?.aborted).toBe(true)
    expect(f.timers.size).toBe(0)
    pending.resolve(image())
    view.dispose()
    const failed = Promise.withResolvers<void>()
    const broken = createCaptureView({
      pool: f.pool,
      read: () => {
        throw new Error("reader failed")
      },
      change: (state) => {
        if (state.failed) failed.resolve()
      },
    })
    broken.visible(true)
    await failed.promise
    expect(f.timers.size).toBe(0)
    broken.dispose()
  })
})
