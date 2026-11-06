import { ConfigProviderV1 } from "@opencode-ai/core/v1/config/provider"
import { Schema } from "effect"
import { isRecord } from "@/util/record"

export namespace ProviderModels {
  const isModel = Schema.is(ConfigProviderV1.Model)

  // Lazily cached set of keys the model schema declares. Wire-shape objects
  // such as a nested "capabilities" key are excess properties the decoder
  // silently drops, so we surface them as warnings instead of hiding them.
  let knownModelKeys: Set<string> | undefined
  function getKnownModelKeys(): Set<string> {
    if (knownModelKeys) return knownModelKeys
    const ast = ConfigProviderV1.Model.ast
    knownModelKeys =
      ast._tag === "Objects"
        ? new Set(ast.propertySignatures.map((item) => String(item.name)))
        : new Set<string>()
    return knownModelKeys
  }

  export function sanitize(input: unknown, source: string) {
    if (!isRecord(input) || !isRecord(input.provider)) return { config: input, warnings: [] }

    const providers = { ...input.provider }
    const warnings: { path: string; message: string; detail: string }[] = []
    for (const [providerID, value] of Object.entries(providers)) {
      if (!isRecord(value) || !isRecord(value.models)) continue

      const models: Record<string, unknown> = {}
      for (const [modelID, model] of Object.entries(value.models)) {
        if (model === null || isModel(model)) {
          if (model !== null && isRecord(model)) {
            const known = getKnownModelKeys()
            // One aggregated warning per model: a wire-shape payload can carry
            // several excess keys, and spamming one warning per key buries the
            // actionable guidance.
            const unknownKeys = Object.keys(model).filter((key) => !known.has(key))
            if (unknownKeys.length > 0) {
              const location = `provider.${providerID}.models.${modelID}`
              warnings.push({
                path: source,
                message:
                  unknownKeys.length === 1
                    ? `Unknown field "${unknownKeys[0]}" at ${location} is ignored`
                    : `Unknown fields ${unknownKeys.map((key) => `"${key}"`).join(", ")} at ${location} are ignored`,
                detail: unknownKeys.includes("capabilities")
                  ? 'Declare model capabilities with the model-level "attachment" boolean and "modalities.input"/"modalities.output" arrays; a wire-shape "capabilities" object is not valid configuration.'
                  : "Only fields declared by the provider model configuration schema are applied to this model.",
              })
            }
          }
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
