import { KILO_AI_GATEWAY_BASE, KILO_API_BASE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
  /** AI gateway base URL. Defaults to KILO_AI_GATEWAY_URL; pass "" for none. */
  gateway?: string
}

function route(raw: string, name: "gateway" | "openrouter"): string {
  const url = new URL(raw)
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  const prefix = api >= 0 ? parts.slice(0, api) : parts
  url.pathname = `/${[...prefix, "api", name].join("/")}/`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function base(options: UrlOptions): string {
  return getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, options.token ?? "")
}

function slash(raw: string) {
  const url = new URL(raw)
  url.pathname = url.pathname.replace(/\/*$/, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

/**
 * KILO_AI_GATEWAY_URL as a base URL with a trailing slash, or undefined when it is unset or a
 * baseURL points somewhere else. A baseURL under the gateway (such as KILO_OPENROUTER_BASE) keeps it.
 */
export function resolveKiloAiGatewayRoot(options: UrlOptions = {}): string | undefined {
  const gateway = options.gateway ?? KILO_AI_GATEWAY_BASE
  if (!gateway) return undefined
  const root = slash(gateway)
  if (options.baseURL && !slash(options.baseURL).startsWith(root)) return undefined
  return root
}

/**
 * Resolve an AI endpoint: `path` under KILO_AI_GATEWAY_URL when it is set, otherwise the
 * `legacy` path on KILO_API_BASE.
 */
export function resolveKiloAiGatewayUrl(path: string, legacy: string, options: Pick<UrlOptions, "gateway"> = {}) {
  const root = resolveKiloAiGatewayRoot(options)
  if (root) return new URL(path, root).toString()
  return `${KILO_API_BASE}${legacy}`
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "gateway")
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "openrouter")
}

/** Base URL for the OpenRouter-compatible endpoint, without a trailing slash */
export const KILO_OPENROUTER_BASE = resolveKiloAiGatewayRoot()?.replace(/\/+$/, "") ?? `${KILO_API_BASE}/api/openrouter`
