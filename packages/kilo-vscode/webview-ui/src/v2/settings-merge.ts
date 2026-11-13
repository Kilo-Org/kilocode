// Effective config from the `api.config.get` documents. Core picks the last document that defines a key
// (`Config.latest`), so a later document replaces the whole top-level value and the merge is one pass in order.
export function mergeConfigDocuments(entries: { type: string; info?: unknown; path?: string }[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const entry of entries)
    if (entry.type === "document" && typeof entry.info === "object" && entry.info !== null)
      Object.assign(result, entry.info as Record<string, unknown>)
  return result
}
