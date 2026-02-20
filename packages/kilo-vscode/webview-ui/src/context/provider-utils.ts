import type { Provider, ProviderModel, ModelSelection } from "../types/messages"

export type EnrichedModel = ProviderModel & { providerID: string; providerName: string }

/**
 * Flatten a provider map into a list of models enriched with provider info.
 */
export function flattenModels(providers: Record<string, Provider>): EnrichedModel[] {
  const result: EnrichedModel[] = []
  for (const providerID of Object.keys(providers)) {
    const provider = providers[providerID]!
    for (const modelID of Object.keys(provider.models)) {
      result.push({
        ...provider.models[modelID]!,
        id: modelID,
        providerID,
        providerName: provider.name,
      })
    }
  }
  return result
}

/**
 * Find an enriched model from a flat model list by provider ID and model ID.
 */
export function findModel(models: EnrichedModel[], selection: ModelSelection | null): EnrichedModel | undefined {
  if (!selection) return undefined
  return models.find((m) => m.providerID === selection.providerID && m.id === selection.modelID)
}
