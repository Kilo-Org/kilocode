import type { Model } from "@opencode/schema/model"

export type Source = {
  readonly model: { readonly providerID: string; readonly modelID: string }
  readonly variant?: string
}
export type Selection = Source | { readonly error: string }

export interface Entry {
  name: string
  providers: string[]
  variants: string[]
  ids: string[]
  rank: number
}

/** Groups one model name offered by several providers, so the agent picks a model rather than a provider. */
export function entries(models: ReadonlyArray<Model.Info>): Entry[] {
  const byName = new Map<string, Entry>()
  models.forEach((model, index) => {
    const entry = byName.get(model.name) ?? {
      name: model.name,
      providers: [],
      variants: [],
      ids: [],
      rank: Number.POSITIVE_INFINITY,
    }
    if (!entry.providers.includes(model.providerID)) entry.providers.push(model.providerID)
    entry.ids.push(`${model.providerID}/${model.id}`)
    for (const variant of model.variants) {
      if (!entry.variants.includes(variant.id)) entry.variants.push(variant.id)
    }
    entry.rank = Math.min(entry.rank, index)
    byName.set(model.name, entry)
  })
  return [...byName.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
}

export function view(entry: Entry) {
  return { name: entry.name, providers: entry.providers, variants: entry.variants }
}

/**
 * Lenient, dependency-free model matching: every alphanumeric token of the query must appear in the
 * alphanumeric-collapsed text. It is order-independent and ignores punctuation and spacing, so "opus claude"
 * matches "Claude Opus 4.1". It is intentionally not typo-tolerant.
 */
export function matchesQuery(haystacks: ReadonlyArray<string>, query: string) {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  if (tokens.length === 0) return true
  const text = haystacks.map(collapse).join(" ")
  return tokens.every((token) => text.includes(token))
}

export function selectModel(
  input: { readonly model?: string | null; readonly provider?: string | null; readonly variant?: string | null },
  models: ReadonlyArray<Model.Info>,
  source?: Source,
  preferred: string | undefined = source?.model.providerID,
): Selection {
  const value = input.model?.trim()
  const provider = input.provider?.trim()
  const variant = input.variant?.trim()
  if (!value) {
    if (provider) return { error: "provider requires a model." }
    if (!source) return { error: "variant override requires an available current model." }
    if (!variant) return source
    const active = models.find(
      (model) => model.providerID === source.model.providerID && model.id === source.model.modelID,
    )
    if (!active) {
      return {
        error: `current model is no longer available: ${source.model.providerID}/${source.model.modelID}. Specify a model override.`,
      }
    }
    if (!active.variants.some((item) => item.id === variant)) {
      return {
        error: `variant "${variant}" is not available for ${active.name}. Available variants: ${variants(active).join(", ") || "none"}`,
      }
    }
    return { model: source.model, variant }
  }

  const scope = provider ? models.filter((model) => model.providerID === provider) : models
  if (provider && scope.length === 0) {
    return { error: `provider is not available for model selection: ${provider}. Requested model: ${value}.` }
  }
  const found = lookup(scope, value)
  if (found.pool.length === 0) {
    const close = suggest(scope, value)
    const hint = close.length ? ` Closest matches: ${close.join(", ")}.` : ""
    return {
      error: provider
        ? `model is not available from provider "${provider}": ${value}.${hint} Use agent_manager_models to search models.`
        : `model is not available: ${value}.${hint} Use agent_manager_models to search models.`,
    }
  }
  if (found.names.length > 1) {
    return {
      error: `model "${value}" is ambiguous and matches several models: ${found.names.slice(0, 5).join(", ")}. Use a more specific name.`,
    }
  }
  const eligible = variant ? found.pool.filter((model) => model.variants.some((item) => item.id === variant)) : found.pool
  if (variant && eligible.length === 0) {
    const available = [...new Set(found.pool.flatMap((model) => variants(model)))]
    return {
      error: `variant "${variant}" is not available for ${found.names.at(0)}. Available variants: ${available.join(", ") || "none"}`,
    }
  }
  const chosen = [...eligible]
    .sort(
      (a, b) =>
        rank(a.providerID, preferred) - rank(b.providerID, preferred) ||
        a.providerID.localeCompare(b.providerID) ||
        a.id.localeCompare(b.id),
    )
    .at(0)
  if (!chosen) return { error: `model is not available: ${value}. Use agent_manager_models to search models.` }
  return {
    model: { providerID: chosen.providerID, modelID: chosen.id },
    ...(variant ? { variant } : {}),
  }
}

function variants(model: Model.Info) {
  return model.variants.map((variant) => variant.id)
}

function lookup(models: ReadonlyArray<Model.Info>, value: string) {
  const query = value.toLowerCase()
  const exact = models.filter((model) => `${model.providerID}/${model.id}`.toLowerCase() === query)
  const named = exact.length ? exact : models.filter((model) => model.name.toLowerCase() === query)
  const pool = named.length
    ? named
    : models.filter((model) => matchesQuery([model.name, `${model.providerID}/${model.id}`], value))
  return { pool, names: [...new Set(pool.map((model) => model.name))] }
}

function suggest(models: ReadonlyArray<Model.Info>, value: string) {
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
  const scored = new Map<string, number>()
  for (const model of models) {
    const text = `${model.name} ${model.providerID}/${model.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "")
    const score = tokens.filter((token) => text.includes(token)).length
    if (score > 0) scored.set(model.name, Math.max(scored.get(model.name) ?? 0, score))
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

function collapse(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}
