// Variant discovery: match custom-provider models against the models.dev catalog
// to find configurable reasoning effort values.
//
// The models.dev catalog exposes structured `reasoning_options` per provider+model.
// We use that to build a variant list (e.g. ["low","medium","high"]) for models that
// support configurable reasoning effort, without guessing for models that only
// expose a toggle or budget_tokens (those require provider-specific transport fields).

import * as ModelsDev from "@opencode-ai/core/models-dev"

export type ReasoningEffortValue = string

export interface VariantCandidate {
  providerID: string
  modelID: string
  modelName: string
  reasoningOptions: readonly ModelsDev.ReasoningOption[]
  confidence: "high" | "medium" | "low"
  reason: string
}

export interface VariantDiscoveryResult {
  modelID: string
  status: "matched" | "review" | "unmatched" | "unsupported"
  selected?: VariantCandidate
  candidates: VariantCandidate[]
  variants: Record<string, Record<string, unknown>>
  conflicts?: string[]
}

export interface VariantDiscoverySummary {
  total: number
  matched: number
  review: number
  unmatched: number
  unsupported: number
  totalVariants: number
  results: VariantDiscoveryResult[]
}

export interface DiscoverVariantsInput {
  baseURL: string
  npm: string
  models: ReadonlyArray<{
    id: string
    name?: string
    ownedBy?: string
    variants?: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  }>
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase()
}

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

function splitScopedId(id: string): { provider: string | undefined; model: string } {
  const idx = id.indexOf("/")
  if (idx <= 0) return { provider: undefined, model: id }
  return { provider: id.slice(0, idx), model: id.slice(idx + 1) }
}

function extractEffortValues(options: readonly ModelsDev.ReasoningOption[]): ReasoningEffortValue[] | null {
  for (const opt of options) {
    if (opt.type === "effort") {
      return opt.values.filter((v: string | null): v is string => typeof v === "string")
    }
  }
  return null
}

function hasOnlyNonEffortOptions(options: readonly ModelsDev.ReasoningOption[]): boolean {
  if (!options.length) return false
  return !options.some((o) => o.type === "effort")
}

function buildVariantsFromEffort(
  values: ReasoningEffortValue[],
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const v of values) {
    out[v] = { reasoningEffort: v }
  }
  return out
}

function mergeVariants(
  existing: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  discovered: Record<string, Record<string, unknown>>,
): { merged: Record<string, Record<string, unknown>>; conflicts: string[] } {
  const merged: Record<string, Record<string, unknown>> = {}
  const conflicts: string[] = []
  for (const [k, v] of Object.entries(existing)) {
    merged[k] = v
  }
  for (const [k, v] of Object.entries(discovered)) {
    if (k in merged) {
      const current = merged[k]
      if (JSON.stringify(current) !== JSON.stringify(v)) {
        conflicts.push(k)
      }
      continue
    }
    merged[k] = v
  }
  return { merged, conflicts }
}

function classifyCandidate(
  providerID: string,
  modelID: string,
  baseURL: string,
  ownedBy: string | undefined,
  catalog: Record<string, ModelsDev.Provider>,
): { confidence: "high" | "medium" | "low"; reason: string } | null {
  const normalizedBase = normalizeUrl(baseURL)
  const scoped = splitScopedId(modelID)

  // 1. Base URL + exact ID match
  for (const [pid, provider] of Object.entries(catalog)) {
    if (provider.api && normalizeUrl(provider.api) === normalizedBase) {
      if (provider.models[modelID] || provider.models[scoped.model]) {
        return {
          confidence: "high",
          reason: `Exact match on base URL and model ID for provider "${pid}"`,
        }
      }
    }
  }

  // 2. Provider-scoped ID match
  if (scoped.provider) {
    const provider = catalog[scoped.provider]
    if (provider?.models[scoped.model]) {
      return {
        confidence: "high",
        reason: `Provider-scoped ID "${scoped.provider}/${scoped.model}" matches catalog entry`,
      }
    }
  }

  // 3. owned_by maps to a provider and exact ID matches
  if (ownedBy) {
    const provider = catalog[ownedBy.toLowerCase()]
    if (provider?.models[modelID] || provider?.models[scoped.model]) {
      return {
        confidence: "high",
        reason: `owned_by "${ownedBy}" maps to provider "${provider.id}" with exact model ID match`,
      }
    }
  }

  // 4. Exact unscoped ID match across providers
  let exactCount = 0
  for (const [pid, provider] of Object.entries(catalog)) {
    if (provider.models[modelID] || provider.models[scoped.model]) {
      exactCount++
    }
  }
  if (exactCount === 1) {
    return {
      confidence: "medium",
      reason: `Exact model ID match in a single provider`,
    }
  }
  if (exactCount > 1) {
    return {
      confidence: "low",
      reason: `Model ID matches ${exactCount} providers; disambiguation required`,
    }
  }

  return null
}

