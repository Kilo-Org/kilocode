import { decode, type ModelRemains, type Native } from "./native"
import type { UsageSnapshot, UsageWindow } from "@/kilocode/provider-usage/schema"
import type { Info as ProviderInfo } from "@/provider/provider"

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

const timeout = 5_000
const limit = 64 * 1024

export class MiniMaxUsageError extends Error {
  constructor(readonly code: "network" | "http" | "too_large" | "invalid" | "application") {
    super("MiniMax usage is temporarily unavailable.")
    this.name = "MiniMaxUsageError"
  }
}

async function text(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => undefined)
    throw new MiniMaxUsageError("too_large")
  }

  if (!response.body) {
    const value = await response.arrayBuffer()
    if (value.byteLength > limit) throw new MiniMaxUsageError("too_large")
    return new TextDecoder().decode(value)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (!chunk.value) continue
    size += chunk.value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new MiniMaxUsageError("too_large")
    }
    chunks.push(chunk.value)
  }

  const value = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    value.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(value)
}

export async function query(providerID: ProviderID, key: string, fetcher: typeof fetch = fetch): Promise<Native> {
  const response = await fetcher(bindings[providerID].url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${key}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => {
    throw new MiniMaxUsageError("network")
  })
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined)
    throw new MiniMaxUsageError("http")
  }

  const body = await text(response)
  const native = (() => {
    try {
      return decode(JSON.parse(body))
    } catch {
      throw new MiniMaxUsageError("invalid")
    }
  })()
  if (native.base_resp.status_code !== 0) throw new MiniMaxUsageError("application")
  return native
}

function reset(end: number | undefined, remains: number | undefined, fetchedAt: string) {
  if (end !== undefined && end > 0) return new Date(end).toISOString()
  if (remains !== undefined && remains > 0) return new Date(Date.parse(fetchedAt) + remains).toISOString()
  return undefined
}

function duration(start: number | undefined, end: number | undefined) {
  if (start === undefined || end === undefined || end <= start) return undefined
  return end - start
}

function label(resource: string, kind: "interval" | "weekly", value: number | undefined) {
  const prefix = resource === "general" ? "Shared quota" : resource === "video" ? "Video" : resource
  if (value === 300 * 60 * 1000) return `${prefix} 5-hour`
  if (value === 10_080 * 60 * 1000) return `${prefix} weekly`
  return kind === "weekly" ? `${prefix} weekly` : `${prefix} interval`
}

function window(
  row: ModelRemains,
  kind: "interval" | "weekly",
  fetchedAt: string,
): { value: UsageWindow; confidence: "high" | "medium" | "low" } | undefined {
  const weekly = kind === "weekly"
  const percent = weekly ? row.current_weekly_remaining_percent : row.current_interval_remaining_percent
  const status = weekly ? row.current_weekly_status : row.current_interval_status
  const total = weekly ? row.current_weekly_total_count : row.current_interval_total_count
  const count = weekly ? row.current_weekly_usage_count : row.current_interval_usage_count
  const start = weekly ? row.weekly_start_time : row.start_time
  const end = weekly ? row.weekly_end_time : row.end_time
  const remains = weekly ? row.weekly_remains_time : row.remains_time
  const boost = weekly
    ? (row.weekly_boost_permille ?? row.weekly_boost_permill)
    : (row.interval_boost_permille ?? row.interval_boost_permill)
  const span = duration(start, end)
  const base = {
    id: `${row.model_name}-${kind}`,
    label: label(row.model_name, kind, span),
    resource: row.model_name,
    kind: "quota" as const,
    durationMs: span,
    resetAt: reset(end, remains, fetchedAt),
  }

  if (status === 3) {
    return {
      value: { ...base, unit: "unknown", orientation: "amount", state: "not_in_plan" },
      confidence: "high",
    }
  }

  if (percent !== undefined) {
    const factor = boost !== undefined && boost > 0 ? boost / 1000 : 1
    const cap = 100 * factor
    const remaining = percent * factor
    return {
      value: {
        ...base,
        unit: factor === 1 ? "percent" : "standard_units",
        orientation: factor === 1 ? "remaining_percent" : "amount",
        used: Math.max(0, cap - remaining),
        remaining,
        limit: cap,
        state: status === 2 || remaining <= 0 ? "exhausted" : "active",
      },
      confidence: "high",
    }
  }

  if (total !== undefined && total > 0 && count !== undefined && count >= 0) {
    return {
      value: {
        ...base,
        unit: "count",
        orientation: "count",
        used: Math.max(0, total - count),
        remaining: count,
        limit: total,
        state: status === 2 || count === 0 ? "exhausted" : "active",
      },
      confidence: "medium",
    }
  }

  if (status === undefined && total === undefined && count === undefined) return undefined
  return {
    value: {
      ...base,
      unit: "unknown",
      orientation: "amount",
      state: status === 2 ? "exhausted" : "unknown",
    },
    confidence: "low",
  }
}

