import fs from "node:fs/promises"
import path from "node:path"
import { Global } from "@opencode-ai/core/global"
import { extractAccountId } from "../codex"
import { Chroma } from "./chroma"
import { loadPhoton } from "./photon"
import description from "./imagegen.txt"
import skillContent from "./imagegen-skill.md" with { type: "text" }

// UPSTREAM-DIVERGENCE: Tandem-only image generation tool core. Kept fully
// self-contained so upstream merges only ever touch the one-line registration in
// plugin/index.ts. Verified request/response contract: notes/imagegen.md.

export const DESCRIPTION: string = description

// Built-in skill shipped with the binary and registered (gated) in skill/index.ts.
// Name/description live here; the body is the embedded markdown above.
export const SKILL = {
  name: "imagegen",
  description:
    "Use when the user wants to create or edit a raster image — a photo, illustration, diagram, mockup, sprite, texture, product shot, logo concept, meme, portrait, or icon art — or to modify an existing image (add/remove elements, recolor, restyle, replace background). Drives the Tandem `imagegen` tool (OpenAI gpt-image). Do not use for vector/SVG output, established icon/logo systems, or visuals better built directly in HTML/CSS/canvas or code.",
  content: skillContent,
} as const

// Single source of truth for imagegen visibility: the opt-out flag plus a resolvable
// OpenAI credential. Both the tool (plugin.ts) and the skill (skill/index.ts) gate on
// this so they can never disagree about whether imagegen is available.
const DISABLED_VALUES = ["0", "false", "off", "no"]
export function disabledByFlag(): boolean {
  return DISABLED_VALUES.includes((process.env.TANDEM_IMAGEGEN ?? "").toLowerCase())
}
export async function isAvailable(): Promise<boolean> {
  if (disabledByFlag()) return false
  return !!(await resolveCreds().catch(() => undefined))
}

// gpt-image-2 backs the API-key Images endpoint. The OAuth path instead drives
// the Responses API's built-in `image_generation` tool, hosted by a chat model.
const IMAGE_MODEL = "gpt-image-2"
const OAUTH_HOST_MODEL = process.env.TANDEM_IMAGEGEN_OAUTH_MODEL || "gpt-5.5"
const API_BASE = "https://api.openai.com/v1"
const OAUTH_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses"

// Duplicated from plugin/openai/codex.ts (not exported there) so codex.ts needs
// no edits. Mirror these if the upstream Codex OAuth client id/issuer ever change.
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const OAUTH_ISSUER = "https://auth.openai.com"

// Curated gpt-image-2 sizes (base 4). A closed enum keeps the model from emitting
// invalid free-form WxH; the backend still validates server-side.
export const SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const
export type Size = (typeof SIZES)[number]
export const QUALITIES = ["low", "medium", "high", "auto"] as const
export type Quality = (typeof QUALITIES)[number]
export const MAX_EDIT_IMAGES = 10

export interface Args {
  prompt: string
  quality: Quality
  size: Size
  image_paths?: string[]
  mask_path?: string
  // Produce a transparent-background cutout. gpt-image-2 / the OAuth image tool cannot emit alpha
  // natively, so this renders on a flat chroma-key background and removes it to alpha locally.
  transparent?: boolean
}

// A produced image plus the prompt the image model reports it actually used
// (`revised_prompt`). On the OAuth path the host chat model authors the prompt,
// so this is how the caller learns what was really rendered. May be undefined
// when the backend does not return one.
export interface GeneratedImage {
  png: Buffer
  revisedPrompt?: string
}

interface ApiCreds {
  mode: "api"
  key: string
}
interface OauthCreds {
  mode: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
}
export type Creds = ApiCreds | OauthCreds

interface StoredAuth {
  type?: string
  key?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
}

async function readAuthStore(): Promise<Record<string, StoredAuth>> {
  const inline = process.env.OPENCODE_AUTH_CONTENT
  if (inline) {
    try {
      return JSON.parse(inline)
    } catch {}
  }
  try {
    return JSON.parse(await fs.readFile(path.join(Global.Path.data, "auth.json"), "utf8"))
  } catch {
    return {}
  }
}

