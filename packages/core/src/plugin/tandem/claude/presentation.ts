export * as ClaudePresentation from "./presentation.js"

import { createHash } from "node:crypto"
import { LanguageModel, LLMRequest, Message, SystemPart, ToolChoice, ToolDefinition, type LLMEvent, type ToolEntry, type ToolResultPart } from "@opencode/ai"
import { Stream } from "effect"

export const isClaude = (id: string) => id.toLowerCase().includes("claude")

const names: Readonly<Record<string, string>> = {
  shell: "Bash", bash: "Bash", read: "Read", edit: "Edit", write: "Write", patch: "Patch",
  question: "AskUserQuestion", subagent: "Agent", task: "Agent", skill: "Skill",
  glob: "Glob", grep: "Grep", webfetch: "WebFetch", websearch: "WebSearch",
}
const keys: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  read: { path: "file_path", filePath: "file_path" },
  write: { path: "file_path", filePath: "file_path" },
  edit: { path: "file_path", filePath: "file_path", oldString: "old_string", newString: "new_string", replaceAll: "replace_all" },
  grep: { include: "glob" }, skill: { id: "skill", name: "skill" },
  shell: { background: "run_in_background" }, bash: { background: "run_in_background" },
  subagent: { agent: "subagent_type", background: "run_in_background" }, task: { agent: "subagent_type", background: "run_in_background" },
}
const nameFor = (name: string) => names[name] ?? name.charAt(0).toUpperCase() + name.slice(1)
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const rename = (value: unknown, mapping: Readonly<Record<string, string>>) =>
  record(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [mapping[key] ?? key, item])) : value

/** Only explicit tool references are prose, never embedded Code Mode paths/programs. */
export function references(text: string) {
  return executeReferences(Object.entries(names).reduce((text, [from, to]) =>
    text.replaceAll(`${from} tool`, `${to} tool`).replaceAll(`${from.charAt(0).toUpperCase() + from.slice(1)} tool`, `${to} tool`), text))
}

export function executeReferences(text: string) {
  return text
    .replaceAll("`execute` tool", "`Execute` tool")
    .replaceAll("to `execute`", "to `Execute`")
    .replaceAll("inside `execute`", "inside `Execute`")
    .replaceAll("Inside `execute`", "Inside `Execute`")
    .replaceAll("call `execute`", "call `Execute`")
    .replaceAll("consider using `execute` to call `tools.opencode.session_move`", "consider using `Execute` to call `tools.opencode.session_move`")
}

/** Added to a Claude Bash result when its saved working directory had disappeared. */
export const workdirReset = (folder: string) =>
  `The working directory ${folder} no longer exists, so this command ran in the session's starting directory.`
const RESET = /^The working directory .* no longer exists, so this command ran in the session's starting directory\.$/s

/**
 * Claude Code's Bash results: trimmed output, its empty-output text, and a failed exit reported as an error that leads
 * with the exit code. Timeouts, kills and background notices keep Tandem's wording.
 */
function bashResult(part: ToolResultPart): ToolResultPart {
  const texts = part.result.type === "text" && typeof part.result.value === "string"
    ? [part.result.value]
    : part.result.type === "content" && part.result.value.every((item) => item.type === "text")
      ? part.result.value.map((item) => item.text)
      : []
  const note = texts.length > 1 && RESET.test(texts.at(-1)!) ? texts.pop() : undefined
  const [output, notice] = texts
  const exit = notice === undefined ? undefined : /^Exited with code (\d+)$/.exec(notice)?.[1]
  if (output === undefined || texts.length > 2 || (notice !== undefined && exit === undefined)) return part
  const text = output === "(no output)" ? "" : output.trimEnd()
  const value = (exit !== undefined ? [`Exit code ${exit}`, text].filter(Boolean).join("\n") : text || "(Bash completed with no output)")
  return { ...part, result: { type: exit !== undefined ? "error" : "text", value: note ? `${value}\n\n${note}` : value } }
}

/** Claude Code's tool_result key order: errors lead with type, Bash results with tool_use_id, and Bash always sends is_error. */
export function toolResultBody(body: string) {
  if (!body.includes('"tool_result"')) return body
  const parsed = (() => {
    try {
      return JSON.parse(body) as unknown
    } catch {
      return undefined
    }
  })()
  if (!record(parsed) || !Array.isArray(parsed.messages)) return body
  const bash = new Set<unknown>()
  for (const message of parsed.messages)
    if (record(message) && Array.isArray(message.content))
      for (const block of message.content)
        if (record(block) && block.type === "tool_use" && block.name === "Bash") bash.add(block.id)
  for (const message of parsed.messages) {
    if (!record(message) || !Array.isArray(message.content)) continue
    message.content = message.content.map((block: unknown) => {
      if (!record(block) || block.type !== "tool_result") return block
      const { type, tool_use_id, content, is_error, ...rest } = block
      if (is_error === true) return { type, content, is_error, tool_use_id, ...rest }
      if (bash.has(tool_use_id)) return { tool_use_id, type, content, is_error: false, ...rest }
      return block
    })
  }
  return JSON.stringify(parsed)
}

