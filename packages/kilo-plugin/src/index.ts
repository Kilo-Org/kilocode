import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

/**
 * The Kilo plugin (plugin-first option 1). It registers nothing yet. The Kilo host (U-E0-01)
 * registers it through `SdkPlugins.register`; Kilo features move here as they are ported.
 */
export default Plugin.define({
  id: "kilo",
  effect: () => Effect.void,
})
