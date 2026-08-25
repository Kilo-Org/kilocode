import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"

export type ProcessingMode = "standard" | "flex"
export const FLEX_REQUEST_TIMEOUT_MS = 900_000
const FLEX_MODEL_IDS = new Set([
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.5-pro",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-pro",
  "gpt-5.2",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-pro",
  "o3",
  "o4-mini",
])

export function isFlexRequest(input: { model: Pick<Provider.Model, "api" | "id" | "providerID">; body: unknown }) {
  if (input.model.providerID !== "openai") return false
  if (input.model.api.npm !== "@ai-sdk/openai") return false
  if (!FLEX_MODEL_IDS.has(input.model.id)) return false
  return typeof input.body === "string" && /"service_tier"\s*:\s*"flex"/.test(input.body)
}

type Input = {
  provider: Pick<Provider.Info, "id" | "options" | "source">
  model: Pick<Provider.Model, "api" | "id">
  auth: Pick<Auth.Info, "type"> | undefined
}

export function supportsFlex(input: Input) {
  if (input.provider.id !== "openai") return false
  if (input.auth?.type === "oauth") return false
  if (input.auth?.type !== "api" && input.provider.source !== "env" && input.provider.source !== "api") return false
  if (input.model.api.npm !== "@ai-sdk/openai") return false
  if (!FLEX_MODEL_IDS.has(input.model.id)) return false
  const url = input.provider.options.baseURL || input.model.api.url
  return !url || (URL.canParse(url) && new URL(url).hostname === "api.openai.com")
}

export function apply(input: {
  mode: ProcessingMode | undefined
  provider: Input["provider"]
  model: Input["model"]
  auth: Input["auth"]
  options: Record<string, unknown>
}) {
  if (!input.mode) return input.options
  if (input.mode === "flex" && !supportsFlex(input)) {
    throw new Error("Flex processing is only available for direct OpenAI API Responses models")
  }
  if (input.mode === "standard" && !supportsFlex(input)) return input.options
  const options = { ...input.options }
  delete options.serviceTier
  if (input.mode === "flex") options.serviceTier = "flex"
  return options
}
