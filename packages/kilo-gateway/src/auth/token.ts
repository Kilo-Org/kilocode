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

/**
 * Get API key from options or environment
 */
export function getApiKey(options: { kilocodeToken?: string; apiKey?: string }): string | undefined {
  return options.kilocodeToken ?? options.apiKey
}
