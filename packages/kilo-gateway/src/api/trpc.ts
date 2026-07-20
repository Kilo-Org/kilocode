import { z } from "zod"
import { buildKiloHeaders } from "../headers.js"
import { KILO_API_BASE } from "./constants.js"

const timeout = 5_000
const limit = 512 * 1024

const AutoTopUpStateSchema = z.object({
  enabled: z.boolean(),
  amountCents: z.number().int().nonnegative(),
  thresholdCents: z.number().int().nonnegative(),
  paymentMethod: z
    .object({
      type: z.string(),
      brand: z.string().nullable(),
      last4: z.string().nullable(),
    })
    .nullable(),
})

const CodingPlanSubscriptionSchema = z.object({
  id: z.string(),
  planId: z.string(),
  planName: z.string(),
  providerName: z.string(),
  providerId: z.string(),
  routeLabel: z.string(),
  hasInstalledByokKey: z.boolean(),
  status: z.enum(["active", "past_due", "canceled"]),
  billingPeriodDays: z.number().int().positive(),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  creditRenewalAt: z.string(),
  cancelAtPeriodEnd: z.boolean(),
  paymentGraceExpiresAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  createdAt: z.string(),
  costKiloCredits: z.number().nonnegative(),
})

const ByokEntrySchema = z.object({
  id: z.string(),
  provider_id: z.string(),
  management_source: z.enum(["user", "coding_plan"]),
  is_enabled: z.boolean(),
})

const NativeNumberSchema = z.number().finite()
const NativeIntegerSchema = z.number().int().safe()
const MiniMaxModelRemainsSchema = z.object({
  model_name: z.string(),
  current_interval_total_count: NativeIntegerSchema.nonnegative().optional(),
  current_interval_usage_count: NativeIntegerSchema.nonnegative().optional(),
  start_time: NativeIntegerSchema.nonnegative().optional(),
  end_time: NativeIntegerSchema.nonnegative().optional(),
  remains_time: NativeIntegerSchema.nonnegative().optional(),
  interval_boost_permill: NativeIntegerSchema.nonnegative().optional(),
  interval_boost_permille: NativeIntegerSchema.nonnegative().optional(),
  current_interval_remaining_percent: NativeNumberSchema.optional(),
  current_interval_status: NativeIntegerSchema.optional(),
  current_weekly_total_count: NativeIntegerSchema.nonnegative().optional(),
  current_weekly_usage_count: NativeIntegerSchema.nonnegative().optional(),
  weekly_start_time: NativeIntegerSchema.nonnegative().optional(),
  weekly_end_time: NativeIntegerSchema.nonnegative().optional(),
  weekly_remains_time: NativeIntegerSchema.nonnegative().optional(),
  weekly_boost_permill: NativeIntegerSchema.nonnegative().optional(),
  weekly_boost_permille: NativeIntegerSchema.nonnegative().optional(),
  current_weekly_remaining_percent: NativeNumberSchema.optional(),
  current_weekly_status: NativeIntegerSchema.optional(),
})

export const MiniMaxNativeUsageSchema = z.object({
  base_resp: z.object({ status_code: NativeIntegerSchema }),
  model_remains: z.array(MiniMaxModelRemainsSchema),
})

const CodingPlanUsageSchema = z.object({
  subscriptionId: z.string(),
  providerId: z.literal("minimax"),
  region: z.literal("global"),
  fetchedAt: z.string(),
  native: MiniMaxNativeUsageSchema,
})

const envelope = z.object({
  result: z.object({ data: z.unknown() }).optional(),
  error: z.unknown().optional(),
})

export type AutoTopUpState = z.infer<typeof AutoTopUpStateSchema>
export type CodingPlanSubscription = z.infer<typeof CodingPlanSubscriptionSchema>
export type ByokEntry = z.infer<typeof ByokEntrySchema>
export type CodingPlanUsage = z.infer<typeof CodingPlanUsageSchema>
export type MiniMaxNativeUsage = z.infer<typeof MiniMaxNativeUsageSchema>

async function read(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => undefined)
    throw new CloudTrpcError("protocol", response.status)
  }
  if (!response.body) {
    const body = await response.arrayBuffer()
    if (body.byteLength > limit) throw new CloudTrpcError("protocol", response.status)
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
    if (size > limit) {
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

export class CloudTrpcError extends Error {
  constructor(
    readonly kind: "network" | "http" | "protocol" | "procedure" | "schema",
    readonly status?: number,
  ) {
    super("Kilo Cloud data is temporarily unavailable.")
    this.name = "CloudTrpcError"
  }
}

async function query<T>(procedure: string, token: string, schema: z.ZodType<T>, input?: unknown): Promise<T> {
  const params = new URLSearchParams()
  if (input !== undefined) params.set("input", JSON.stringify(input))
  const suffix = params.size ? `?${params.toString()}` : ""
  const response = await fetch(`${KILO_API_BASE}/api/trpc/${procedure}${suffix}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...buildKiloHeaders(),
    },
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => {
    throw new CloudTrpcError("network")
  })

  const body = await read(response).catch((error) => {
    if (error instanceof CloudTrpcError) throw error
    throw new CloudTrpcError("protocol", response.status)
  })

  const parsed = (() => {
    try {
      return envelope.parse(JSON.parse(body))
    } catch {
      throw new CloudTrpcError("protocol", response.status)
    }
  })()
  if (parsed.error !== undefined) throw new CloudTrpcError("procedure", response.status)
  if (!response.ok) throw new CloudTrpcError("http", response.status)
  if (!parsed.result) throw new CloudTrpcError("protocol", response.status)

  const data = parsed.result.data
  const value = typeof data === "object" && data !== null && "json" in data ? (data as { json: unknown }).json : data
  const result = schema.safeParse(value)
  if (!result.success) throw new CloudTrpcError("schema", response.status)
  return result.data
}

export function getAutoTopUpState(token: string) {
  return query("user.getAutoTopUpPaymentMethod", token, AutoTopUpStateSchema)
}

export function listCodingPlanSubscriptions(token: string) {
  return query("codingPlans.listSubscriptions", token, z.array(CodingPlanSubscriptionSchema))
}

export function listByokEntries(token: string) {
  return query("byok.list", token, z.array(ByokEntrySchema), {})
}

export function getCodingPlanUsage(token: string, subscriptionId: string) {
  return query("codingPlans.getUsage", token, CodingPlanUsageSchema, { subscriptionId })
}
