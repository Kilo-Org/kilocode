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
