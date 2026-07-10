import type { Provider, SessionModelUsage } from "../types/messages"

const DATE_SUFFIX = /(?:-(?:20\d{6}|20\d{2}-\d{2}-\d{2}))(?:-v\d+(?::\d+)?)?$/i

export type TokenSummary = { input: number; output: number; cached: number }

export function formatCost(input: number, formatter: Intl.NumberFormat) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  if (value > 0 && value < 0.000001) return "<$0.000001"
  return formatter.format(value)
}

export function formatSummaryCost(input: number, locale: string) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function summaryCost(
  sessionID: string | undefined,
  usage: SessionModelUsage | undefined,
  fallback: () => Array<{ cost: number }>,
) {
  if (sessionID?.startsWith("cloud:")) return fallback().reduce((sum, item) => sum + item.cost, 0)
  return usage?.totals.cost
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

export function modelUsageName(model: SessionModelUsage["models"][number], providers: Record<string, Provider>) {
  const provider = providers[model.providerID]
  const id = model.modelID.replace(DATE_SUFFIX, "")
  const name = provider?.models[model.modelID]?.name ?? provider?.models[id]?.name ?? id
  return name
    .replace(/^[^:]+:\s+/, "")
    .replace(/^[^/]+\//, "")
    .replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
    .replace(/^qwen(?=\d)/i, "Qwen ")
}
