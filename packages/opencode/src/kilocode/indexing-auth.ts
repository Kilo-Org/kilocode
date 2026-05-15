type Auth = unknown

type Env = {
  KILO_API_KEY?: string
  KILO_ORG_ID?: string
}

type Provider = {
  key?: unknown
  options?: Record<string, unknown>
}

export type KiloIndexingAuth = {
  apiKey?: string
  baseUrl?: string
  organizationId?: string
}

const providers = [
  "openai",
  "ollama",
  "openai-compatible",
  "gemini",
  "mistral",
  "vercel-ai-gateway",
  "bedrock",
  "openrouter",
  "voyage",
]

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return
  const trimmed = value.trim()
  return trimmed || undefined
}

function token(auth: Auth): string | undefined {
  const data = record(auth)
  if (data.type === "api") return text(data.key)
  if (data.type === "oauth") return text(data.access)
  return
}

function org(auth: Auth): string | undefined {
  const data = record(auth)
  if (data.type === "oauth") return text(data.accountId)
  return
}

function value(input: unknown): boolean {
  if (input === undefined || input === null) return false
  if (typeof input === "string") return input.trim().length > 0
  if (typeof input === "object") return Object.values(input).some(value)
  return true
}

function hasOtherProvider(indexing: unknown): boolean {
  const cfg = record(indexing)
  return providers.some((provider) => value(cfg[provider]))
}

export function resolveKiloIndexingAuth(input: {
  config?: unknown
  provider?: Provider
  auth?: Auth
  env?: Env
}): KiloIndexingAuth {
  const config = record(input.config)
  const options = record(record(config.provider).kilo)
  const provider = input.provider ?? record(input.provider)
  const providerOptions = record(provider.options)
  const providerConfig = record(options.options)
  const kilo = record(record(config.indexing).kilo)
  const env = input.env ?? process.env

  return {
    apiKey:
      text(kilo.apiKey) ??
      text(providerConfig.apiKey) ??
      token(input.auth) ??
      text(provider.key) ??
      text(providerOptions.kilocodeToken) ??
      text(env.KILO_API_KEY),
    baseUrl: text(kilo.baseUrl) ?? text(providerConfig.baseURL) ?? text(providerConfig.baseUrl),
    organizationId:
      text(kilo.organizationId) ??
      text(providerConfig.kilocodeOrganizationId) ??
      org(input.auth) ??
      text(providerOptions.kilocodeOrganizationId) ??
      text(env.KILO_ORG_ID),
  }
}

export function hasKiloIndexingAuth(input: Parameters<typeof resolveKiloIndexingAuth>[0]): boolean {
  return !!resolveKiloIndexingAuth(input).apiKey
}

export function shouldDefaultIndexingToKilo(indexing: unknown, auth: KiloIndexingAuth): boolean {
  const cfg = record(indexing)
  if (cfg.provider !== undefined || !auth.apiKey) return false
  return !hasOtherProvider(cfg)
}

export function indexingWithKiloDefault(config: unknown, auth: KiloIndexingAuth) {
  const cfg = record(config)
  const indexing = cfg.indexing
  if (!shouldDefaultIndexingToKilo(indexing, auth)) return indexing
  return { ...record(indexing), provider: "kilo" }
}
