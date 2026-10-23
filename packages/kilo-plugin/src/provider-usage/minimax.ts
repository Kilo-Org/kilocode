export * as MiniMaxUsage from "./minimax"

import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { Schema } from "effect"
import { get, text } from "./http"

// MiniMax Token Plan quota of a MiniMax coding plan provider with an `sk-cp` key. Same request and mapping as v1
// (packages/core/src/kilocode/provider-usage/minimax on main).
export const bindings = {
  "minimax-coding-plan": {
    region: "global",
    url: "https://api.minimax.io/v1/token_plan/remains",
    manage: "https://platform.minimax.io/subscribe/token-plan",
  },
  "minimax-cn-coding-plan": {
    region: "china",
    url: "https://api.minimaxi.com/v1/token_plan/remains",
    manage: "https://platform.minimaxi.com/subscribe/token-plan",
  },
} as const

export type ProviderID = keyof typeof bindings

export interface Candidate {
  providerID: ProviderID
  label: string
  key: string
}

// Matches the cloud schema: remaining percent is a 0-100 share of the base quota; boosts scale it separately.
const Percent = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(100))
const ModelRemains = Schema.Struct({
  model_name: Schema.String,
  current_interval_total_count: Schema.optional(Schema.Int),
  current_interval_usage_count: Schema.optional(Schema.Int),
  start_time: Schema.optional(Schema.Int),
  end_time: Schema.optional(Schema.Int),
  remains_time: Schema.optional(Schema.Int),
  interval_boost_permille: Schema.optional(Schema.Int),
  current_interval_remaining_percent: Schema.optional(Percent),
  current_interval_status: Schema.optional(Schema.Int),
  current_weekly_total_count: Schema.optional(Schema.Int),
  current_weekly_usage_count: Schema.optional(Schema.Int),
  weekly_start_time: Schema.optional(Schema.Int),
  weekly_end_time: Schema.optional(Schema.Int),
  weekly_remains_time: Schema.optional(Schema.Int),
  weekly_boost_permille: Schema.optional(Schema.Int),
  current_weekly_remaining_percent: Schema.optional(Percent),
  current_weekly_status: Schema.optional(Schema.Int),
})
type ModelRemains = typeof ModelRemains.Type
const Native = Schema.Struct({
  base_resp: Schema.Struct({ status_code: Schema.Int }),
  model_remains: Schema.Array(ModelRemains),
})
type Native = typeof Native.Type
const decode = Schema.decodeUnknownSync(Native)

const hourMs = 60 * 60 * 1000
const dayMs = 24 * hourMs
const weekMs = 7 * dayMs

export function load(candidate: Candidate, fetcher: typeof fetch = fetch) {
  const binding = bindings[candidate.providerID]
  const id = `minimax-direct-${binding.region}`
  return query(candidate, fetcher)
    .then((native) =>
      normalize(native, {
        id,
        providerID: candidate.providerID,
        sourceLabel: candidate.label,
        managementUrl: binding.manage,
        fetchedAt: new Date().toISOString(),
      }),
    )
    .catch(
      (): ProviderUsage.UsageSnapshot => ({
        id,
        providerID: candidate.providerID,
        sourceKind: "direct",
        providerLabel: "MiniMax",
        planLabel: "MiniMax Token Plan",
        sourceLabel: candidate.label,
        fetchState: "unavailable",
        planState: "unknown",
        routingState: "not_applicable",
        managementUrl: binding.manage,
        windows: [],
        error: { code: "direct_minimax_unavailable", message: "Usage unavailable.", retryable: true },
      }),
    )
}

async function query(candidate: Candidate, fetcher: typeof fetch) {
  const response = await get(bindings[candidate.providerID].url, { Authorization: `Bearer ${candidate.key}` }, fetcher)
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined)
    throw new Error("MiniMax usage is temporarily unavailable.")
  }
  const native = decode(JSON.parse(await text(response)))
  if (native.base_resp.status_code !== 0) throw new Error("MiniMax usage is temporarily unavailable.")
  return native
}

