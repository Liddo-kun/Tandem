// Tandem-owned (not in upstream): imagegen credentials, OAuth adapters and local image artifacts.
import fs from "node:fs/promises"
import path from "node:path"
import { Schema } from "effect"
import { loadPhoton } from "./photon.js"
import description from "./description.md" with { type: "text" }
import skillContent from "./imagegen-skill.md" with { type: "text" }

export const DESCRIPTION: string = description

// Built-in skill shipped with the binary and registered (gated) in skill/index.ts.
// Name/description live here; the body is the embedded markdown above.
export const SKILL = {
  name: "imagegen",
  description:
    "Generate or edit raster images with Tandem's imagegen tool. Use for image requests, not vector/SVG or code-native visuals.",
  content: skillContent,
} as const

export function disabledByFlag(): boolean {
  return ["0", "false", "off", "no"].includes((process.env.TANDEM_IMAGEGEN ?? "").trim().toLowerCase())
}

export const IMAGE_MODEL = "gpt-image-2.5-sunburst"
// Native Codex compatibility name, matching the official client. The serving
// image model is backend-managed; this request field does not verify its identity.
const OAUTH_IMAGE_MODEL = "gpt-image-2"
const OAUTH_HOST_MODEL = process.env.TANDEM_IMAGEGEN_OAUTH_MODEL || "gpt-5.5"
const OAUTH_IMAGES_BASE = "https://chatgpt.com/backend-api/codex/images"
const OAUTH_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"

export const QUALITIES = ["medium", "high", "xhigh", "max"] as const
export type Quality = (typeof QUALITIES)[number]
export const MAX_EDIT_IMAGES = 10

export interface Args {
  prompt: string
  quality?: Quality
  width?: number
  height?: number
  image_paths?: string[]
  mask_path?: string
  transparent?: boolean
}

interface ApiArgs extends Args {
  quality: Quality
  width: number
  height: number
}

// A produced image plus the prompt the image model reports it actually used
// (`revised_prompt`). Masked OAuth edits use a host model, so this records
// the prompt it actually handed off. May be undefined
// when the backend does not return one.
export interface GeneratedImage {
  png: Buffer
  revisedPrompt?: string
  transport?: "images" | "responses"
  requestId?: string
  generationId?: string
  observed?: { width: number; height: number; alpha: boolean }
  reported?: { model?: string; quality?: string; background?: string; action?: string }
}

function reportedSettings(value: Record<string, unknown>): NonNullable<GeneratedImage["reported"]> {
  // Tool.Success metadata is Schema.Json: absent settings must be omitted,
  // not own properties containing undefined (which fail durable event encoding).
  return {
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    ...(typeof value.quality === "string" ? { quality: value.quality } : {}),
    ...(typeof value.background === "string" ? { background: value.background } : {}),
    ...(typeof value.action === "string" ? { action: value.action } : {}),
  }
}

interface ApiCreds {
  mode: "api"
  key: string
}
interface OauthCreds {
  mode: "oauth"
  access: string
  accountId?: string
  /** Explicit legacy transport adapter; never inferred from token-sharing credentials. */
  clientID: string
}
export type Creds = ApiCreds | OauthCreds

export async function run(args: Args, creds: Creds, signal: AbortSignal): Promise<GeneratedImage> {
  if (creds.mode === "oauth" && creds.clientID !== "app_EMoamEEZ73f0CkXaXp7hrann")
    throw new Error(
      "Codex Images requires the separate OpenAI Images (ChatGPT) login or an OpenAI API key; conversation token-sharing credentials are not compatible.",
    )
  validate(args)
  await validateMask(args)
  if (creds.mode === "oauth" && args.mask_path && args.transparent)
    throw new Error(
      "Masked OAuth edits with transparency are unsupported by the retained Responses route; no generation was attempted",
    )
  let image: GeneratedImage
  if (creds.mode === "api") {
    validateApiArgs(args)
    image = await generateApiKey(args, creds, signal)
  } else {
    image = await (args.mask_path ? editOAuth(args, creds, signal) : nativeOAuth(args, creds, signal))
  }
  if (!pngDimensions(image.png)) throw new Error("OpenAI returned invalid or non-PNG image data")
  const photon = await loadPhoton()
  const decoded = photon.PhotonImage.new_from_byteslice(image.png)
  try {
    image.observed = {
      width: decoded.get_width(),
      height: decoded.get_height(),
      alpha: decoded.get_raw_pixels().some((value, index) => index % 4 === 3 && value < 255),
    }
    if (args.transparent && !image.observed.alpha)
      throw new Error("OpenAI returned an opaque image despite requesting native transparency")
  } finally {
    decoded.free()
  }
  return image
}

