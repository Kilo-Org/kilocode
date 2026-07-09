import {
  getAutoTopUpState,
  getCodingPlanUsage,
  getKiloPassState,
  listByokEntries,
  listCodingPlanSubscriptions,
  type AutoTopUpState,
  type ByokEntry,
  type CodingPlanSubscription,
  type KiloPassUsageState,
} from "@kilocode/kilo-gateway"
import type { KiloBilling, UsageSnapshot } from "./schema"
import { decode } from "@/kilocode/provider/minimax/native"
import { normalize } from "@/kilocode/provider/minimax/usage"

export interface CloudState {
  pass: Result<KiloPassUsageState>
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
  const [pass, topup, plans, byok] = await Promise.all([
    safe(getKiloPassState(token)),
    safe(getAutoTopUpState(token)),
    safe(listCodingPlanSubscriptions(token)),
    safe(listByokEntries(token)),
  ])
  return { pass, topup, plans, byok }
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
            thresholdCents: state.topup.value.thresholdCents,
            ...(state.topup.value.paymentMethod?.type && { paymentType: state.topup.value.paymentMethod.type }),
            ...(state.topup.value.paymentMethod?.brand && { paymentBrand: state.topup.value.paymentMethod.brand }),
            ...(state.topup.value.paymentMethod?.last4 && { paymentLast4: state.topup.value.paymentMethod.last4 }),
          },
        }
      : { error: error("cloud_auto_top_up_unavailable", "Auto-top-up status is unavailable.") }),
  }
}

export function pass(state: CloudState): UsageSnapshot[] {
  if (!state.pass.ok || !state.pass.value.subscription) return []
  const subscription = state.pass.value.subscription
  if (subscription.status === "canceled" || subscription.status === "incomplete_expired") return []

  const bonus = subscription.currentPeriodBonusCreditsUsd ?? 0
  const limit = subscription.currentPeriodBaseCreditsUsd + bonus
  const used = subscription.currentPeriodUsageUsd
  const planState = subscription.cancelAtPeriodEnd
    ? "canceling"
    : subscription.status === "past_due" || subscription.status === "unpaid"
      ? "past_due"
      : subscription.status === "active" || subscription.status === "trialing"
        ? "active"
        : "unknown"
  return [
    {
      id: "kilo-pass",
      providerID: "kilo",
      sourceKind: "kilo_pass",
      providerLabel: "Kilo",
      planLabel: `Kilo Pass $${subscription.tier.replace("tier_", "")}`,
      sourceLabel: "via Kilo",
      fetchState: "ready",
      planState,
      routingState: "not_applicable",
      availabilityState: limit - used <= 0 ? "exhausted" : "available",
      fetchedAt: new Date().toISOString(),
      confidence: "high",
      source: "cloud",
      managementUrl: `${base()}/subscriptions/kilo-pass`,
      windows: [
        {
          id: "current-period",
          label: "Current period",
          resource: "Kilo Credits",
          kind: "quota",
          unit: "USD",
          orientation: "amount",
          used,
          remaining: Math.max(0, limit - used),
          limit,
          ...(subscription.refillAt && { resetAt: subscription.refillAt }),
          state: limit - used <= 0 ? "exhausted" : "active",
        },
      ],
      balances: [],
      credits: [
        {
          id: "base-credits",
          label: "Base credits",
          balance: String(subscription.currentPeriodBaseCreditsUsd),
          unit: "USD",
        },
        ...(subscription.currentPeriodBonusCreditsUsd !== null
          ? [
              {
                id: "bonus-credits",
                label: subscription.isBonusUnlocked ? "Bonus credits" : "Pending bonus credits",
                balance: String(subscription.currentPeriodBonusCreditsUsd),
                unit: "USD",
              },
            ]
          : []),
      ],
    },
  ]
}

function route(subscription: CodingPlanSubscription, state: Result<ByokEntry[]>): UsageSnapshot["routingState"] {
  if (!state.ok) return "unknown"
  const entry = state.value.find((item) => item.provider_id === subscription.providerId)
  if (!subscription.hasInstalledByokKey) return entry ? "replaced" : "missing"
  if (!entry || entry.management_source !== "coding_plan") return "missing"
  return entry.is_enabled ? "active" : "disabled"
}

export function plans(state: CloudState) {
  if (!state.plans.ok) return []
  return state.plans.value
    .filter(
      (item) =>
        item.planId === "minimax-token-plan-plus" &&
        item.providerId === "minimax" &&
        (item.status === "active" || item.status === "past_due"),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
}

export async function managed(
  token: string,
  subscription: CodingPlanSubscription,
  state: Result<ByokEntry[]>,
): Promise<UsageSnapshot> {
  const routingState = route(subscription, state)
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
        routingState,
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
      routingState,
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
