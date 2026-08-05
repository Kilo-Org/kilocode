import {
  fetchAutoTopUpState,
  fetchByokEntries,
  fetchCodingPlanSubscriptions,
  fetchCodingPlanUsage,
  type AutoTopUpState,
  type ByokEntry,
  type CodingPlanQuotaWindow,
  type CodingPlanSubscription,
} from "@kilocode/kilo-gateway"
import type { KiloBilling, UsageSnapshot, UsageWindow } from "./schema"

export interface CloudState {
  topup: Result<AutoTopUpState>
  plans: Result<CodingPlanSubscription[]>
  byok: Result<ByokEntry[]>
}

type Result<T> = { ok: true; value: T } | { ok: false }

const safe = async <T>(promise: Promise<T>): Promise<Result<T>> =>
  promise.then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  )

export async function load(token: string): Promise<CloudState> {
  const [topup, plans, byok] = await Promise.all([
    safe(fetchAutoTopUpState(token)),
    safe(fetchCodingPlanSubscriptions(token)),
    safe(fetchByokEntries(token)),
  ])
  return { topup, plans, byok }
}

function base() {
  if (!process.env.KILO_API_URL) return "https://app.kilo.ai"
  try {
    return new URL(process.env.KILO_API_URL).origin
  } catch {
    return "https://app.kilo.ai"
  }
}

const error = (code: string, message: string) => ({ code, message, retryable: true })

// Cloud does not expose the auto-top-up trigger; mirror its fixed $5 threshold for display.
const AUTO_TOP_UP_THRESHOLD_CENTS = 500

export function billing(state: CloudState): KiloBilling {
  const url = base()
  return {
    topUpUrl: `${url}/credits`,
    manageUrl: `${url}/subscriptions`,
    ...(state.topup.ok
      ? {
          autoTopUp: {
            enabled: state.topup.value.enabled,
            amountCents: state.topup.value.amountCents,
            thresholdCents: AUTO_TOP_UP_THRESHOLD_CENTS,
            ...(state.topup.value.paymentMethod?.type && { paymentType: state.topup.value.paymentMethod.type }),
            ...(state.topup.value.paymentMethod?.brand && { paymentBrand: state.topup.value.paymentMethod.brand }),
            ...(state.topup.value.paymentMethod?.last4 && { paymentLast4: state.topup.value.paymentMethod.last4 }),
          },
        }
      : { error: error("cloud_auto_top_up_unavailable", "Auto-top-up status is unavailable.") }),
  }
}

function installed(subscription: CodingPlanSubscription, state: Result<ByokEntry[]>) {
  if (!state.ok || !subscription.hasInstalledByokKey) return false
  return state.value.some(
    (item) =>
      item.provider_id === subscription.providerId && item.management_source === "coding_plan" && item.is_enabled,
  )
}

export function plans(state: CloudState) {
  if (!state.plans.ok) return []
  return state.plans.value
    .filter((item) => (item.status === "active" || item.status === "past_due") && installed(item, state.byok))
    .sort((a, b) => a.id.localeCompare(b.id))
}

function durationMs(period: CodingPlanQuotaWindow["period"]) {
  const multipliers = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
  } as const
  if (period.unit === "month") return undefined
  return period.value * multipliers[period.unit]
}

function periodLabel(period: CodingPlanQuotaWindow["period"]) {
  const singular = period.value === 1
  if (period.unit === "hour") return `${period.value}-hour quota`
  if (period.unit === "day") return singular ? "Daily quota" : `${period.value}-day quota`
  if (period.unit === "week") return singular ? "Weekly quota" : `${period.value}-week quota`
  return singular ? "Monthly quota" : `${period.value}-month quota`
}

function window(subscriptionId: string, value: CodingPlanQuotaWindow): UsageWindow {
  const remaining = value.remainingPercent
  const duration = durationMs(value.period)
  return {
    id: `${subscriptionId}:${value.id}`,
    label: periodLabel(value.period),
    resource: "subscription",
    unit: "percent",
    orientation: "remaining_percent",
    used: Math.max(0, 100 - remaining),
    remaining,
    limit: 100,
    ...(duration !== undefined ? { durationMs: duration } : {}),
    resetAt: value.resetsAt,
    state: remaining <= 0 ? "exhausted" : "active",
  }
}

export async function managed(token: string, subscription: CodingPlanSubscription): Promise<UsageSnapshot> {
  const fetchedAt = new Date().toISOString()
  const planState = subscription.cancelAtPeriodEnd
    ? "canceling"
    : subscription.status === "past_due"
      ? "past_due"
      : "active"
  const id = `kilo-managed:${subscription.id}`
  const managementUrl = `${base()}/subscriptions/coding-plans/${subscription.id}`

  return fetchCodingPlanUsage(token, subscription.id)
    .then((usage) => {
      const windows = usage.subscription.windows.map((item) => window(usage.subscription.id, item))
      return {
        id,
        providerID: usage.subscription.providerId,
        sourceKind: "kilo_managed",
        providerLabel: usage.subscription.providerName,
        planLabel: usage.subscription.planName,
        sourceLabel: "via Kilo",
        fetchState: "ready",
        planState,
        routingState: "active",
        fetchedAt: usage.fetchedAt,
        managementUrl,
        windows,
      } satisfies UsageSnapshot
    })
    .catch(() => ({
      id,
      providerID: subscription.providerId,
      sourceKind: "kilo_managed",
      providerLabel: subscription.providerName,
      planLabel: subscription.planName,
      sourceLabel: "via Kilo",
      fetchState: "unavailable",
      planState,
      routingState: "active",
      fetchedAt,
      managementUrl,
      windows: [],
      error: error("managed_subscription_unavailable", "Usage unavailable."),
    }))
}
