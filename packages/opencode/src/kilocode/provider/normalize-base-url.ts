// kilocode_change - new file
//
// Normalizes the Kilo Gateway base URL based on whether an organization is
// configured. Extracted from packages/opencode/src/provider/models.ts to keep
// Kilo-specific logic out of shared upstream files.

export function normalizeKiloBaseURL(baseURL: string | undefined, org: string | undefined): string | undefined {
  if (!baseURL) return undefined
  const trimmed = baseURL.replace(/\/+$/, "")
  if (org) {
    if (trimmed.includes("/api/organizations/")) return trimmed
    if (trimmed.endsWith("/api")) return `${trimmed}/organizations/${org}`
    return `${trimmed}/api/organizations/${org}`
  }
  if (trimmed.includes("/openrouter")) return trimmed
  if (trimmed.endsWith("/api")) return `${trimmed}/openrouter`
  return `${trimmed}/api/openrouter`
}
