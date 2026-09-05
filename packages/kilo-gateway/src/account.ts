import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { Effect, Schema } from "effect"
import { fetchAuthenticatedJSON } from "./gateway.js"

// Source-only contract: origin/main ecccd1f gateway fixtures; not deployment-verified.
const PassResponse = Schema.Unknown
const livePassStatuses = new Set(["active", "past_due", "trialing"])

export function fetchBalance(server: string, token: string, organizationID: string | null) {
  return fetchAuthenticatedJSON<KiloGateway.Balance>(server, token, "/api/profile/balance", KiloGateway.Balance, {
    ...(organizationID === null ? {} : { "X-KILOCODE-ORGANIZATIONID": organizationID }),
  }).pipe(Effect.map(KiloGateway.Balance.make))
}

export function fetchKiloPass(server: string, token: string) {
  const input = new URLSearchParams({ batch: "1", input: JSON.stringify({ "0": null }) })
  return fetchAuthenticatedJSON(server, token, `/api/trpc/kiloPass.getState?${input}`, PassResponse).pipe(
    Effect.map(parseKiloPass),
  )
}

export function fetchAccountBalance(server: string, token: string, organizationID: string | null) {
  return Effect.all({
    balance: optional(fetchBalance(server, token, organizationID)),
    kiloPass: organizationID === null ? optional(fetchKiloPass(server, token)) : Effect.succeed(null),
  })
}

function optional<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return effect.pipe(Effect.catch(() => Effect.succeed(null)))
}

export function parseKiloPass(input: unknown) {
  const item = Array.isArray(input) ? input[0] : input
  const data = record(record(record(item)?.result)?.data)
  const root = record(data?.json) ?? data ?? record(input)
  const subscription = record(root?.subscription)
  if (
    !subscription ||
    (subscription.currentPeriodBaseCreditsUsd == null && subscription.currentPeriodUsageUsd == null)
  ) {
    return null
  }
  if (typeof subscription.status === "string" && !livePassStatuses.has(subscription.status)) return null
  const nextBillingAt = subscription.nextBillingAt ?? subscription.nextRenewalAt
  return KiloGateway.KiloPassState.make({
    currentPeriodBaseCreditsUsd: number(subscription.currentPeriodBaseCreditsUsd),
    currentPeriodUsageUsd: number(subscription.currentPeriodUsageUsd),
    currentPeriodBonusCreditsUsd: number(subscription.currentPeriodBonusCreditsUsd),
    nextBillingAt: typeof nextBillingAt === "string" ? nextBillingAt : null,
  })
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return 0
}
