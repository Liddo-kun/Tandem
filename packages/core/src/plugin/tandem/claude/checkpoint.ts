export * as ClaudeCheckpoint from "./checkpoint.js"

import type { Message } from "@opencode/ai"
import type { Model } from "@opencode/schema/model"
import { Schema } from "effect"
import { SessionMessage } from "../../../session/message.js"
import { toLLMMessages } from "../../../session/runner/to-llm-message.js"

/**
 * A Claude Code-style compaction, stored in the compaction message's hidden metadata under `KEY`. Claude
 * compaction writes it; the Claude plugin finds the checkpoint message by it and lays out the new conversation.
 */
export const KEY = "tandem.claude-compaction"

/**
 * Tool-result metadata on read, edit, write and patch calls: each absolute file path the call read or changed, with
 * its modification time in milliseconds just after the call. Restored files are ordered by it.
 */
export const MTIMES = "tandem.mtimes"

export interface Info {
  readonly version: 1
  /** `/compact` is "manual"; automatic and "too long" compactions are "auto". */
  readonly reason: "auto" | "manual"
  /** The summary message as the model reads it. */
  readonly text: string
  /** The kept group: encoded session messages, with any tool results shortened to fit. */
  readonly kept: ReadonlyArray<unknown>
  /** The provider metadata key `kept` was produced under, for lowering it again. */
  readonly providerMetadataKey: string
  /** Restored context in order: files, background tasks, skills note. The baseline is added when laid out. */
  readonly restored: ReadonlyArray<string>
  /** Restore candidates and loaded skills (newest first), carried forward to the next compaction. */
  readonly files: ReadonlyArray<{ readonly path: string; readonly mtime: number }>
  readonly skills: ReadonlyArray<string>
  /** The transcript file, when it was written. */
  readonly transcript?: string
}

export const read = (metadata: Readonly<Record<string, unknown>> | undefined): Info | undefined => {
  const value = metadata?.[KEY]
  return value && typeof value === "object" && (value as { version?: unknown }).version === 1 ? (value as Info) : undefined
}

const encodeMessage = Schema.encodeSync(SessionMessage.Info)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)

/** Session messages as JSON metadata, using JSON's omission of undefined entries. */
export const encodeKept = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<unknown> =>
  JSON.parse(JSON.stringify(messages.map((message) => encodeMessage(message))))

export const decodeKept = (info: Info): ReadonlyArray<SessionMessage.Info> => info.kept.map((message) => decodeMessage(message))

/** The kept group as request messages for `model`. Provider state is replayed only to the model that made it. */
export const keptMessages = (info: Info, model: Model.Ref): Message[] =>
  toLLMMessages(decodeKept(info), model, info.providerMetadataKey)
