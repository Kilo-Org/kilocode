import type { FeatureFlags } from "../../types/messages"

export function visible(features: FeatureFlags) {
  return features.sandboxControls
}
