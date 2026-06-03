/**
 * Parse KiloCode URL from token
 * Some tokens contain encoded base URL information
 */
export function getKiloUrlFromToken(defaultUrl: string, token: string): string {
  // If token contains URL information, extract it
  if (!token) return defaultUrl

  const match = token.match(/^(https?:\/\/[^:]+(?::\d+)?(?:\/[^:]*)?):/)
  if (!match) return defaultUrl

  try {
    return new URL(match[1]).toString().replace(/\/+$/, "")
  } catch {
    return defaultUrl
  }
}

/**
 * Validate KiloCode token format
 */
export function isValidKilocodeToken(token: string): boolean {
  if (!token || typeof token !== "string") return false

  // Basic validation - adjust based on actual token requirements
  return token.length > 10
}

type KiloEnv = {
  KILO_API_KEY?: string
  KILO_ORG_ID?: string
}

function text(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function runtime(env?: KiloEnv): KiloEnv {
  if (env) return env
  if (typeof process === "undefined") return {}
  return {
    KILO_API_KEY: process.env.KILO_API_KEY,
    KILO_ORG_ID: process.env.KILO_ORG_ID,
  }
}

export function getEnvApiKey(env?: KiloEnv) {
  return text(runtime(env).KILO_API_KEY)
}

export function getEnvOrganizationId(env?: KiloEnv) {
  return text(runtime(env).KILO_ORG_ID)
}

/**
 * Get the Kilo API key, preferring the explicit environment override.
 */
export function getApiKey(options: { kilocodeToken?: string; apiKey?: string; env?: KiloEnv } = {}): string | undefined {
  return getEnvApiKey(options.env) ?? text(options.kilocodeToken) ?? text(options.apiKey)
}

export function getKiloOrganizationId(
  options: { kilocodeOrganizationId?: string; env?: KiloEnv } = {},
): string | undefined {
  return getEnvOrganizationId(options.env) ?? text(options.kilocodeOrganizationId)
}
