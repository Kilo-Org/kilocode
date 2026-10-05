import {
  DEFAULT_KILO_AI_GATEWAY_URL,
  DEFAULT_KILO_API_URL,
  KILO_AI_GATEWAY_OVERRIDE,
  KILO_API_BASE,
} from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
  /** AI gateway base URL (`…/api/v1`). Defaults to KILO_AI_GATEWAY_URL; pass "" to infer it. */
  gateway?: string
  /** Kilo API URL the gateway is inferred from. Defaults to KILO_API_BASE. */
  api?: string
}

/** Cloud dev runs the web app on 3000 + offset and the ai-gateway app on 3010 + offset. */
const LOCAL_GATEWAY_PORT_OFFSET = 10

function route(raw: string, name?: "gateway" | "openrouter"): string {
  const url = new URL(raw)
  const parts = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean)
  const api = parts.lastIndexOf("api")
  const prefix = api >= 0 ? parts.slice(0, api) : parts
  url.pathname = `/${[...prefix, "api", ...(name ? [name] : [])].join("/")}/`
  url.search = ""
  url.hash = ""
  return url.toString()
}

function base(options: UrlOptions): string {
  return getKiloUrlFromToken(options.baseURL ?? options.api ?? KILO_API_BASE, options.token ?? "")
}

function slash(url: URL) {
  const result = new URL(url)
  result.pathname = result.pathname.replace(/\/*$/, "/")
  result.search = ""
  result.hash = ""
  return result.toString()
}

function loopback(host: string) {
  return host === "localhost" || host === "[::1]" || host.startsWith("127.")
}

function origin(raw: string) {
  return URL.parse(raw)?.origin
}

/**
 * The AI gateway serving a URL: the URL itself when it already is a gateway base, production for
 * api.kilo.ai, and, for a local Kilo API URL, the local ai-gateway app. Other hosts have none and
 * keep their legacy routes.
 */
function infer(raw: string, local: boolean) {
  const url = URL.parse(raw)
  if (!url) return
  if (/\/api\/v1\/?$/.test(url.pathname)) return slash(url)
  if (url.origin === origin(DEFAULT_KILO_API_URL)) return slash(new URL(DEFAULT_KILO_AI_GATEWAY_URL))
  if (!local || !loopback(url.hostname)) return
  const port = url.port ? Number(url.port) + LOCAL_GATEWAY_PORT_OFFSET : 3010
  return `${url.protocol}//${url.hostname}:${port}/api/v1/`
}

/**
 * Root (`…/api/v1/`) of the Kilo AI Gateway, or undefined when the AI endpoints stay on their
 * legacy routes. KILO_AI_GATEWAY_URL wins unless a baseURL points at a custom endpoint. Otherwise
 * the gateway is inferred from the token URL, baseURL or KILO_API_URL; only a Kilo API URL (not a
 * custom localhost baseURL) maps to the local ai-gateway app.
 */
export function resolveKiloAiGatewayRoot(options: UrlOptions = {}): string | undefined {
  const api = options.api ?? KILO_API_BASE
  const gateway = options.gateway ?? KILO_AI_GATEWAY_OVERRIDE
  const own = [gateway, api, DEFAULT_KILO_API_URL].some(
    (item) => item && origin(item) === origin(options.baseURL ?? ""),
  )
  if (gateway && (!options.baseURL || own)) return slash(new URL(gateway))
  const token = getKiloUrlFromToken("", options.token ?? "")
  if (token) return infer(token, true)
  if (options.baseURL) return infer(options.baseURL, origin(options.baseURL) === origin(api))
  return infer(api, true)
}

/**
 * Resolve an AI gateway endpoint. `path` is relative to the gateway's `/api/v1/`;
 * `legacy` is the path KILO_API_BASE serves the same endpoint at.
 */
export function resolveKiloAiGatewayUrl(path: string, legacy: string, options: Pick<UrlOptions, "gateway"> = {}) {
  const root = resolveKiloAiGatewayRoot(options)
  if (root) return new URL(path, root).toString()
  return `${KILO_API_BASE}${legacy}`
}

/** Kilo API root (`…/api/`) for endpoints the AI gateway does not serve, such as `defaults` */
export function resolveKiloApiRoot(options: Omit<UrlOptions, "gateway"> = {}): string {
  return route(base(options))
}

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "gateway")
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return resolveKiloAiGatewayRoot(options) ?? route(base(options), "openrouter")
}

/** Base URL for the OpenRouter-compatible endpoint, without a trailing slash */
export const KILO_OPENROUTER_BASE = resolveKiloAiGatewayRoot()?.replace(/\/+$/, "") ?? `${KILO_API_BASE}/api/openrouter`
