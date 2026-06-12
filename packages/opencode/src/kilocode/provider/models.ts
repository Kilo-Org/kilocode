import { resolveKiloCredentials } from "@/kilocode/auth/credentials"

export type KiloModelOptions = {
  baseURL?: string
  kilocodeOrganizationId?: string
  kilocodeToken?: string
}

export function normalizeKiloBaseURL(baseURL: string | undefined, org: string | undefined) {
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

export function resolveKiloModelOptions(input: { config?: unknown; auth?: unknown }) {
  const credentials = resolveKiloCredentials(input)
  const baseURL = normalizeKiloBaseURL(credentials.baseUrl, credentials.organizationId)
  return {
    ...(baseURL ? { baseURL } : {}),
    ...(credentials.organizationId ? { kilocodeOrganizationId: credentials.organizationId } : {}),
  }
}

export function mergeKiloModelOptions(
  providerID: string,
  resolved: KiloModelOptions,
  options: KiloModelOptions,
): KiloModelOptions {
  if (providerID !== "kilo") return { ...resolved, ...options }
  return { ...options, ...resolved }
}
