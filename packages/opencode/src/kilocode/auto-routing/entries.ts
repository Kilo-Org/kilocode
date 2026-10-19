import type { ClientCustomRouterEntry } from "@kilocode/kilo-gateway"
import type { Provider } from "@/provider/provider"

const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

// ADR 0005: the client entry carries the metadata the router needs to rank this
// model, taken from the CLI's own resolved model (models.dev plus config).
export function clientEntry(model: Provider.Model): ClientCustomRouterEntry {
  const modalities = MODALITIES.filter((name) => model.capabilities.input[name])
  const cost = model.cost
  const priced = cost.input > 0 || cost.output > 0 || cost.cache.read > 0 || cost.cache.write > 0
  return {
    kind: "client",
    provider: model.providerID,
    model: model.id,
    variants: Object.keys(model.variants ?? {}),
    capabilities: {
      contextLength: model.limit.context > 0 ? model.limit.context : null,
      inputModalities: [...modalities],
      toolCall: model.capabilities.toolcall,
      reasoning: model.capabilities.reasoning,
    },
    pricing: priced
      ? {
          inputPerMTokUsd: cost.input,
          outputPerMTokUsd: cost.output,
          ...(cost.cache.read > 0 ? { cacheReadPerMTokUsd: cost.cache.read } : {}),
        }
      : null,
  }
}
