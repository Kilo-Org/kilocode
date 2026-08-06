/**
 * Pure tab-ordering logic for the agent manager.
 */

export { reorderTabs } from "../src/utils/tab-order"

/**
 * Apply a custom ordering to a list of items.
 *
 * Items are returned in `order` sequence (skipping IDs not in `items`),
 * followed by any items not present in `order`.
 * Returns the original array unchanged if `order` is undefined or empty.
 */
export function applyTabOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items
  const lookup = new Map(items.map((item) => [item.id, item]))
  const ordered: T[] = []
  for (const id of order) {
    const item = lookup.get(id)
    if (item) {
      ordered.push(item)
      lookup.delete(id)
    }
  }
  for (const item of lookup.values()) ordered.push(item)
  return ordered
}

/**
 * Replace `oldId` with `newId` in `order`, preserving its position.
 * Returns a new array, or undefined if `oldId` isn't in `order`.
 * Used when a pending session tab is promoted to a real session id.
 */
export function replaceInTabOrder(order: string[] | undefined, oldId: string, newId: string): string[] | undefined {
  if (!order) return undefined
  const i = order.indexOf(oldId)
  if (i === -1) return undefined
  const next = [...order]
  next[i] = newId
  return next
}

/**
 * Insert `id` into `order` directly after `afterId`.
 * If `afterId` is missing from `order`, appends `id` at the end.
 * Returns a new array, or undefined if `id` is already present.
 */
export function insertInTabOrderAfter(order: string[] | undefined, afterId: string, id: string): string[] {
  const base = order ?? []
  if (base.includes(id)) return base
  const i = base.indexOf(afterId)
  if (i === -1) return [...base, id]
  return [...base.slice(0, i + 1), id, ...base.slice(i + 1)]
}

/**
 * Find the title of the first item according to a custom order.
 *
 * Falls back to the first titled item in `items` if the order
 * doesn't produce a match, then to `fallback`.
 */
export function firstOrderedTitle(
  items: { id: string; title?: string }[],
  order: string[] | undefined,
  fallback: string,
): string {
  if (order) {
    const lookup = new Map(items.map((item) => [item.id, item]))
    for (const id of order) {
      const item = lookup.get(id)
      if (item?.title) return item.title
    }
  }
  const first = items.find((item) => item.title)
  return first?.title || fallback
}
