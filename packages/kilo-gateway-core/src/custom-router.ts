export * as KiloCustomRouter from "./custom-router.js"

import { Effect, Option, Schema } from "effect"
import { createHash } from "node:crypto"
import { KiloHeaders } from "./headers.js"
import { request as send } from "./http.js"
import { KiloServer } from "./server.js"

// Custom auto routers (ADR 0005). Port of v1 packages/kilo-gateway/src/api/custom-router.ts (the contract mirror),
// custom-router-api.ts (the HTTP client) and packages/opencode/src/kilocode/auto-routing/router.ts (the routing
// decision). The source of truth for the contract is packages/auto-routing-contracts/src/custom-router.ts in
// Kilo-Org/cloud; keep the two in step when either side changes.

export const MODEL_PREFIX = "kilo-auto/custom/"
export const ORG_MODEL_PREFIX = "kilo-auto/custom/org/"
export const RESERVED_USER_SLUG = "org"
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/
export const CLIENT_PREFIX = "client:"
export const DECISION_HEADER = "x-kilo-auto-decision"
export const DEFAULT_WORKER_URL = "https://auto-routing.kiloapps.io"
const ROUTERS_PATH = ["auto-routing", "custom-routers"]
const REQUEST_TIMEOUT_MS = 30_000
const LIST_TTL_MS = 30_000
const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

const NonEmpty = Schema.String.check(Schema.isMinLength(1))
const Variant = Schema.NullOr(NonEmpty)
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

export const Scope = Schema.Literals(["user", "org"])
export type Scope = typeof Scope.Type
export const Slug = Schema.String.check(Schema.isPattern(SLUG_PATTERN))
export const Reference = Schema.Struct({ scope: Scope, slug: Slug })
export type Reference = typeof Reference.Type

const GatewayModel = Schema.String.check(
  Schema.makeFilter(
    (model: string) =>
      (model.trim().length > 0 && !model.trim().startsWith(CLIENT_PREFIX)) ||
      "Gateway model ID must not start with the client prefix",
  ),
)

export const ClientCapabilities = Schema.Struct({
  contextLength: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  inputModalities: Schema.Array(Schema.String),
  toolCall: Schema.Boolean,
  reasoning: Schema.Boolean,
})

export const ClientPricing = Schema.Struct({
  inputPerMTokUsd: NonNegative,
  outputPerMTokUsd: NonNegative,
  cacheReadPerMTokUsd: Schema.optional(NonNegative),
})

export const ClientEntry = Schema.Struct({
  kind: Schema.Literal("client"),
  provider: NonEmpty,
  model: NonEmpty,
  variants: Schema.Array(Schema.String),
  capabilities: ClientCapabilities,
  pricing: Schema.NullOr(ClientPricing),
})
export type ClientEntry = typeof ClientEntry.Type

const GatewayEntry = Schema.Struct({ kind: Schema.Literal("gateway"), model: GatewayModel })
const ClientRef = Schema.Struct({ kind: Schema.Literal("client"), provider: NonEmpty, model: NonEmpty })

export const EntryRef = Schema.Union([GatewayEntry, ClientRef])
export type EntryRef = typeof EntryRef.Type
export const Entry = Schema.Union([GatewayEntry, ClientEntry])
export type Entry = typeof Entry.Type

