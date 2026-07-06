// UPSTREAM-DIVERGENCE: Tandem-only leaf module (image-based context compaction).
// Dependency-free on purpose: message-v2.ts needs PART_MARKER but importing
// compaction-image.ts from there would create an import cycle (compaction-image
// imports message-v2). Both sides import this leaf instead.

/** Marker metadata key on the synthetic text parts of an image compaction
 *  (values: "banner" | "sidecar" | "end"; legacy "factsheet"). */
export const PART_MARKER = "compactionImage"

export * as CompactionImageMarker from "./marker"
