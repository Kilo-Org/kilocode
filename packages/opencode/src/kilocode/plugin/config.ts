import type { Config } from "@/config/config"

export namespace KilocodePluginConfig {
  export async function apply(cfg: Config.Info, hook: () => Promise<void>) {
    const paths = new Set(cfg.skills?.paths)
    try {
      await hook()
    } finally {
      const next = cfg.skills?.paths ?? []
      const origins = cfg.skill_path_origins
      const added = next.filter((item) => !paths.has(item) && !origins?.[item])
      if (added.length) {
        cfg.skill_path_origins = {
          ...origins,
          ...Object.fromEntries(added.map((item) => [item, { trusted: true, source: "plugin config hook" }])),
        }
      }
    }
  }
}
