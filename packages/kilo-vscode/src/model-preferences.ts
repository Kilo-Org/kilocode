// The model picker preferences of v1, kept in the extension globalState so that every webview (sidebar, Settings,
// Agent Manager) shares them: favorites, the 5 most recent picks, the usage count per model and the remembered
// reasoning effort per agent and model. The webview owns the rules; the host only validates and stores.
import type { ModelPreferences, ModelPreferenceRef, ModelUsageMap } from "./protocol"

export const FAVORITES_KEY = "kilo-code.v2.favoriteModels"
export const RECENTS_KEY = "kilo-code.v2.recentModels"
export const USAGE_KEY = "kilo-code.v2.modelUsage"
export const VARIANTS_KEY = "kilo-code.v2.variantSelections"

/** Recents a reset clears. A reset keeps the favorites and the expanded picker, as on v1. */
export const MODEL_RESET_KEYS = [RECENTS_KEY, USAGE_KEY, VARIANTS_KEY]

const RECENT_LIMIT = 5
const USAGE_LIMIT = 200

type State = { get: (key: string) => unknown; update: (key: string, value: unknown) => Thenable<void> }

export function readModelPreferences(state: State): ModelPreferences {
  return {
    favorites: validateRefs(state.get(FAVORITES_KEY)),
    recents: validateRefs(state.get(RECENTS_KEY)).slice(0, RECENT_LIMIT),
    usage: validateUsage(state.get(USAGE_KEY)),
    variants: validateVariants(state.get(VARIANTS_KEY)),
  }
}

export function toggleFavorite(raw: unknown, action: "add" | "remove", ref: ModelPreferenceRef) {
  const list = validateRefs(raw).filter((item) => !same(item, ref))
  return action === "add" ? [...list, ref] : list
}

export function recordUsage(raw: unknown, ref: ModelPreferenceRef, now = Date.now()): ModelUsageMap {
  const usage = validateUsage(raw)
  const key = `${ref.providerID}/${ref.modelID}`
  usage[key] = { count: (usage[key]?.count ?? 0) + 1, lastUsed: now }
  return validateUsage(usage)
}

export function validateRefs(raw: unknown): ModelPreferenceRef[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item: unknown) => {
    if (!item || typeof item !== "object") return []
    const value = item as Record<string, unknown>
    if (typeof value.providerID !== "string" || typeof value.modelID !== "string") return []
    if (!value.providerID || !value.modelID) return []
    return [{ providerID: value.providerID, modelID: value.modelID }]
  })
}

export function validateRecents(raw: unknown) {
  const seen = new Set<string>()
  return validateRefs(raw)
    .filter((item) => {
      const key = `${item.providerID}/${item.modelID}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, RECENT_LIMIT)
}

/** Keeps valid entries, the most recently used first, at most 200 (v1 `validateModelUsage`). */
export function validateUsage(raw: unknown): ModelUsageMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .flatMap(([key, value]) => {
        if (!value || typeof value !== "object") return []
        const item = value as Record<string, unknown>
        if (typeof item.count !== "number" || !Number.isFinite(item.count) || item.count <= 0) return []
        if (typeof item.lastUsed !== "number" || !Number.isFinite(item.lastUsed)) return []
        return [[key, { count: Math.floor(item.count), lastUsed: item.lastUsed }] as const]
      })
      .toSorted(([, a], [, b]) => b.lastUsed - a.lastUsed)
      .slice(0, USAGE_LIMIT),
  )
}

export function validateVariants(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

function same(a: ModelPreferenceRef, b: ModelPreferenceRef) {
  return a.providerID === b.providerID && a.modelID === b.modelID
}