export const ErrorCode = Schema.Literals([
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
export type ErrorCode = typeof ErrorCode.Type

// retryAt is an ISO time; present when the limit has a known reset.
const ErrorResponse = Schema.Struct({
  error: Schema.Struct({ code: ErrorCode, message: Schema.String, retryAt: Schema.optional(Schema.String) }),
})

const AutoRouter = Schema.Literals(["efficient", "frontier"])
const Mode = Schema.Literals(["cost_per_accuracy", "best_accuracy"])

export interface DecideRequest {
  readonly model: string
  readonly messages: readonly unknown[]
  readonly tools?: readonly unknown[]
  readonly sessionId: string | null
  readonly machineId?: string | null
  readonly clientRequestId?: string | null
  readonly mode?: string | null
  readonly clientEntries: readonly { readonly provider: string; readonly model: string }[]
}

export const Decision = Schema.Struct({
  entry: EntryRef,
  model: NonEmpty,
  variant: Variant,
  stale: Schema.Boolean,
  fallback: Schema.Boolean,
  sticky: Schema.Boolean,
  taskType: Schema.NullOr(Schema.String),
  subtaskType: Schema.NullOr(Schema.String),
  tableVersion: Schema.NullOr(Schema.String),
})
export const DecideResponse = Schema.Struct({ decision: Decision, decisionId: NonEmpty })
export type DecideResponse = typeof DecideResponse.Type

export const VariantStatus = Schema.Struct({
  variant: Variant,
  status: Schema.Literals(["missing", "pending", "running", "ready", "stale", "failed"]),
  failureReason: Schema.NullOr(Schema.String),
})

export const ListEntry = Schema.Struct({
  key: NonEmpty,
  entry: Entry,
  needsClientEval: Schema.Boolean,
  variants: Schema.Array(VariantStatus),
})
export type ListEntry = typeof ListEntry.Type

export const Summary = Schema.Struct({
  id: Schema.String.check(Schema.isUUID()),
  scope: Scope,
  slug: Slug,
  name: Schema.String,
  modelId: NonEmpty,
  baseRouter: AutoRouter,
  mode: Mode,
  defaultEntryKey: NonEmpty,
  canEdit: Schema.Boolean,
  entries: Schema.Array(ListEntry),
})
export type Summary = typeof Summary.Type

export const ListResponse = Schema.Struct({ routers: Schema.Array(Summary) })
export type ListResponse = typeof ListResponse.Type
export const RouterResponse = Schema.Struct({ router: Summary })
export type RouterResponse = typeof RouterResponse.Type

export const EvalPlanItem = Schema.Struct({
  entry: EntryRef,
  variant: Variant,
  caseId: NonEmpty,
  rep: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type EvalPlanItem = typeof EvalPlanItem.Type

export const EvalPlan = Schema.Struct({
  baseRouter: AutoRouter,
  engineIdentity: NonEmpty,
  repetitions: Schema.Int.check(Schema.isGreaterThan(0)),
  items: Schema.Array(EvalPlanItem),
  // Pairs still serving from an older engine identity; their re-eval items are already in `items`.
  staleEntries: Schema.Array(Schema.Struct({ entry: EntryRef, variant: Variant })).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
})
export type EvalPlan = typeof EvalPlan.Type

export const EvalCase = Schema.Struct({
  caseId: NonEmpty,
  baseRouter: AutoRouter,
  // The exact `kilo run` prompt the platform container sends; pass it verbatim.
  prompt: NonEmpty,
  timeoutMs: Schema.Int.check(Schema.isGreaterThan(0)),
})
export type EvalCase = typeof EvalCase.Type

export const EvalResult = Schema.Struct({ score: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })) })
export type EvalResult = typeof EvalResult.Type

export class RequestError extends Error {
  readonly code: string
  readonly status: number
  readonly retryAt?: string

  constructor(input: { code: string; message: string; status: number; retryAt?: string }) {
    super(input.message)
    this.name = "CustomRouterRequestError"
    this.code = input.code
    this.status = input.status
    this.retryAt = input.retryAt
  }
}

/** The resolved Gateway account scope the requests run in. `server` is the Kilo API base. */
export interface Account {
  readonly server: string
  readonly token: string
  readonly organizationID?: string | null
  readonly version: string
}

export function parseModelID(model: string): Reference | undefined {
  if (!model.startsWith(MODEL_PREFIX)) return undefined
  const reference = model.startsWith(ORG_MODEL_PREFIX)
    ? { scope: "org" as const, slug: model.slice(ORG_MODEL_PREFIX.length) }
    : { scope: "user" as const, slug: model.slice(MODEL_PREFIX.length) }
  if (reference.scope === "user" && reference.slug === RESERVED_USER_SLUG) return undefined
  return Option.getOrUndefined(Schema.decodeUnknownOption(Reference)(reference))
}

/** Accepts the full model ID or a bare slug, with an optional `org/` prefix, as the v1 commands did. */
export function resolveReference(
  value: string,
): { readonly reference: Reference; readonly modelID: string } | undefined {
  const org = value.startsWith("org/") ? value.slice("org/".length) : undefined
  const id = parseModelID(value) ? value : org ? `${ORG_MODEL_PREFIX}${org}` : `${MODEL_PREFIX}${value}`
  const reference = parseModelID(id)
  return reference ? { reference, modelID: id } : undefined
}

export function entryKey(entry: EntryRef) {
  return entry.kind === "gateway" ? `gateway:${entry.model}` : `${CLIENT_PREFIX}${entry.provider}/${entry.model}`
}

export interface ClientModel {
  readonly provider: string
  readonly model: string
  readonly variants: readonly string[]
  readonly context: number
  readonly input: readonly string[]
  readonly toolCall: boolean
  readonly reasoning: boolean
  readonly cost?: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
}

// The client entry carries the metadata the router needs to rank this model, taken from the CLI's own resolved model.
export function clientEntry(model: ClientModel): ClientEntry {
  const cost = model.cost
  const priced = cost !== undefined && (cost.input > 0 || cost.output > 0 || cost.cacheRead > 0 || cost.cacheWrite > 0)
  return {
    kind: "client",
    provider: model.provider,
    model: model.model,
    variants: [...model.variants],
    capabilities: {
      contextLength: model.context > 0 ? model.context : null,
      inputModalities: MODALITIES.filter((name) => model.input.includes(name)),
      toolCall: model.toolCall,
      reasoning: model.reasoning,
    },
    pricing: priced
      ? {
          inputPerMTokUsd: cost.input,
          outputPerMTokUsd: cost.output,
          ...(cost.cacheRead > 0 ? { cacheReadPerMTokUsd: cost.cacheRead } : {}),
        }
      : null,
  }
}

export function errorMessage(code: string, detail?: string, retryAt?: string): string {
  const suffix = detail ? ` (${detail})` : ""
  switch (code) {
    case "unauthorized":
      return "Sign in to Kilo to use a custom auto router. Run `kilo auth login`."
    case "forbidden":
      return `You do not have access to this custom auto router${suffix}.`
    case "router_not_found":
      return `Custom auto router ${detail ?? ""} was not found. Check the id with \`kilo auto router list\`.`
    case "insufficient_balance":
      return "Your Kilo balance is too low for auto routing. Top up your account and try again."
    case "quota_exceeded":
      return `Kilo's benchmark limit for this router owner is reached. Try again ${retryAt ? `after ${retryAt}` : "later"}.`
    case "custom_router_unavailable":
      return `No model in this custom auto router can serve this request${suffix}. Add a client model with \`kilo auto router add\`, or add a gateway model in the web editor.`
    case "stale_engine_identity":
      return `This custom auto router needs a fresh evaluation. Run \`kilo auto eval ${detail ?? "<router>"}\`.`
    case "invalid_request":
      return `Kilo rejected the custom router request${suffix}.`
  }
  return `Kilo auto routing failed${suffix}.`
}

/** The user-facing message of a failed custom router request. */
export function describe(error: unknown, router?: string) {
  if (error instanceof RequestError) return errorMessage(error.code, error.message || router, error.retryAt)
  return `Kilo auto routing request failed: ${error instanceof Error ? error.message : String(error)}`
}

const HOST_ALIAS = "host.docker.internal"
const LOOPBACK = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]

