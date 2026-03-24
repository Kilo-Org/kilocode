import type { AssistantMessage, Message } from "@kilocode/sdk/v2/client"

type Session = {
  id: string
  parentID?: string
}

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
}

type Metrics = {
  totalCost: number
  context: Context | undefined
}

const tokenTotal = (msg: AssistantMessage) => {
  return msg.tokens.input + msg.tokens.output + msg.tokens.reasoning + msg.tokens.cache.read + msg.tokens.cache.write
}

const lastAssistantWithTokens = (messages: Message[]) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue
    if (tokenTotal(msg) <= 0) continue
    return msg
  }
}

const build = (messages: Message[] = [], providers: Provider[] = []): Metrics => {
  const totalCost = messages.reduce((sum, msg) => sum + (msg.role === "assistant" ? msg.cost : 0), 0)
  const message = lastAssistantWithTokens(messages)
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
    },
  }
}

export function collectFamilyMessages(
  sessionID: string,
  sessions: Session[],
  messageMap: Record<string, Message[]>,
): Message[] {
  const childrenByParent = new Map<string, string[]>()
  for (const s of sessions) {
    if (s.parentID) {
      const list = childrenByParent.get(s.parentID)
      if (list) list.push(s.id)
      else childrenByParent.set(s.parentID, [s.id])
    }
  }

  const allMessages: Message[] = []
  const queue = [sessionID]
  const visited = new Set<string>()
  while (queue.length > 0) {
    const sid = queue.pop()!
    if (visited.has(sid)) continue
    visited.add(sid)
    allMessages.push(...(messageMap[sid] ?? []))
    const children = childrenByParent.get(sid)
    if (children) queue.push(...children)
  }
  return allMessages
}

export function getSessionContextMetrics(messages: Message[] = [], providers: Provider[] = []) {
  return build(messages, providers)
}
