import { getAutocompleteModel } from "../../../../src/shared/autocomplete-models"

/**
 * Resolve the stored provider/model pair to the dropdown value. The selector
 * itself uses the normal connected-provider model list, just like the other
 * model settings on this page.
 */
export function getAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider && !modelID) return null
  const model = getAutocompleteModel(provider, modelID)
  return { providerID: model.providerID, modelID: model.modelID }
}

/**
 * True when the selection resolves to a configured-provider (BYOK) model
 * rather than a curated entry. Curated models are known to support FIM;
 * custom models are unverified, so the settings UI shows a warning.
 */
export function isCustomAutocompleteSelection(provider?: string, modelID?: string) {
  if (!provider || !modelID) return false
  return getAutocompleteModel(provider, modelID).configuredProvider === true
}
