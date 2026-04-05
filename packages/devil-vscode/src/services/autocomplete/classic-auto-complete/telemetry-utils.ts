import type { FillInAtCursorSuggestion } from "../types"

/**
 * Generate a unique key for a suggestion based on its content and context.
 * Used to deduplicate telemetry for the same suggestion shown multiple times.
 */
export function getSuggestionKey(suggestion: FillInAtCursorSuggestion): string {
  return `${suggestion.prefix}|${suggestion.suffix}|${suggestion.text}`
}

/**
 * Insert a key into a Map used as a bounded LRU set.
 * Evicts the oldest entry when the map exceeds `maxSize`.
 * Returns the (possibly evicted) updated map.
 */
export function insertWithLRUEviction(map: Map<string, true>, key: string, maxSize: number): void {
  map.set(key, true)
  if (map.size > maxSize) {
    const oldest = map.keys().next().value as string | undefined
    if (oldest !== undefined) {
      map.delete(oldest)
    }
  }
}
