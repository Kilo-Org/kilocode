// Client-side mirror of the custom auto router HTTP contracts. The source of
// truth is packages/auto-routing-contracts/src/custom-router.ts in Kilo-Org/cloud
// (ADR 0005, docs/adr/0005-custom-auto-routers.md); keep the two in step when
// either side changes.
import { z } from "zod"

export const CUSTOM_ROUTER_MODEL_PREFIX = "kilo-auto/custom/"
export const ORG_CUSTOM_ROUTER_MODEL_PREFIX = "kilo-auto/custom/org/"
export const RESERVED_USER_CUSTOM_ROUTER_SLUG = "org"
export const MAX_CUSTOM_ROUTER_ENTRIES = 20
export const CUSTOM_ROUTER_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export const AUTO_ROUTING_CUSTOM_ROUTERS_PATH = "/api/auto-routing/custom-routers"
export const AUTO_ROUTING_PLATFORM_MEASUREMENTS_PATH = "/api/auto-routing/platform-measurements"
export const CUSTOM_ROUTER_DECIDE_PATH = "/v1/decide"
export const CUSTOM_ROUTER_EVAL_PLAN_PATH = "/v1/eval/plan"
export const CUSTOM_ROUTER_EVAL_CASE_PATH = "/v1/eval/case"
export const CUSTOM_ROUTER_EVAL_RESULT_PATH = "/v1/eval/result"
export const AUTO_ROUTING_ORGANIZATION_HEADER = "X-KiloCode-OrganizationId"
export const AUTO_DECISION_HEADER = "x-kilo-auto-decision"

export const CustomRouterScopeSchema = z.enum(["user", "org"])
export type CustomRouterScope = z.infer<typeof CustomRouterScopeSchema>

export const CustomRouterSlugSchema = z.string().regex(CUSTOM_ROUTER_SLUG_PATTERN)

export const CustomRouterReferenceSchema = z.object({
  scope: CustomRouterScopeSchema,
  slug: CustomRouterSlugSchema,
})
export type CustomRouterReference = z.infer<typeof CustomRouterReferenceSchema>

export function isCustomRouterModelId(model: string): boolean {
  return model.startsWith(CUSTOM_ROUTER_MODEL_PREFIX)
}

export function parseCustomRouterModelId(model: string): CustomRouterReference | null {
  if (!isCustomRouterModelId(model)) return null
  const reference: CustomRouterReference = model.startsWith(ORG_CUSTOM_ROUTER_MODEL_PREFIX)
    ? { scope: "org", slug: model.slice(ORG_CUSTOM_ROUTER_MODEL_PREFIX.length) }
    : { scope: "user", slug: model.slice(CUSTOM_ROUTER_MODEL_PREFIX.length) }
  if (reference.scope === "user" && reference.slug === RESERVED_USER_CUSTOM_ROUTER_SLUG) return null
  return CustomRouterReferenceSchema.safeParse(reference).success ? reference : null
}

export function customRouterModelId(scope: CustomRouterScope, slug: string): string {
  return `${scope === "org" ? ORG_CUSTOM_ROUTER_MODEL_PREFIX : CUSTOM_ROUTER_MODEL_PREFIX}${slug}`
}

export const ClientModelCapabilitiesSchema = z.object({
  contextLength: z.number().int().positive().nullable(),
  inputModalities: z.array(z.string()),
  toolCall: z.boolean(),
  reasoning: z.boolean(),
})
export type ClientModelCapabilities = z.infer<typeof ClientModelCapabilitiesSchema>

export const ClientModelPricingSchema = z.object({
  inputPerMTokUsd: z.number().nonnegative(),
  outputPerMTokUsd: z.number().nonnegative(),
  cacheReadPerMTokUsd: z.number().nonnegative().optional(),
})
export type ClientModelPricing = z.infer<typeof ClientModelPricingSchema>

export const CLIENT_CANDIDATE_PREFIX = "client:"

const GatewayModelIdSchema = z
  .string()
  .trim()
  .min(1)
  .refine((model) => !model.startsWith(CLIENT_CANDIDATE_PREFIX), "Gateway model ID must not start with the client prefix")

export const MeasuredAsModelIdSchema = GatewayModelIdSchema.refine(
  (model) => !model.toLowerCase().startsWith("kilo-auto/"),
  "measuredAs must name a concrete platform model",
)

const GatewayCustomRouterEntryRefSchema = z.object({
  kind: z.literal("gateway"),
  model: GatewayModelIdSchema,
})

export const GatewayCustomRouterEntrySchema = GatewayCustomRouterEntryRefSchema.extend({
  measuredAs: MeasuredAsModelIdSchema.optional(),
})
export type GatewayCustomRouterEntry = z.infer<typeof GatewayCustomRouterEntrySchema>