function validate(args: Args): void {
  if (!args.prompt.trim()) throw new Error("prompt is required")
  if (args.image_paths && args.image_paths.length > MAX_EDIT_IMAGES)
    throw new Error(`image_paths supports at most ${MAX_EDIT_IMAGES} images`)
  if (args.mask_path && !args.image_paths?.length) throw new Error("mask_path requires image_paths")
}

function validateApiArgs(args: Args): asserts args is ApiArgs {
  if (!args.quality || !QUALITIES.includes(args.quality)) throw new Error("quality must be medium, high, xhigh, or max")
  const { width, height } = args
  if (width === undefined || height === undefined)
    throw new Error("width and height are required for API-key image generation")
  if (![width, height].every((edge) => Number.isInteger(edge) && edge > 0 && edge <= 3840 && edge % 16 === 0))
    throw new Error("width and height must be positive multiples of 16, at most 3840 pixels each")
  const pixels = width * height
  if (Math.max(width, height) > 3 * Math.min(width, height) || pixels < 655_360 || pixels > 8_294_400)
    throw new Error("Dimensions require an aspect ratio between 1:3 and 3:1 and 655360–8294400 total pixels")
}

function requestId(res: Response): string | undefined {
  return (
    res.headers.get("x-codex-imagegen-request-id") ??
    res.headers.get("x-request-id") ??
    res.headers.get("x-oai-request-id") ??
    undefined
  )
}

// ---- API-key transport: OpenCode's public image API ----

async function generateApiKey(args: ApiArgs, creds: ApiCreds, signal: AbortSignal): Promise<GeneratedImage> {
  const { ai } = await import("@opencode/ai/promise")
  const { OpenAI } = await import("@opencode/ai/providers")
  const images = await Promise.all((args.image_paths ?? []).map((file) => ai.file(file, { signal })))
  const response = await ai.image.generate(
    {
      model: OpenAI.configure({ apiKey: creds.key }).image(IMAGE_MODEL),
      prompt: args.prompt,
      n: 1,
      size: `${args.width}x${args.height}`,
      format: "png",
      images: images.length ? images : undefined,
      mask: args.mask_path ? await ai.file(args.mask_path, { signal }) : undefined,
      providerOptions: {
        quality: args.quality,
        background: args.transparent ? "transparent" : "opaque",
        moderation: "low",
      },
    },
    { signal },
  )
  if (!response.image) throw new Error("OpenAI returned no image data")
  return {
    png: Buffer.from(await ai.bytes(response.image, { signal })),
    transport: "images",
    reported: reportedSettings(response.providerMetadata?.openai ?? {}),
  }
}

const ImageResponse = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  quality: Schema.optionalKey(Schema.String),
  background: Schema.optionalKey(Schema.String),
  action: Schema.optionalKey(Schema.String),
  data: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        b64_json: Schema.optionalKey(Schema.String),
        revised_prompt: Schema.optionalKey(Schema.String),
        generation_id: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
})

function decodeImageResponse(value: unknown): GeneratedImage {
  const json = Schema.decodeUnknownSync(ImageResponse)(value)
  const item = (json.data ?? []).find(
    (entry): entry is { b64_json: string; revised_prompt?: string; generation_id?: string } =>
      typeof entry.b64_json === "string",
  )
  if (!item) throw new Error("OpenAI returned no image data")
  return {
    png: Buffer.from(item.b64_json, "base64"),
    revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
    generationId: typeof item.generation_id === "string" ? item.generation_id : undefined,
    reported: reportedSettings(json),
  }
}

