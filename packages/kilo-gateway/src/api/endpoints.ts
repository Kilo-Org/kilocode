import { z } from "zod"
import { getKiloUrlFromToken } from "../auth/token.js"
import { getDefaultHeaders, buildKiloHeaders } from "../headers.js"
import { KILO_API_BASE, KILO_OPENROUTER_BASE, MODELS_FETCH_TIMEOUT_MS } from "./constants.js"

/** Public OpenRouter API base used as a fallback when the gateway does not proxy endpoint listings */
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

const endpointSchema = z.object({
  name: z.string(),
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
    name: raw.provider_name ?? raw.name,
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

async function fetchEndpoints(
  url: string,
  headers: Record<string, string>,
): Promise<KiloModelEndpointsResult & { retriable?: boolean }> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
  }).catch(() => undefined)

  if (!response) return { endpoints: [], error: { kind: "network" }, retriable: true }

  if (!response.ok) {
    const kind = response.status === 401 || response.status === 403 ? "unauthorized" : "http"
    // Every HTTP failure — auth errors included — stays retriable so the
    // "kilo" catalog can fall back to the public OpenRouter listing. The
    // gateway does not proxy endpoint listings today (it answers 405), so
    // failing hard on 401/403 would leave the selector without any catalog.
    return { endpoints: [], error: { kind, status: response.status }, retriable: true }
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
 * With the default `"kilo"` catalog, tries the Kilo Gateway OpenRouter passthrough
 * first and falls back to the public OpenRouter API if the gateway does not expose
 * the endpoint listing (or errors). The `"public"` catalog queries the public
 * OpenRouter API only — for models configured against OpenRouter directly, where
 * gateway-specific entries would not be routable.
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
  const fallback = () => fetchEndpoints(`${OPENROUTER_PUBLIC_API_BASE}/${path}`, getDefaultHeaders())
  if (options?.catalog === "public") {
    const result = await fallback()
    return { endpoints: result.endpoints, ...(result.error ? { error: result.error } : {}) }
  }

  const token = options?.kilocodeToken
  const organizationId = options?.kilocodeOrganizationId

  const defaultBaseURL = organizationId ? `${KILO_API_BASE}/api/organizations/${organizationId}` : KILO_OPENROUTER_BASE
  const baseURL = options?.baseURL ?? defaultBaseURL
  const finalBaseURL = token ? getKiloUrlFromToken(baseURL, token) : baseURL

  const headers = {
    ...getDefaultHeaders(),
    ...buildKiloHeaders(undefined, { kilocodeOrganizationId: organizationId }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  const primary = await fetchEndpoints(`${finalBaseURL}/${path}`, headers)
  if (!primary.error) return { endpoints: primary.endpoints }
  if (!primary.retriable) return primary

  const result = await fallback()
  return { endpoints: result.endpoints, ...(result.error ? { error: result.error } : {}) }
}
