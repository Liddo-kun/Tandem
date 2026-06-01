import type {
  JSONSchema7,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { isRecord } from "@/util/record"

type LanguageModelV3Tool = LanguageModelV3FunctionTool | LanguageModelV3ProviderTool

// UPSTREAM-DIVERGENCE: Tandem presents Claude Code's trained tool surface only
// at the AI SDK provider boundary, then maps structured tool calls back before
// opencode validates/executes them. Keep this out of ProviderTransform.message()
// until the native runtime has equivalent request and stream adapters.
const TOOL_NAME_TO_CLAUDE_CODE: Record<string, string> = {
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  // CC 2.1.159 renamed its clarifying-question tool to AskUserQuestion and its
  // subagent tool to Agent; match those so the request fingerprints as the tool
  // surface Opus was trained against. Name-only swap — opencode keeps its own
  // schema/description for these tools.
  question: "AskUserQuestion",
  read: "Read",
  skill: "Skill",
  task: "Agent",
  todowrite: "TodoWrite",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  write: "Write",
}

const TOOL_NAME_FROM_CLAUDE_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_NAME_TO_CLAUDE_CODE).map(([opencode, claude]) => [claude, opencode]),
)

// Parameter key renames presented at the provider boundary and reversed before
// opencode validates/executes the call. Covers two classes:
//   - camelCase -> snake_case (edit/read/write) — Claude Code's actual param keys.
//   - same-concept-different-name (grep include -> glob, skill name -> skill,
//     task background -> run_in_background) — Claude Code names the equivalent
//     param differently; matching it tightens the trained tool fingerprint.
// All renamed keys are top-level so the shallow round-trip (renameKeys) reverses
// them correctly.
const TOOL_INPUT_TO_CLAUDE_CODE: Record<string, Record<string, string>> = {
  edit: { filePath: "file_path", oldString: "old_string", newString: "new_string", replaceAll: "replace_all" },
  read: { filePath: "file_path" },
  write: { filePath: "file_path" },
  grep: { include: "glob" },
  skill: { name: "skill" },
  task: { background: "run_in_background" },
}

// Keys whose opencode name is a plain English word that also appears in the
// tool's description prose (and, for "include"/"background", as a value-style
// reference like `background=true`). Claude Code keeps these words in its own
// prose, so we rename the schema key + round-trip the value but never rewrite
// the description text — a naive global string replace would corrupt it.
const PROSE_UNSAFE_INPUT_KEYS: Record<string, ReadonlySet<string>> = {
  grep: new Set(["include"]),
  skill: new Set(["name"]),
  task: new Set(["background"]),
}

function descriptionKeyMap(opencodeName: string, keyMap: Record<string, string>): Record<string, string> {
  const unsafe = PROSE_UNSAFE_INPUT_KEYS[opencodeName]
  if (!unsafe) return keyMap
  return Object.fromEntries(Object.entries(keyMap).filter(([from]) => !unsafe.has(from)))
}

// Tool-name mentions in description prose (e.g. "use the Task tool") must track
// the renamed tool — Claude is shown `Agent`, so the prose must say "Agent tool",
// not "Task tool". Derived from the rename table so it survives future renames;
// capitalize-only renames (bash -> Bash) produce identical phrases and drop out,
// leaving only genuine renames like task -> Agent and question -> AskUserQuestion.
// The matched phrase ("Task tool") is specific enough that a plain substring
// replace cannot corrupt unrelated prose.
const TOOL_NAME_PROSE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(TOOL_NAME_TO_CLAUDE_CODE)
    .map(([opencode, claude]) => [`${capitalizeName(opencode)} tool`, `${claude} tool`] as const)
    .filter(([from, to]) => from !== to),
)

const decodeJson = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)

function invertKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).map(([from, to]) => [to, from]))
}

function capitalizeName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function uncapitalizeName(name: string) {
  return name.charAt(0).toLowerCase() + name.slice(1)
}

export function toClaudeCodeToolName(name: string): string {
  if (name === "StructuredOutput") return name
  return TOOL_NAME_TO_CLAUDE_CODE[name] ?? capitalizeName(name)
}

export function fromClaudeCodeToolName(name: string): string {
  if (name === "StructuredOutput") return name
  if (name.startsWith("mcp_")) return fromClaudeCodeToolName(name.slice(4))
  return TOOL_NAME_FROM_CLAUDE_CODE[name] ?? uncapitalizeName(name)
}

function renameKeys(value: unknown, keyMap: Record<string, string>): unknown {
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [keyMap[key] ?? key, item]))
}