export const ClientCustomRouterEntrySchema = z.object({
  kind: z.literal("client"),
  provider: z.string().min(1),
  model: z.string().min(1),
  variants: z.array(z.string()),
  capabilities: ClientModelCapabilitiesSchema,
  pricing: ClientModelPricingSchema.nullable(),
  measuredAs: MeasuredAsModelIdSchema.optional(),
})
export type ClientCustomRouterEntry = z.infer<typeof ClientCustomRouterEntrySchema>

export const CustomRouterEntryRefSchema = z.discriminatedUnion("kind", [
  GatewayCustomRouterEntryRefSchema,
  z.object({ kind: z.literal("client"), provider: z.string().min(1), model: z.string().min(1) }),
])
export type CustomRouterEntryRef = z.infer<typeof CustomRouterEntryRefSchema>

export const CustomRouterEntrySchema = z.discriminatedUnion("kind", [
  GatewayCustomRouterEntrySchema,
  ClientCustomRouterEntrySchema,
])
export type CustomRouterEntry = z.infer<typeof CustomRouterEntrySchema>

export function customRouterEntryKey(entry: CustomRouterEntryRef): string {
  return entry.kind === "gateway" ? `gateway:${entry.model}` : `client:${entry.provider}/${entry.model}`
}

export function customRouterCandidateModel(entry: CustomRouterEntryRef): string {
  return entry.kind === "gateway" ? entry.model : customRouterEntryKey(entry)
}

export function parseCustomRouterCandidateModel(model: string): CustomRouterEntryRef | null {
  if (!model.startsWith(CLIENT_CANDIDATE_PREFIX)) {
    const gateway = CustomRouterEntryRefSchema.safeParse({ kind: "gateway", model })
    return gateway.success ? gateway.data : null
  }
  const id = model.slice(CLIENT_CANDIDATE_PREFIX.length)
  const separator = id.indexOf("/")
  if (separator === -1) return null
  const client = CustomRouterEntryRefSchema.safeParse({
    kind: "client",
    provider: id.slice(0, separator),
    model: id.slice(separator + 1),
  })
  return client.success && customRouterCandidateModel(client.data) === model ? client.data : null
}

export const CustomRouterClientEntryIdSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
})
export type CustomRouterClientEntryId = z.infer<typeof CustomRouterClientEntryIdSchema>

export const CustomRouterErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "router_not_found",
  "invalid_request",
  "insufficient_balance",
  "quota_exceeded",
  "custom_router_unavailable",
  "stale_engine_identity",
  "internal_error",
])
export type CustomRouterErrorCode = z.infer<typeof CustomRouterErrorCodeSchema>

export const CustomRouterErrorResponseSchema = z.object({
  // retryAt is an ISO time; present when the limit has a known reset.
  error: z.object({ code: CustomRouterErrorCodeSchema, message: z.string(), retryAt: z.string().optional() }),
})
export type CustomRouterErrorResponse = z.infer<typeof CustomRouterErrorResponseSchema>

export const AutoRouterSchema = z.enum(["efficient", "frontier"])
export const AutoRoutingModeSchema = z.enum(["cost_per_accuracy", "best_accuracy"])
const VariantSchema = z.string().min(1).nullable()

export const CustomRouterDecideRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.unknown()),
  tools: z.array(z.unknown()).optional(),
  sessionId: z.string().min(1).nullable(),
  machineId: z.string().min(1).nullable().optional(),
  clientRequestId: z.string().min(1).nullable().optional(),
  mode: z.string().min(1).nullable().optional(),
  clientEntries: z.array(CustomRouterClientEntryIdSchema),
})
export type CustomRouterDecideRequest = z.infer<typeof CustomRouterDecideRequestSchema>

export const CustomRouterDecisionSchema = z.object({
  entry: CustomRouterEntryRefSchema,
  model: z.string().min(1),
  variant: VariantSchema,
  stale: z.boolean(),
  fallback: z.boolean(),
  sticky: z.boolean(),
  taskType: z.string().nullable(),
  subtaskType: z.string().nullable(),
  tableVersion: z.string().nullable(),
})
export type CustomRouterDecision = z.infer<typeof CustomRouterDecisionSchema>

export const CustomRouterDecideResponseSchema = z.object({
  decision: CustomRouterDecisionSchema,
  decisionId: z.string().min(1),
})
export type CustomRouterDecideResponse = z.infer<typeof CustomRouterDecideResponseSchema>

