import { buildKiloHeaders } from "../headers.js"
import type { KiloPassState } from "../types.js"
import { KILO_API_BASE } from "./constants.js"

function record(value: unknown) {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export function parseKiloPassState(value: unknown): KiloPassState | null {
  const item = Array.isArray(value) ? value[0] : value
  const data = record(record(record(item)?.result)?.data)
  const root = record(data?.json) ?? data ?? record(value)
  const sub = record(root?.subscription)
  if (!sub || (sub.currentPeriodBaseCreditsUsd == null && sub.currentPeriodUsageUsd == null)) return null

  const next = sub.nextBillingAt ?? sub.nextRenewalAt
  return {
    currentPeriodBaseCreditsUsd: num(sub.currentPeriodBaseCreditsUsd),
    currentPeriodUsageUsd: num(sub.currentPeriodUsageUsd),
    currentPeriodBonusCreditsUsd: num(sub.currentPeriodBonusCreditsUsd),
    nextBillingAt: typeof next === "string" ? next : null,
  }
}

export async function fetchKiloPassState(token: string): Promise<KiloPassState | null> {
  try {
    const params = new URLSearchParams({ batch: "1", input: JSON.stringify({ "0": null }) })
    const response = await fetch(`${KILO_API_BASE}/api/trpc/kiloPass.getState?${params}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...buildKiloHeaders() },
    })
    if (!response.ok) return null
    return parseKiloPassState(await response.json())
  } catch {
    return null
  }
}
