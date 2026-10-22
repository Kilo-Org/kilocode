import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

export const INDEXING_PLUGIN = "@kilocode/kilo-indexing"

// RATIONALE: Upstream PluginSpec changed from string to string | [string, Record].
// Use a broad input type to accept both forms but return the concrete PluginSpec shape.
type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export function indexingEnabled(config?: ConfigLike | null): boolean {
  return hasIndexingPlugin(config?.plugin ?? [])
}

export function ensureIndexingPlugin(items: readonly PluginSpec[], plugin?: string): PluginSpec[] {
  const plugins = [...items]
  if (!plugin) return plugins
  if (hasIndexingPlugin(plugins)) return plugins
  return [...plugins, plugin]
}
