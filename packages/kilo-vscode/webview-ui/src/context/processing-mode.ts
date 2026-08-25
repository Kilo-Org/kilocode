import type { ModelSelection, ProcessingMode, Provider } from "../types/messages"

export const DEFAULT_PROCESSING_MODE: ProcessingMode = "standard"
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

export function supportsFlex(
  providers: Record<string, Provider>,
  authStates: Record<string, "api" | "oauth" | "wellknown">,
  selection: ModelSelection | null,
) {
  if (!selection || selection.providerID !== "openai") return false
  const provider = providers[selection.providerID]
  if (!provider) return false
  if (authStates[selection.providerID] === "oauth") return false
  if (authStates[selection.providerID] !== "api" && provider.source !== "env" && provider.source !== "api") return false
  const model = provider.models[selection.modelID]
  if (model?.api?.npm !== "@ai-sdk/openai") return false
  if (!FLEX_MODEL_IDS.has(model.id)) return false
  const url = provider.options?.baseURL || model.api.url
  return !url || (URL.canParse(url) && new URL(url).hostname === "api.openai.com")
}
