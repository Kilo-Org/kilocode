import type { IndexingConfig } from "@kilocode/kilo-indexing/config"

export type IndexingScope = "global" | "project"

export function indexingEnabled(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  if (scope === "global") return global.enabled === true
  return (project.enabled ?? global.enabled) === true
}

export function indexingEnabledInherited(scope: IndexingScope, global: IndexingConfig, project: IndexingConfig) {
  return scope === "project" && project.enabled === undefined && global.enabled !== undefined
}
