import { loadPhoton } from "./photon"

// UPSTREAM-DIVERGENCE: Tandem-only. Native TypeScript port of the OpenAI Codex imagegen skill's
// remove_chroma_key.py (codex-rs/skills/src/assets/samples/imagegen/scripts/remove_chroma_key.py).
// gpt-image-2 (and the OAuth image_generation tool) cannot output a transparent background, so the
// transparent-image workflow renders the subject on a flat solid chroma-key color and converts that
// color to alpha here. Same algorithm and defaults as the Python helper (auto-key border sampling,
// soft matte, despill, edge contract/feather); pixel I/O goes through the already-bundled Photon
// WASM codec instead of Pillow, so nothing new is shipped and there is no Python runtime dependency.

type Color = [number, number, number]

const KEY_DOMINANCE_THRESHOLD = 16
const ALPHA_NOISE_FLOOR = 8

// Bright-rim defringe (Tandem enhancement, see removeChromaKey): the image models tend to paint a
// thin light "sticker outline" / rim-light glow around the subject where it meets the flat key color.
// That rim is near-white and not key-colored, so pure chroma keying leaves it fully opaque and it
// reads as a halo on any background. Codex relies on an agent eyeballing the result and re-running
// with --edge-contract; this tool runs unattended, so it erodes that specific rim automatically:
// boundary pixels that are bright and nearly desaturated get cleared, for a few one-pixel passes.
const DEFRINGE_PASSES = 2
const DEFRINGE_BRIGHTNESS = 200 // mean RGB at/above which a boundary pixel may be rim, 0-255
const DEFRINGE_SATURATION = 0.15 // HSV saturation below which a bright boundary pixel is rim, 0-1
const DEFRINGE_NEIGHBOR_ALPHA = 128 // a pixel is "boundary" if a 4-neighbor's alpha is below this

export interface RemoveOptions {
  // Sample the key color from the rendered image's border or corners. Ignored when keyColor is set.
  autoKey?: "border" | "corners"
  // Force an explicit key color instead of sampling it.
  keyColor?: Color
  tolerance?: number
  softMatte?: boolean
  transparentThreshold?: number
  opaqueThreshold?: number
  edgeContract?: number
  edgeFeather?: number
  despill?: boolean
  // Erode the model's bright "sticker outline" rim from the matte edge (see DEFRINGE_* constants).
  defringe?: boolean
}

type ResolvedOptions = Required<Omit<RemoveOptions, "keyColor">>

// Defaults match the Codex skill's recommended invocation for the built-in transparent workflow:
//   --auto-key border --soft-matte --transparent-threshold 12 --opaque-threshold 220 --despill
const DEFAULTS: ResolvedOptions = {
  autoKey: "border",
  tolerance: 12,
  softMatte: true,
  transparentThreshold: 12,
  opaqueThreshold: 220,
  edgeContract: 0,
  edgeFeather: 0,
  despill: true,
  defringe: true,
}

// Appended to the user's prompt for transparent requests so the image model renders the subject on a
// flat, removable background. Auto-key border sampling keys out whatever flat color the model used,
// so the model may pick green or magenta as long as it does not appear in the subject.
export const PROMPT: string =
  "IMPORTANT BACKGROUND REQUIREMENT FOR BACKGROUND REMOVAL: Place the subject on a perfectly flat, " +
  "solid, uniform chroma-key background in a single saturated color that does NOT appear anywhere in " +
  "the subject — use bright green #00ff00 by default, or magenta #ff00ff if the subject contains green. " +
  "The background must be one uniform color across the entire frame with no shadows, gradients, texture, " +
  "reflections, floor plane, horizon, or lighting variation. Keep the subject fully separated from the " +
  "background with crisp, clean edges and generous padding around it. The subject must meet the " +
  "background directly: do NOT draw any outline, stroke, sticker border, white or light edge, halo, " +
  "rim light, glow, light wrap, feathering, or fade around the subject's silhouette. Do not add any " +
  "cast shadow, contact shadow, reflection, vignette, border, watermark, or text."