// Native Codex Images API: direct prompt, no host-model hop. The backend may
// choose its own model/quality/dimensions; preserve reported values separately.
async function nativeOAuth(args: Args, creds: OauthCreds, signal: AbortSignal): Promise<GeneratedImage> {
  const images = await Promise.all(
    (args.image_paths ?? []).map(async (file) => ({
      image_url: `data:${mimeFromPath(file)};base64,${(await readFile(file)).toString("base64")}`,
    })),
  )
  const body = {
    model: OAUTH_IMAGE_MODEL,
    prompt: args.prompt,
    background: args.transparent ? "transparent" : "opaque",
    quality: "auto",
    size: "auto",
    ...(images.length ? { images } : {}),
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.access}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    originator: "opencode",
  }
  if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId
  const operation = images.length ? "edits" : "generations"
  const res = await fetch(`${OAUTH_IMAGES_BASE}/${operation}`, {
    method: "POST",
    signal,
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await httpError(res, "image generation")
  return { ...decodeImageResponse(await res.json()), transport: "images", requestId: requestId(res) }
}

// Masked OAuth edits retain Responses input_image_mask: the native Images route
// silently accepts even invalid mask bytes (live control), so it cannot be relied
// on for masks. Do not send a mask there and pretend it was applied.
async function editOAuth(args: Args, creds: OauthCreds, signal: AbortSignal): Promise<GeneratedImage> {
  const inputImages = await Promise.all(
    (args.image_paths ?? []).map(
      async (file) => `data:${mimeFromPath(file)};base64,${(await readFile(file)).toString("base64")}`,
    ),
  )
  return oauthOneImage(args, creds, inputImages, signal)
}

async function oauthOneImage(
  args: Args,
  creds: OauthCreds,
  inputImages: string[] | undefined,
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: args.prompt }]
  for (const url of inputImages ?? []) content.push({ type: "input_image", image_url: url })
  const body = {
    model: OAUTH_HOST_MODEL,
    stream: true,
    store: false,
    // On OAuth the host chat model authors the prompt handed to the image_generation
    // tool — left to itself gpt-5.5 rewrites/expands and sanitizes it (verified via
    // Codex traces, notes/imagegen.md). Force verbatim pass-through so the user's
    // wording is what gets rendered. (The image model's own revised_prompt layer may
    // still adjust it slightly; that is surfaced back to the user.)
    instructions:
      "Call the image_generation tool exactly once. Use the user's message as the image prompt VERBATIM: pass their exact words unchanged. Do not rewrite, rephrase, paraphrase, translate, summarize, expand, embellish, add details, or alter, soften, or sanitize the wording in any way. Do not ask questions, explain, or add commentary.",
    input: [{ role: "user", content }],
    tools: [
      {
        type: "image_generation",
        action: inputImages?.length ? "edit" : "generate",
        size: "auto",
        quality: "auto",
        background: args.transparent ? "transparent" : "opaque",
        output_format: "png",
        moderation: "low",
        ...(args.mask_path
          ? {
              input_image_mask: {
                image_url: `data:image/png;base64,${(await readFile(args.mask_path)).toString("base64")}`,
              },
            }
          : {}),
      },
    ],
    tool_choice: { type: "image_generation" },
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.access}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    originator: "opencode",
  }
  if (creds.accountId) headers["ChatGPT-Account-Id"] = creds.accountId
  const res = await fetch(OAUTH_RESPONSES_URL, { method: "POST", signal, headers, body: JSON.stringify(body) })
  if (!res.ok || !res.body) throw await httpError(res, "image generation")
  return { ...(await readImageFromSSE(res.body)), transport: "responses", requestId: requestId(res) }
}

