const EXTENSION = "extension"

/** The Gateway notifications this surface shows: the extension ones, without the IDs this window dismissed. */
export function visibleNotifications<T extends { id: string; showIn?: readonly string[] }>(
  items: readonly T[],
  dismissedIds: readonly string[],
): T[] {
  return items.filter((item) => (!item.showIn || item.showIn.includes(EXTENSION)) && !dismissedIds.includes(item.id))
}
