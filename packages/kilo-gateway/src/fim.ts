import { KILO_API_BASE } from "./api/constants.js"
import { getAutocompleteModel, type DirectAutocompleteProviderID } from "./autocomplete.js"

export { requestMistralFim } from "./mistral-fim-endpoint.js"

export const DIRECT_FIM_ENV: Record<DirectAutocompleteProviderID, string[]> = {
  mistral: ["MISTRAL_API_KEY"],
  inception: ["INCEPTION_API_KEY"],
}

export type FimTarget =
  | { provider: "kilo"; model: string; url: string }
  | { provider: "inception"; model: string; url: string }
  | { provider: "mistral"; model: string }
  | { provider: "configured"; providerID: string; model: string }

const KILO_FIM_URL = KILO_API_BASE + "/api/fim/completions"
const INCEPTION_FIM_URL = "https://api.inceptionlabs.ai/v1/fim/completions"

export function openAICompletionsUrl(baseURL: string) {
  return `${baseURL.replace(/\/+$/, "")}/completions`
}

export function isLoopbackUrl(value: string) {
  if (!URL.canParse(value)) return false
  const hostname = new URL(value).hostname
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1"
}

export function buildOpenAICompletionsRequest(input: {
  model: string
  prefix: string
  suffix: string
  maxTokens: number
  temperature: number
}) {
  return {
    model: input.model,
    prompt: input.prefix,
    suffix: input.suffix,
    max_tokens: input.maxTokens,
    temperature: input.temperature,
    stream: true,
  }
}

function kiloTarget(model?: string): FimTarget {
  return { provider: "kilo", model: model ?? "mistralai/codestral-2501", url: KILO_FIM_URL }
}

export function resolveFimTarget(provider?: string, model?: string): FimTarget {
  if (!provider || provider === "kilo") return kiloTarget(model)

  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  if (info.directProvider === "inception") {
    return { provider: "inception", model: info.requestModel, url: INCEPTION_FIM_URL }
  }
  if (info.configuredProvider) {
    return { provider: "configured", providerID: info.providerID, model: info.requestModel }
  }
  return { provider: "configured", providerID: provider, model: model ?? "" }
}
