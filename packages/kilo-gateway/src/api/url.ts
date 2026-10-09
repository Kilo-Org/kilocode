import { DEFAULT_KILO_AI_GATEWAY_URL, KILO_AI_GATEWAY_OVERRIDE, KILO_API_BASE, KILO_API_OVERRIDE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
  /** KILO_AI_GATEWAY_URL value. Defaults to the process environment; pass "" for unset. */
  gateway?: string
  /** KILO_API_URL value. Defaults to the process environment; pass "" for unset. */
  api?: string
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
  return getKiloUrlFromToken(options.baseURL ?? (options.api || KILO_API_BASE), options.token ?? "")
}

function slash(raw: string) {
  const url = new URL(raw)
  url.pathname = url.pathname.replace(/\/*$/, "/")
  url.search = ""
  url.hash = ""
  return url.toString()
}

/**
 * Kilo AI Gateway base URL with a trailing slash, or undefined when the AI endpoints use the
 * legacy routes on the Kilo API:
 * - A valid KILO_AI_GATEWAY_URL is used as given.
 * - Otherwise a custom Kilo API (KILO_API_URL or a URL embedded in the token) keeps the legacy routes.
 * - Otherwise the production gateway is used.
 * A baseURL outside the gateway also keeps the legacy routes; one under it (such as
 * KILO_OPENROUTER_BASE) keeps the gateway.
 */
export function resolveKiloAiGatewayRoot(options: UrlOptions = {}): string | undefined {
  const raw = (options.gateway ?? KILO_AI_GATEWAY_OVERRIDE)?.trim()
  const custom = (options.api ?? KILO_API_OVERRIDE) || getKiloUrlFromToken("", options.token ?? "")
  const gateway = raw && URL.canParse(raw) ? raw : custom ? undefined : DEFAULT_KILO_AI_GATEWAY_URL
  if (!gateway) return undefined
  const root = slash(gateway)
  if (options.baseURL && !slash(options.baseURL).startsWith(root)) return undefined
  return root
}

/**
 * Resolve an AI endpoint: `path` under the Kilo AI Gateway, or the `legacy` path on KILO_API_BASE
 * when the legacy routes apply.
 */
export function resolveKiloAiGatewayUrl(
  path: string,
  legacy: string,
  options: Pick<UrlOptions, "gateway" | "api"> = {},
) {
  const root = resolveKiloAiGatewayRoot(options)
  if (root) return new URL(path, root).toString()
  return `${options.api || KILO_API_BASE}${legacy}`
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "gateway")
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "openrouter")
}

/** Base URL for the OpenRouter-compatible endpoint, without a trailing slash */
export const KILO_OPENROUTER_BASE = resolveKiloAiGatewayRoot()?.replace(/\/+$/, "") ?? `${KILO_API_BASE}/api/openrouter`
