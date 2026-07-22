import type { KilocodeSessionModelUsageResponse, Session, StepFinishPart } from "@kilocode/sdk/v2"

export type SessionModelUsage = KilocodeSessionModelUsageResponse
export type UsageResult = { sessionID: string; data?: SessionModelUsage }

export type StepMetrics = NonNullable<StepFinishPart["metrics"]>
export type AggregatedMetrics = { generation?: number }

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

// Throughput label used by the sidebar / usage panel. Centralized here so a
// future i18n sweep only touches one file — the opencode CLI does not yet
// wire a translation layer, so today this is a literal English label.
// PP (prompt-processing) is intentionally omitted: llama.cpp's
// `prompt_per_second` is dropped upstream by the AI SDK adapter before it
// reaches providerMetadata, so the current build can only emit the
// generation rate. The PP row lands alongside generation speed once the
// upstream metadataExtractor wiring ships.
export const throughputLabel = {
  generation: "Generation speed",
} as const

export function formatCost(input: number) {
  const value = Math.max(0, Number.isFinite(input) ? input : 0)
  return currency.format(value)
}

// Local aggregation of step-finish metrics for the sidebar/usage panel.
//
// We surface the *most recent* generation rate (last non-empty sample wins)
// so the displayed figure tracks the latest assistant turn the user is
// waiting on rather than a weighted session-wide average that drifts toward
// long-ago turns. Steps with no generated output (e.g. tool-only steps)
// contribute nothing — they simply don't replace the running snapshot.
export function aggregateMetrics(
  samples: ReadonlyArray<{ metrics?: StepMetrics; generated: number }>,
): AggregatedMetrics {
  let generation: number | undefined
  for (const sample of samples) {
    const metrics = sample.metrics
    if (!metrics) continue
    const value = metrics.generation
    if (value === undefined) continue
    if (!Number.isFinite(value) || (value as number) <= 0) continue
    if ((sample.generated ?? 0) <= 0) continue
    generation = value as number
  }
  return {
    ...(generation !== undefined ? { generation } : {}),
  }
}

export function hasMetrics(value: AggregatedMetrics | undefined): value is AggregatedMetrics {
  return value !== undefined && value.generation !== undefined
}
