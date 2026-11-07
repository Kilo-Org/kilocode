import { z } from "zod"
import { getDefaultHeaders, buildKiloHeaders } from "../headers.js"
import { MODELS_FETCH_TIMEOUT_MS } from "./constants.js"
import { resolveKiloGatewayBaseUrl } from "./url.js"

/** Public OpenRouter API base, used for the "public" catalog (BYOK OpenRouter models) */
const OPENROUTER_PUBLIC_API_BASE = "https://openrouter.ai/api/v1"

/**
 * A single upstream endpoint (inference provider) serving a model.
 * `provider` is the OpenRouter routing slug (endpoint `tag`, e.g. "gmicloud/fp8")
 * usable in the `provider.order` / `provider.only` request routing preferences.
 */
export type KiloModelEndpoint = {
  provider: string
  name: string
  quantization?: string
  context?: number
  output?: number
  /** Prices in $/M tokens */
  pricing?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
  }
  uptime?: number
}

export type KiloModelEndpointsResult = {
  endpoints: KiloModelEndpoint[]
  error?: { kind: "unauthorized" | "network" | "schema" | "http" | "invalid"; status?: number }
}

const price = z.union([z.string(), z.number()]).nullish()

// The gateway response is a subset of the public OpenRouter endpoint listing:
// per-endpoint `name`, `quantization`, `max_completion_tokens`, `uptime_last_30m`
// and `pricing.input_cache_write` are currently absent there, so everything
// beyond the routing slug is optional.
const endpointSchema = z.object({
  name: z.string().nullish(),
  tag: z.string().nullish(),
  provider_name: z.string().nullish(),
  quantization: z.string().nullish(),
  context_length: z.number().nullish(),
  max_completion_tokens: z.number().nullish(),
  pricing: z
    .object({
      prompt: price,
      completion: price,
      input_cache_read: price,
      input_cache_write: price,
    })
    .nullish(),
  uptime_last_30m: z.number().nullish(),
})

const responseSchema = z.object({
  data: z.object({
    // Elements are validated one by one below so a single malformed endpoint
    // drops out alone instead of failing the whole catalog.
    endpoints: z.array(z.unknown()),
  }),
})

function parseApiPrice(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined
  const parsed = typeof value === "number" ? value : parseFloat(value)
  if (isNaN(parsed)) return undefined
  return parsed * 1_000_000 // $/token → $/M tokens
}

function transform(raw: z.infer<typeof endpointSchema>): KiloModelEndpoint | undefined {
  const slug = raw.tag ?? raw.provider_name
  if (!slug) return undefined
  const input = parseApiPrice(raw.pricing?.prompt)
  const output = parseApiPrice(raw.pricing?.completion)
  const read = parseApiPrice(raw.pricing?.input_cache_read)
  const write = parseApiPrice(raw.pricing?.input_cache_write)
  // Omit absent optional keys entirely — present-but-undefined keys are
  // encoded as null by the server response schema.
  return {
    provider: slug,
    name: raw.provider_name ?? raw.name ?? slug,
    ...(raw.quantization != null ? { quantization: raw.quantization } : {}),
    ...(raw.context_length != null ? { context: raw.context_length } : {}),
    ...(raw.max_completion_tokens != null ? { output: raw.max_completion_tokens } : {}),
    ...(input !== undefined || output !== undefined || read !== undefined || write !== undefined
      ? {
          pricing: {
            ...(input !== undefined ? { input } : {}),
            ...(output !== undefined ? { output } : {}),
            ...(read !== undefined ? { cacheRead: read } : {}),
            ...(write !== undefined ? { cacheWrite: write } : {}),
          },
        }
      : {}),
    ...(raw.uptime_last_30m != null ? { uptime: raw.uptime_last_30m } : {}),
  }
}

/**
 * Encode each path segment of a model ID while preserving the author/model slash.
 * Returns undefined for IDs that could escape the /models/… path: empty, "." and
 * ".." segments survive encodeURIComponent and would be normalized away by URL
 * resolution.
 */
function segments(model: string): string | undefined {
  const parts = model.split("/")
  if (parts.some((part) => part === "" || part === "." || part === "..")) return undefined
  return parts.map(encodeURIComponent).join("/")
}

async function fetchEndpoints(url: string, headers: Record<string, string>): Promise<KiloModelEndpointsResult> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  }).catch(() => undefined)

  if (!response) return { endpoints: [], error: { kind: "network" } }

  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
    return { endpoints: [], error: { kind, status: response.status } }
  }

  const json = await response.json().catch(() => null)
  if (json === null) return { endpoints: [], error: { kind: "schema" } }

  const result = responseSchema.safeParse(json)
  if (!result.success) return { endpoints: [], error: { kind: "schema" } }

  const endpoints = result.data.data.endpoints.flatMap((item) => {
    const parsed = endpointSchema.safeParse(item)
    if (!parsed.success) return []
    const endpoint = transform(parsed.data)
    return endpoint ? [endpoint] : []
  })
  return { endpoints }
}

/**
 * Fetch the list of upstream endpoints (inference providers) serving a model.
 *
 * The default `"kilo"` catalog queries the Kilo Gateway endpoints API only —
 * no fallback to the public OpenRouter API, so the catalog never lists an
 * endpoint the gateway cannot actually route (maintainer request in #12380).
 * The `"public"` catalog queries the public OpenRouter API only — for models
 * configured against OpenRouter directly, without Kilo auth headers.
 */
export async function fetchKiloModelEndpoints(
  model: string,
  options?: {
    kilocodeToken?: string
    kilocodeOrganizationId?: string
    baseURL?: string
    catalog?: "kilo" | "public"
  },
): Promise<KiloModelEndpointsResult> {
  const encoded = segments(model)
  if (encoded === undefined) return { endpoints: [], error: { kind: "invalid" } }
  const path = `models/${encoded}/endpoints`

  if (options?.catalog === "public") {
    return fetchEndpoints(`${OPENROUTER_PUBLIC_API_BASE}/${path}`, getDefaultHeaders())
  }

  const token = options?.kilocodeToken
  const organizationId = options?.kilocodeOrganizationId

  // The gateway endpoints API has no organization-scoped path; the
  // organization id travels in the headers instead.
  const baseURL = resolveKiloGatewayBaseUrl({ baseURL: options?.baseURL, token })
  const headers = {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, { kilocodeOrganizationId: organizationId }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  return fetchEndpoints(`${baseURL}${path}`, headers)
}
