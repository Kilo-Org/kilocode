import { pathToFileURL } from "url"
import { ATOMIC_CHAT_PLUGIN } from "@kilocode/plugin-atomic-chat"

type PluginSpec = string | [string, Record<string, unknown>]

type Req = {
  resolve: (id: string) => string
}

type LogLike = {
  debug: (msg: string, data?: Record<string, unknown>) => void
}

export function hasAtomicChatPlugin(plugins: readonly PluginSpec[]): boolean {
  return plugins.some((item) => {
    const spec = typeof item === "string" ? item : item[0]
    return spec.includes("plugin-atomic-chat") || spec === ATOMIC_CHAT_PLUGIN
  })
}

export function resolveAtomicChatPlugin(req: Req, log?: LogLike): string {
  try {
    const file = req.resolve(ATOMIC_CHAT_PLUGIN)
    return pathToFileURL(file).href
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log?.debug("failed to resolve atomic chat plugin package, using package marker", { error })
    return ATOMIC_CHAT_PLUGIN
  }
}

export function ensureAtomicChatPlugin(items: readonly PluginSpec[], plugin?: string): PluginSpec[] {
  const plugins = [...items]
  if (!plugin) return plugins
  if (hasAtomicChatPlugin(plugins)) return plugins
  return [...plugins, plugin]
}
