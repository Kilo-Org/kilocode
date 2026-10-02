import { KILO_AI_GATEWAY_BASE, KILO_API_BASE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
  /** Dedicated AI gateway URL. Defaults to KILO_AI_GATEWAY_URL; pass "" to use the Kilo API routes. */
  gateway?: string
}

function route(raw: string, name: "gateway" | "openrouter" | "v1"): string {
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

/**
 * Root (`…/api/v1/`) of the dedicated Kilo AI Gateway, or undefined when the AI endpoints are
 * served by the Kilo API. A `baseURL` on another origin pins the Kilo API routes it points at;
 * one on the gateway's origin (such as KILO_OPENROUTER_BASE) keeps using the gateway.
 */
export function resolveKiloAiGatewayRoot(options: UrlOptions = {}): string | undefined {
  const gateway = options.gateway ?? KILO_AI_GATEWAY_BASE
  if (!gateway) return
  const root = route(gateway, "v1")
  if (options.baseURL && URL.parse(options.baseURL)?.origin !== new URL(root).origin) return
  return root
}

/**
 * Resolve an AI gateway endpoint. `path` is relative to the dedicated gateway's `/api/v1/`;
 * `legacy` is the path KILO_API_BASE serves the same endpoint at.
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
