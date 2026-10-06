import { DEFAULT_KILO_AI_GATEWAY_URL, KILO_AI_GATEWAY_OVERRIDE, KILO_API_BASE, KILO_API_OVERRIDE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
  /** AI gateway base URL. Defaults to KILO_AI_GATEWAY_URL; pass "" for none. */
  gateway?: string
  /** Kilo API URL the gateway is derived from. Defaults to KILO_API_URL; pass "" for none. */
  api?: string
}

/** Drops everything after the last `/api` segment and appends `/api/` or `/api/v1/` */
function route(raw: string, name?: "v1"): string {
  const url = new URL(raw)
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  const prefix = api >= 0 ? parts.slice(0, api) : parts
  url.pathname = `/${[...prefix, "api", ...(name ? [name] : [])].join("/")}/`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function slash(raw: string) {
  const url = new URL(raw)
  url.pathname = url.pathname.replace(/\/*$/, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

/**
 * Kilo AI Gateway base URL (`…/api/v1/`) for the AI endpoints:
 * - KILO_AI_GATEWAY_URL as given, unless a baseURL points somewhere else.
 * - Otherwise `/api/v1` on the Kilo API URL: the token URL, baseURL or KILO_API_URL.
 * - Otherwise the production gateway.
 */
export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  const gateway = options.gateway ?? KILO_AI_GATEWAY_OVERRIDE
  if (gateway) {
    const root = slash(gateway)
    if (!options.baseURL || slash(options.baseURL).startsWith(root)) return root
    return route(options.baseURL, "v1")
  }
  const api = getKiloUrlFromToken(options.baseURL ?? options.api ?? KILO_API_OVERRIDE ?? "", options.token ?? "")
  return api ? route(api, "v1") : slash(DEFAULT_KILO_AI_GATEWAY_URL)
}

/** Resolve an AI gateway endpoint, e.g. `fim/completions` */
export function resolveKiloGatewayUrl(path: string, options: UrlOptions = {}): string {
  return new URL(path, resolveKiloGatewayBaseUrl(options)).toString()
}

/** Kilo API root (`…/api/`) for endpoints the AI gateway does not serve, such as `defaults` */
export function resolveKiloApiRoot(options: Pick<UrlOptions, "baseURL" | "token"> = {}): string {
  return route(getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, options.token ?? ""))
}

/** Kilo AI Gateway base URL without a trailing slash; the name predates the gateway split */
export const KILO_OPENROUTER_BASE = resolveKiloGatewayBaseUrl().replace(/\/+$/, "")