// Resolution precedence: stored API key, then OPENAI_API_KEY env, then OAuth.
// The SDK client exposes no auth read path, so the store is read directly here.
export async function resolveCreds(): Promise<Creds | undefined> {
  const openai = (await readAuthStore()).openai
  if (openai?.type === "api" && openai.key) return { mode: "api", key: openai.key }
  if (process.env.OPENAI_API_KEY) return { mode: "api", key: process.env.OPENAI_API_KEY }
  if (openai?.type === "oauth" && openai.refresh)
    return {
      mode: "oauth",
      access: openai.access ?? "",
      refresh: openai.refresh,
      expires: openai.expires ?? 0,
      accountId: openai.accountId,
    }
  return undefined
}

export function needsRefresh(creds: OauthCreds): boolean {
  return !creds.access || creds.expires < Date.now() + 60_000
}

export async function refreshOAuth(creds: OauthCreds): Promise<OauthCreds> {
  const res = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: creds.refresh,
      client_id: OAUTH_CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) throw new Error(`OpenAI token refresh failed (${res.status})`)
  const tokens: {
    access_token: string
    refresh_token: string
    id_token?: string
    expires_in?: number
  } = await res.json()
  return {
    mode: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId:
      extractAccountId({
        id_token: tokens.id_token ?? "",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      }) ?? creds.accountId,
  }
}

export async function run(args: Args, creds: Creds): Promise<GeneratedImage> {
  validate(args)
  const editing = !!args.image_paths?.length
  if (!args.transparent) return generateOrEdit(args, creds, editing)

  // Transparent output: gpt-image-2 and the OAuth image_generation tool cannot emit a transparent
  // background, so render the subject on a flat chroma-key background and key it out to alpha locally
  // (matches the Codex imagegen skill's built-in transparent workflow). The key instruction is
  // appended to the prompt — not the system message — so it survives the OAuth verbatim pass-through
  // and reaches the image model on both transports. revisedPrompt is dropped because the altered
  // prompt's revision would just echo the chroma directive, which is noise to the user.
  const keyed: Args = { ...args, prompt: `${args.prompt.trim()}\n\n${Chroma.PROMPT}` }
  const image = await generateOrEdit(keyed, creds, editing)
  return { png: await Chroma.removeChromaKey(image.png) }
}

function generateOrEdit(args: Args, creds: Creds, editing: boolean): Promise<GeneratedImage> {
  if (creds.mode === "api") return editing ? editApiKey(args, creds) : generateApiKey(args, creds)
  return editing ? editOAuth(args, creds) : generateOAuth(args, creds)
}

function validate(args: Args): void {
  if (!args.prompt.trim()) throw new Error("prompt is required")
  if (args.image_paths && args.image_paths.length > MAX_EDIT_IMAGES)
    throw new Error(`image_paths supports at most ${MAX_EDIT_IMAGES} images`)
}

// ---- API-key transport: REST /v1/images/{generations,edits} ----