// Parse the Responses SSE stream and return the first completed image plus the
// prompt the image model reports it used. The base64 PNG arrives on
// `response.output_item.done` (item.type === "image_generation_call", field
// `result`), alongside `revised_prompt`; `response.completed` is the fallback.
async function readImageFromSSE(body: ReadableStream<Uint8Array>): Promise<GeneratedImage> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let result: string | undefined
  let revisedPrompt: string | undefined
  let reported: GeneratedImage["reported"]
  let failure: string | undefined

  const capture = (value: unknown) => {
    const item = record(value)
    if (item?.type !== "image_generation_call" || typeof item.result !== "string") return
    result ??= item.result
    const settings = reportedSettings(item)
    const model = settings.model ?? reported?.model
    reported = { ...settings, ...(model === undefined ? {} : { model }) }
    if (revisedPrompt === undefined && typeof item.revised_prompt === "string") revisedPrompt = item.revised_prompt
  }

  const handle = (event: string, data: string) => {
    const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(data)
    if (parsed._tag === "None") return
    const value = record(parsed.value)
    const response = record(value?.response)
    const imageTool = Array.isArray(response?.tools)
      ? response.tools.map(record).find((tool) => tool?.type === "image_generation")
      : undefined
    if (typeof imageTool?.model === "string") reported = { ...reported, model: imageTool.model }
    if (event === "response.output_item.done") capture(value?.item)
    if (event === "response.completed" && Array.isArray(response?.output)) response.output.forEach(capture)
    if (event === "response.failed" || event === "error") {
      const error = record(response?.error) ?? record(value?.error)
      failure = typeof error?.message === "string" ? error.message : "OpenAI image generation failed"
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let split: number
    while ((split = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, split)
      buffer = buffer.slice(split + 2)
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim()
        else if (line.startsWith("data:")) data += line.slice(5).trim()
      }
      if (data && data !== "[DONE]") handle(event, data)
      if (failure) {
        await reader.cancel()
        throw new Error(failure)
      }
      if (result) {
        await reader.cancel()
        return { png: Buffer.from(result, "base64"), revisedPrompt, reported }
      }
    }
  }
  if (result) return { png: Buffer.from(result, "base64"), revisedPrompt, reported }
  throw new Error(failure ?? "image generation produced no image")
}

// ---- chat copy (saved beside the original PNG; invisible to the model) ----

// The generated bytes are PNG and the full-quality PNG is always saved. Beside it we save a smaller
// copy at the SAME pixel dimensions and return THAT path as the chat artifact: it is what the web UI
// thumbnails and what the `read` tool later base64-encodes back into the prompt when the model
// re-inspects an image. A multi-MB PNG would balloon session history and every re-read; the small
// copy cuts that several-fold. Opaque images use JPEG; transparent ones use WebP, which preserves
// alpha (JPEG cannot). Override JPEG quality (1–100) via TANDEM_IMAGEGEN_JPEG_QUALITY.
const JPEG_QUALITY = clampQuality(process.env.TANDEM_IMAGEGEN_JPEG_QUALITY, 90)
function clampQuality(raw: string | undefined, fallback: number): number {
  const n = raw?.trim() ? Number(raw) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(1, Math.round(n)))
}

// Recompress one generated PNG to JPEG bytes. Returns undefined if Photon can't decode the buffer
// or if the JPEG somehow isn't smaller (tiny/flat images); the caller then keeps only the PNG, so
// the chat copy is best-effort and never breaks saving. Same dimensions, so size reporting (read
// from the PNG header) stays accurate.
export async function encodeJpeg(png: Buffer, quality: number = JPEG_QUALITY): Promise<Buffer | undefined> {
  try {
    const photon = await loadPhoton()
    const image = photon.PhotonImage.new_from_byteslice(png)
    try {
      const jpeg = Buffer.from(image.get_bytes_jpeg(quality))
      return jpeg.length < png.length ? jpeg : undefined
    } finally {
      image.free()
    }
  } catch {
    return undefined
  }
}

// Re-encode a transparent PNG to WebP bytes (alpha preserved). Same best-effort contract as
// encodeJpeg: undefined when Photon can't decode it or the WebP isn't smaller, so the caller keeps
// the PNG. Used as the chat copy for transparent images since JPEG cannot carry an alpha channel.
export async function encodeWebp(png: Buffer): Promise<Buffer | undefined> {
  try {
    const photon = await loadPhoton()
    const image = photon.PhotonImage.new_from_byteslice(png)
    try {
      const webp = Buffer.from(image.get_bytes_webp())
      return webp.length < png.length ? webp : undefined
    } finally {
      image.free()
    }
  } catch {
    return undefined
  }
}

// ---- output ----

