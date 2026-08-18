import type { ModelSelection, ModelUsageMap } from "../../types/messages"
import type { EnrichedModel } from "../../context/provider"
import { searchMatch } from "../../utils/search-match"
import {
  KILO_PROVIDER_ID as KILO_GATEWAY_ID,
  PROVIDER_PRIORITY as PROVIDER_ORDER,
  providerOrderIndex,
} from "../../../../src/shared/provider-model"

export { KILO_GATEWAY_ID, PROVIDER_ORDER }

export const KILO_AUTO_SMALL_IDS = new Set(["kilo-auto/small", "auto-small"])
const AUTO_FALLBACK = "Routes requests automatically."

interface Choice {
  id: string
  name: string
}

export function isAuto(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return (
    model.providerID === KILO_GATEWAY_ID && (model.id.startsWith("kilo-auto/") || KILO_AUTO_SMALL_IDS.has(model.id))
  )
}

export function autoChoices(
  model: Pick<EnrichedModel, "providerID" | "id" | "autoRouting">,
  catalog: readonly Pick<EnrichedModel, "id" | "name">[] = [],
): readonly Choice[] {
  if (!isAuto(model)) return []
  const ids = model.autoRouting?.models
  if (!ids?.length) return []
  const names = new Map(catalog.map((item) => [item.id, stripSubProviderPrefix(sanitizeName(item.name))]))
  return ids.map((id) => ({ id, name: names.get(id) ?? id }))
}

export function autoSummary(model: Pick<EnrichedModel, "options">): string {
  const raw = model.options?.description?.split(/\n\s*\n/)[0]
  if (!raw) return AUTO_FALLBACK
  return raw.replace(/\s+/g, " ").trim() || AUTO_FALLBACK
}

export function isSmall(model: Pick<EnrichedModel, "providerID" | "id">): boolean {
  return model.providerID === KILO_GATEWAY_ID && KILO_AUTO_SMALL_IDS.has(model.id)
}

export function providerSortKey(providerID: string, order: readonly string[] = PROVIDER_ORDER): number {
  return providerOrderIndex(providerID, order as typeof PROVIDER_ORDER)
}

export function isFree(model: Pick<EnrichedModel, "isFree">): boolean {
  return model.isFree === true
}

export function isDataCollectedModel(model: Pick<EnrichedModel, "mayTrainOnYourPrompts">): boolean {
  return model.mayTrainOnYourPrompts === true
}

export function hasByok(model: Pick<EnrichedModel, "hasUserByokAvailable">): boolean {
  return model.hasUserByokAvailable === true
}

export function freeDataLabel(_free: string, data: string): string {
  return data
}

export function modelSelectionKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

