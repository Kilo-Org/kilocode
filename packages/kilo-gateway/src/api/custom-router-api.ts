// HTTP client for the custom auto router endpoints (ADR 0005):
//   * the web app REST routes under /api/auto-routing/custom-routers
//   * the public auto-routing worker routes under /v1/...
// Paths and payloads mirror packages/auto-routing-contracts/src/custom-router.ts
// in Kilo-Org/cloud.
import {
  AUTO_ROUTING_CUSTOM_ROUTERS_PATH,
  CUSTOM_ROUTER_DECIDE_PATH,
  CUSTOM_ROUTER_EVAL_CASE_PATH,
  CUSTOM_ROUTER_EVAL_PLAN_PATH,
  CUSTOM_ROUTER_EVAL_RESULT_PATH,
  ClientEvalCaseResponseSchema,
  ClientEvalPlanResponseSchema,
  ClientEvalResultResponseSchema,
  CustomRouterDecideResponseSchema,
  CustomRouterErrorResponseSchema,
  CustomRouterListResponseSchema,
  CustomRouterReferenceSchema,
  CustomRouterResponseSchema,
  customRouterClientEntriesPath,
  type ClientCustomRouterEntry,
  type CustomRouterDecideRequest,
  type CustomRouterReference,
  type ClientEvalCaseResponse,
  type ClientEvalPlanResponse,
  type ClientEvalResultResponse,
  type CustomRouterDecideResponse,
  type CustomRouterErrorCode,
  type CustomRouterListResponse,
  type CustomRouterResponse,
} from "./custom-router.js"
import { KILO_API_BASE, KILO_AUTO_ROUTING_BASE } from "./constants.js"
import { getDefaultHeaders, buildKiloHeaders } from "../headers.js"

const REQUEST_TIMEOUT_MS = 30_000

export class CustomRouterRequestError extends Error {
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

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type RequestOptions = {
  token?: string
  organizationId?: string | null
  signal?: AbortSignal
  fetch?: FetchLike
  timeoutMs?: number
}

function headers(options: RequestOptions): Record<string, string> {
  return {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, { kilocodeOrganizationId: options.organizationId ?? undefined }),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
  }
}

async function request<T>(
  options: RequestOptions,
  input: { url: string; method: "GET" | "POST" | "DELETE"; body?: unknown; parse: (value: unknown) => T },
): Promise<T> {
  const run = options.fetch ?? fetch
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const response = await run(input.url, {
    method: input.method,
    headers: { ...headers(options), "Content-Type": "application/json" },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
    signal: options.signal ?? AbortSignal.timeout(timeout),
  })
  const text = await response.text()
  const json = text.length > 0 ? safeJson(text) : undefined
  if (!response.ok) throw failure(response.status, json)
  try {
    return input.parse(json)
  } catch {
    throw new CustomRouterRequestError({
      code: "internal_error",
      message: `Unexpected response from the custom router service (HTTP ${response.status})`,
      status: response.status,
    })
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const STATUS_CODES: Record<number, CustomRouterErrorCode> = {
  400: "invalid_request",
  401: "unauthorized",
  402: "insufficient_balance",
  403: "forbidden",
  404: "router_not_found",
  409: "stale_engine_identity",
  422: "custom_router_unavailable",
  429: "quota_exceeded",
}

function failure(status: number, body: unknown): CustomRouterRequestError {
  const parsed = CustomRouterErrorResponseSchema.safeParse(body)
  if (parsed.success) return new CustomRouterRequestError({ ...parsed.data.error, status })
  return new CustomRouterRequestError({
    code: STATUS_CODES[status] ?? "internal_error",
    message: describe(body),
    status,
  })
}

function describe(body: unknown): string {
  if (typeof body === "string" && body.length > 0) return body
  if (body && typeof body === "object") return JSON.stringify(body)
  return "request failed"
}

function join(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`
}

// Two hosts: the web app REST routes live on the Kilo API base (KILO_API_URL),
// the worker routes on the auto-routing base (KILO_AUTO_ROUTING_URL).
function web(path: string): string {
  return join(KILO_API_BASE, path)
}

function worker(path: string): string {
  return join(KILO_AUTO_ROUTING_BASE, path)
}

export function fetchCustomRouters(options: RequestOptions): Promise<CustomRouterListResponse> {
  return request(options, {
    url: web(AUTO_ROUTING_CUSTOM_ROUTERS_PATH),
    method: "GET",
    parse: (value) => CustomRouterListResponseSchema.parse(value),
  })
}

export function registerCustomRouterClientEntry(
  input: RequestOptions & { scope: CustomRouterReference["scope"]; slug: string; entry: ClientCustomRouterEntry },
): Promise<CustomRouterResponse> {
  const parsed = CustomRouterReferenceSchema.parse({ scope: input.scope, slug: input.slug })
  return request(input, {
    url: web(customRouterClientEntriesPath(parsed.scope, parsed.slug)),
    method: "POST",
    body: { entry: input.entry },
    parse: (value) => CustomRouterResponseSchema.parse(value),
  })
}

export function removeCustomRouterClientEntry(
  input: RequestOptions & { scope: CustomRouterReference["scope"]; slug: string; provider: string; model: string },
): Promise<CustomRouterResponse> {
  const parsed = CustomRouterReferenceSchema.parse({ scope: input.scope, slug: input.slug })
  const query = new URLSearchParams({ provider: input.provider, model: input.model })
  return request(input, {
    url: `${web(customRouterClientEntriesPath(parsed.scope, parsed.slug))}?${query.toString()}`,
    method: "DELETE",
    parse: (value) => CustomRouterResponseSchema.parse(value),
  })
}

export function decideCustomRouter(
  input: RequestOptions & { body: CustomRouterDecideRequest },
): Promise<CustomRouterDecideResponse> {
  return request(input, {
    url: worker(CUSTOM_ROUTER_DECIDE_PATH),
    method: "POST",
    body: input.body,
    parse: (value) => CustomRouterDecideResponseSchema.parse(value),
  })
}

export function fetchClientEvalPlan(
  input: RequestOptions & { routerId: string },
): Promise<ClientEvalPlanResponse> {
  return request(input, {
    url: worker(CUSTOM_ROUTER_EVAL_PLAN_PATH),
    method: "POST",
    body: { routerId: input.routerId },
    parse: (value) => ClientEvalPlanResponseSchema.parse(value),
  })
}

export function fetchClientEvalCase(
  input: RequestOptions & { routerId: string; caseId: string },
): Promise<ClientEvalCaseResponse> {
  return request(input, {
    url: worker(CUSTOM_ROUTER_EVAL_CASE_PATH),
    method: "POST",
    body: { routerId: input.routerId, caseId: input.caseId },
    parse: (value) => ClientEvalCaseResponseSchema.parse(value),
  })
}

export function uploadClientEvalResult(
  input: RequestOptions & { body: unknown },
): Promise<ClientEvalResultResponse> {
  return request(input, {
    url: worker(CUSTOM_ROUTER_EVAL_RESULT_PATH),
    method: "POST",
    body: input.body,
    parse: (value) => ClientEvalResultResponseSchema.parse(value),
  })
}
