import { KILO_AUTO, KILO_PROVIDER_ID } from "../../../src/shared/provider-model"
import type { EnrichedModel } from "../../src/context/provider-utils"
import type { ModelSelection } from "../../src/types/messages"

const fallback: EnrichedModel = {
  id: KILO_AUTO.modelID,
  name: "Kilo Auto",
  providerID: KILO_PROVIDER_ID,
  providerName: "Kilo Gateway",
}

export function options(models: EnrichedModel[]) {
  const result = models.filter((model) => model.providerID === KILO_PROVIDER_ID)
  if (result.length) return result
  return [fallback]
}

export function initial(models: EnrichedModel[], selected: ModelSelection | null) {
  if (selected?.providerID === KILO_PROVIDER_ID && models.some((model) => model.id === selected.modelID)) {
    return selected.modelID
  }
  return models[0]?.id
}
