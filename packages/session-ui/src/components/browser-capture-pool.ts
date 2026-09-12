// UPSTREAM-DIVERGENCE: reserve document-wide capacity before fetching, not after allocating blobs.
export type BrowserImage = { blob: Blob; expiresAt: number }
export const MAX_RESIDENT_CAPTURES = 2
export const MAX_RESIDENT_MS = 60_000
export const MAX_CAPTURE_BYTES = 8 * 1024 * 1024
export const MAX_CAPTURE_PIXELS = 8 * 1024 * 1024

interface Lease {
  signal: AbortSignal
  publish(image: BrowserImage): Promise<string | undefined>
  release(): void
}

export function createCapturePool(
  options: {
    now?: () => number
    schedule?: (run: () => void, ms: number) => () => void
  } = {},
) {
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ??
    ((run, ms) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    })
  const leases = new Set<Lease>()
  return {
    acquire(onRelease: () => void, priority = false): Lease | undefined {
      if (leases.size >= MAX_RESIDENT_CAPTURES) {
        if (!priority) return
        leases.values().next().value?.release()
      }
      const abort = new AbortController()
      const deadline = now() + MAX_RESIDENT_MS
      let src: string | undefined
      let cancelTimer: (() => void) | undefined
      const lease: Lease = {
        signal: abort.signal,
        release() {
          if (!leases.delete(lease)) return
          abort.abort()
          cancelTimer?.()
          if (src) URL.revokeObjectURL(src)
          src = undefined
          onRelease()
        },
        async publish(image) {
          if (abort.signal.aborted || src || image.blob.type !== "image/png" || image.blob.size > MAX_CAPTURE_BYTES)
            return
          const header = new DataView(await image.blob.slice(0, 24).arrayBuffer())
          if (
            header.byteLength < 24 ||
            header.getUint32(0) !== 0x89504e47 ||
            header.getUint32(4) !== 0x0d0a1a0a ||
            header.getUint32(8) !== 13 ||
            header.getUint32(12) !== 0x49484452
          )
            return
          const width = header.getUint32(16)
          const height = header.getUint32(20)
          // Bound decoded memory too. Larger captures remain available to model projection, not UI decoding.
          if (!width || !height || width * height > MAX_CAPTURE_PIXELS) return
          const remaining = Math.min(deadline, image.expiresAt) - now()
          if (abort.signal.aborted || src || !Number.isFinite(remaining) || remaining <= 0) return
          cancelTimer?.()
          cancelTimer = schedule(() => lease.release(), remaining)
          src = URL.createObjectURL(image.blob)
          return src
        },
      }
      leases.add(lease)
      cancelTimer = schedule(() => lease.release(), MAX_RESIDENT_MS)
      return lease
    },
  }
}

const residentCaptures = createCapturePool()
export type CaptureState = { src?: string; failed: boolean; loading: boolean }

/** Visibility changes and explicit user retries are the only admission triggers; expiry never auto-refetches. */
export function createCaptureView(input: {
  read: (signal: AbortSignal) => Promise<BrowserImage | undefined>
  change: (state: CaptureState) => void
  pool?: ReturnType<typeof createCapturePool>
}) {
  let visible = false
  let disposed = false
  let lease: Lease | undefined
  const load = (priority = false) => {
    if (disposed || !visible || lease) return
    const current = (input.pool ?? residentCaptures).acquire(() => {
      lease = undefined
      input.change({ src: undefined, failed: false, loading: false })
    }, priority)
    if (!current) return
    lease = current
    input.change({ src: undefined, failed: false, loading: true })
    void Promise.resolve()
      .then(() => (current.signal.aborted ? undefined : input.read(current.signal)))
      .then(async (image) => {
        if (current.signal.aborted) return
        const src = image && (await current.publish(image))
        if (current.signal.aborted) return
        if (src) input.change({ src, failed: false, loading: false })
        else {
          current.release()
          input.change({ src: undefined, failed: true, loading: false })
        }
      })
      .catch(() => {
        if (current.signal.aborted) return
        current.release()
        input.change({ src: undefined, failed: true, loading: false })
      })
  }
  return {
    visible(value: boolean) {
      if (disposed || visible === value) return
      visible = value
      if (value) load()
      else lease?.release()
    },
    retry: () => load(true),
    fail() {
      if (disposed) return
      lease?.release()
      input.change({ src: undefined, failed: true, loading: false })
    },
    dispose() {
      disposed = true
      visible = false
      lease?.release()
    },
  }
}
