import type { Message, Provider, SessionModelUsage } from "../types/messages"

const DATE_SUFFIX = /(?:-(?:20\d{6}|20\d{2}-\d{2}-\d{2}))(?:-v\d+(?::\d+)?)?$/i

export type TokenSummary = { input: number; output: number; cached: number }

export type TurnModel = { providerID: string; modelID: string; variant?: string }

/**
 * The model behind a session's active or latest turn.
 *
 * The newest message wins. A user message exists before its reply, so a task
 * resumed on another model shows the new model as soon as the turn starts.
 * The backend copies the user variant onto the reply and stores the default
 * effort as no variant or `default`, which both mean "no variant" here.
 */
export function turnModel(messages: Message[]): TurnModel | undefined {
  const last = messages.findLast((msg) => (msg.role === "assistant" ? !!msg.providerID && !!msg.modelID : !!msg.model))
  if (!last) return undefined
  const model =
    last.role === "assistant" && last.providerID && last.modelID
      ? { providerID: last.providerID, modelID: last.modelID, variant: last.variant }
      : last.model
  if (!model) return undefined
  const variant = model.variant && model.variant !== "default" ? model.variant : undefined
  return { providerID: model.providerID, modelID: model.modelID, ...(variant ? { variant } : {}) }
}

export function isSameSessionTree(
  current: string,
  sessionID: string,
  get: (id: string) => { parentID?: string | null } | undefined,
  parentID?: string | null,
) {
  const top = (start: string, first?: string | null): string => {
    const seen = new Set<string>()
    const visit = (id: string, parent?: string | null): string => {
      if (seen.has(id)) return start
      seen.add(id)
      const next = parent ?? get(id)?.parentID
      return next ? visit(next) : id
    }
    return visit(start, first)
  }
  return top(current) === top(sessionID, parentID)
}

export function hasModelUsage(usage: SessionModelUsage | undefined): usage is SessionModelUsage {
  if (!usage) return false
  const tokens = usage.totals.tokens
  return (
    usage.models.length > 0 ||
    usage.totals.steps > 0 ||
    usage.totals.cost > 0 ||
    tokens.input > 0 ||
    tokens.output > 0 ||
    tokens.reasoning > 0 ||
    tokens.cache.read > 0 ||
    tokens.cache.write > 0
  )
}

export function tokenSummary(usage: SessionModelUsage): TokenSummary {
  return {
    input: usage.totals.tokens.input,
    output: usage.totals.tokens.output,
    cached: usage.totals.tokens.cache.read,
  }
}

export function cacheRate(model: SessionModelUsage["models"][number]) {
  const total = model.tokens.input + model.tokens.cache.read + model.tokens.cache.write
  if (total === 0) return "-"
  return `${((model.tokens.cache.read / total) * 100).toFixed(1)}%`
}

export function groupModelUsage(models: SessionModelUsage["models"], providers: Record<string, Provider>) {
  const groups = new Map<string, { providerID: string; providerName: string; models: SessionModelUsage["models"] }>()
  for (const model of models) {
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: providers[model.providerID]?.name ?? model.providerID,
      models: [],
    }
    group.models.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.values()]
}

export function modelUsageName(
  model: Pick<SessionModelUsage["models"][number], "providerID" | "modelID">,
  providers: Record<string, Provider>,
) {
  const provider = providers[model.providerID]
  const id = model.modelID.replace(DATE_SUFFIX, "")
  const name = provider?.models[model.modelID]?.name ?? provider?.models[id]?.name ?? id
  return name
    .replace(/^[^:]+:\s+/, "")
    .replace(/^[^/]+\//, "")
    .replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
    .replace(/^qwen(?=\d)/i, "Qwen ")
}