export function normalize(
  native: Native,
  input: {
    id: string
    providerID: string
    sourceKind: "kilo_managed" | "direct"
    providerLabel: string
    planLabel: string
    sourceLabel: string
    managementUrl: string
    fetchedAt: string
    planID?: string
    routingState?: UsageSnapshot["routingState"]
    planState?: UsageSnapshot["planState"]
  },
): UsageSnapshot {
  const rows = native.model_remains
    .filter((row) => row.model_name !== "video")
    .flatMap((row) =>
      (["interval", "weekly"] as const).flatMap((kind) => {
        const value = window(row, kind, input.fetchedAt)
        return value ? [value] : []
      }),
    )
  const windows = rows.map((row) => row.value)
  const availabilityState = windows.some((item) => item.state === "active" || item.state === "unlimited")
    ? "available"
    : windows.some((item) => item.state === "exhausted")
      ? "exhausted"
      : "unknown"
  const confidence = rows.some((row) => row.confidence === "low")
    ? "low"
    : rows.some((row) => row.confidence === "medium")
      ? "medium"
      : "high"

  return {
    id: input.id,
    providerID: input.providerID,
    sourceKind: input.sourceKind,
    providerLabel: input.providerLabel,
    planLabel: input.planLabel,
    sourceLabel: input.sourceLabel,
    fetchState: "ready",
    planState: input.planState ?? "active",
    routingState: input.routingState ?? "not_applicable",
    availabilityState,
    fetchedAt: input.fetchedAt,
    confidence,
    source: input.sourceKind === "kilo_managed" ? "cloud" : "provider_api",
    managementUrl: input.managementUrl,
    windows,
    balances: [],
    credits: [],
  }
}

const unavailable = (id: string, providerID: string, label: string, managementUrl: string): UsageSnapshot => ({
  id,
  providerID,
  sourceKind: "direct",
  providerLabel: "MiniMax",
  planLabel: "MiniMax Token Plan",
  sourceLabel: label,
  fetchState: "unavailable",
  planState: "unknown",
  routingState: "not_applicable",
  availabilityState: "unavailable",
  confidence: "high",
  source: "provider_api",
  managementUrl,
  windows: [],
  balances: [],
  credits: [],
  error: { code: "direct_minimax_unavailable", message: "Usage unavailable.", retryable: true },
})

export async function direct(
  providers: Record<string, ProviderInfo>,
  fetcher: typeof fetch = fetch,
  cached: (id: string, load: () => Promise<UsageSnapshot>) => Promise<UsageSnapshot> = (_id, load) => load(),
) {
  const candidates = (Object.keys(bindings) as ProviderID[]).flatMap((providerID) => {
    const provider = providers[providerID]
    if (!provider) return []
    const value = provider.options.apiKey !== undefined ? provider.options.apiKey : provider.key
    if (typeof value !== "string" || !value.trim().startsWith("sk-cp")) return []
    return [{ providerID, provider, key: value.trim() }]
  })
  const groups = new Map<string, typeof candidates>()
  for (const candidate of candidates) {
    const group = groups.get(candidate.key) ?? []
    group.push(candidate)
    groups.set(candidate.key, group)
  }

  return Promise.all(
    [...groups.values()].map(async (group) => {
      const shared = group.length > 1
      const first = group[0]
      const id = shared ? "minimax-direct-shared" : `minimax-direct-${bindings[first.providerID].region}`
      return cached(id, async () => {
        const responses = await Promise.allSettled(
          group.map((candidate) => query(candidate.providerID, candidate.key, fetcher)),
        )
        const index = responses.findIndex((response) => response.status === "fulfilled")
        if (index === -1) {
          return unavailable(
            id,
            first.providerID,
            shared ? "Direct MiniMax" : first.provider.name,
            bindings[first.providerID].manage,
          )
        }

        const candidate = group[index]
        const response = responses[index]
        if (response.status !== "fulfilled") {
          return unavailable(id, candidate.providerID, "Direct MiniMax", bindings[candidate.providerID].manage)
        }
        return normalize(response.value, {
          id,
          providerID: candidate.providerID,
          sourceKind: "direct",
          providerLabel: "MiniMax",
          planLabel: "MiniMax Token Plan",
          sourceLabel: candidate.provider.name,
          managementUrl: bindings[candidate.providerID].manage,
          fetchedAt: new Date().toISOString(),
        })
      })
    }),
  )
}