async function generateApiKey(args: Args, creds: ApiCreds): Promise<GeneratedImage> {
  const body: Record<string, unknown> = {
    model: IMAGE_MODEL,
    prompt: args.prompt,
    size: args.size,
    quality: args.quality,
    output_format: "png",
    moderation: "low",
  }
  const res = await fetch(`${API_BASE}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await httpError(res, "image generation")
  return decodeImageResponse(await res.json())
}

async function editApiKey(args: Args, creds: ApiCreds): Promise<GeneratedImage> {
  const form = new FormData()
  form.append("model", IMAGE_MODEL)
  form.append("prompt", args.prompt)
  if (args.size !== "auto") form.append("size", args.size)
  form.append("quality", args.quality)
  for (const file of args.image_paths!) {
    form.append("image[]", new Blob([await readBlobPart(file)], { type: mimeFromPath(file) }), path.basename(file))
  }
  if (args.mask_path)
    form.append(
      "mask",
      new Blob([await readBlobPart(args.mask_path)], { type: "image/png" }),
      path.basename(args.mask_path),
    )
  const res = await fetch(`${API_BASE}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${creds.key}` },
    body: form,
  })
  if (!res.ok) throw await httpError(res, "image edit")
  return decodeImageResponse(await res.json())
}

function decodeImageResponse(json: { data?: { b64_json?: string; revised_prompt?: string }[] }): GeneratedImage {
  const item = (json.data ?? []).find(
    (entry): entry is { b64_json: string; revised_prompt?: string } => typeof entry.b64_json === "string",
  )
  if (!item) throw new Error("OpenAI returned no image data")
  return {
    png: Buffer.from(item.b64_json, "base64"),
    revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
  }
}

// ---- OAuth transport: Responses API image_generation tool over /codex/responses ----

async function generateOAuth(args: Args, creds: OauthCreds): Promise<GeneratedImage> {
  return oauthOneImage(args, creds, undefined)
}

async function editOAuth(args: Args, creds: OauthCreds): Promise<GeneratedImage> {
  const inputImages = await Promise.all(
    args.image_paths!.map(
      async (file) => `data:${mimeFromPath(file)};base64,${(await readFile(file)).toString("base64")}`,
    ),
  )
  // The Responses image_generation tool has no separate mask parameter; mask_path
  // is honored only on the API-key path. Edits here are prompt + input images.
  return oauthOneImage(args, creds, inputImages)
}

async function oauthOneImage(
  args: Args,
  creds: OauthCreds,
  inputImages: string[] | undefined,
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
      { type: "image_generation", size: args.size, quality: args.quality, output_format: "png", moderation: "low" },
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
  const res = await fetch(OAUTH_RESPONSES_URL, { method: "POST", headers, body: JSON.stringify(body) })
  if (!res.ok || !res.body) throw await httpError(res, "image generation")
  return readImageFromSSE(res.body)
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
  let failure: string | undefined

  const capture = (item: any) => {
    if (item?.type !== "image_generation_call" || typeof item.result !== "string") return
    result ??= item.result
    if (revisedPrompt === undefined && typeof item.revised_prompt === "string") revisedPrompt = item.revised_prompt
  }

  const handle = (event: string, data: string) => {
    let parsed: any
    try {
      parsed = JSON.parse(data)
    } catch {
      return
    }
    if (event === "response.output_item.done") {
      capture(parsed.item)
    } else if (event === "response.completed" && Array.isArray(parsed.response?.output)) {
      for (const item of parsed.response.output) capture(item)
    } else if (event === "response.failed" || event === "error") {
      failure =
        parsed.response?.error?.message ??
        parsed.error?.message ??
        parsed.message ??
        JSON.stringify(parsed).slice(0, 300)
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
      if (result) return { png: Buffer.from(result, "base64"), revisedPrompt }
    }
  }
  if (result) return { png: Buffer.from(result, "base64"), revisedPrompt }
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
  const n = Number(raw)
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
): Promise<string> {
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
  const stem = await uniqueStem(dir, baseName)
  await fs.writeFile(path.join(dir, `${stem}.png`), png)
  let chat = `${stem}.png`
  if (copy) {
    await fs.writeFile(path.join(dir, `${stem}.${ext}`), copy)
    chat = `${stem}.${ext}`
  }
  return path.relative(directory, path.join(dir, chat)).split(path.sep).join("/")
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

// Copy into a fresh ArrayBuffer-backed view so it satisfies BlobPart (a raw
// Buffer is typed over ArrayBufferLike, which BlobPart does not accept).
async function readBlobPart(file: string): Promise<Uint8Array<ArrayBuffer>> {
  const buf = await readFile(file)
  const view = new Uint8Array(buf.byteLength)
  view.set(buf)
  return view
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

// Real pixel size read straight from a PNG's IHDR header: width and height are the two
// big-endian uint32s at byte offsets 16 and 20 (after the 8-byte signature and the IHDR
// length+type). This is the only reliable size readout on the OAuth path — there the
// image_generation tool ignores the requested `size` and the host model auto-sizes from
// the prompt, so the returned dimensions can differ from what was asked for.
export function pngDimensions(png: Buffer): string | undefined {
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return undefined
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

export * as ImageGen from "./imagegen"
