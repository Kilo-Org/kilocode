import type { KilocodeSessionModelUsageResponse, Session, StepFinishPart } from "@kilocode/sdk/v2"

export type SessionModelUsage = KilocodeSessionModelUsageResponse
export type UsageResult = { sessionID: string; data?: SessionModelUsage }

export type StepMetrics = NonNullable<StepFinishPart["metrics"]>
export type AggregatedMetrics = { prompt?: number; generation?: number }

export function select(result: UsageResult | undefined, sessionID: string) {
  if (result?.sessionID !== sessionID) return undefined
  return result.data
}

export function failed(result: UsageResult | undefined, sessionID: string) {
  return result?.sessionID === sessionID && !result.data
}

export function isSessionTreeMember(input: {
  root: string
  sessionID: string
  get: (sessionID: string) => Session | undefined
  info?: Session
}) {
  const seen = new Set<string>()
  const visit = (sessionID: string, info?: Session): boolean => {
    if (sessionID === input.root) return true
    if (seen.has(sessionID)) return false
    seen.add(sessionID)
    const session = info ?? input.get(sessionID)
    if (!session?.parentID) return false
    return visit(session.parentID)
  }
  return visit(input.sessionID, input.info)
}

export function groupModelsByProvider(
  models: SessionModelUsage["models"],
  providers: ReadonlyArray<{ id: string; name: string }>,
) {
  const names = new Map(providers.map((provider) => [provider.id, provider.name]))
  const groups = new Map<string, { providerID: string; providerName: string; models: SessionModelUsage["models"] }>()
  for (const model of models) {
    const group = groups.get(model.providerID) ?? {
      providerID: model.providerID,
      providerName: names.get(model.providerID) ?? model.providerID,
      models: [],
    }
    group.models.push(model)
    groups.set(model.providerID, group)
  }
  return [...groups.values()]
}

const count = new Intl.NumberFormat("en-US")
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})
const throughput = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatCount(value: number) {
  return count.format(value)
}

export function formatRate(tokens: SessionModelUsage["totals"]["tokens"]) {
  const total = tokens.input + tokens.cache.read + tokens.cache.write
  if (total === 0) return "-"
  return `${((tokens.cache.read / total) * 100).toFixed(1)}%`
}

export function formatPP(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return "-"
  return `${throughput.format(value)} t/s`
}

export function formatTG(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return "-"
  return `${throughput.format(value)} t/s`
}

export function formatCost(input: number) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  return currency.format(value)
}

// Local aggregation of step-finish metrics for the sidebar/usage panel.
// We weight by generated tokens so longer generations pull the average
// toward their reported rate, matching how llama.cpp's per-call timings
// average into a session-wide figure.
export function aggregateMetrics(
  samples: ReadonlyArray<{ metrics?: StepMetrics; generated: number }>,
): AggregatedMetrics {
  const totals = { promptSum: 0, promptWeight: 0, generationSum: 0, generationWeight: 0 }
  for (const sample of samples) {
    const rate = sample.metrics
    if (!rate) continue
    const weight = sample.generated > 0 ? sample.generated : 0
    if (Number.isFinite(rate.prompt) && (rate.prompt ?? 0) > 0 && weight > 0) {
      totals.promptSum += (rate.prompt as number) * weight
      totals.promptWeight += weight
    }
    if (Number.isFinite(rate.generation) && (rate.generation ?? 0) > 0 && weight > 0) {
      totals.generationSum += (rate.generation as number) * weight
      totals.generationWeight += weight
    }
  }
  const prompt = totals.promptWeight > 0 ? totals.promptSum / totals.promptWeight : undefined
  const generation =
    totals.generationWeight > 0 ? totals.generationSum / totals.generationWeight : undefined
  return {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(generation !== undefined ? { generation } : {}),
  }
}

export function hasMetrics(value: AggregatedMetrics | undefined): value is AggregatedMetrics {
  return value !== undefined && (value.prompt !== undefined || value.generation !== undefined)
}