// Convert a generated PNG that has a flat chroma-key background into a PNG with that color removed to
// alpha. Returns PNG bytes (alpha preserved). The whole pipeline mirrors remove_chroma_key.py:
// sample/resolve the key color, set per-pixel alpha (soft matte + despill), then contract/feather.
export async function removeChromaKey(png: Buffer, options: RemoveOptions = {}): Promise<Buffer> {
  const o: ResolvedOptions = { ...DEFAULTS, ...options }
  const photon = await loadPhoton()
  const image = photon.PhotonImage.new_from_byteslice(png)
  try {
    const width = image.get_width()
    const height = image.get_height()
    const data = image.get_raw_pixels() // RGBA, 4 bytes/pixel
    const key = options.keyColor ?? sampleBorderKey(data, width, height, o.autoKey)
    applyAlpha(data, key, o)
    if (o.defringe) defringeBrightRim(data, width, height)
    contractAlpha(data, width, height, o.edgeContract)
    featherAlpha(data, width, height, o.edgeFeather)
    const out = new photon.PhotonImage(data, width, height)
    try {
      return Buffer.from(out.get_bytes())
    } finally {
      out.free()
    }
  } finally {
    image.free()
  }
}

// ---- key color model (computed once per image; the key is constant across all pixels) ----

interface KeyModel {
  key: Color
  spill: number[] // channel indices (0=R,1=G,2=B) that carry the key color
  nonSpill: number[]
  keyMax: number
}

// Channels at or near the key's dominant value are "spill" channels (the chroma color's strength).
// A dark key (max < 128) has no usable spill channels; the matcher then falls back to plain distance.
function keyModel(key: Color): KeyModel {
  const keyMax = Math.max(key[0], key[1], key[2])
  const spill: number[] = []
  if (keyMax >= 128) for (let i = 0; i < 3; i++) if (key[i] >= keyMax - 16 && key[i] >= 128) spill.push(i)
  const nonSpill = [0, 1, 2].filter((i) => !spill.includes(i))
  return { key, spill, nonSpill, keyMax }
}

// ---- per-pixel alpha ----

function applyAlpha(data: Uint8Array, key: Color, o: ResolvedOptions): number {
  const model = keyModel(key)
  let transparent = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const srcAlpha = data[i + 3]
    const distance = channelDistance(r, g, b, key)
    const keyLike = looksKeyColored(r, g, b, model, distance)
    let out =
      o.softMatte && keyLike
        ? Math.min(softAlpha(distance, o.transparentThreshold, o.opaqueThreshold), dominanceAlpha(r, g, b, model))
        : distance <= o.tolerance
          ? 0
          : 255
    out = Math.round(out * (srcAlpha / 255))
    if (out > 0 && out <= ALPHA_NOISE_FLOOR) out = 0
    if (out === 0) {
      data[i] = 0
      data[i + 1] = 0
      data[i + 2] = 0
      data[i + 3] = 0
      transparent++
      continue
    }
    if (o.despill && keyLike) {
      const cleaned = cleanupSpill(r, g, b, model)
      data[i] = cleaned[0]
      data[i + 1] = cleaned[1]
      data[i + 2] = cleaned[2]
    }
    data[i + 3] = out
  }
  return transparent
}

