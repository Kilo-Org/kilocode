import { AUTOCOMPLETE_MODELS } from "../../../../src/shared/autocomplete-models"
import type { EnrichedModel } from "../../context/provider"

export const AUTOCOMPLETE_PROVIDER_ID = "kilo"
export const AUTOCOMPLETE_PROVIDER_NAME = "Kilo Gateway"

export const AUTOCOMPLETE_SELECTOR_MODELS: EnrichedModel[] = AUTOCOMPLETE_MODELS.map((m) => ({
  id: m.id,
  name: m.label,
  providerID: AUTOCOMPLETE_PROVIDER_ID,
  providerName: AUTOCOMPLETE_PROVIDER_NAME,
}))
