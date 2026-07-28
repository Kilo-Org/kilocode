import { createRequire } from "module"
import { ConfigPlugin } from "@/config/plugin"
import { ConfigPluginV1 } from "@opencode-ai/core/v1/config/plugin"
import { isIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { ensureAtomicChatPlugin, isAtomicChatPlugin } from "@/kilocode/atomic-chat-feature"
import { ensureIndexingPlugin, resolveIndexingPlugin } from "@/kilocode/indexing-feature"

type Log = {
  debug: (msg: string, data?: Record<string, unknown>) => void
}

const req = createRequire(import.meta.url)

export namespace KilocodeDefaultPlugins {
  export function apply<T extends { plugin?: ConfigPluginV1.Spec[]; plugin_origins?: ConfigPlugin.Origin[] }>(
    cfg: T,
    opts: { disabled: boolean; log?: Log },
  ): T {
    let plugins = cfg.plugin ?? []

    if (!opts.disabled) {
      plugins = ensureIndexingPlugin(plugins, resolveIndexingPlugin(req, opts.log))
      plugins = ensureAtomicChatPlugin(plugins)
    }

    cfg.plugin = plugins
    // Built-in plugins are not loaded externally and must not wait for external plugin setup.
    const origins = cfg.plugin_origins?.filter((item) => !isIndexingPlugin(item.spec) && !isAtomicChatPlugin(item.spec))
    if (!origins) return cfg
    if (opts.disabled) {
      cfg.plugin_origins = origins
      return cfg
    }
    const known = new Set(origins.map((item) => ConfigPlugin.pluginSpecifier(item.spec)))
    cfg.plugin_origins = [
      ...origins,
      ...plugins
        .filter((spec) => !isIndexingPlugin(spec) && !isAtomicChatPlugin(spec))
        .filter((spec) => !known.has(ConfigPlugin.pluginSpecifier(spec)))
        .map((spec) => ({ spec, source: "builtin", scope: "global" as const })),
    ]
    return cfg
  }
}
