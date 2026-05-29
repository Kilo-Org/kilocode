import { pathToFileURL } from "url"
import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

export const INDEXING_PLUGIN = "@kilocode/kilo-indexing"

// RATIONALE: Upstream PluginSpec changed from string to string | [string, Record].
// Use a broad input type to accept both forms but return the concrete PluginSpec shape.
type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

type Req = {
  resolve: (id: string) => string
}

type LogLike = {
  debug: (msg: string, data?: Record<string, unknown>) => void
}

export function indexingEnabled(config?: ConfigLike | null): boolean {
  return hasIndexingPlugin(config?.plugin ?? [])
}

export function resolveIndexingPlugin(req: Req, log?: LogLike): string {
  try {
    const file = req.resolve(INDEXING_PLUGIN)
    return pathToFileURL(file).href
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log?.debug("failed to resolve indexing plugin package, using package marker", { error })
    return INDEXING_PLUGIN
  }
}

export function ensureIndexingPlugin(items: readonly PluginSpec[], plugin?: string): PluginSpec[] {
  const plugins = [...items]
  if (!plugin) return plugins
  if (hasIndexingPlugin(plugins)) return plugins
  return [...plugins, plugin]
}
