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

const KILO_FIM_URL = KILO_API_BASE + "/api/fim/completions"
const INCEPTION_FIM_URL = "https://api.inceptionlabs.ai/v1/fim/completions"

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
  return kiloTarget(model)
}