function collectCandidates(
  modelID: string,
  baseURL: string,
  ownedBy: string | undefined,
  catalog: Record<string, ModelsDev.Provider>,
): VariantCandidate[] {
  const candidates: VariantCandidate[] = []
  const seen = new Set<string>()
  const normalized = normalizeId(modelID)
  const scoped = splitScopedId(normalized)

  for (const [pid, provider] of Object.entries(catalog)) {
    const model = provider.models[scoped.model] ?? provider.models[normalized]
    if (!model) continue
    const key = `${pid}/${model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const options = model.reasoning_options ?? []
    if (!options.length) continue
    const classification = classifyCandidate(pid, model.id, baseURL, ownedBy, catalog)
    candidates.push({
      providerID: pid,
      modelID: model.id,
      modelName: model.name,
      reasoningOptions: options,
      confidence: classification?.confidence ?? "low",
      reason: classification?.reason ?? "Fuzzy name match",
    })
  }

  return candidates
}

export function discoverVariants(
  input: DiscoverVariantsInput,
  catalog: Record<string, ModelsDev.Provider>,
): VariantDiscoverySummary {
  const results: VariantDiscoveryResult[] = []
  let matched = 0
  let review = 0
  let unmatched = 0
  let unsupported = 0
  let totalVariants = 0

  for (const model of input.models) {
    const modelID = model.id
    const classification = classifyCandidate(
      "",
      modelID,
      input.baseURL,
      model.ownedBy,
      catalog,
    )

    const candidates = collectCandidates(modelID, input.baseURL, model.ownedBy, catalog)

    if (!candidates.length) {
      results.push({
        modelID,
        status: "unmatched",
        candidates: [],
        variants: {},
      })
      unmatched++
      continue
    }

    // Find the best candidate based on classification
    let selected: VariantCandidate | undefined
    let confidence: "high" | "medium" | "low" = "low"
    let reason = ""

    if (classification) {
      if (classification.confidence === "high") {
        selected = candidates[0]
        confidence = "high"
        reason = classification.reason
      } else if (classification.confidence === "medium") {
        // Only auto-select if all candidates agree on effort values
        const effortLists = candidates
          .map((c) => extractEffortValues(c.reasoningOptions))
          .filter((v): v is ReasoningEffortValue[] => v !== null)

        if (effortLists.length > 0) {
          const first = JSON.stringify(effortLists[0].sort())
          const allAgree = effortLists.every((l) => JSON.stringify(l.sort()) === first)
          if (allAgree) {
            selected = candidates[0]
            confidence = "medium"
            reason = `${classification.reason}; all candidates agree on effort values`
          }
        }
        if (!selected) {
          reason = classification.reason
        }
      } else {
        reason = classification.reason
      }
    }

    if (!selected) {
      // Check if any candidate has effort options
      const hasEffort = candidates.some(
        (c) => extractEffortValues(c.reasoningOptions) !== null,
      )
      if (!hasEffort && candidates.every((c) => hasOnlyNonEffortOptions(c.reasoningOptions))) {
        results.push({
          modelID,
          status: "unsupported",
          candidates,
          variants: {},
        })
        unsupported++
      } else {
        results.push({
          modelID,
          status: "review",
          candidates,
          variants: {},
        })
        review++
      }
      continue
    }

    // Build variants from the selected candidate
    const effortValues = extractEffortValues(selected.reasoningOptions)
    if (!effortValues || effortValues.length === 0) {
      results.push({
        modelID,
        status: "unsupported",
        selected: { ...selected, confidence, reason },
        candidates,
        variants: {},
      })
      unsupported++
      continue
    }

    const discoveredVariants = buildVariantsFromEffort(effortValues)

    // Merge with existing variants
    const existing = model.variants ?? {}
    const { merged, conflicts } = mergeVariants(existing, discoveredVariants)

    totalVariants += Object.keys(discoveredVariants).length

    results.push({
      modelID,
      status: "matched",
      selected: { ...selected, confidence, reason },
      candidates,
      variants: merged,
      conflicts: conflicts.length > 0 ? conflicts : undefined,
    })
    matched++
  }

  return {
    total: input.models.length,
    matched,
    review,
    unmatched,
    unsupported,
    totalVariants,
    results,
  }
}
