type Env = {
  KILO_API_KEY?: string
  KILO_ORG_ID?: string
}

type Provider = {
  key?: unknown
  options?: Record<string, unknown>
}

export type KiloCredentials = {
  token?: string
  organizationId?: string
  baseUrl?: string
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export function text(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed || undefined
}

function token(auth: unknown) {
  const data = record(auth)
  if (data.type === "api") return text(data.key)
  if (data.type === "oauth") return text(data.access)
  if (data.type === "wellknown") return text(data.token)
  return
}

function org(auth: unknown) {
  const data = record(auth)
  if (data.type === "oauth") return text(data.accountId)
  return
}

export function resolveKiloCredentials(input: {
  env?: Env
  config?: unknown
  auth?: unknown
  provider?: Provider
  token?: unknown
  organizationId?: unknown
  baseUrl?: unknown
}): KiloCredentials {
  const env = input.env ?? {}
  const config = record(input.config)
  const options = record(record(config.provider).kilo)
  const configured = record(options.options)
  const provider = input.provider ?? {}
  const state = record(provider.options)

  return {
    token:
      text(env.KILO_API_KEY) ??
      text(configured.apiKey) ??
      text(configured.kilocodeToken) ??
      text(input.token) ??
      token(input.auth) ??
      text(provider.key) ??
      text(state.kilocodeToken) ??
      text(state.apiKey),
    organizationId:
      text(env.KILO_ORG_ID) ??
      text(configured.kilocodeOrganizationId) ??
      text(input.organizationId) ??
      org(input.auth) ??
      text(state.kilocodeOrganizationId),
    baseUrl: text(input.baseUrl) ?? text(configured.baseURL) ?? text(configured.baseUrl),
  }
}
