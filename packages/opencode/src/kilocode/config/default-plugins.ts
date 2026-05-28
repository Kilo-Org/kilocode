import { createRequire } from "module"
import type { ConfigPlugin } from "@/config/plugin"
import { isIndexingPlugin } from "@kilocode/kilo-indexing/detect"
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
    const plugin = opts.disabled ? undefined : resolveIndexingPlugin(req, opts.log)
    cfg.plugin = ensureIndexingPlugin(cfg.plugin ?? [], plugin)
    // Built-in indexing is not loaded through external plugins and must not wait for their setup.
    cfg.plugin_origins = cfg.plugin_origins?.filter((item) => !isIndexingPlugin(item.spec))
    return cfg
  }
}
