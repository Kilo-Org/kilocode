import type { Config } from "@/config/config"

export function mark(cfg: Config.Info, before: ReadonlySet<string>) {
  const paths = cfg.skills?.paths
  if (!paths?.length) return

  // Only paths added after plugin hooks began are trusted. Config-file paths
  // already have an origin recorded by Config.load; limiting this to the
  // observed delta keeps missing provenance fail-closed for future callers.
  const origins = { ...cfg.skill_path_origins }
  for (const path of paths) {
    if (before.has(path) || origins[path]) continue
    origins[path] = {
      trusted: true,
      source: "plugin config hook",
    }
  }
  cfg.skill_path_origins = origins
}

export * as PluginSkillOrigins from "./plugin-skill-origins"