function collapse(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function tokenScore(token: string, value: string): number {
  const list = words(value)
  if (list.includes(token)) return 1000
  if (list.some((word) => word.startsWith(token))) return 700
  if (collapse(value).includes(collapse(token))) return 400
  if (searchMatch(token, value)) return 250
  return -1
}

function matchScore(model: EnrichedModel, query: string): number | undefined {
  const name = stripSubProviderPrefix(sanitizeName(model.name))
  const tokens = words(query)
  if (tokens.length === 0) return 0

  const scores = tokens.map((token) => {
    const modelScore = Math.max(tokenScore(token, name), tokenScore(token, model.id))
    const providerScore = modelScore < 0 ? tokenScore(token, model.providerName) : -1
    return { modelScore, providerScore }
  })
  if (scores.some((score) => score.modelScore < 0 && score.providerScore < 0)) return undefined

  const modelScore = scores.reduce((sum, score) => sum + Math.max(score.modelScore, 0), 0)
  const providerScore = scores.reduce((sum, score) => sum + Math.max(score.providerScore, 0), 0)
  const exact = collapse(query) === collapse(name) || collapse(query) === collapse(model.id)
  return modelScore + Math.floor(providerScore / 10) + (exact ? 5000 : 0)
}

function logicalModelKey(model: EnrichedModel): string {
  return collapse(stripSubProviderPrefix(sanitizeName(model.name))) || collapse(model.id)
}

function usageFor(model: EnrichedModel, usage: ModelUsageMap | undefined) {
  return usage?.[modelSelectionKey(model.providerID, model.id)] ?? { count: 0, lastUsed: 0 }
}

export interface ModelSearchOptions {
  usage?: ModelUsageMap
  favorites?: ReadonlySet<string>
  recent?: readonly ModelSelection[]
}

/**
 * Ranks matching models globally instead of sorting each provider independently.
 * Exact model tokens beat prefixes such as "sol" in "solar", while personal
 * usage only breaks ties between similarly relevant matches.
 */
export function rankModelSearch(
  models: readonly EnrichedModel[],
  query: string,
  options: ModelSearchOptions = {},
): EnrichedModel[] {
  const groups = new Map<
    string,
    {
      key: string
      score: number
      count: number
      lastUsed: number
      items: Array<{ model: EnrichedModel; score: number; count: number; lastUsed: number }>
    }
  >()
  const recent = new Map(
    (options.recent ?? []).map((item, index) => [modelSelectionKey(item.providerID, item.modelID), index]),
  )

  for (const model of models) {
    const score = matchScore(model, query)
    if (score === undefined) continue
    const usage = usageFor(model, options.usage)
    const key = logicalModelKey(model)
    const group = groups.get(key) ?? { key, score, count: 0, lastUsed: 0, items: [] }
    group.score = Math.max(group.score, score)
    group.count += usage.count
    group.lastUsed = Math.max(group.lastUsed, usage.lastUsed)
    group.items.push({ model, score, count: usage.count, lastUsed: usage.lastUsed })
    groups.set(key, group)
  }

  return [...groups.values()]
    .sort((a, b) => b.score - a.score || b.count - a.count || b.lastUsed - a.lastUsed || a.key.localeCompare(b.key))
    .flatMap((group) =>
      group.items
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.count - a.count ||
            b.lastUsed - a.lastUsed ||
            (options.favorites?.has(modelSelectionKey(b.model.providerID, b.model.id)) ? 1 : 0) -
              (options.favorites?.has(modelSelectionKey(a.model.providerID, a.model.id)) ? 1 : 0) ||
            (recent.get(modelSelectionKey(a.model.providerID, a.model.id)) ?? Infinity) -
              (recent.get(modelSelectionKey(b.model.providerID, b.model.id)) ?? Infinity) ||
            providerSortKey(a.model.providerID) - providerSortKey(b.model.providerID) ||
            a.model.providerName.localeCompare(b.model.providerName) ||
            a.model.name.localeCompare(b.model.name) ||
            a.model.id.localeCompare(b.model.id),
        )
        .map((item) => item.model),
    )
}

export function mostUsedModels(
  models: readonly EnrichedModel[],
  usage: ModelUsageMap | undefined,
  favorites: ReadonlySet<string> = new Set(),
  limit = 5,
): EnrichedModel[] {
  return models
    .filter((model) => {
      const item = usageFor(model, usage)
      return item.count > 0 && !favorites.has(modelSelectionKey(model.providerID, model.id))
    })
    .sort((a, b) => {
      const left = usageFor(a, usage)
      const right = usageFor(b, usage)
      return right.count - left.count || right.lastUsed - left.lastUsed || a.name.localeCompare(b.name)
    })
    .slice(0, limit)
}

// Strips trailing "(free)" parenthesized suffix from model display names, e.g.
// "Llama 3 (free)" → "Llama 3". A separate "Free" label/tag is rendered
// elsewhere, so preserve bare trailing "Free" words (e.g. "Kilo Auto Free").
export function sanitizeName(name: string): string {
  return name.replace(/[\s:_-]*\(free\)\s*$/i, "").trim()
}

export function stripSubProviderPrefix(name: string): string {
  const colon = name.indexOf(": ")
  if (colon < 0) return name
  const prefix = name.slice(0, colon)
  if (prefix.toLowerCase() === KILO_GATEWAY_ID) return name
  return name.slice(colon + 2)
}

export function buildTriggerLabel(
  resolvedName: string | undefined,
  providerID: string | undefined,
  raw: ModelSelection | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) {
    if (providerID === KILO_GATEWAY_ID) return stripSubProviderPrefix(resolvedName)
    return resolvedName
  }
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
