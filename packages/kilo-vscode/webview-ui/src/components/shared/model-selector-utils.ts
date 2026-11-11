// The v1 model picker rules (groups, search ranking, labels and badges) over v2 data. `toPickerModels` joins the v2
// model catalog with the provider names and the Kilo Gateway metadata of the `kilocode.gateway` `models` RPC into
// the `PickerModel` shape the v1 rules used, so the rules below stay the v1 code.
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { ModelPreferenceRef, ModelUsageMap } from "../../../../src/protocol"
import { searchMatch } from "../../utils/search-match"

export const KILO_GATEWAY_ID = "kilo"
// v1 `PROVIDER_PRIORITY`: the Kilo Gateway first, then these providers; other providers follow.
export const PROVIDER_ORDER = ["kilo", "anthropic", "deepseek", "openai", "google", "openrouter", "vercel"] as const

export const KILO_AUTO_SMALL_IDS = new Set(["kilo-auto/small", "auto-small"])
const AUTO_FALLBACK = "Routes requests automatically."
// v1 order of the modality chips.
const MODALITIES = ["text", "audio", "image", "video", "pdf"] as const

/** One picker row: the v1 `EnrichedModel` fields the picker and the preview read. */
export interface PickerModel {
  id: string
  providerID: string
  name: string
  providerName: string
  releaseDate?: string
  limit?: { context: number }
  capabilities?: { reasoning: boolean; input?: Partial<Record<(typeof MODALITIES)[number], boolean>> }
  options?: { description?: string }
  autoRouting?: { models: readonly string[] }
  recommendedIndex?: number
  isFree?: boolean
  mayTrainOnYourPrompts?: boolean
  hasUserByokAvailable?: boolean
  terminalBench?: { overallScore: number; avgAttemptCostUsd: number }
  cost?: { input: number; output: number; cache?: { read: number; write: number } }
}

interface Choice {
  id: string
  name: string
}

/**
 * The picker rows of a v2 catalog. Kilo Gateway models take their badges, order and description from the Gateway
 * metadata (by Gateway model id, then by catalog id, as the TUI). Other providers have no Gateway metadata, so as on
 * v1 they show no free, BYOK or training badge.
 */
export function toPickerModels(
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[] | undefined,
  gateway: ReadonlyMap<string, KiloGatewayRpc.ModelEntry> | undefined,
): PickerModel[] {
  const names = new Map((providers ?? []).map((provider) => [provider.id, provider.name]))
  return models.map((model) => {
    const entry =
      model.providerID === KILO_GATEWAY_ID ? (gateway?.get(model.modelID) ?? gateway?.get(model.id)) : undefined
    return { ...catalogFields(model, names.get(model.providerID), entry), ...gatewayFields(model, entry) }
  })
}

function catalogFields(
  model: ModelInfo,
  providerName: string | undefined,
  entry: KiloGatewayRpc.ModelEntry | undefined,
) {
  const cost = model.cost.find((item) => !item.tier) ?? model.cost[0]
  const input = new Set(model.capabilities.input.map((item) => item.split("/")[0]))
  return {
    id: model.id,
    providerID: model.providerID,
    name: model.name,
    providerName: providerName ?? model.providerID,
    releaseDate: model.time.released > 0 ? new Date(model.time.released).toISOString() : undefined,
    limit: model.limit.context > 0 ? { context: model.limit.context } : undefined,
    capabilities: {
      reasoning: entry?.reasoning ?? model.variants.length > 0,
      input: Object.fromEntries(MODALITIES.map((item) => [item, input.has(item)])),
    },
    cost: cost ? { input: cost.input, output: cost.output, cache: cost.cache } : undefined,
  }
}

function gatewayFields(model: ModelInfo, entry: KiloGatewayRpc.ModelEntry | undefined) {
  if (model.providerID !== KILO_GATEWAY_ID) return {}
  if (!entry) return { isFree: costFree(model) }
  return {
    options: entry.description ? { description: entry.description } : undefined,
    autoRouting: entry.autoRouting,
    recommendedIndex: entry.recommendedIndex,
    isFree: entry.isFree,
    mayTrainOnYourPrompts: entry.mayTrainOnYourPrompts,
    hasUserByokAvailable: entry.hasUserByokAvailable,
    terminalBench: entry.terminalBench,
  }
}

// Without Gateway metadata (cold or failed RPC), a Gateway model with only zero prices is free.
function costFree(model: ModelInfo) {
  return model.cost.length > 0 && model.cost.every((cost) => cost.input === 0 && cost.output === 0)
}

export function isAuto(model: Pick<PickerModel, "providerID" | "id">): boolean {
  return (
    model.providerID === KILO_GATEWAY_ID && (model.id.startsWith("kilo-auto/") || KILO_AUTO_SMALL_IDS.has(model.id))
  )
}

export function autoChoices(
  model: Pick<PickerModel, "providerID" | "id" | "autoRouting">,
  catalog: readonly Pick<PickerModel, "id" | "name">[] = [],
): readonly Choice[] {
  if (!isAuto(model)) return []
  const ids = model.autoRouting?.models
  if (!ids?.length) return []
  const names = new Map(catalog.map((item) => [item.id, stripSubProviderPrefix(sanitizeName(item.name))]))
  return ids.map((id) => ({ id, name: names.get(id) ?? id }))
}

export function autoSummary(model: Pick<PickerModel, "options">): string {
  const raw = model.options?.description?.split(/\n\s*\n/)[0]
  if (!raw) return AUTO_FALLBACK
  return raw.replace(/\s+/g, " ").trim() || AUTO_FALLBACK
}

