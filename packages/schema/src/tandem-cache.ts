// Tandem-owned (not in upstream): a request's prompt-cache usage, sent to clients as soon as its response starts.
export * as TandemCache from "./tandem-cache.js"

import { Schema } from "effect"
import { Rpc } from "./rpc.js"

/** Input tokens of one model request: `read` from the prompt cache, `write`n to it, and `input` sent uncached. */
export const Started = Schema.Struct({
  sessionID: Schema.String,
  read: Schema.Number,
  write: Schema.Number,
  input: Schema.Number,
})
export interface Started extends Schema.Schema.Type<typeof Started> {}

export const Definition = Rpc.define({
  id: "tandem.cache",
  methods: {},
  events: {
    started: { schema: Schema.toStandardSchemaV1(Started) },
  },
})
