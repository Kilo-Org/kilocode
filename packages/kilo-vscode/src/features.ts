import { hasIndexingPlugin } from "@kilocode/kilo-indexing/detect"

type PluginSpec = string | [string, Record<string, unknown>]

type ConfigLike = {
  plugin?: readonly PluginSpec[] | null
}

/** UI features that can be hidden in this build via a per-feature flag. */
export type UiFeature = "agentManager" | "kiloClaw" | "marketplace" | "worktree"

export type Features = {
  indexing: boolean
  agentManager: boolean
  kiloClaw: boolean
  marketplace: boolean
  worktree: boolean
}

// Each UI feature is off by default and can be re-enabled by setting its env var
// to exactly "true" in the extension host process.
const UI_FEATURE_ENV: Record<UiFeature, string> = {
  agentManager: "KILOCODE_FEATURE_AGENT_MANAGER",
  kiloClaw: "KILOCODE_FEATURE_KILOCLAW",
  marketplace: "KILOCODE_FEATURE_MARKETPLACE",
  worktree: "KILOCODE_FEATURE_WORKTREE",
}

const UI_FEATURE_DEFAULT: Record<UiFeature, boolean> = {
  agentManager: false,
  kiloClaw: false,
  marketplace: false,
  worktree: false,
}

export function isFeatureEnabled(name: UiFeature): boolean {
  const raw = process.env[UI_FEATURE_ENV[name]]
  if (raw === undefined) return UI_FEATURE_DEFAULT[name]
  return raw === "true"
}

export function configFeatures(config?: ConfigLike | null): Features {
  return {
    indexing: hasIndexingPlugin(config?.plugin ?? []),
    agentManager: isFeatureEnabled("agentManager"),
    kiloClaw: isFeatureEnabled("kiloClaw"),
    marketplace: isFeatureEnabled("marketplace"),
    worktree: isFeatureEnabled("worktree"),
  }
}
