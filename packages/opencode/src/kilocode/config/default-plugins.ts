import { createRequire } from "module"
import type { ConfigPlugin } from "@/config/plugin"
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
    const before = cfg.plugin ?? []
    const plugin = opts.disabled ? undefined : resolveIndexingPlugin(req, opts.log)
    const after = ensureIndexingPlugin(before, plugin)
    if (after.length > before.length) {
      const added = after[after.length - 1]
      cfg.plugin_origins = [
        ...(cfg.plugin_origins ?? []),
        { spec: added, source: "builtin", scope: "global" as ConfigPlugin.Scope },
      ]
    }
    cfg.plugin = after
    return cfg
  }
}
