import path from "node:path"
import type { PhotonImage } from "@silvia-odwyer/photon-node"
import { fileURLToPath } from "node:url"
import photonWasm from "#photon-wasm"

type PhotonModule = { PhotonImage: typeof PhotonImage }

// UPSTREAM-DIVERGENCE: Tandem-only. Shared lazy loader for the Photon WASM codec (already a
// dependency, used by Image.normalize). Mirrors the wasm-path shim in src/image/image.ts so the
// Bun-compiled single-file binary resolves the embedded wasm; cached so it initializes once per
// process. `??=` avoids clobbering the global if the Image service set it first (both derive the
// same embedded asset path). Used by imagegen.ts for JPEG/WebP chat copies.
let photonPromise: Promise<PhotonModule> | undefined
export function loadPhoton(): Promise<PhotonModule> {
  if (!photonPromise) {
    if (!photonWasm) throw new Error("Image codec unavailable on this runtime")
    ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH ??=
      path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
    photonPromise = import("@silvia-odwyer/photon-node")
  }
  return photonPromise
}

export * as Photon from "./photon.js"
