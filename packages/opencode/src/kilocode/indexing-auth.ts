import type { IndexingConfig } from "@kilocode/kilo-indexing/config"
import { resolveKiloCredentials } from "./auth/credentials"

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
  const provider = input.provider ?? record(input.provider)
  const kilo = record(record(config.indexing).kilo)
  const credentials = resolveKiloCredentials({
    env: input.env,
    config,
    provider,
    auth: input.auth,
    token: kilo.apiKey,
    organizationId: kilo.organizationId,
    baseUrl: kilo.baseUrl,
  })

  return {
    apiKey: credentials.token,
    baseUrl: credentials.baseUrl,
    organizationId: credentials.organizationId,
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

export function indexingWithKiloDefault(
  indexing: IndexingConfig | undefined,
  auth: KiloIndexingAuth,
): IndexingConfig | undefined {
  if (!shouldDefaultIndexingToKilo(indexing, auth)) return indexing
  return { ...indexing, provider: "kilo" }
}
