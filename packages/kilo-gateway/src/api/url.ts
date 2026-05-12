import { KILO_API_BASE } from "./constants.js"
import { getKiloUrlFromToken } from "../auth/token.js"

type UrlOptions = {
  baseURL?: string
  token?: string
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

export function resolveKiloGatewayBaseUrl(options: UrlOptions = {}): string {
  return route(base(options), "gateway")
}

export function resolveKiloOpenRouterBaseUrl(options: UrlOptions = {}): string {
  return route(base(options), "openrouter")
}
