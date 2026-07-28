import type { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
export function filterPromptTrainingModels(providers: Record<string, Provider.Info>, hide: boolean) {
  if (!hide) return providers
  return Object.fromEntries(
    Object.entries(providers).map(([id, provider]) => {
      if (id !== ProviderV2.ID.kilo) return [id, provider]
      const models = Object.fromEntries(
        Object.entries(provider.models).filter(([, model]) => model.mayTrainOnYourPrompts !== true),
      )
      return [id, { ...provider, models }]
    }),
  )
}

export function nonEmptyProviders(providers: Record<string, Provider.Info>) {
  return Object.fromEntries(Object.entries(providers).filter(([, provider]) => Object.keys(provider.models).length > 0))
}
