import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

export type Features = {
  indexing: boolean
  project_stack: boolean
}

export function configFeatures(config?: ConfigLike | null): Features {
  // `project_stack` is not CLI-derived — KiloProvider injects it from the
  // `kilo-code.new.experimental.projectStack` VS Code setting before sending
  // `features` to the webview.
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    project_stack: false,
  }
}

/** Merge an extension-managed feature flag into a CLI-derived features object. */
export function withFeature(features: Features, key: keyof Features, value: boolean): Features {
  if (features[key] === value) return features
  return { ...features, [key]: value }
}