/** Request-local native presentation. The canonical execution snapshot is never mutated. */
export function request(input: LLMRequest, selectedClaude = isClaude(input.model.id), roles?: ReadonlyMap<string, { readonly name: string }>): LLMRequest {
  if (!selectedClaude) return input
  const reverse = new Map<string, { name: string; keys: Record<string, string> }>()
  const outbound = new Map<string, { name: string; keys: Record<string, string> }>()
  const definitions = (tools: ReadonlyArray<ToolEntry>): ReadonlyArray<ToolEntry> => tools.map((tool) => {
    if (tool.type === "namespace") return tool // Native namespaces and hosted tools retain their protocol contracts.
    if (tool.native) return tool
    const role = roles?.get(tool.name)?.name ?? tool.name
    const mapping = Object.fromEntries(Object.entries(keys[role] ?? {}).filter(([key]) =>
      record(tool.inputSchema.properties) && Object.hasOwn(tool.inputSchema.properties, key)))
    const name = nameFor(role)
    if (reverse.has(name) || input.tools.some((other) => other.type === "tool" && other.name === name && other.name !== tool.name))
      throw new Error(`Claude tool presentation collision: ${name}`)
    outbound.set(tool.name, { name, keys: mapping })
    outbound.set(role, { name, keys: mapping })
    reverse.set(name, { name: role, keys: Object.fromEntries(Object.entries(mapping).map(([a, b]) => [b, a])) })
    const properties = tool.inputSchema.properties
    // Plain-word keys ("agent", "background") also occur in prose; only their `key=` form is renamed.
    const description = (text: string) => Object.entries(mapping).reduce((text, [from, to]) =>
      ["filePath", "oldString", "newString", "replaceAll"].includes(from) ? text.replaceAll(from, to) : text.replaceAll(`(${from}=`, `(${to}=`), references(text))
    return new ToolDefinition({
      ...tool, name,
      description: description(tool.description),
      inputSchema: {
        ...tool.inputSchema,
        ...(record(properties) ? { properties: Object.fromEntries(Object.entries(properties).map(([key, value]) => [mapping[key] ?? key, record(value) && typeof value.description === "string" ? { ...value, description: description(value.description) } : value])) } : {}),
        ...(Array.isArray(tool.inputSchema.required) ? { required: tool.inputSchema.required.map((key) => typeof key === "string" ? mapping[key] ?? key : key) } : {}),
      },
    })
  })
  const tools = definitions(input.tools)
  const messages = input.messages.map((message) => new Message({ ...message, content: message.content.map((part) => {
    if ((part.type !== "tool-call" && part.type !== "tool-result") || part.providerExecuted || part.namespace) return part
    // Historical local tools may no longer be in today's catalog. Keep their call/result pair coherent.
    const mapping = outbound.get(part.name)
    const name = mapping?.name ?? nameFor(part.name)
    return part.type === "tool-call"
      ? { ...part, name, input: rename(part.input, mapping?.keys ?? keys[part.name] ?? {}) }
      : name === "Bash" ? bashResult({ ...part, name }) : { ...part, name }
  }) }))
  const inbound = (event: LLMEvent): LLMEvent => {
    if (!event.type.startsWith("tool-") || !("name" in event) || ("providerExecuted" in event && event.providerExecuted) || ("namespace" in event && event.namespace)) return event
    const mapping = reverse.get(event.name)
    if (!mapping) return event
    if (event.type === "tool-call" || event.type === "tool-input-delta")
      return { ...event, name: mapping.name, ...(event.input === undefined ? {} : { input: rename(event.input, mapping.keys) }) }
    return { ...event, name: mapping.name }
  }
  // Wrap common structured events after protocol parsing, before ALL consumers (including generate).
  // Raw deltas, result payloads, provider metadata, thinking and signatures pass through untouched.
  const route = input.model.route
  const model = LanguageModel.update(input.model, { route: {
    ...route,
    streamPrepared: (...args) => route.streamPrepared(...args).pipe(Stream.map(inbound)),
  } })
  const first = messages.find((message) => message.role === "user")
  const text = first?.content.find((part) => part.type === "text")?.text ?? ""
  const chars = [4, 7, 20].map((index) => text[index] || "0").join("")
  const suffix = createHash("sha256").update(`59cf53e54c78${chars}2.1.280`).digest("hex").slice(0, 3)
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 5)
  return LLMRequest.update(input, {
    model, tools, messages,
    system: [SystemPart.make(`x-anthropic-billing-header: cc_version=2.1.280.${suffix}; cc_entrypoint=cli; cch=${hash};`), ...input.system.map((part) => ({ ...part, text: executeReferences(part.text) }))],
    toolChoice: input.toolChoice?.name ? new ToolChoice({ ...input.toolChoice, name: outbound.get(input.toolChoice.name)?.name ?? input.toolChoice.name }) : input.toolChoice,
    providerOptions: { ...input.providerOptions, clearThinking: true },
  })
}
