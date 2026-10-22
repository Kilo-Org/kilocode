export * as KiloRequests from "./requests.js"

import { Option, Schema } from "effect"

const JsonRecord = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
const decodeJsonRecord = Schema.decodeUnknownOption(JsonRecord)

// Reserved account and credential metadata keys that Core merges into model settings before building a request.
// These must never serialize into the outgoing JSON request body sent to the Kilo Gateway.
export const ACCOUNT_BODY_KEYS = new Set([
  "access",
  "apiKey",
  "authToken",
  "email",
  "hasPersonalAccount",
  "key",
  "kiloCredentials",
  "name",
  "organizationID",
  "organizationName",
  "organizations",
  "refresh",
  "selectedOrganizationId",
  "server",
  "token",
  "user",
])

export interface TransformOptions {
  readonly dataCollection?: "allow" | "deny"
}

// Transforms a JSON request body for the Kilo Gateway (ported from v1 `packages/kilo-gateway/src/responses.ts`
// and the v2 request body sanitizer):
// 1. Strips leaked credential/account metadata keys from the top-level JSON object.
// 2. On `/responses` when `store !== true`, strips `item_reference` entries and item `id` fields from `input[]`.
// 3. Injects `provider.data_collection` when specified (`"allow"` or `"deny"`).
export function transformBody(
  urlOrPath: string | URL,
  body: string | undefined,
  options?: TransformOptions,
): string | undefined {
  if (typeof body !== "string" || body.length === 0) return body
  const parsed = decodeJsonRecord(body)
  if (Option.isNone(parsed)) return body
  const data = parsed.value

  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (ACCOUNT_BODY_KEYS.has(key)) {
      changed = true
      continue
    }
    next[key] = value
  }

  if (isResponsesEndpoint(urlOrPath) && next.store !== true && Array.isArray(next.input)) {
    const stripped = stripResponsesInput(next.input)
    if (stripped.changed) {
      next.input = stripped.kept
      changed = true
    }
  }

  if (options?.dataCollection) {
    const existingProvider = isRecord(next.provider) ? next.provider : {}
    if (existingProvider.data_collection !== options.dataCollection) {
      next.provider = { ...existingProvider, data_collection: options.dataCollection }
      changed = true
    }
  }

  return changed ? JSON.stringify(next) : body
}

// Rewrites an outgoing Web `Request` for the Kilo Gateway:
// - Promotes `x-api-key` to `Authorization: Bearer <key>` (needed when an Anthropic dialect client sends
//   a key credential to `/api/gateway/messages`).
// - Applies `transformBody` to JSON bodies.
export async function rewriteRequest(request: Request, options?: TransformOptions): Promise<Request> {
  const headers = new Headers(request.headers)
  let headersChanged = false
  const apiKey = headers.get("x-api-key")?.trim()
  if (apiKey) {
    if (!headers.has("authorization")) {
      headers.set("authorization", `Bearer ${apiKey}`)
    }
    headers.delete("x-api-key")
    headersChanged = true
  }

  if (request.method === "GET" || request.method === "HEAD" || !request.body) {
    return headersChanged ? new Request(request, { headers }) : request
  }

  const rawBody = await request.clone().text().catch(() => undefined)
  const transformed = transformBody(request.url, rawBody, options)
  if (transformed === rawBody && !headersChanged) return request

  headers.delete("content-length")
  return new Request(request, {
    headers,
    body: transformed ?? rawBody,
    duplex: "half",
  } as RequestInit)
}

function isResponsesEndpoint(urlOrPath: string | URL): boolean {
  const raw = urlOrPath instanceof URL ? urlOrPath.pathname : urlOrPath
  const pathname = URL.canParse(raw) ? new URL(raw).pathname : (raw.split(/[?#]/, 1)[0] ?? "")
  return pathname.endsWith("/responses")
}

function stripResponsesInput(input: readonly unknown[]) {
  const kept = input.flatMap((item) => {
    if (!isRecord(item)) return [item]
    if (item.type === "item_reference") return []
    if (!("id" in item)) return [item]
    const copy = { ...item }
    delete copy.id
    return [copy]
  })
  const changed = kept.length !== input.length || kept.some((item, index) => item !== input[index])
  return { kept, changed }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
