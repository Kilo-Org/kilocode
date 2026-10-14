export * as KiloTrpc from "./trpc.js"

import { Effect, Option, Schema } from "effect"
import { KiloHeaders } from "./headers.js"
import { KiloServer } from "./server.js"

const TIMEOUT_MS = 5_000
const LIMIT_BYTES = 512 * 1024
const LIVE_PASS_STATUSES = new Set(["active", "past_due", "trialing"])

const JsonValue = Schema.fromJsonString(Schema.Unknown)
const decodeJson = Schema.decodeUnknownOption(JsonValue)

export interface KiloPassState {
  readonly currentPeriodBaseCreditsUsd: number
  readonly currentPeriodUsageUsd: number
  readonly currentPeriodBonusCreditsUsd: number
  readonly nextBillingAt: string | null
}

const CodingPlanSubscriptionSchema = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  planName: Schema.String,
  providerName: Schema.String,
  providerId: Schema.String,
  canQueryUsage: Schema.Boolean,
  hasInstalledByokKey: Schema.Boolean,
  status: Schema.Literals(["active", "past_due", "canceled"]),
  cancelAtPeriodEnd: Schema.Boolean,
})
export type CodingPlanSubscription = typeof CodingPlanSubscriptionSchema.Type
const decodeSubscriptions = Schema.decodeUnknownOption(Schema.Array(CodingPlanSubscriptionSchema))

const ByokEntrySchema = Schema.Struct({
  id: Schema.String,
  provider_id: Schema.String,
  management_source: Schema.Literals(["user", "coding_plan"]),
  is_enabled: Schema.Boolean,
})
export type ByokEntry = typeof ByokEntrySchema.Type
const decodeByokEntries = Schema.decodeUnknownOption(Schema.Array(ByokEntrySchema))

const CodingPlanQuotaWindowSchema = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/)),
  remainingPercent: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  resetsAt: Schema.String,
  startsAt: Schema.optionalKey(Schema.String),
  period: Schema.Struct({
    unit: Schema.Literals(["hour", "day", "week", "month"]),
    value: Schema.Int.check(Schema.isGreaterThan(0)),
  }),
})
export type CodingPlanQuotaWindow = typeof CodingPlanQuotaWindowSchema.Type

const CodingPlanUsageSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  fetchedAt: Schema.String,
  subscription: Schema.Struct({
    id: Schema.String,
    planName: Schema.String,
    providerId: Schema.String,
    providerName: Schema.String,
    windows: Schema.Array(CodingPlanQuotaWindowSchema),
  }),
})
export type CodingPlanUsage = typeof CodingPlanUsageSchema.Type
const decodeUsage = Schema.decodeUnknownOption(CodingPlanUsageSchema)

export class CloudTrpcError extends Error {
  constructor(
    readonly kind: "network" | "http" | "protocol" | "procedure" | "schema",
    readonly status?: number,
  ) {
    super("Kilo Cloud data is temporarily unavailable.")
    this.name = "CloudTrpcError"
  }
}

// Parses `kiloPass.getState` tRPC responses like v1 `parseKiloPassState` (`api/kilo-pass.ts:13-30`).
export function parseKiloPassState(value: unknown): KiloPassState | null {
  const item = Array.isArray(value) ? value[0] : value
  const data = asRecord(asRecord(asRecord(item)?.result)?.data)
  const root = asRecord(data?.json) ?? data ?? asRecord(value)
  const sub = asRecord(root?.subscription)
  if (!sub || (sub.currentPeriodBaseCreditsUsd == null && sub.currentPeriodUsageUsd == null)) return null
  if (typeof sub.status === "string" && !LIVE_PASS_STATUSES.has(sub.status)) return null

  const next = sub.nextBillingAt ?? sub.nextRenewalAt
  return {
    currentPeriodBaseCreditsUsd: finiteNumber(sub.currentPeriodBaseCreditsUsd),
    currentPeriodUsageUsd: finiteNumber(sub.currentPeriodUsageUsd),
    currentPeriodBonusCreditsUsd: finiteNumber(sub.currentPeriodBonusCreditsUsd),
    nextBillingAt: typeof next === "string" ? next : null,
  }
}

