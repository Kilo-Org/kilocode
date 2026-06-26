import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export type Features = {
  indexing: boolean
  sandboxControls: boolean
}

export function configFeatures(config?: ConfigLike | null): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    sandboxControls: process.platform !== "win32",
  }
}