// Client evals run in a local container. Local model servers listen on the host loopback; the container reaches them
// through the Docker host gateway. WHATWG URL keeps IPv6 hosts bracketed, so the loopback list has both spellings.
export function hostUrl(url: string) {
  const parsed = URL.parse(url)
  if (!parsed || !LOOPBACK.includes(parsed.hostname)) return url
  parsed.hostname = HOST_ALIAS
  return parsed.toString()
}

export function isSecretKey(key: string) {
  return /(api[-_]?key|token|secret|password|authorization|cookie)/i.test(key)
}

/** JSON with every credential-shaped value replaced, for output on a terminal. */
export function redacted(value: unknown) {
  return JSON.stringify(value, (key, item) => (isSecretKey(key) ? "[redacted]" : item), 2)
}

/** The public auto-routing worker base. `KILO_AUTO_ROUTING_URL` overrides it. */
export function workerBase(env: Record<string, string | undefined> = process.env) {
  return (env.KILO_AUTO_ROUTING_URL?.trim() || DEFAULT_WORKER_URL).replace(/\/+$/, "")
}

// Two hosts: the web app REST routes live on the Kilo API base, the worker routes on the auto-routing base.
export function list(account: Account) {
  return request(account, { url: KiloServer.apiUrl(account.server, ...ROUTERS_PATH), method: "GET" }, ListResponse)
}

