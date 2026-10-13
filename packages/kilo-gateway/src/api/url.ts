import { KILO_AI_GATEWAY_BASE, KILO_API_BASE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
}

function clean(raw: string) {
  const url = new URL(raw)
  url.search = ""
  url.hash = ""
  return url
}

/** Legacy API app route, e.g. `https://api.kilo.ai/api/openrouter/`. */
function route(raw: string, name: "gateway" | "openrouter"): string {
  const url = clean(raw)
  const parts = url.pathname.split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  const prefix = api >= 0 ? parts.slice(0, api) : parts
  url.pathname = `/${[...prefix, "api", name].join("/")}/`
  return url.toString()
}

/**
 * AI gateway root, e.g. `https://ai-gateway.kilo.ai/api/v1/`, when the URL is the
 * configured AI gateway base. Any other URL (custom base URLs, token-embedded URLs)
 * keeps the legacy API app routing.
 */
function gateway(raw: string): string | undefined {
  if (!KILO_AI_GATEWAY_BASE) return undefined
  const text = clean(raw).toString().replace(/\/+$/, "")
  if (text !== clean(KILO_AI_GATEWAY_BASE).toString().replace(/\/+$/, "")) return undefined
  return `${text}/`
}

function resolve(options: UrlOptions, name: "gateway" | "openrouter"): string {
  const raw = getKiloUrlFromToken(options.baseURL ?? KILO_AI_GATEWAY_BASE ?? KILO_API_BASE, options.token ?? "")
  return gateway(raw) ?? route(raw, name)
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return resolve(options, "gateway")
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return resolve(options, "openrouter")
}

/**
 * Resolve a Kilo AI gateway endpoint from the environment.
 *
 * `path` is relative to the AI gateway root (KILO_AI_GATEWAY_URL, default
 * `https://ai-gateway.kilo.ai/api/v1`). `legacy` is the matching path under
 * `${KILO_API_URL}/api/`, used when only the legacy KILO_API_URL is set.
 */
export function resolveKiloGatewayUrl(path: string, legacy = path): string {
  if (KILO_AI_GATEWAY_BASE) return `${KILO_AI_GATEWAY_BASE}/${path}`
  return `${KILO_API_BASE}/api/${legacy}`
}
