import { z } from "zod"
import { buildKiloHeaders } from "../headers.js"
import { KILO_API_BASE } from "./constants.js"

const timeout = 5_000
const limit = 512 * 1024

const CodingPlanSubscriptionSchema = z.object({
  id: z.string(),
  planId: z.string(),
  planName: z.string(),
  providerName: z.string(),
  providerId: z.string(),
  canQueryUsage: z.boolean(),
  hasInstalledByokKey: z.boolean(),
  status: z.enum(["active", "past_due", "canceled"]),
  cancelAtPeriodEnd: z.boolean(),
})

const ByokEntrySchema = z.object({
  id: z.string(),
  provider_id: z.string(),
  management_source: z.enum(["user", "coding_plan"]),
  is_enabled: z.boolean(),
})

const CodingPlanQuotaWindowSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/),
  remainingPercent: z.number().finite().nonnegative(),
  resetsAt: z.iso.datetime(),
  startsAt: z.iso.datetime().optional(),
  period: z.object({
    unit: z.enum(["hour", "day", "week", "month"]),
    value: z.number().int().positive(),
  }),
})

const CodingPlanQuotaWindowsSchema = z
  .array(CodingPlanQuotaWindowSchema)
  .min(1)
  .max(16)
  .superRefine((windows, ctx) => {
    const ids = new Set<string>()
    for (const [index, window] of windows.entries()) {
      if (ids.has(window.id)) {
        ctx.addIssue({ code: "custom", message: "Quota window IDs must be unique.", path: [index, "id"] })
      }
      ids.add(window.id)
    }
  })

export const CodingPlanUsageSchema = z.object({
  schemaVersion: z.literal(1),
  fetchedAt: z.iso.datetime(),
  subscription: z.object({
    id: z.string(),
    planName: z.string().min(1),
    providerId: z.string().min(1),
    providerName: z.string().min(1),
    windows: CodingPlanQuotaWindowsSchema,
  }),
})

const envelope = z.object({
  result: z.object({ data: z.unknown() }).optional(),
  error: z.unknown().optional(),
})

export type CodingPlanSubscription = z.infer<typeof CodingPlanSubscriptionSchema>
export type ByokEntry = z.infer<typeof ByokEntrySchema>
export type CodingPlanUsage = z.infer<typeof CodingPlanUsageSchema>
export type CodingPlanQuotaWindow = z.infer<typeof CodingPlanQuotaWindowSchema>

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
  if (parsed.error != null) throw new CloudTrpcError("procedure", response.status)
  if (!response.ok) throw new CloudTrpcError("http", response.status)
  if (!parsed.result) throw new CloudTrpcError("protocol", response.status)

  const data = parsed.result.data
  const value = typeof data === "object" && data !== null && "json" in data ? (data as { json: unknown }).json : data
  const result = schema.safeParse(value)
  if (!result.success) throw new CloudTrpcError("schema", response.status)
  return result.data
}

export function fetchCodingPlanSubscriptions(token: string) {
  return query("codingPlans.listSubscriptions", token, z.array(CodingPlanSubscriptionSchema))
}

export function fetchByokEntries(token: string) {
  return query("byok.list", token, z.array(ByokEntrySchema), {})
}

export async function fetchCodingPlanUsage(token: string, subscriptionId: string) {
  const usage = await query("codingPlans.getUsage", token, CodingPlanUsageSchema, { subscriptionId })
  if (usage.subscription.id !== subscriptionId) throw new CloudTrpcError("schema")
  return usage
}
