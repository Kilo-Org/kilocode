import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
  experimental?: { semantic_indexing?: boolean } | null
}

export type Features = {
  indexing: boolean
}

export function configFeatures(config?: ConfigLike | null): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []) && config?.experimental?.semantic_indexing === true,
  }
}
