import path from "node:path"
import { fileURLToPath } from "node:url"
import photonWasm from "@silvia-odwyer/photon-node/photon_rs_bg.wasm" with { type: "file" }

// UPSTREAM-DIVERGENCE: Tandem-only. Shared lazy loader for the Photon WASM codec (already a
// dependency, used by Image.normalize). Mirrors the wasm-path shim in src/image/image.ts so the
// Bun-compiled single-file binary resolves the embedded wasm; cached so it initializes once per
// process. `??=` avoids clobbering the global if the Image service set it first (both derive the
// same embedded asset path). Used by imagegen.ts (JPEG/WebP chat copies) and chroma.ts.
let photonPromise: Promise<typeof import("@silvia-odwyer/photon-node")> | undefined
export function loadPhoton(): Promise<typeof import("@silvia-odwyer/photon-node")> {
  if (!photonPromise) {
    ;(globalThis as typeof globalThis & { __OPENCODE_PHOTON_WASM_PATH?: string }).__OPENCODE_PHOTON_WASM_PATH ??=
      path.isAbsolute(photonWasm) ? photonWasm : fileURLToPath(new URL(photonWasm, import.meta.url))
    photonPromise = import("@silvia-odwyer/photon-node")
  }
  return photonPromise
}

export * as Photon from "./photon"
