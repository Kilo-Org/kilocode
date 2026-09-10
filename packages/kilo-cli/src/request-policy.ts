import type { Location } from "@opencode-ai/core/location"
import { Effect } from "effect"
import type { Layout } from "./paths"
import { hidePromptTrainingModels } from "./settings-rpc"
import { createSettingsStore } from "./settings"

/**
 * Bridge the location-scoped settings fold to the Gateway plugin, mirroring the
 * `configEntries` bridge in `interactive-server.ts`: the plugin Context cannot reach the
 * host's raw Kilo-only settings, so the host resolves them here. The reader reuses the real
 * settings store — the same raw profile + project document fold, scope precedence, and
 * invalid-value reporting the dialog and model picker consume — instead of cloning document
 * discovery. The effective value matches the picker's: project wins over profile.
 *
 * `"deny"` is returned only for an explicit stored `true`. An unset, explicitly `false`, or
 * invalid stored value returns `undefined`, so the Gateway never invents a restriction; the
 * settings snapshot already reports an invalid stored value to the user. A read failure is
 * left to the caller, which keeps its last known policy.
 */
export function readDataCollectionPolicy(options: { layout: Layout; project: boolean }, location: Location.Interface) {
  const store = createSettingsStore({
    layout: options.layout,
    project: { enabled: options.project, directory: location.directory, boundary: location.project.directory },
  })
  return Effect.tryPromise({
    try: async () => (hidePromptTrainingModels(await store.read()) ? ("deny" as const) : undefined),
    catch: (cause) => (cause instanceof Error ? cause : new Error("Unable to read the Kilo settings snapshot")),
  })
}
