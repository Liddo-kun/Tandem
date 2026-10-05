// Tandem-owned (not in upstream): shared auxiliary-agent and Corrector metadata contracts.
export * as TandemAuxiliary from "./tandem-auxiliary.js"

import { Option, Schema } from "effect"

// Browser-safe shared contract. Session IDs stay strings here to avoid a dependency on Schema.
export const correctorAgent = "tandem-corrector"
export const readerAgent = "web-fetcher"
export const fetchTool = "fetch_page"

export const Role = Schema.Literals(["corrector", "browser-reader"])
export type Role = typeof Role.Type

export const Metadata = Schema.Struct({
  tandemAuxiliary: Role,
  tandemBareContext: Schema.Literal(true),
  tandemCorrectorDisabled: Schema.Literal(true),
  tandemAuxiliaryOwner: Schema.String.check(Schema.isMinLength(1)),
})
export type Metadata = typeof Metadata.Type

/** Half-open UTF-16 offsets in PromptInput.text; consumers also validate bounds and nonoverlap. */
export const CorrectorRange = Schema.Struct({
  start: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  end: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
export type CorrectorRange = typeof CorrectorRange.Type

export const CorrectorMetadata = Schema.Struct({
  tandemCorrectorDisabled: Schema.optional(Schema.Boolean),
  tandemPromptCorrectorOriginal: Schema.optional(Schema.String),
  tandemPromptCorrectorRanges: Schema.optional(Schema.Array(CorrectorRange)),
  /** SHA-256 of the correctable text/ranges after processing, including unchanged/rejected results. */
  tandemPromptCorrectorProcessed: Schema.optional(Schema.String),
})
export type CorrectorMetadata = typeof CorrectorMetadata.Type

const decodeCorrectorMetadata = Schema.decodeUnknownOption(CorrectorMetadata)
export function readCorrectorMetadata(metadata: unknown) {
  return Option.getOrUndefined(decodeCorrectorMetadata(metadata ?? {}))
}

export function isBareContext(metadata: Readonly<Record<string, unknown>> | undefined) {
  return metadata?.tandemBareContext === true
}
