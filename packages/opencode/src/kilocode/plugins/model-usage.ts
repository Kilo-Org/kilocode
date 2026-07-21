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

export function formatRateValue(value: number | undefined) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return "-"
  return `${throughput.format(value as number)} t/s`
}

// Throughput labels used by the sidebar / usage panel. Centralized here so a
// future i18n sweep only touches one file — the opencode CLI does not yet
// wire a translation layer, so today these are literal English labels.
export const throughputLabel = {
  prompt: "PP",
  generation: "TG",
} as const

export function formatCost(input: number) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  return currency.format(value)
}

// Local aggregation of step-finish metrics for the sidebar/usage panel.
//
// We weight the *generation* rate by generated tokens (longer generations
// pull the average toward their own reported rate). The *prompt* rate comes
// from llama.cpp's `prompt_per_second`, which is a property of the timing
// not the generated output — when a step finishes before tokens are
// emitted (e.g. a tool-only step) the per-step generated count is zero and
// a generated-weighted average would silently drop that step. We fall back
// to a simple mean over the steps that did report a positive prompt rate
// so a zero-weight step still contributes.
export function aggregateMetrics(
  samples: ReadonlyArray<{ metrics?: StepMetrics; generated: number }>,
): AggregatedMetrics {
  let promptSum = 0
  let promptCount = 0
  let generationSum = 0
  let generationWeight = 0
  for (const sample of samples) {
    const metrics = sample.metrics
    if (!metrics) continue
    if (Number.isFinite(metrics.prompt) && (metrics.prompt as number) > 0) {
      promptSum += metrics.prompt as number
      promptCount += 1
    }
    const generated = sample.generated
    if (Number.isFinite(metrics.generation) && (metrics.generation as number) > 0 && generated > 0) {
      generationSum += (metrics.generation as number) * generated
      generationWeight += generated
    }
  }
  const prompt = promptCount > 0 ? promptSum / promptCount : undefined
  const generation = generationWeight > 0 ? generationSum / generationWeight : undefined
  return {
    ...(prompt !== undefined ? { prompt } : {}),
    ...(generation !== undefined ? { generation } : {}),
  }
}

export function hasMetrics(value: AggregatedMetrics | undefined): value is AggregatedMetrics {
  return value !== undefined && (value.prompt !== undefined || value.generation !== undefined)
}
