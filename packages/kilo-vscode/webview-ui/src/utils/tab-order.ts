export function reorderTabs(tabs: readonly string[], from: string, to: string): string[] | undefined {
  if (from === to) return undefined
  const start = tabs.indexOf(from)
  const end = tabs.indexOf(to)
  if (start === -1 || end === -1) return undefined
  const result = [...tabs]
  result.splice(start, 1)
  result.splice(end, 0, from)
  return result
}

export function moveTab(tabs: readonly string[], id: string, offset: -1 | 1): string[] | undefined {
  const index = tabs.indexOf(id)
  const target = index + offset
  if (index === -1 || target < 0 || target >= tabs.length) return undefined
  return reorderTabs(tabs, id, tabs[target])
}

/**
 * Move pinned items to the front, keeping their pin order.
 *
 * Unpinned items keep the sequence they already had, so this layers on top of a
 * stored tab order without discarding a user's drag order. Pinned ids that are
 * not currently open are ignored.
 */
export function applyPinnedTabs<T extends { id: string }>(items: T[], pinned: string[] | undefined): T[] {
  if (!pinned || pinned.length === 0) return items
  const rank = new Map(pinned.map((id, i) => [id, i]))
  const head = items.filter((item) => rank.has(item.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
  if (head.length === 0) return items
  const tail = items.filter((item) => !rank.has(item.id))
  return [...head, ...tail]
}

/**
 * Pin or unpin `id`.
 *
 * A newly pinned tab lands at the end of the pinned group so existing pins keep
 * their position. Unpinning drops the tab back into the unpinned group.
 */
export function togglePinnedTab(pinned: string[] | undefined, id: string): string[] {
  const base = pinned ?? []
  if (base.includes(id)) return base.filter((item) => item !== id)
  return [...base, id]
}

/**
 * Reorder `from` onto `to` without crossing the pinned boundary.
 *
 * Pinned tabs reorder inside the pin list; unpinned tabs reorder inside the
 * stored order `ids`. A move that mixes the two groups, or repeats an id, is
 * rejected so both lists stay independent.
 */
export function reorderPinnedTabs(
  ids: readonly string[],
  pinned: readonly string[],
  from: string,
  to: string,
): { ids: string[]; pinned: string[] } | undefined {
  const first = pinned.includes(from)
  const second = pinned.includes(to)
  if (first !== second) return undefined
  if (first) {
    const next = reorderTabs(pinned, from, to)
    return next ? { ids: [...ids], pinned: next } : undefined
  }
  const next = reorderTabs(ids, from, to)
  return next ? { ids: next, pinned: [...pinned] } : undefined
}