function channelDistance(r: number, g: number, b: number, key: Color): number {
  return Math.max(Math.abs(r - key[0]), Math.abs(g - key[1]), Math.abs(b - key[2]))
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function smoothstep(value: number): number {
  const v = Math.max(0, Math.min(1, value))
  return v * v * (3 - 2 * v)
}

// Smooth alpha ramp: fully transparent at/below the transparent threshold, fully opaque at/above the
// opaque threshold, smoothstep-interpolated between.
function softAlpha(distance: number, transparentThreshold: number, opaqueThreshold: number): number {
  if (distance <= transparentThreshold) return 0
  if (distance >= opaqueThreshold) return 255
  return clampChannel(255 * smoothstep((distance - transparentThreshold) / (opaqueThreshold - transparentThreshold)))
}

// How strongly the key color dominates a pixel: the (min) spill-channel strength minus the strongest
// non-spill channel. High dominance means the pixel is mostly the key color and should be transparent.
function dominanceAlpha(r: number, g: number, b: number, m: KeyModel): number {
  if (m.spill.length === 0) return 255
  const keyStrength = minOver(r, g, b, m.spill)
  const nonKeyStrength = maxOver(r, g, b, m.nonSpill)
  const dominance = keyStrength - nonKeyStrength
  if (dominance <= 0) return 255
  const denominator = Math.max(1, m.keyMax - nonKeyStrength)
  return clampChannel((1 - Math.min(1, dominance / denominator)) * 255)
}

function keyChannelDominance(r: number, g: number, b: number, m: KeyModel): number {
  if (m.spill.length === 0) return 0
  return minOver(r, g, b, m.spill) - maxOver(r, g, b, m.nonSpill)
}

// A pixel "looks key colored" when it is close to the key by distance, or (for a bright key) the key
// channels clearly dominate. Used to scope soft-matte and despill to background/edge pixels only.
function looksKeyColored(r: number, g: number, b: number, m: KeyModel, distance: number): boolean {
  if (distance <= 32) return true
  if (m.spill.length === 0) return true
  return keyChannelDominance(r, g, b, m) >= KEY_DOMINANCE_THRESHOLD
}

// Decontaminate key-color spill on kept (edge) pixels: cap each spill channel at just below the
// strongest non-spill channel so a green/magenta fringe does not survive on the subject's edges.
function cleanupSpill(r: number, g: number, b: number, m: KeyModel): Color {
  if (m.spill.length === 0 || m.nonSpill.length === 0) return [r, g, b]
  const channels: Color = [r, g, b]
  const anchor = maxOver(r, g, b, m.nonSpill)
  const cap = Math.max(0, anchor - 1)
  for (const i of m.spill) if (channels[i] > cap) channels[i] = cap
  return [clampChannel(channels[0]), clampChannel(channels[1]), clampChannel(channels[2])]
}

// Min/max of selected channels without allocating (hot path: runs once per pixel).
function minOver(r: number, g: number, b: number, idx: number[]): number {
  let min = 255
  for (const i of idx) {
    const v = i === 0 ? r : i === 1 ? g : b
    if (v < min) min = v
  }
  return min
}
function maxOver(r: number, g: number, b: number, idx: number[]): number {
  let max = 0
  for (const i of idx) {
    const v = i === 0 ? r : i === 1 ? g : b
    if (v > max) max = v
  }
  return max
}

// ---- edge shaping on the alpha channel ----

// Saturation (HSV S) of a pixel: 0 for greys/whites, →1 for vivid colors. Used to tell the model's
// near-white rim glow apart from genuinely colored subject edges, which we must keep.
function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  if (max === 0) return 0
  return (max - Math.min(r, g, b)) / max
}

// Erode the bright, desaturated "sticker outline" rim the image models paint where the subject meets
// the flat key color (see DEFRINGE_* constants). Pure chroma keying leaves that rim opaque because it
// is not key-colored; here we clear, for a few one-pixel passes, any boundary pixel (touching a much
// more transparent neighbor) that is both bright and nearly grey. Colored subject edges have high
// saturation and survive; light subject parts lose at most a pixel or two, an acceptable trim.
function defringeBrightRim(data: Uint8Array, width: number, height: number): void {
  for (let pass = 0; pass < DEFRINGE_PASSES; pass++) {
    const alpha = new Uint8Array(width * height)
    for (let p = 0; p < width * height; p++) alpha[p] = data[p * 4 + 3]
    const cleared: number[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (alpha[p] === 0) continue
        const onBoundary =
          (x > 0 && alpha[p - 1] < DEFRINGE_NEIGHBOR_ALPHA) ||
          (x < width - 1 && alpha[p + 1] < DEFRINGE_NEIGHBOR_ALPHA) ||
          (y > 0 && alpha[p - width] < DEFRINGE_NEIGHBOR_ALPHA) ||
          (y < height - 1 && alpha[p + width] < DEFRINGE_NEIGHBOR_ALPHA)
        if (!onBoundary) continue
        const o = p * 4
        const brightness = (data[o] + data[o + 1] + data[o + 2]) / 3
        if (brightness >= DEFRINGE_BRIGHTNESS && saturation(data[o], data[o + 1], data[o + 2]) < DEFRINGE_SATURATION)
          cleared.push(o)
      }
    }
    for (const o of cleared) {
      data[o] = 0
      data[o + 1] = 0
      data[o + 2] = 0
      data[o + 3] = 0
    }
  }
}

