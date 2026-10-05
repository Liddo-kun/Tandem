// Apply an `LLMRequest.cache` policy by injecting `CacheHint`s onto the parts
// the policy designates. Runs once at compile time, before the per-protocol
// body builder, so the existing inline-hint lowering path handles the rest.
//
// The default `"auto"` shape places breakpoints at the last tool definition,
// the first and last distinct system parts, and the conversation tail. This
// exposes reusable tool, base-agent, project, and session prefixes while
// advancing the tail after each tool result keeps recent conversation prefixes
// reusable during long agent runs.
//
// UPSTREAM-DIVERGENCE: document Tandem's one-hour manual-hint normalization and breakpoint cap.
// Manual `cache: CacheHint` placements count against the four-breakpoint budget;
// auto only fills remaining slots. Tandem's supported one-hour routes normalize
// manual TTLs and trim excess manual markers in provider invalidation order.
import { CacheHint, type CachePolicy, type CachePolicyObject } from "./schema/options.js"
import { LLMRequest, Message, ToolDefinition, type ContentPart, type ToolEntry } from "./schema/messages.js"
import { effortUpdate } from "./effort-updates.js"

const AUTO: CachePolicyObject = {
  tools: true,
  system: true,
  messages: { tail: 1 },
}

const NONE: CachePolicyObject = {}
const BREAKPOINT_CAP = 4
// UPSTREAM-DIVERGENCE: identify Claude's volatile billing block so it never consumes a breakpoint.
const billing = (text: string) => text.startsWith("x-anthropic-billing-header:")

// Resolution rules:
//   - undefined   → "auto" — caching is on by default.
//   - "auto"      → tools + first/last system + final message boundary.
//   - "none"      → no auto placement; manual `CacheHint`s still flow.
//   - object form → exactly what the caller asked for.
const resolve = (policy: CachePolicy | undefined): CachePolicyObject => {
  if (policy === undefined || policy === "auto") return AUTO
  if (policy === "none") return NONE
  return policy
}

// Protocols whose wire format ignores inline cache markers (OpenAI's implicit
// prefix caching, Gemini's implicit + out-of-band CachedContent). Skip the
// whole policy pass for these — emitting hints would be harmless but pointless.
const RESPECTS_INLINE_HINTS = new Set([
  "alibaba-chat",
  "alibaba-messages",
  "anthropic-messages",
  "anthropic-compatible-messages",
  "cloudflare-ai-gateway-messages",
  "google-vertex-messages",
  "meta-messages",
  "minimax-messages",
  "moonshot-messages",
  "zai-coding-messages",
  "bedrock-converse",
  "openrouter",
  "digitalocean",
])

// OpenRouter upstreams other than Anthropic and Alibaba Qwen cache without breakpoints. Gemini uses only the last
// breakpoint, so a conversation-tail breakpoint writes a new cache every step and costs more than none. Qwen ignores
// breakpoints on tool definitions and caches tools with the system prompt.
const QWEN: CachePolicyObject = { system: true, messages: { tail: 1 } }
const openRouterPolicy = (modelID: string): CachePolicyObject => {
  // `~anthropic/claude-sonnet-latest` style IDs are OpenRouter aliases for the latest model in a family.
  const id = modelID.replace(/^~/, "")
  if (id.startsWith("anthropic/")) return AUTO
  if (id.startsWith("qwen/")) return QWEN
  return NONE
}

const makeHint = (ttlSeconds: number | undefined): CacheHint =>
  ttlSeconds !== undefined ? new CacheHint({ type: "ephemeral", ttlSeconds }) : new CacheHint({ type: "ephemeral" })

interface Budget {
  remaining: number
}

const markLastTool = (tools: ReadonlyArray<ToolEntry>, hint: CacheHint, budget: Budget): ReadonlyArray<ToolEntry> => {
  const target = tools.at(-1)
  if (target === undefined) return tools
  if (target.type === "namespace") {
    const nested = markLastTool(target.tools, hint, budget)
    return nested === target.tools ? tools : [...tools.slice(0, -1), { ...target, tools: nested }]
  }
  if (target.cache || budget.remaining === 0) return tools
  budget.remaining -= 1
  return [...tools.slice(0, -1), new ToolDefinition({ ...target, cache: hint })]
}

const countToolHints = (tools: ReadonlyArray<ToolEntry>): number =>
  tools.reduce(
    (count, tool) => count + (tool.type === "tool" ? (tool.cache === undefined ? 0 : 1) : countToolHints(tool.tools)),
    0,
  )

const markSystemBoundaries = (system: LLMRequest["system"], hint: CacheHint, budget: Budget): LLMRequest["system"] => {
  if (system.length === 0) return system
  // UPSTREAM-DIVERGENCE: choose system cache boundaries outside Claude's billing block.
  const first = system.findIndex((part) => !billing(part.text))
  const last = system.findLastIndex((part) => !billing(part.text))
  let changed = false
  const next = system.map((part, index) => {
    // UPSTREAM-DIVERGENCE: use the non-billing boundaries rather than raw array endpoints.
    if ((index !== first && index !== last) || part.cache || budget.remaining === 0) return part
    budget.remaining -= 1
    changed = true
    return { ...part, cache: hint }
  })
  return changed ? next : system
}

const lastIndexOfRole = (messages: ReadonlyArray<Message>, role: Message["role"]): number =>
  messages.findLastIndex((m) => m.role === role)

