import { AUTOCOMPLETE_MODELS, getAutocompleteModel } from "../../../../src/shared/autocomplete-models"

/**
 * The (provider, model) pair the selector shows. Null when neither is set, so the selector renders the "Not set"
 * clear state; the runtime resolves unset values to the default model separately.
 */
export function getAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider && !modelID) return null
  const model = getAutocompleteModel(provider, modelID)
  return { providerID: model.providerID, modelID: model.modelID }
}

/** The fixed autocomplete catalog, grouped by provider in the selector. */
export const AUTOCOMPLETE_SELECTOR_MODELS = AUTOCOMPLETE_MODELS.map((model) => ({
  id: model.modelID,
  name: model.label,
  providerID: model.providerID,
  providerName: model.provider,
}))