export function normalize(
  native: Native,
  input: { id: string; providerID: string; sourceLabel: string; managementUrl: string; fetchedAt: string },
): ProviderUsage.UsageSnapshot {
  return {
    id: input.id,
    providerID: input.providerID,
    sourceKind: "direct",
    providerLabel: "MiniMax",
    planLabel: "MiniMax Token Plan",
    sourceLabel: input.sourceLabel,
    fetchState: "ready",
    planState: "active",
    routingState: "not_applicable",
    fetchedAt: input.fetchedAt,
    managementUrl: input.managementUrl,
    windows: native.model_remains
      .filter((row) => row.model_name !== "video")
      .flatMap((row) =>
        (["interval", "weekly"] as const).flatMap((kind) => {
          const value = window(row, kind, input.fetchedAt)
          return value ? [value] : []
        }),
      ),
  }
}

function window(
  row: ModelRemains,
  kind: "interval" | "weekly",
  fetchedAt: string,
): ProviderUsage.UsageWindow | undefined {
  const weekly = kind === "weekly"
  const percent = weekly ? row.current_weekly_remaining_percent : row.current_interval_remaining_percent
  const status = weekly ? row.current_weekly_status : row.current_interval_status
  const total = weekly ? row.current_weekly_total_count : row.current_interval_total_count
  const count = weekly ? row.current_weekly_usage_count : row.current_interval_usage_count
  const start = weekly ? row.weekly_start_time : row.start_time
  const end = weekly ? row.weekly_end_time : row.end_time
  const remains = weekly ? row.weekly_remains_time : row.remains_time
  const boost = weekly ? row.weekly_boost_permille : row.interval_boost_permille
  const span = start !== undefined && end !== undefined && end > start ? end - start : undefined
  const base = {
    id: `${row.model_name}-${kind}`,
    resource: row.model_name,
    period: cadence(kind, span),
    durationMs: span,
    resetAt: reset(end, remains, fetchedAt),
  }

  if (status === 3) return { ...base, unit: "unknown", orientation: "amount", state: "not_in_plan" }

  if (percent !== undefined) {
    const factor = boost !== undefined && boost > 0 ? boost / 1000 : 1
    const cap = 100 * factor
    // The status flag is authoritative: an exhausted window has zero remaining even when the percent field lags.
    const remaining = status === 2 ? 0 : percent * factor
    return {
      ...base,
      unit: factor === 1 ? "percent" : "standard_units",
      orientation: factor === 1 ? "remaining_percent" : "amount",
      used: Math.max(0, cap - remaining),
      remaining,
      limit: cap,
      state: status === 2 || remaining <= 0 ? "exhausted" : "active",
    }
  }

  if (total !== undefined && total > 0 && count !== undefined && count >= 0) {
    // Despite the name, MiniMax's *_usage_count fields report the remaining quota, not the consumed amount.
    const remaining = status === 2 ? 0 : count
    return {
      ...base,
      unit: "count",
      orientation: "count",
      used: Math.max(0, total - remaining),
      remaining,
      limit: total,
      state: status === 2 || remaining === 0 ? "exhausted" : "active",
    }
  }

  if (status === undefined && total === undefined && count === undefined) return undefined
  return { ...base, unit: "unknown", orientation: "amount", state: status === 2 ? "exhausted" : "unknown" }
}

function reset(end: number | undefined, remains: number | undefined, fetchedAt: string) {
  if (end !== undefined && end > 0) return new Date(end).toISOString()
  if (remains !== undefined && remains > 0) return new Date(Date.parse(fetchedAt) + remains).toISOString()
  return undefined
}

function cadence(kind: "interval" | "weekly", span: number | undefined): ProviderUsage.UsagePeriod | undefined {
  if (kind === "weekly") return { unit: "week", value: 1 }
  if (span === undefined) return undefined
  if (span % weekMs === 0) return { unit: "week", value: span / weekMs }
  if (span % dayMs === 0) return { unit: "day", value: span / dayMs }
  if (span % hourMs === 0) return { unit: "hour", value: span / hourMs }
  return undefined
}