function rewriteDescriptionKeys(description: unknown, keyMap: Record<string, string>): unknown {
  if (typeof description !== "string") return description
  return Object.entries(keyMap).reduce((result, [from, to]) => result.split(from).join(to), description)
}

// keyMap renames property keys + required entries; proseMap (a subset of keyMap
// that excludes prose-unsafe keys) rewrites embedded description strings.
function rewriteJsonSchemaKeys(
  schema: unknown,
  keyMap: Record<string, string>,
  proseMap: Record<string, string>,
): unknown {
  if (Array.isArray(schema)) return schema.map((item) => rewriteJsonSchemaKeys(item, keyMap, proseMap))
  if (!isRecord(schema)) return schema

  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (key === "description") return [key, rewriteDescriptionKeys(value, proseMap)]
      if (key === "properties" && isRecord(value)) {
        const properties = renameKeys(value, keyMap) as Record<string, unknown>
        return [
          key,
          Object.fromEntries(
            Object.entries(properties).map(([property, propertySchema]) => [
              property,
              rewriteJsonSchemaKeys(propertySchema, keyMap, proseMap),
            ]),
          ),
        ]
      }
      if (key === "required" && Array.isArray(value)) {
        return [key, value.map((item) => (typeof item === "string" ? (keyMap[item] ?? item) : item))]
      }
      return [key, rewriteJsonSchemaKeys(value, keyMap, proseMap)]
    }),
  )
}

export function toolsToClaudeCode(tools: Array<LanguageModelV3Tool> | undefined): Array<LanguageModelV3Tool> | undefined {
  if (!tools) return tools
  return tools.map((tool) => {
    if (tool.type !== "function") return tool
    const opencodeName = fromClaudeCodeToolName(tool.name)
    const keyMap = TOOL_INPUT_TO_CLAUDE_CODE[opencodeName]
    // Every tool's description is rewritten for tool-name prose; param-key prose
    // is merged in only for tools that rename keys. Key sets never overlap.
    const proseMap = { ...TOOL_NAME_PROSE_MAP, ...(keyMap ? descriptionKeyMap(opencodeName, keyMap) : {}) }
    return {
      ...tool,
      name: toClaudeCodeToolName(opencodeName),
      description: rewriteDescriptionKeys(tool.description, proseMap) as string | undefined,
      ...(keyMap ? { inputSchema: rewriteJsonSchemaKeys(tool.inputSchema, keyMap, proseMap) as JSONSchema7 } : {}),
    }
  })
}

export function promptToClaudeCode(prompt: LanguageModelV3Prompt): LanguageModelV3Prompt {
  return prompt.map((message) => {
    if (message.role === "assistant") {
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type === "tool-call") {
            const opencodeName = fromClaudeCodeToolName(part.toolName)
            const keyMap = TOOL_INPUT_TO_CLAUDE_CODE[opencodeName]
            return {
              ...part,
              toolName: toClaudeCodeToolName(opencodeName),
              ...(keyMap ? { input: renameKeys(part.input, keyMap) } : {}),
            }
          }
          if (part.type === "tool-result") {
            return { ...part, toolName: toClaudeCodeToolName(fromClaudeCodeToolName(part.toolName)) }
          }
          return part
        }),
      }
    }
    if (message.role === "tool") {
      return {
        ...message,
        content: message.content.map((part) => {
          if (part.type === "tool-result") {
            return { ...part, toolName: toClaudeCodeToolName(fromClaudeCodeToolName(part.toolName)) }
          }
          return part
        }),
      }
    }
    return message
  })
}

export function toolCallFromClaudeCode(toolName: string, input: string): { toolName: string; input: string } {
  const opencodeName = fromClaudeCodeToolName(toolName)
  const keyMap = TOOL_INPUT_TO_CLAUDE_CODE[opencodeName]
  if (!keyMap) return { toolName: opencodeName, input }
  const decoded = Option.getOrUndefined(decodeJson(input))
  if (decoded === undefined) return { toolName: opencodeName, input }
  return { toolName: opencodeName, input: JSON.stringify(renameKeys(decoded, invertKeys(keyMap))) }
}

export function responseTransform(): TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart> {
  return new TransformStream({
    transform(part, controller) {
      if (part.type === "tool-call") {
        controller.enqueue({ ...part, ...toolCallFromClaudeCode(part.toolName, part.input) })
        return
      }
      if (part.type === "tool-input-start") {
        controller.enqueue({ ...part, toolName: fromClaudeCodeToolName(part.toolName) })
        return
      }
      controller.enqueue(part)
    },
  })
}

export * as ClaudeCodeToolDisguise from "./claude-code-tool-disguise"