export function kiloPass(
  server: string,
  token: string,
  version = "unknown",
  organizationID?: string | null,
): Effect.Effect<KiloPassState | null> {
  return Effect.promise(async () => {
    try {
      const params = new URLSearchParams({ batch: "1", input: JSON.stringify({ "0": null }) })
      const response = await fetch(`${KiloServer.normalize(server)}/api/trpc/kiloPass.getState?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...KiloHeaders.provider({ version, organizationID }),
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) return null
      const text = await readBounded(response)
      const parsed = decodeJson(text)
      return Option.isSome(parsed) ? parseKiloPassState(parsed.value) : null
    } catch {
      return null
    }
  })
}

export function codingPlanSubscriptions(
  server: string,
  token: string,
  version = "unknown",
  organizationID?: string | null,
): Effect.Effect<readonly CodingPlanSubscription[], CloudTrpcError> {
  return Effect.tryPromise({
    try: () =>
      query(
        server,
        "codingPlans.listSubscriptions",
        token,
        version,
        organizationID,
        (value) => Option.getOrUndefined(decodeSubscriptions(value)),
      ),
    catch: (error) => (error instanceof CloudTrpcError ? error : new CloudTrpcError("network")),
  })
}

export function byokEntries(
  server: string,
  token: string,
  version = "unknown",
  organizationID?: string | null,
): Effect.Effect<readonly ByokEntry[], CloudTrpcError> {
  return Effect.tryPromise({
    try: () =>
      query(
        server,
        "byok.list",
        token,
        version,
        organizationID,
        (value) => Option.getOrUndefined(decodeByokEntries(value)),
        {},
      ),
    catch: (error) => (error instanceof CloudTrpcError ? error : new CloudTrpcError("network")),
  })
}

export function codingPlanUsage(
  server: string,
  token: string,
  subscriptionId: string,
  version = "unknown",
  organizationID?: string | null,
): Effect.Effect<CodingPlanUsage, CloudTrpcError> {
  return Effect.tryPromise({
    try: async () => {
      const usage = await query(
        server,
        "codingPlans.getUsage",
        token,
        version,
        organizationID,
        (value) => {
          const decoded = Option.getOrUndefined(decodeUsage(value))
          if (!decoded) return undefined
          const windows = decoded.subscription.windows
          if (windows.length < 1 || windows.length > 16) return undefined
          const ids = new Set(windows.map((w) => w.id))
          if (ids.size !== windows.length) return undefined
          return decoded
        },
        { subscriptionId },
      )
      if (usage.subscription.id !== subscriptionId) throw new CloudTrpcError("schema")
      return usage
    },
    catch: (error) => (error instanceof CloudTrpcError ? error : new CloudTrpcError("network")),
  })
}

async function query<T>(
  server: string,
  procedure: string,
  token: string,
  version: string,
  organizationID: string | null | undefined,
  decode: (value: unknown) => T | undefined,
  input?: unknown,
): Promise<T> {
  const params = new URLSearchParams()
  if (input !== undefined) params.set("input", JSON.stringify(input))
  const suffix = params.size ? `?${params.toString()}` : ""
  const response = await fetch(`${KiloServer.normalize(server)}/api/trpc/${procedure}${suffix}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...KiloHeaders.provider({ version, organizationID }),
    },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new CloudTrpcError("network")
  })

  const body = await readBounded(response).catch((error) => {
    if (error instanceof CloudTrpcError) throw error
    throw new CloudTrpcError("protocol", response.status)
  })

  const decoded = decodeJson(body)
  if (Option.isNone(decoded) || !asRecord(decoded.value)) {
    throw new CloudTrpcError("protocol", response.status)
  }
  const envelope = decoded.value as Record<string, unknown>
  if (envelope.error != null) throw new CloudTrpcError("procedure", response.status)
  if (!response.ok) throw new CloudTrpcError("http", response.status)
  const resultObj = asRecord(envelope.result)
  if (!resultObj || !("data" in resultObj)) throw new CloudTrpcError("protocol", response.status)

  const data = resultObj.data
  const dataRecord = asRecord(data)
  const unwrapped = dataRecord && "json" in dataRecord ? dataRecord.json : data
  const validated = decode(unwrapped)
  if (validated === undefined) throw new CloudTrpcError("schema", response.status)
  return validated
}

async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > LIMIT_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw new CloudTrpcError("protocol", response.status)
  }
  if (!response.body) {
    const body = await response.arrayBuffer()
    if (body.byteLength > LIMIT_BYTES) throw new CloudTrpcError("protocol", response.status)
    return new TextDecoder().decode(body)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (!chunk.value) continue
    size += chunk.value.byteLength
    if (size > LIMIT_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new CloudTrpcError("protocol", response.status)
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}