export function register(account: Account, reference: Reference, entry: ClientEntry) {
  return request(
    account,
    { url: clientEntriesUrl(account, reference), method: "POST", body: { entry } },
    RouterResponse,
  ).pipe(Effect.ensuring(evict(account)))
}

export function remove(
  account: Account,
  reference: Reference,
  target: { readonly provider: string; readonly model: string },
) {
  const query = new URLSearchParams({ provider: target.provider, model: target.model })
  return request(
    account,
    { url: `${clientEntriesUrl(account, reference)}?${query.toString()}`, method: "DELETE" },
    RouterResponse,
  ).pipe(Effect.ensuring(evict(account)))
}

export function decide(account: Account, body: DecideRequest) {
  return request(account, { url: `${workerBase()}/v1/decide`, method: "POST", body }, DecideResponse)
}

export function evalPlan(account: Account, routerID: string) {
  return request(
    account,
    { url: `${workerBase()}/v1/eval/plan`, method: "POST", body: { routerId: routerID } },
    EvalPlan,
  )
}

export function evalCase(account: Account, routerID: string, caseID: string) {
  return request(
    account,
    { url: `${workerBase()}/v1/eval/case`, method: "POST", body: { routerId: routerID, caseId: caseID } },
    EvalCase,
  )
}

export function evalResult(account: Account, body: unknown) {
  return request(account, { url: `${workerBase()}/v1/eval/result`, method: "POST", body }, EvalResult)
}

function clientEntriesUrl(account: Account, reference: Reference) {
  return KiloServer.apiUrl(account.server, ...ROUTERS_PATH, reference.scope, reference.slug, "client-entries")
}

const STATUS_CODES: Record<number, ErrorCode> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "insufficient_balance",
  403: "forbidden",
  404: "router_not_found",
  409: "stale_engine_identity",
  422: "custom_router_unavailable",
  429: "quota_exceeded",
}

function request<S extends Schema.ConstraintDecoder<unknown>>(
  account: Account,
  input: { readonly url: string; readonly method: "GET" | "POST" | "DELETE"; readonly body?: unknown },
  schema: S,
): Effect.Effect<S["Type"], Error> {
  return Effect.gen(function* () {
    const response = yield* send(
      input.url,
      {
        method: input.method,
        headers: {
          ...KiloHeaders.request({ version: account.version, organizationID: account.organizationID }),
          Authorization: `Bearer ${account.token}`,
          "Content-Type": "application/json",
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
      },
      "Custom router request failed",
      REQUEST_TIMEOUT_MS,
    )
    const text = yield* Effect.promise(() => response.text())
    const json = text.length > 0 ? parseJson(text) : undefined
    if (!response.ok) return yield* Effect.fail(failure(response.status, json))
    const decoded = Schema.decodeUnknownOption(schema)(json)
    if (Option.isSome(decoded)) return decoded.value
    return yield* Effect.fail(
      new RequestError({
        code: "internal_error",
        message: `Unexpected response from the custom router service (HTTP ${response.status})`,
        status: response.status,
      }),
    )
  })
}

// A body that is not JSON (for example an HTML error page) is not shown to the user, as on v1.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function failure(status: number, body: unknown) {
  const parsed = Schema.decodeUnknownOption(ErrorResponse)(body)
  if (Option.isSome(parsed)) return new RequestError({ ...parsed.value.error, status })
  return new RequestError({
    code: STATUS_CODES[status] ?? "internal_error",
    message:
      typeof body === "string" && body.length > 0
        ? body
        : body && typeof body === "object"
          ? JSON.stringify(body)
          : "request failed",
    status,
  })
}

