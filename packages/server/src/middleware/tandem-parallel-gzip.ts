// Tandem-owned (not in upstream): gzip large responses on several threads.
import { Effect } from "effect"
import { HttpBody, HttpEffect, HttpMiddleware, HttpServerRequest, HttpServerResponse } from "effect/http"
import { promisify } from "node:util"
import zlib from "node:zlib"

// Upstream compression gzips a response in one call before sending its headers, which took 2.6 s for a 42 MB
// session page of inline photos. Android WebView accepts only gzip and deflate over plain HTTP, so faster
// encodings do not reach the apps. Slices compressed in parallel, each primed with the 32 KiB before it, join
// into one standard gzip stream (concatenated gzip members are not: Chromium decodes only the first).
const minimum = 1024 * 1024
const sliceSize = 256 * 1024
const maxSlices = 8
const window = 32 * 1024
const level = 6

const deflateRaw = promisify(zlib.deflateRaw) as (data: Uint8Array, options: zlib.ZlibOptions) => Promise<Buffer>

export async function parallelGzip(data: Uint8Array) {
  const slices = Math.min(maxSlices, Math.ceil(data.byteLength / sliceSize))
  const size = Math.ceil(data.byteLength / slices)
  const parts = await Promise.all(
    Array.from({ length: slices }, (_, index) => {
      const start = index * size
      const end = Math.min(data.byteLength, start + size)
      return deflateRaw(data.subarray(start, end), {
        level,
        chunkSize: 256 * 1024,
        ...(start > 0 ? { dictionary: data.subarray(Math.max(0, start - window), start) } : {}),
        // A sync flush ends a slice on a byte boundary without marking the stream finished.
        finishFlush: end === data.byteLength ? zlib.constants.Z_FINISH : zlib.constants.Z_SYNC_FLUSH,
      })
    }),
  )
  const header = Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255])
  const trailer = Buffer.alloc(8)
  trailer.writeUInt32LE(zlib.crc32(data) >>> 0, 0)
  trailer.writeUInt32LE(data.byteLength >>> 0, 4)
  return new Uint8Array(Buffer.concat([header, ...parts, trailer]))
}

function acceptsGzip(header: string | undefined) {
  return (header ?? "").split(",").some((entry) => {
    const [name, ...params] = entry.trim().toLowerCase().split(";")
    if (name !== "gzip" && name !== "*") return false
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="))
    return q === undefined || Number(q.slice(2)) > 0
  })
}

const compressible = (contentType: string | undefined) => !!contentType && /json|^text\//i.test(contentType)

const vary = (current: string | undefined) =>
  current && /accept-encoding/i.test(current) ? current : current ? `${current}, Accept-Encoding` : "Accept-Encoding"

// Apply after upstream's compression middleware so this handler runs first; upstream then skips the response.
export const parallelGzipLarge = HttpMiddleware.make((app) =>
  HttpEffect.withPreResponseHandler(app, (request: HttpServerRequest.HttpServerRequest, response) => {
    const body = response.body
    if (
      response.status !== 200 ||
      body._tag !== "Uint8Array" ||
      body.body.byteLength < minimum ||
      response.headers["content-encoding"] !== undefined ||
      /no-transform/i.test(response.headers["cache-control"] ?? "") ||
      !compressible(response.headers["content-type"] ?? body.contentType) ||
      !acceptsGzip(request.headers["accept-encoding"])
    )
      return Effect.succeed(response)
    return Effect.promise(() => parallelGzip(body.body)).pipe(
      Effect.map((compressed) =>
        HttpServerResponse.setHeaders(
          HttpServerResponse.setBody(
            response,
            HttpBody.uint8Array(compressed, response.headers["content-type"] ?? body.contentType),
          ),
          {
            "content-encoding": "gzip",
            "content-length": String(compressed.byteLength),
            vary: vary(response.headers["vary"]),
          },
        ),
      ),
    )
  }),
)
