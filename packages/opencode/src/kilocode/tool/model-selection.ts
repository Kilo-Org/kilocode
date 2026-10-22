import type { Provider } from "@/provider/provider"
import { matchesQuery } from "./model-search"

type Source = {
  model: { providerID: Provider.Model["providerID"]; modelID: Provider.Model["id"] }
  variant?: string
}
type Candidate = { providerID: string; model: Provider.Info["models"][string] }
type Selection = Source | { error: string }

function lookup(all: Candidate[], value: string) {
  const query = value.toLowerCase()
  const exact = all.filter((item) => `${item.providerID}/${item.model.id}`.toLowerCase() === query)
  const named = exact.length ? exact : all.filter((item) => item.model.name.toLowerCase() === query)
  const pool = named.length
    ? named
    : all.filter((item) => matchesQuery([item.model.name, `${item.providerID}/${item.model.id}`], value))
  return { pool, names: [...new Set(pool.map((item) => item.model.name))] }
}

function suggest(all: Candidate[], value: string) {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const scored = new Map<string, number>()
  for (const item of all) {
    const text = `${item.model.name} ${item.providerID}/${item.model.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const score = tokens.filter((token) => text.includes(token)).length
    if (score > 0) scored.set(item.model.name, Math.max(scored.get(item.model.name) ?? 0, score))
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map((entry) => entry[0])
}

function rank(provider: string, preferred?: string) {
  if (provider === preferred) return 0
  if (provider === "kilo") return 1
  return 2
}

export function selectModel(
  input: { model?: string | null; provider?: string | null; variant?: string | null },
  providers: Record<string, Provider.Info>,
  source?: Source,
  preferred: string | undefined = source?.model.providerID,
): Selection {
  const all = Object.values(providers).flatMap((provider) =>
    Object.values(provider.models).map((model) => ({ providerID: provider.id, model })),
  )
  const value = input.model?.trim()
  const provider = input.provider?.trim()
  const variant = input.variant?.trim()
  if (!value) {
    if (provider) return { error: "provider requires a model." }
    if (!source) return { error: "variant override requires an available current model." }
    if (!variant) return source
    const active = all.find(
      (item) => item.providerID === source.model.providerID && item.model.id === source.model.modelID,
    )
    if (!active) {
      return {
        error: `current model is no longer available: ${source.model.providerID}/${source.model.modelID}. Specify a model override.`,
      }
    }
    if (!active.model.variants || !Object.hasOwn(active.model.variants, variant)) {
      return {
        error: `variant "${variant}" is not available for ${active.model.name}. Available variants: ${Object.keys(active.model.variants ?? {}).join(", ") || "none"}`,
      }
    }
    return { model: source.model, variant }
  }

  const scope = provider ? all.filter((item) => item.providerID === provider) : all
  if (provider && scope.length === 0) {
    return { error: `provider is not available for model selection: ${provider}. Requested model: ${value}.` }
  }
  const { pool, names } = lookup(scope, value)
  if (pool.length === 0) {
    const close = suggest(scope, value)
    const hint = close.length ? ` Closest matches: ${close.join(", ")}.` : ""
    return {
      error: provider
        ? `model is not available from provider "${provider}": ${value}.${hint} Use agent_manager_models to search models.`
        : `model is not available: ${value}.${hint} Use agent_manager_models to search models.`,
    }
  }
  if (names.length > 1) {
    return {
      error: `model "${value}" is ambiguous and matches several models: ${names.slice(0, 5).join(", ")}. Use a more specific name.`,
    }
  }
  const eligible = variant
    ? pool.filter((item) => item.model.variants && Object.hasOwn(item.model.variants, variant))
    : pool
  if (variant && eligible.length === 0) {
    const available = [...new Set(pool.flatMap((item) => Object.keys(item.model.variants ?? {})))]
    return {
      error: `variant "${variant}" is not available for ${names.at(0)}. Available variants: ${available.join(", ") || "none"}`,
    }
  }
  const chosen = [...eligible]
    .sort(
      (a, b) =>
        rank(a.providerID, preferred) - rank(b.providerID, preferred) ||
        a.providerID.localeCompare(b.providerID) ||
        a.model.id.localeCompare(b.model.id),
    )
    .at(0)
  if (!chosen) return { error: `model is not available: ${value}. Use agent_manager_models to search models.` }
  return {
    model: { providerID: chosen.model.providerID, modelID: chosen.model.id },
    ...(variant ? { variant } : {}),
  }
}