export type Resolution =
  | { readonly kind: "client"; readonly provider: string; readonly model: string; readonly variant: string | null }
  | { readonly kind: "gateway"; readonly model: string; readonly variant: string | null; readonly decisionId: string }

export interface ResolveInput {
  readonly account: Account | undefined
  readonly modelID: string
  readonly messages: readonly unknown[]
  readonly tools?: readonly unknown[]
  readonly sessionID: string
  readonly requestID?: string
  readonly mode?: string
  readonly machineID?: string
  /** Whether this client can serve a client entry: the provider and model are in its catalog. */
  readonly servable: (entry: { readonly provider: string; readonly model: string }) => boolean
  readonly now?: () => number
}

// One list request per account scope at a time, kept for LIST_TTL_MS. The server process is long-lived, so expired
// entries are swept and the key holds a hash, not the token.
const cache = new Map<string, { readonly at: number; readonly value: Effect.Effect<ListResponse, Error> }>()

function cacheKey(account: Account) {
  return createHash("sha256")
    .update(`${account.server}\n${account.token}\n${account.organizationID ?? ""}`)
    .digest("hex")
}

// An entry edit must reach the next routing decision, not the one after the cache expires.
function evict(account: Account) {
  return Effect.sync(() => cache.delete(cacheKey(account)))
}

function routers(account: Account, now: number) {
  return Effect.gen(function* () {
    for (const [key, entry] of cache) if (now - entry.at >= LIST_TTL_MS) cache.delete(key)
    const key = cacheKey(account)
    const hit = cache.get(key)
    if (hit) return yield* hit.value
    const value = yield* Effect.cached(list(account))
    cache.set(key, { at: now, value })
    return yield* value.pipe(Effect.tapError(() => Effect.sync(() => cache.delete(key))))
  })
}

/** The client entries of a router this client can serve. */
export function servableEntries(router: Summary, servable: ResolveInput["servable"]) {
  return router.entries.flatMap((item) => (item.entry.kind === "client" && servable(item.entry) ? [item.entry] : []))
}

// ADR 0005 serving: the client only asks /v1/decide when the selected custom router has a client entry this client
// can serve. Otherwise (`undefined`) the custom model ID goes to the Gateway unchanged. Failures carry the
// user-facing message; there is no fallback outside the router's pool.
export function resolve(input: ResolveInput): Effect.Effect<Resolution | undefined, Error> {
  return Effect.gen(function* () {
    if (!parseModelID(input.modelID)) return undefined
    const account = input.account
    if (!account?.token) return yield* Effect.fail(new Error(errorMessage("unauthorized")))
    const loaded = yield* routers(account, input.now?.() ?? Date.now()).pipe(
      Effect.mapError((error) => new Error(describe(error, input.modelID))),
    )
    const router = loaded.routers.find((item) => item.modelId === input.modelID)
    if (!router) return yield* Effect.fail(new Error(errorMessage("router_not_found", input.modelID)))
    const servable = servableEntries(router, input.servable)
    if (servable.length === 0) return undefined
    const response = yield* decide(account, {
      model: input.modelID,
      messages: input.messages,
      ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
      sessionId: input.sessionID,
      machineId: input.machineID ?? null,
      clientRequestId: input.requestID ?? null,
      mode: input.mode ?? null,
      clientEntries: servable.map((entry) => ({ provider: entry.provider, model: entry.model })),
    }).pipe(Effect.mapError((error) => new Error(describe(error, input.modelID))))
    const pick = response.decision
    yield* Effect.logInfo("custom router decision", {
      router: input.modelID,
      entry: entryKey(pick.entry),
      stale: pick.stale,
      fallback: pick.fallback,
    })
    if (pick.entry.kind === "client") {
      if (!input.servable(pick.entry))
        return yield* Effect.fail(new Error(errorMessage("custom_router_unavailable", entryKey(pick.entry))))
      return { kind: "client", provider: pick.entry.provider, model: pick.entry.model, variant: pick.variant }
    }
    return { kind: "gateway", model: pick.entry.model, variant: pick.variant, decisionId: response.decisionId }
  })
}
