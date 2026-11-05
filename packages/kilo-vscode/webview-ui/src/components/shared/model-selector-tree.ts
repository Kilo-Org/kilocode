// The model picker tree of v1 ModelSelector: row and group keys, and the pure group and node building. Order:
// Favorites, Auto Models, Recommended, Most used, then one group per provider; a search shows one flat ranked list.
import { isAuto, mostUsedModels, providerSortKey, type PickerModel } from "./model-selector-utils"
import type { ModelUsageMap } from "../../../../src/protocol"

export const CLEAR_KEY = "clear"
const FAVORITES_KEY = "favorites"
const AUTO_KEY = "auto"
const RECOMMENDED_KEY = "recommended"
const MOST_USED_KEY = "most-used"

export function modelKey(providerID: string, modelID: string) {
  return `${providerID}/${modelID}`
}

export function rowKey(kind: "model" | "favorite", providerID: string, modelID: string) {
  return `${kind}:${providerID}/${modelID}`
}

export function groupKey(key: string) {
  return `group:${key}`
}

export interface ModelRow {
  key: string
  kind: "clear" | "favorite" | "model"
  model?: PickerModel
}

export interface ModelGroup {
  key: string
  label?: string
  rows: ModelRow[]
}

export interface ModelNode {
  key: string
  kind: "group" | "row"
  group?: ModelGroup
  row?: ModelRow
}

export interface ScrollAnchor {
  key: string
  // Virtual content offset of the anchored row before the list mutates.
  // Works even when the row is scrolled out of the mounted window.
  offset: number | undefined
  scroll: number
}

/** The favorites in their saved order, with the model active when the popup opened first. */
export function orderFavorites(list: PickerModel[], snapshot: string | null) {
  if (!snapshot) return list
  const idx = list.findIndex((m) => modelKey(m.providerID, m.id) === snapshot)
  if (idx <= 0) return list
  const item = list[idx]
  if (!item) return list
  return [item, ...list.slice(0, idx), ...list.slice(idx + 1)]
}

export function buildGroups(input: {
  visible: PickerModel[]
  filtered: PickerModel[]
  favorites: PickerModel[]
  favoriteKeys: ReadonlySet<string>
  /** Undefined without the preferences context: no Most used group. */
  usage: ModelUsageMap | undefined
  search: boolean
  labels: { favorites: string; auto: string; recommended: string; mostUsed: string }
}): ModelGroup[] {
  if (input.search) {
    if (input.filtered.length === 0) return []
    return [{ key: "search-results", rows: input.filtered.map(modelRow) }]
  }
  const mostUsed = input.usage
    ? mostUsedModels(
        input.visible.filter((model) => !isAuto(model) && model.recommendedIndex === undefined),
        input.usage,
        input.favoriteKeys,
      )
    : []
  const used = new Set(mostUsed.map((m) => modelKey(m.providerID, m.id)))
  const autos: PickerModel[] = []
  const recommended: PickerModel[] = []
  const map = new Map<string, PickerModel[]>()
  for (const m of input.filtered) {
    if (isAuto(m) && m.recommendedIndex !== undefined) {
      autos.push(m)
      continue
    }
    if (used.has(modelKey(m.providerID, m.id))) continue
    if (m.recommendedIndex !== undefined) {
      recommended.push(m)
      continue
    }
    map.set(m.providerID, [...(map.get(m.providerID) ?? []), m])
  }
  autos.sort(
    (a, b) => (a.recommendedIndex ?? Infinity) - (b.recommendedIndex ?? Infinity) || a.name.localeCompare(b.name),
  )
  recommended.sort((a, b) => (a.recommendedIndex ?? Infinity) - (b.recommendedIndex ?? Infinity))

  const leading: ModelGroup[] = [
    {
      key: FAVORITES_KEY,
      label: input.labels.favorites,
      rows: input.favorites.map((m) => ({ key: rowKey("favorite", m.providerID, m.id), kind: "favorite", model: m })),
    },
    { key: AUTO_KEY, label: input.labels.auto, rows: autos.map(modelRow) },
    { key: RECOMMENDED_KEY, label: input.labels.recommended, rows: recommended.map(modelRow) },
    { key: MOST_USED_KEY, label: input.labels.mostUsed, rows: mostUsed.map(modelRow) },
  ]
  const providers = [...map.entries()]
    .sort(([a], [b]) => providerSortKey(a) - providerSortKey(b))
    .map(([id, list]) => {
      list.sort((a, b) => a.name.localeCompare(b.name))
      return { key: id, label: list[0]?.providerName ?? id, rows: list.map(modelRow) }
    })
  return [...leading.filter((group) => group.rows.length > 0), ...providers]
}

/** The keyboard tree: headings and the rows of open groups; a search lists only rows. */
export function buildNodes(
  groups: ModelGroup[],
  input: { allowClear: boolean; search: boolean; open: (key: string) => boolean },
): ModelNode[] {
  const clear: ModelNode[] = input.allowClear
    ? [{ key: CLEAR_KEY, kind: "row", row: { key: CLEAR_KEY, kind: "clear" } }]
    : []
  return [
    ...clear,
    ...groups.flatMap((group): ModelNode[] => {
      const rows = group.rows.map((row) => ({ key: row.key, kind: "row" as const, row, group }))
      if (input.search) return rows
      const heading = { key: groupKey(group.key), kind: "group" as const, group }
      return input.open(group.key) ? [heading, ...rows] : [heading]
    }),
  ]
}

function modelRow(m: PickerModel): ModelRow {
  return { key: rowKey("model", m.providerID, m.id), kind: "model", model: m }
}
