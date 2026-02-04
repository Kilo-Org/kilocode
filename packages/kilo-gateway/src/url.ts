// kilocode_change - new file

const trim = (value: string): string => value.replace(/\/+$/, "")

const ensureSlash = (value: string): string => (value[value.length - 1] === "/" ? value : `${value}/`)

const toOpenRouter = (value: string): string => {
  if (value.indexOf("/api/organizations/") >= 0) {
    return value
      .replace(/\/api\/organizations\/[^/]+\/openrouter(?:\/|$)/, "/api/openrouter")
      .replace(/\/api\/organizations\/[^/]+(?:\/|$)/, "/api/openrouter")
  }
  return value
}

const ensureOpenRouter = (value: string): string => {
  if (value.indexOf("/openrouter") >= 0) return value
  if (value.slice(-4) === "/api") return `${value}/openrouter`
  if (value.indexOf("/api/") >= 0) return `${value}/openrouter`
  return `${value}/api/openrouter`
}

export function normalizeKiloOpenRouterURL(input: { baseURL: string; kilocodeOrganizationId?: string }): {
  baseURL: string
  kilocodeOrganizationId?: string
} {
  const base = trim(input.baseURL)
  const updated = ensureOpenRouter(toOpenRouter(base))
  const normalized = ensureSlash(trim(updated))
  return {
    baseURL: normalized,
    ...(input.kilocodeOrganizationId ? { kilocodeOrganizationId: input.kilocodeOrganizationId } : {}),
  }
}
