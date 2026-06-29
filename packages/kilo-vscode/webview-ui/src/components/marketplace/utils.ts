import type {
  MarketplaceInstalledMetadata,
  MarketplaceItem,
  MarketplaceRelevanceMetadata,
} from "../../types/marketplace"

export function hasRelevantItems(items: MarketplaceItem[], relevance: MarketplaceRelevanceMetadata): boolean {
  return items.some((item) => !!relevance[`${item.type}:${item.id}`])
}

export function retain<T>(selected: T[], available: T[]): T[] {
  const values = new Set(available)
  const next = selected.filter((value) => values.has(value))
  return next.length === selected.length ? selected : next
}

export function isInstalled(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): "project" | "global" | false {
  return installedScopes(id, type, metadata)[0] ?? false
}

export function installedScopes(
  id: string,
  type: string,
  metadata: MarketplaceInstalledMetadata,
): ("project" | "global")[] {
  const scopes: ("project" | "global")[] = []
  const key = `${type}:${id}`
  if (metadata.project[key]?.type === type) scopes.push("project")
  if (metadata.global[key]?.type === type) scopes.push("global")
  return scopes
}

function matches(item: MarketplaceItem, query: string, labels: Partial<Record<MarketplaceItem["type"], string>>) {
  const skill = item.type === "skill" ? item : undefined
  return (
    item.id.toLowerCase().includes(query) ||
    item.name.toLowerCase().includes(query) ||
    item.description.toLowerCase().includes(query) ||
    item.category.replaceAll("-", " ").toLowerCase().includes(query) ||
    item.type.includes(query) ||
    (labels[item.type]?.toLowerCase().includes(query) ?? false) ||
    (item.author?.toLowerCase().includes(query) ?? false) ||
    (skill?.displayName.toLowerCase().includes(query) ?? false)
  )
}

export function filterItems(
  items: MarketplaceItem[],
  metadata: MarketplaceInstalledMetadata,
  search: string,
  status: string,
  categories: string[],
  types: MarketplaceItem["type"][],
  labels: Partial<Record<MarketplaceItem["type"], string>> = {},
  relevant = false,
  relevance: MarketplaceRelevanceMetadata = {},
): MarketplaceItem[] {
  const query = search.trim().toLowerCase()
  return items
    .filter((item) => {
      if (status === "installed" && !isInstalled(item.id, item.type, metadata)) return false
      if (status === "notInstalled" && isInstalled(item.id, item.type, metadata)) return false
      if (types.length > 0 && !types.includes(item.type)) return false
      if (categories.length > 0 && !categories.includes(item.category)) return false
      if (relevant && !relevance[`${item.type}:${item.id}`]) return false
      if (!query) return true
      return matches(item, query, labels)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
