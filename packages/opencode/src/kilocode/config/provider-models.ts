import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { Schema } from "effect"
import { isRecord } from "@/util/record"

export namespace ProviderModels {
  const isModel = Schema.is(ConfigProviderV1.Model)

  export function sanitize(input: unknown, source: string) {
    if (!isRecord(input) || !isRecord(input.provider)) return { config: input, warnings: [] }

    const providers = { ...input.provider }
    const warnings: { path: string; message: string; detail: string }[] = []
    for (const [providerID, value] of Object.entries(providers)) {
      if (!isRecord(value) || !isRecord(value.models)) continue

      const models: Record<string, unknown> = {}
      for (const [modelID, model] of Object.entries(value.models)) {
        if (model === null || isModel(model)) {
          Object.defineProperty(models, modelID, {
            value: model,
            enumerable: true,
            configurable: true,
            writable: true,
          })
          continue
        }

        warnings.push({
          path: source,
          message: `Skipped invalid model configuration at provider.${providerID}.models.${modelID}`,
          detail: "The remaining models for this provider were kept.",
        })
      }

      providers[providerID] = { ...value, models }
    }

    return { config: { ...input, provider: providers }, warnings }
  }
}
