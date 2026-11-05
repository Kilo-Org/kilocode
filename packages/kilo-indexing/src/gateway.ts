import { KiloHeaders, KiloServer } from "@kilocode/gateway-core"

// The Kilo Gateway helpers that the engine needs, on top of @kilocode/gateway-core.

export const HEADER_FEATURE = KiloHeaders.HEADER_FEATURE
export const HEADER_ORGANIZATIONID = KiloHeaders.HEADER_ORGANIZATION

/**
 * The Kilo gateway base. A URL in a development token wins over the configured base URL. A configured AI gateway base
 * keeps its own path (`KILO_AI_GATEWAY_URL`, or `${KILO_API_URL}/api/gateway/v1`); a custom or token-embedded server
 * keeps the legacy `${prefix}/api/gateway/` route.
 */
export function resolveKiloGatewayBaseUrl(options: { baseURL?: string; token?: string } = {}): string {
  const base =
    (options.token ? KiloServer.fromToken(options.token) : undefined) ?? options.baseURL ?? KiloServer.aiGatewayFromEnv()
  return `${KiloServer.gateway(base)}/`
}

export function getDefaultHeaders(): Record<string, string> {
  const version = process.env.KILOCODE_VERSION
  return {
    "User-Agent": version ? `${KiloHeaders.USER_AGENT_PREFIX}/${version}` : KiloHeaders.USER_AGENT_PREFIX,
    "Content-Type": "application/json",
  }
}
