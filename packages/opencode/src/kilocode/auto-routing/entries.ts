import type { ClientCustomRouterEntry } from "@kilocode/kilo-gateway"
import type { Provider } from "@/provider/provider"

const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

// ADR 0005: the client entry carries the metadata the router needs to rank this
// model, taken from the CLI's own resolved model (models.dev plus config).
export function clientEntry(model: Provider.Model, measuredAs?: string): ClientCustomRouterEntry {
  const modalities = MODALITIES.filter((name) => model.capabilities.input[name])
  const cost = model.cost
  const priced = cost.input > 0 || cost.output > 0 || cost.cache.read > 0 || cost.cache.write > 0
  return {
    kind: "client",
    provider: model.providerID,
    model: model.id,
    ...(measuredAs ? { measuredAs } : {}),
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

export type LinkChoice =
  | { kind: "link"; measuredAs: string }
  | { kind: "skip" }
  | { kind: "ask"; suggestion: string }

// How `kilo auto router add` picks a platform benchmark link. A suggestion needs an interactive
// answer, so a non-interactive run without --yes registers without a link.
export function linkChoice(input: {
  measuredAs?: string
  yes: boolean
  interactive: boolean
  suggestion: string | null
}): LinkChoice {
  if (input.measuredAs) return { kind: "link", measuredAs: input.measuredAs }
  if (!input.suggestion) return { kind: "skip" }
  if (input.yes) return { kind: "link", measuredAs: input.suggestion }
  if (!input.interactive) return { kind: "skip" }
  return { kind: "ask", suggestion: input.suggestion }
}