export async function saveImage(
  png: Buffer,
  directory: string,
  baseName: string,
  transparent = false,
): Promise<{ path: string; originalPath: string }> {
  // Save under the working directory (<cwd>/imagegen) rather than the XDG data dir, so the web UI
  // can fetch the file by relative path through the existing worktree-scoped file.read endpoint.
  // The full-quality PNG is written AND a smaller copy beside it (same stem); the returned path is
  // the small copy when one was produced, else the PNG, so the chat/model use the small copy while
  // the PNG is retained. The copy is JPEG for opaque images, WebP for transparent ones (JPEG cannot
  // hold alpha). The path is relative to `directory` (posix separators), valid for both file.read in
  // the UI and the `read` tool for the model. `baseName` (the tool call id) keeps names unique;
  // uniqueStem resolves any remaining collisions. Users can gitignore imagegen/.
  const dir = path.join(directory, "imagegen")
  await fs.mkdir(dir, { recursive: true })
  const ext = transparent ? "webp" : "jpg"
  const copy = transparent ? await encodeWebp(png) : await encodeJpeg(png)
  const stem = await uniqueStem(dir, path.basename(baseName).replace(/[^a-zA-Z0-9_-]/g, "_") || "image")
  await fs.writeFile(path.join(dir, `${stem}.png`), png, { flag: "wx" })
  let chat = `${stem}.png`
  if (copy) {
    chat = await fs
      .writeFile(path.join(dir, `${stem}.${ext}`), copy, { flag: "wx" })
      .then(() => `${stem}.${ext}`)
      .catch(() => chat)
  }
  return {
    path: path.relative(directory, path.join(dir, chat)).split(path.sep).join("/"),
    originalPath: path
      .relative(directory, path.join(dir, `${stem}.png`))
      .split(path.sep)
      .join("/"),
  }
}

// Pick a stem for which none of <stem>.{png,jpg,webp} already exists, so the PNG and its small copy
// stay together under one name and nothing is overwritten.
async function uniqueStem(dir: string, stem: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const candidate = attempt === 0 ? stem : `${stem}-${attempt}`
    if (
      !(await exists(path.join(dir, `${candidate}.png`))) &&
      !(await exists(path.join(dir, `${candidate}.jpg`))) &&
      !(await exists(path.join(dir, `${candidate}.webp`)))
    )
      return candidate
  }
}

// ---- helpers ----

async function readFile(file: string): Promise<Buffer> {
  try {
    return await fs.readFile(file)
  } catch {
    throw new Error(`could not read image file: ${file}`)
  }
}

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}

function mimeFromPath(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg"
  if (ext === ".webp") return "image/webp"
  return "image/png"
}

// Report decoded dimensions rather than assuming the backend honored the request.
export function pngDimensions(png: Buffer): string | undefined {
  if (png.length < 24 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return undefined
  const width = png.readUInt32BE(16)
  const height = png.readUInt32BE(20)
  if (!width || !height) return undefined
  return `${width}x${height}`
}

async function httpError(res: Response, operation: string): Promise<Error> {
  const text = await res.text().catch(() => "")
  let detail = text
  try {
    const json: { error?: { message?: string }; detail?: string } = JSON.parse(text)
    detail = json.error?.message ?? json.detail ?? text
  } catch {}
  detail = detail.slice(0, 400)
  if (res.status === 401 || res.status === 403)
    return new Error(`OpenAI ${operation} unauthorized (${res.status}). Re-login or check credentials. ${detail}`)
  if (res.status === 400) return new Error(`OpenAI rejected the ${operation} request (400): ${detail}`)
  return new Error(`OpenAI ${operation} failed (${res.status}): ${detail}`)
}

function record(value: unknown): Record<string, unknown> | undefined {
  const decoded = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(value)
  return decoded._tag === "Some" ? decoded.value : undefined
}

async function validateMask(args: Args) {
  if (!args.mask_path) return
  const mask = await readFile(args.mask_path)
  const size = pngDimensions(mask)
  if (!size) throw new Error("mask_path must be a PNG")
  const photon = await loadPhoton()
  const source = photon.PhotonImage.new_from_byteslice(await readFile(args.image_paths?.[0] ?? ""))
  try {
    if (size !== `${source.get_width()}x${source.get_height()}`)
      throw new Error("Mask dimensions must match the first input image")
    const decoded = photon.PhotonImage.new_from_byteslice(mask)
    try {
      if (!decoded.get_raw_pixels().some((value, index) => index % 4 === 3 && value < 255))
        throw new Error("Mask requires transparent editable pixels")
    } finally {
      decoded.free()
    }
  } finally {
    source.free()
  }
}

export * as ImageGen from "./imagegen.js"
