import type { AssistantMessage, Message } from "@opencode-ai/sdk/v2/client"

type Provider = {
  id: string
  name?: string
  models: Record<string, Model | undefined>
}

type Model = {
  name?: string
  limit: {
    context: number
  }
}

type Context = {
  message: AssistantMessage
  provider?: Provider
  model?: Model
  providerLabel: string
  modelLabel: string
  limit: number | undefined
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  total: number
  usage: number | null
  // cache.read + cache.write of the PREVIOUS request, used to score how much of the
  // prior cache survived into this request (read_now / previousCacheTotal).
  previousCacheTotal: number
}

type Metrics = {
  totalCost: number
  context: Context | undefined
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

// Most recent assistant messages that carry token usage, newest first (up to `count`).
const recentAssistantsWithTokens = (messages: Message[], count: number) => {
  const found: AssistantMessage[] = []
  for (let i = messages.length - 1; i >= 0 && found.length < count; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    found.push(msg)
  }
  return found
}

const build = (messages: Message[] = [], providers: Provider[] = []): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const [message, previous] = recentAssistantsWithTokens(messages, 2)
  if (!message) return { totalCost, context: undefined }

  const provider = providers.find((item) => item.id === message.providerID)
  const model = provider?.models[message.modelID]
  const limit = model?.limit.context
  const total = tokenTotal(message)

  return {
    totalCost,
    context: {
      message,
      provider,
      model,
      providerLabel: provider?.name ?? message.providerID,
      modelLabel: model?.name ?? message.modelID,
      limit,
      input: message.tokens.input,
      output: message.tokens.output,
      reasoning: message.tokens.reasoning,
      cacheRead: message.tokens.cache.read,
      cacheWrite: message.tokens.cache.write,
      total,
      usage: limit ? Math.round((total / limit) * 100) : null,
      previousCacheTotal: previous ? previous.tokens.cache.read + previous.tokens.cache.write : 0,
    },
  }
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
