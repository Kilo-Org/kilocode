import { resolveKiloGatewayUrl } from "./api/url.js"
import { DEFAULT_AUTOCOMPLETE_MODEL, getAutocompleteModel, type DirectAutocompleteProviderID } from "./autocomplete.js"

export { requestMistralFim } from "./mistral-fim-endpoint.js"

export const DIRECT_FIM_ENV: Record<DirectAutocompleteProviderID, string[]> = {
  mistral: ["MISTRAL_API_KEY"],
}

export type FimTarget =
  | { provider: "kilo"; model: string; url: string }
  | { provider: "mistral"; model: string }

const KILO_FIM_URL = resolveKiloGatewayUrl("fim/completions")

function kiloTarget(model?: string): FimTarget {
  return { provider: "kilo", model: model ?? DEFAULT_AUTOCOMPLETE_MODEL.requestModel, url: KILO_FIM_URL }
}

export function resolveFimTarget(provider?: string, model?: string): FimTarget {
  if (!provider || provider === "kilo") return kiloTarget(model)

  const info = getAutocompleteModel(provider, model)
  if (info.directProvider === "mistral") {
    return { provider: "mistral", model: info.requestModel }
  }
  // An unknown direct provider, such as a retired one, falls back to the default Gateway model.
  return kiloTarget(info.requestModel)
}
