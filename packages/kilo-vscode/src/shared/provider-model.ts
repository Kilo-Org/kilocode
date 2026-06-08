export const KILO_PROVIDER_ID = "kilo"
export const KILO_AUTO = { providerID: KILO_PROVIDER_ID, modelID: "kilo-auto/free" } as const
export const CUSTOM_PROVIDER_PACKAGE = "@ai-sdk/openai-compatible"
export const CUSTOM_PROVIDER_INTERFACE_IDS = [
  "google-generative-ai",
  "openai-compatible",
  "openai-responses",
  "anthropic",
] as const
export type CustomProviderInterface = (typeof CUSTOM_PROVIDER_INTERFACE_IDS)[number]

const CUSTOM_PROVIDER_PACKAGES = {
  "google-generative-ai": "@ai-sdk/google",
  "openai-compatible": CUSTOM_PROVIDER_PACKAGE,
  "openai-responses": "@ai-sdk/openai",
  anthropic: "@ai-sdk/anthropic",
} as const
export type CustomProviderPackage = (typeof CUSTOM_PROVIDER_PACKAGES)[CustomProviderInterface]

const DEFAULT_CUSTOM_PROVIDER_INTERFACE: CustomProviderInterface = "openai-compatible"
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/

export const PROVIDER_PRIORITY = [
  KILO_PROVIDER_ID,
  "anthropic",
  "deepseek",
  "openai",
  "google",
  "openrouter",
  "vercel",
] as const

export function parseModelString(raw: string | undefined | null) {
  if (!raw) return null
  const slash = raw.indexOf("/")
  if (slash <= 0 || slash >= raw.length - 1) return null
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) }
}

export function providerOrderIndex(providerID: string, order = PROVIDER_PRIORITY) {
  const index = order.indexOf(providerID.toLowerCase() as (typeof PROVIDER_PRIORITY)[number])
  return index >= 0 ? index : order.length
}

export function createKiloFallbackProvider() {
  return {
    id: KILO_PROVIDER_ID,
    name: "Kilo Gateway",
    source: "custom" as const,
    env: ["KILO_API_KEY"],
    models: {},
  }
}

function isCustomProviderInterface(value: unknown): value is CustomProviderInterface {
  return typeof value === "string" && CUSTOM_PROVIDER_INTERFACE_IDS.includes(value as CustomProviderInterface)
}

export function customProviderPackage(type: CustomProviderInterface): CustomProviderPackage {
  return CUSTOM_PROVIDER_PACKAGES[type]
}

export function isCustomProviderPackage(value: unknown): value is CustomProviderPackage {
  return Object.values(CUSTOM_PROVIDER_PACKAGES).includes(value as CustomProviderPackage)
}

export function customProviderInterface(npm?: unknown, option?: unknown): CustomProviderInterface {
  if (isCustomProviderInterface(option)) return option
  const match = Object.entries(CUSTOM_PROVIDER_PACKAGES).find(([, pkg]) => pkg === npm)
  if (match) return match[0] as CustomProviderInterface
  return DEFAULT_CUSTOM_PROVIDER_INTERFACE
}
