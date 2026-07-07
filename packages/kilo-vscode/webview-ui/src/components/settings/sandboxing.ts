import type { Config, FeatureFlags } from "../../types/messages"

export function visible(features: FeatureFlags, config: Config) {
  return features.sandboxControls && config.experimental?.sandbox === true
}
