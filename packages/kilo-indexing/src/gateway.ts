import { KiloHeaders, KiloServer } from "@kilocode/gateway-core"

// The Kilo Gateway helpers that the engine needs, on top of @kilocode/gateway-core.

export const HEADER_FEATURE = KiloHeaders.HEADER_FEATURE
export const HEADER_ORGANIZATIONID = KiloHeaders.HEADER_ORGANIZATION

/** The `/api/gateway/` route of the Kilo API. A URL in a development token wins over the configured base URL. */
export function resolveKiloGatewayBaseUrl(options: { baseURL?: string; token?: string } = {}): string {
  const base = (options.token ? KiloServer.fromToken(options.token) : undefined) ?? options.baseURL ?? KiloServer.fromEnv()
  return `${KiloServer.apiUrl(base, "gateway")}/`
}

export function getDefaultHeaders(): Record<string, string> {
  const version = process.env.KILOCODE_VERSION
  return {
    "User-Agent": version ? `${KiloHeaders.USER_AGENT_PREFIX}/${version}` : KiloHeaders.USER_AGENT_PREFIX,
    "Content-Type": "application/json",
  }
}