export function providerSortKey(providerID: string, order: readonly string[] = PROVIDER_ORDER): number {
  const index = order.indexOf(providerID.toLowerCase())
  return index >= 0 ? index : order.length
}

export function isFree(model: Pick<PickerModel, "isFree">): boolean {
  return model.isFree === true
}

export function isDataCollectedModel(model: Pick<PickerModel, "mayTrainOnYourPrompts">): boolean {
  return model.mayTrainOnYourPrompts === true
}

export function hasByok(model: Pick<PickerModel, "hasUserByokAvailable">): boolean {
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

// Keep dots inside version tokens ("5.5"), so a version query does not split into
// loose number words that also match an older "4.5". Every other separator splits.
function words(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((word) => word.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean)
}

function isVersionToken(token: string): boolean {
  return /^\d+(?:\.\d+)+$/.test(token)
}

/** Per-model search text, normalized once because the same catalog is scanned on every keystroke. */
interface SearchFields {
  raw: string
  name: string
  nameWords: string[]
  rawWords: string[]
  idWords: string[]
  nameCollapsed: string
  rawCollapsed: string
  idCollapsed: string
  providerWords: string[]
  providerCollapsed: string
}

const searchFields = new WeakMap<PickerModel, SearchFields>()

function fieldsFor(model: PickerModel): SearchFields {
  const cached = searchFields.get(model)
  if (cached) return cached
  const raw = sanitizeName(model.name)
  const name = stripSubProviderPrefix(raw)
  const fields = {
    raw,
    name,
    nameWords: words(name),
    rawWords: words(raw),
    idWords: words(model.id),
    nameCollapsed: collapse(name),
    rawCollapsed: collapse(raw),
    idCollapsed: collapse(model.id),
    providerWords: words(model.providerName),
    providerCollapsed: collapse(model.providerName),
  }
  searchFields.set(model, fields)
  return fields
}

function tokenScore(
  token: string,
  collapsed: string,
  value: string,
  list: string[],
  valueCollapsed: string,
): number {
  if (list.includes(token)) return 1000
  if (list.some((word) => word.startsWith(token))) return 700
  if (valueCollapsed.includes(collapsed)) return 400
  // A version needs a literal match ("5.5" must not fuzzy-match the "5" in "4.5").
  if (isVersionToken(token)) return -1
  if (searchMatch(token, value)) return 250
  return -1
}

function matchScore(model: PickerModel, query: string): number | undefined {
  const fields = fieldsFor(model)
  const tokens = words(query)
  if (tokens.length === 0) return 0

  const scores = tokens.map((token) => {
    const collapsed = collapse(token)
    const modelScore = Math.max(
      tokenScore(token, collapsed, fields.name, fields.nameWords, fields.nameCollapsed),
      tokenScore(token, collapsed, fields.raw, fields.rawWords, fields.rawCollapsed),
      tokenScore(token, collapsed, model.id, fields.idWords, fields.idCollapsed),
    )
    const providerScore =
      modelScore < 0
        ? tokenScore(token, collapsed, model.providerName, fields.providerWords, fields.providerCollapsed)
        : -1
    return { modelScore, providerScore }
  })
  if (scores.some((score) => score.modelScore < 0 && score.providerScore < 0)) return undefined

  const modelScore = scores.reduce((sum, score) => sum + Math.max(score.modelScore, 0), 0)
  const providerScore = scores.reduce((sum, score) => sum + Math.max(score.providerScore, 0), 0)
  const collapsed = collapse(query)
  const exact =
    collapsed === fields.nameCollapsed || collapsed === fields.rawCollapsed || collapsed === fields.idCollapsed
  return modelScore + Math.floor(providerScore / 10) + (exact ? 5000 : 0)
}

function logicalModelKey(model: PickerModel): string {
  const fields = fieldsFor(model)
  return fields.nameCollapsed || fields.idCollapsed
}

function usageFor(model: PickerModel, usage: ModelUsageMap | undefined) {
  return usage?.[modelSelectionKey(model.providerID, model.id)] ?? { count: 0, lastUsed: 0 }
}

export interface ModelSearchOptions {
  usage?: ModelUsageMap
  favorites?: ReadonlySet<string>
  recent?: readonly ModelPreferenceRef[]
}

/**
 * Ranks matching models globally instead of sorting each provider independently.
 * Exact model tokens beat prefixes such as "sol" in "solar", while personal
 * usage only breaks ties between similarly relevant matches.
 */
export function rankModelSearch<T extends PickerModel>(
  models: readonly T[],
  query: string,
  options: ModelSearchOptions = {},
): T[] {
  const groups = new Map<
    string,
    {
      key: string
      score: number
      count: number
      lastUsed: number
      items: Array<{ model: T; score: number; count: number; lastUsed: number }>
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

export function mostUsedModels<T extends PickerModel>(
  models: readonly T[],
  usage: ModelUsageMap | undefined,
  favorites: ReadonlySet<string> = new Set(),
  limit = 5,
): T[] {
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
  raw: { providerID: string; modelID: string } | null,
  allowClear: boolean,
  clearLabel: string,
  hasProviders: boolean,
  labels: { select: string; noProviders: string; notSet: string },
): string {
  if (resolvedName) {
    const name = sanitizeName(resolvedName)
    if (providerID === KILO_GATEWAY_ID) return stripSubProviderPrefix(name)
    return name
  }
  if (raw?.providerID && raw?.modelID) {
    return raw.providerID === KILO_GATEWAY_ID ? raw.modelID : `${raw.providerID} / ${raw.modelID}`
  }
  if (allowClear) return clearLabel || labels.notSet
  return hasProviders ? labels.select : labels.noProviders
}