export const CustomRouterVariantStatusSchema = z.object({
  variant: VariantSchema,
  status: z.enum(["missing", "pending", "running", "ready", "stale", "failed"]),
  failureReason: z.string().nullable(),
  linked: z.boolean().default(false),
})
export type CustomRouterVariantStatus = z.infer<typeof CustomRouterVariantStatusSchema>

export const PlatformMeasurementsResponseSchema = z.object({
  baseRouter: AutoRouterSchema,
  models: z.array(
    z.object({
      model: MeasuredAsModelIdSchema,
      variants: z.array(VariantSchema),
    }),
  ),
})
export type PlatformMeasurementsResponse = z.infer<typeof PlatformMeasurementsResponseSchema>

function linkKey(id: string): string {
  return id.toLowerCase().replace(/[._:]/g, '-');
}

export function suggestMeasuredAs(
  entry: { provider: string | null; model: string },
  platformModels: readonly string[]
): string | null {
  const full = linkKey(entry.provider === null ? entry.model : `${entry.provider}/${entry.model}`);
  const exact = platformModels.find(model => linkKey(model) === full);
  if (exact) return exact;
  const name = linkKey(entry.model.slice(entry.model.lastIndexOf('/') + 1));
  const byName = platformModels.filter(
    model => linkKey(model.slice(model.lastIndexOf('/') + 1)) === name
  );
  return byName.length === 1 ? (byName[0] ?? null) : null;
}

export const CustomRouterListEntrySchema = z.object({
  key: z.string().min(1),
  entry: CustomRouterEntrySchema,
  needsClientEval: z.boolean(),
  variants: z.array(CustomRouterVariantStatusSchema),
})
export type CustomRouterListEntry = z.infer<typeof CustomRouterListEntrySchema>

export const CustomRouterSummarySchema = z.object({
  id: z.uuid(),
  scope: CustomRouterScopeSchema,
  slug: CustomRouterSlugSchema,
  name: z.string(),
  modelId: z.string().min(1),
  baseRouter: AutoRouterSchema,
  mode: AutoRoutingModeSchema,
  defaultEntryKey: z.string().min(1),
  canEdit: z.boolean(),
  entries: z.array(CustomRouterListEntrySchema),
})
export type CustomRouterSummary = z.infer<typeof CustomRouterSummarySchema>

export const CustomRouterListResponseSchema = z.object({ routers: z.array(CustomRouterSummarySchema) })
export type CustomRouterListResponse = z.infer<typeof CustomRouterListResponseSchema>

export const CustomRouterResponseSchema = z.object({ router: CustomRouterSummarySchema })
export type CustomRouterResponse = z.infer<typeof CustomRouterResponseSchema>

export const RegisterClientEntryRequestSchema = z.object({ entry: ClientCustomRouterEntrySchema })
export type RegisterClientEntryRequest = z.infer<typeof RegisterClientEntryRequestSchema>

export const ClientEvalPlanItemSchema = z.object({
  entry: CustomRouterEntryRefSchema,
  variant: VariantSchema,
  caseId: z.string().min(1),
  rep: z.number().int().nonnegative(),
})
export type ClientEvalPlanItem = z.infer<typeof ClientEvalPlanItemSchema>

export const ClientEvalPlanResponseSchema = z.object({
  baseRouter: AutoRouterSchema,
  engineIdentity: z.string().min(1),
  repetitions: z.number().int().positive(),
  items: z.array(ClientEvalPlanItemSchema),
  // Pairs still serving from an older engine identity; their re-eval items are already in `items`.
  staleEntries: z.array(z.object({ entry: CustomRouterEntryRefSchema, variant: VariantSchema })).default([]),
})
export type ClientEvalPlanResponse = z.infer<typeof ClientEvalPlanResponseSchema>

export const ClientEvalCaseResponseSchema = z.object({
  caseId: z.string().min(1),
  baseRouter: AutoRouterSchema,
  // The exact `kilo run` prompt the platform container sends; pass it verbatim.
  prompt: z.string().min(1),
  timeoutMs: z.number().int().positive(),
})
export type ClientEvalCaseResponse = z.infer<typeof ClientEvalCaseResponseSchema>

export const ClientEvalResultResponseSchema = z.object({ score: z.number().min(0).max(1) })
export type ClientEvalResultResponse = z.infer<typeof ClientEvalResultResponseSchema>

export function customRouterPath(scope: CustomRouterScope, slug: string): string {
  return `${AUTO_ROUTING_CUSTOM_ROUTERS_PATH}/${scope}/${slug}`
}

export function customRouterClientEntriesPath(scope: CustomRouterScope, slug: string): string {
  return `${customRouterPath(scope, slug)}/client-entries`
}