// Mark the last text part of `messages[index]`. If no text part exists, mark
// the last content part regardless of type — that's the breakpoint position
// in tool-result-only messages too.
const markMessageAt = (
  messages: ReadonlyArray<Message>,
  index: number,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (index < 0 || index >= messages.length) return messages
  const target = messages[index]!
  if (target.content.length === 0) return messages
  const lastTextIndex = target.content.findLastIndex((part) => part.type === "text")
  const markAt = lastTextIndex >= 0 ? lastTextIndex : target.content.length - 1
  const existing = target.content[markAt]!
  if (("cache" in existing && existing.cache) || budget.remaining === 0) return messages
  budget.remaining -= 1
  const nextContent = target.content.map((part, i) => (i === markAt ? ({ ...part, cache: hint } as ContentPart) : part))
  const next = new Message({ ...target, content: nextContent })
  // Single pass over `messages`, substituting the one updated entry. Long
  // conversations call this on every request, so avoid `.map()` here — its
  // closure dispatch and identity copies show up in profiling.
  const result = messages.slice()
  result[index] = next
  return result
}

const markMessages = (
  messages: ReadonlyArray<Message>,
  strategy: NonNullable<CachePolicyObject["messages"]>,
  hint: CacheHint,
  budget: Budget,
): ReadonlyArray<Message> => {
  if (messages.length === 0) return messages
  if (strategy === "latest-user-message")
    return markMessageAt(messages, lastIndexOfRole(messages, "user"), hint, budget)
  if (strategy === "latest-assistant")
    return markMessageAt(messages, lastIndexOfRole(messages, "assistant"), hint, budget)
  let start = messages.length
  let remaining = strategy.tail
  while (remaining > 0 && start > 0) {
    start -= 1
    if (effortUpdate(messages[start]!) === undefined) remaining -= 1
  }
  let next = messages
  for (let i = start; i < messages.length; i++)
    if (effortUpdate(messages[i]!) === undefined) next = markMessageAt(next, i, hint, budget)
  return next
}

const countHints = (request: LLMRequest) =>
  countToolHints(request.tools) +
  request.system.reduce((count, part) => count + (part.cache === undefined ? 0 : 1), 0) +
  request.messages.reduce(
    (count, message) =>
      count +
      message.content.reduce(
        (contentCount, part) => contentCount + ("cache" in part && part.cache !== undefined ? 1 : 0),
        0,
      ),
    0,
  )

export const applyCachePolicy = (request: LLMRequest): LLMRequest => {
  if (!RESPECTS_INLINE_HINTS.has(request.model.route.id)) return request
  // UPSTREAM-DIVERGENCE: normalize supported routes to one-hour hints and exclude billing breakpoints.
  const hour = request.model.route.id !== "bedrock-converse" &&
    (request.model.id.toLowerCase().includes("claude") || ["openrouter", "alibaba-chat", "alibaba-messages"].includes(request.model.route.id))
  if (hour) {
    // Normalize manual hints too, in provider invalidation order. OpenRouter's
    // chat lowering does not have Anthropic's separate four-breakpoint limiter.
    const budget = { remaining: BREAKPOINT_CAP }
    const hint = (cache: CacheHint | undefined) => cache && budget.remaining-- > 0 ? makeHint(3600) : undefined
    const tools = (items: ReadonlyArray<ToolEntry>): ReadonlyArray<ToolEntry> => items.map((tool) =>
      tool.type === "namespace" ? { ...tool, tools: tools(tool.tools) } : tool.cache ? new ToolDefinition({ ...tool, cache: hint(tool.cache) }) : tool)
    const normalizedTools = tools(request.tools)
    const system = request.system.map((part) => ({ ...part, cache: billing(part.text) ? undefined : hint(part.cache) }))
    const messages = request.messages.map((message) => new Message({ ...message, content: message.content.map((part) =>
      "cache" in part && part.cache ? { ...part, cache: hint(part.cache) } : part) }))
    request = LLMRequest.update(request, { tools: normalizedTools, system, messages })
  }
  // The per-request billing hash is never a reusable prefix breakpoint, even if manually marked.
  if (request.system.some((part) => billing(part.text) && part.cache))
    request = LLMRequest.update(request, { system: request.system.map((part) => billing(part.text) ? { ...part, cache: undefined } : part) })
  const policy =
    request.model.route.id === "openrouter" && (request.cache === undefined || request.cache === "auto")
      ? openRouterPolicy(request.model.id)
      : request.model.route.id === "alibaba-chat" && (request.cache === undefined || request.cache === "auto")
        ? request.model.id.toLowerCase().startsWith("qwen")
          ? QWEN
          : NONE
        : resolve(request.cache)
  if (!policy.tools && !policy.system && !policy.messages) return request

  // UPSTREAM-DIVERGENCE: automatic hints share the supported route's one-hour TTL.
  const hint = makeHint(hour ? 3600 : policy.ttlSeconds)
  const budget = { remaining: Math.max(0, BREAKPOINT_CAP - countHints(request)) }
  const tools = policy.tools ? markLastTool(request.tools, hint, budget) : request.tools
  const system = policy.system ? markSystemBoundaries(request.system, hint, budget) : request.system
  const messages = policy.messages ? markMessages(request.messages, policy.messages, hint, budget) : request.messages

  if (tools === request.tools && system === request.system && messages === request.messages) return request
  return LLMRequest.update(request, { tools, system, messages })
}
