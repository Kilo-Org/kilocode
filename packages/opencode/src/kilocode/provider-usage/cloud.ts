import {
  getAutoTopUpState,
  getCodingPlanUsage,
  listByokEntries,
  listCodingPlanSubscriptions,
  type AutoTopUpState,
  type ByokEntry,
  type CodingPlanSubscription,
} from "@kilocode/kilo-gateway"
import type { KiloBilling, UsageSnapshot } from "./schema"
import { decode } from "@/kilocode/provider/minimax/native"
import { normalize } from "@/kilocode/provider/minimax/usage"

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
    safe(getAutoTopUpState(token)),
    safe(listCodingPlanSubscriptions(token)),
    safe(listByokEntries(token)),
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
            thresholdDollars: state.topup.value.thresholdDollars,
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
    (item) => item.provider_id === subscription.providerId && item.management_source === "coding_plan" && item.is_enabled,
  )
}

export function plans(state: CloudState) {
  if (!state.plans.ok) return []
  return state.plans.value
    .filter(
      (item) =>
        item.planId.startsWith("minimax-token-plan-") &&
        item.providerId === "minimax" &&
        (item.status === "active" || item.status === "past_due") &&
        installed(item, state.byok),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function managed(
  token: string,
  subscription: CodingPlanSubscription,
): Promise<UsageSnapshot> {
  const fetchedAt = new Date().toISOString()
  const planState = subscription.cancelAtPeriodEnd
    ? "canceling"
    : subscription.status === "past_due"
      ? "past_due"
      : "active"
  const id = `kilo-managed-minimax:${subscription.id}`
  const managementUrl = `${base()}/subscriptions/coding-plans/${subscription.id}`

  return getCodingPlanUsage(token, subscription.id)
    .then((usage) => {
      const native = decode(usage.native)
      if (native.base_resp.status_code !== 0) throw new Error("MiniMax application error")
      return normalize(native, {
        id,
        providerID: "minimax",
        sourceKind: "kilo_managed",
        providerLabel: subscription.providerName,
        planLabel: subscription.planName,
        sourceLabel: "via Kilo",
        managementUrl,
        fetchedAt: usage.fetchedAt,
        planID: subscription.planId,
        routingState: "active",
        planState,
      })
    })
    .catch(() => ({
      id,
      providerID: "minimax",
      sourceKind: "kilo_managed",
      providerLabel: subscription.providerName,
      planLabel: subscription.planName,
      sourceLabel: "via Kilo",
      fetchState: "unavailable",
      planState,
      routingState: "active",
      availabilityState: "unavailable",
      fetchedAt,
      confidence: "high",
      source: "cloud",
      managementUrl,
      windows: [],
      balances: [],
      credits: [],
      error: error("managed_minimax_unavailable", "Usage unavailable."),
    }))
}
