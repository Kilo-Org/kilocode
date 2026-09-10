import { AUTOCOMPLETE_MODELS, getAutocompleteModel } from "../../../../src/shared/autocomplete-models"
import type { EnrichedModel } from "../../context/provider"

/**
 * Resolve the (provider, model) pair to the dropdown's value. Returns
 * `null` when neither is set so the selector renders the "Not set" (clear)
 * state via `allowClear`. The runtime resolves unset values to
 * `DEFAULT_AUTOCOMPLETE_MODEL` separately.
 */
export function getAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider && !modelID) return null
  const model = getAutocompleteModel(provider, modelID)
  return { providerID: model.providerID, modelID: model.modelID }
}

export const AUTOCOMPLETE_SELECTOR_MODELS: EnrichedModel[] = AUTOCOMPLETE_MODELS.map((m) => ({
  id: m.modelID,
  name: m.label,
  providerID: m.providerID,
  providerName: m.provider,
}))
