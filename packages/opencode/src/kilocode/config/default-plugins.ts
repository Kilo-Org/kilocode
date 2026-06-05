import { createRequire } from "module"
import type { ConfigPlugin } from "@/config/plugin"
import { isIndexingPlugin } from "@kilocode/kilo-indexing/detect"
import { ensureAtomicChatPlugin, resolveAtomicChatPlugin } from "@/kilocode/atomic-chat-feature"
import { ensureIndexingPlugin, resolveIndexingPlugin } from "@/kilocode/indexing-feature"

type Log = {
  debug: (msg: string, data?: Record<string, unknown>) => void
}

const req = createRequire(import.meta.url)

export namespace KilocodeDefaultPlugins {
  export function apply<T extends { plugin?: ConfigPlugin.Spec[]; plugin_origins?: ConfigPlugin.Origin[] }>(
    cfg: T,
    opts: { disabled: boolean; log?: Log },
  ): T {
    let plugins = cfg.plugin ?? []

    if (!opts.disabled) {
      plugins = ensureIndexingPlugin(plugins, resolveIndexingPlugin(req, opts.log))
      plugins = ensureAtomicChatPlugin(plugins, resolveAtomicChatPlugin(req, opts.log))
    }

    cfg.plugin = plugins
    // Built-in indexing is not loaded through external plugins and must not wait for their setup.
    cfg.plugin_origins = cfg.plugin_origins?.filter((item) => !isIndexingPlugin(item.spec))
    return cfg
  }
}
