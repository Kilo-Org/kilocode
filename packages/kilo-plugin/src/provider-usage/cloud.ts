export * as UsageCloud from "./cloud"

import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"

// Kilo coding plans with their quota windows, as v1 built them (packages/core/src/kilocode/provider-usage/cloud.ts
// on main). The data comes from the `kilocode.gateway` RPC, which owns the Kilo account.

/** Active or past-due plans whose coding plan key is installed and enabled in BYOK, sorted by ID. */
export function plans(
  subscriptions: readonly KiloGatewayRpc.CodingPlanSubscription[],
  byok: readonly KiloGatewayRpc.ByokEntry[],
) {
  return subscriptions
    .filter((item) => item.status === "active" || item.status === "past_due")
    .filter(
      (item) =>
        item.canQueryUsage &&
        item.hasInstalledByokKey &&
        byok.some(
          (entry) =>
            entry.provider_id === item.providerId && entry.management_source === "coding_plan" && entry.is_enabled,
        ),
    )
    .toSorted((a, b) => a.id.localeCompare(b.id))
}

/** The web app origin for plan management: the origin of a custom Kilo API URL, else app.kilo.ai. */
export function app(server: string) {
  if (!URL.canParse(server) || new URL(server).origin === "https://api.kilo.ai") return "https://app.kilo.ai"
  return new URL(server).origin
}

export function snapshot(
  subscription: KiloGatewayRpc.CodingPlanSubscription,
  usage: KiloGatewayRpc.CodingPlanUsage | undefined,
  base: string,
): ProviderUsage.UsageSnapshot {
  const common = {
    id: `kilo-managed:${subscription.id}`,
    sourceKind: "kilo_managed",
    sourceLabel: "via Kilo",
    planState: subscription.cancelAtPeriodEnd
      ? "canceling"
      : subscription.status === "past_due"
        ? "past_due"
        : "active",
    routingState: "active",
    managementUrl: `${base}/subscriptions/coding-plans/${subscription.id}`,
  } as const
  if (!usage)
    return {
      ...common,
      providerID: subscription.providerId,
      providerLabel: subscription.providerName,
      planLabel: subscription.planName,
      fetchState: "unavailable",
      fetchedAt: new Date().toISOString(),
      windows: [],
      error: { code: "managed_subscription_unavailable", message: "Usage unavailable.", retryable: true },
    }
  return {
    ...common,
    providerID: usage.subscription.providerId,
    providerLabel: usage.subscription.providerName,
    planLabel: usage.subscription.planName,
    fetchState: "ready",
    fetchedAt: usage.fetchedAt,
    windows: usage.subscription.windows.map((item) => {
      const duration = item.period.unit === "month" ? undefined : item.period.value * hours[item.period.unit]
      return {
        id: `${usage.subscription.id}:${item.id}`,
        resource: "subscription",
        unit: "percent",
        orientation: "remaining_percent",
        used: Math.max(0, 100 - item.remainingPercent),
        remaining: item.remainingPercent,
        limit: 100,
        period: item.period,
        ...(duration === undefined ? {} : { durationMs: duration * 3_600_000 }),
        resetAt: item.resetsAt,
        state: item.remainingPercent <= 0 ? "exhausted" : "active",
      }
    }),
  }
}

const hours = { hour: 1, day: 24, week: 168 } as const