// Shrink the visible matte by `pixels` (3x3 min filter per pass), trimming a thin key-color fringe.
function contractAlpha(data: Uint8Array, width: number, height: number, pixels: number): void {
  if (pixels <= 0) return
  for (let pass = 0; pass < pixels; pass++) {
    const src = new Uint8Array(width * height)
    for (let p = 0; p < width * height; p++) src[p] = data[p * 4 + 3]
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let min = 255
        for (let dy = -1; dy <= 1; dy++) {
          const yy = clampIndex(y + dy, height)
          for (let dx = -1; dx <= 1; dx++) {
            const v = src[yy * width + clampIndex(x + dx, width)]
            if (v < min) min = v
          }
        }
        data[(y * width + x) * 4 + 3] = min
      }
    }
  }
}

// Soften stair-stepped edges with a separable Gaussian blur on the alpha channel only.
function featherAlpha(data: Uint8Array, width: number, height: number, radius: number): void {
  if (radius <= 0) return
  const sigma = radius
  const reach = Math.max(1, Math.ceil(sigma * 3))
  const kernel = new Float64Array(reach * 2 + 1)
  let sum = 0
  for (let k = -reach; k <= reach; k++) {
    const w = Math.exp(-(k * k) / (2 * sigma * sigma))
    kernel[k + reach] = w
    sum += w
  }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum

  const alpha = new Float64Array(width * height)
  for (let p = 0; p < width * height; p++) alpha[p] = data[p * 4 + 3]
  const tmp = new Float64Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -reach; k <= reach; k++) acc += alpha[y * width + clampIndex(x + k, width)] * kernel[k + reach]
      tmp[y * width + x] = acc
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = -reach; k <= reach; k++) acc += tmp[clampIndex(y + k, height) * width + x] * kernel[k + reach]
      data[(y * width + x) * 4 + 3] = clampChannel(acc)
    }
  }
}

function clampIndex(value: number, size: number): number {
  return value < 0 ? 0 : value >= size ? size - 1 : value
}

// ---- key color sampling ----

// Estimate the flat background color from the image border (or corners) as the per-channel median,
// so keying tolerates the model rendering a slightly off shade of the requested chroma color.
function sampleBorderKey(data: Uint8Array, width: number, height: number, mode: "border" | "corners"): Color {
  const reds: number[] = []
  const greens: number[] = []
  const blues: number[] = []
  const push = (x: number, y: number) => {
    const o = (y * width + x) * 4
    reds.push(data[o])
    greens.push(data[o + 1])
    blues.push(data[o + 2])
  }

  if (mode === "corners") {
    const patch = Math.max(1, Math.min(width, height, 12))
    const boxes: [number, number, number, number][] = [
      [0, 0, patch, patch],
      [width - patch, 0, width, patch],
      [0, height - patch, patch, height],
      [width - patch, height - patch, width, height],
    ]
    for (const [left, top, right, bottom] of boxes)
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) push(x, y)
  } else {
    const band = Math.max(1, Math.min(width, height, 6))
    const step = Math.max(1, Math.floor(Math.min(width, height) / 256))
    for (let x = 0; x < width; x += step)
      for (let y = 0; y < band; y++) {
        push(x, y)
        push(x, height - 1 - y)
      }
    for (let y = 0; y < height; y += step)
      for (let x = 0; x < band; x++) {
        push(x, y)
        push(width - 1 - x, y)
      }
  }

  if (reds.length === 0) throw new Error("could not sample chroma-key color from image border")
  return [median(reds), median(greens), median(blues)]
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

export * as Chroma from "./chroma"
