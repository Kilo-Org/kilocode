import type { OpenCode } from "@opencode-ai/client"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import type { TuiModelGroup, TuiModelPicker } from "@opencode-ai/tui/context/runtime"
import { isKiloAutoID } from "./routed-model"
import { hidePromptTrainingModels, SettingsRpc } from "./settings-rpc"

export function createModelPicker(client: ReturnType<typeof OpenCode.make>): TuiModelPicker {
  return {
    preferredProviderID: "kilo",
    async groups(input, signal) {
      if (!input.models.some((model) => model.providerID === "kilo")) return []
      const ref = input.location
      const location = ref
        ? { directory: ref.directory, ...(ref.workspaceID === undefined ? {} : { workspace: ref.workspaceID }) }
        : undefined
      // Both reads are live per dialog open: no cache, and a failed settings
      // read fails the groups request so the dialog shows its visible fallback.
      const [metadata, settings] = await Promise.all([
        client.rpc(KiloModels.Definition).list({}, { location: input.location, signal }),
        client.rpc(SettingsRpc.Definition).read({}, { location, signal }),
      ])
      return modelGroups(input.models, metadata, hidePromptTrainingModels(settings))
    },
  }
}

export function modelGroups(
  models: ReadonlyArray<{ providerID: string; modelID: string }>,
  metadata: ReadonlyArray<KiloModels.Entry>,
  hideTraining = false,
): TuiModelGroup[] {
  const ranked = metadata
    .filter((model) => model.recommendedIndex !== undefined)
    .toSorted((a, b) => a.recommendedIndex! - b.recommendedIndex! || a.id.localeCompare(b.id))
  return models.flatMap((model): TuiModelGroup[] => {
    if (model.providerID !== "kilo") return []
    const entry = metadata.find((entry) => entry.id === model.modelID)
    // Mirrors v1 filterPromptTrainingModels: only real mayTrainOnYourPrompts
    // metadata hides a model. Missing or false metadata is not a privacy
    // guarantee; the entry still exists so favorites and recents can hide it.
    if (hideTraining && entry?.mayTrainOnYourPrompts === true)
      return [{ providerID: model.providerID, modelID: model.modelID, hidden: true }]
    // Source: ecccd1f CLI FreeModelDisclosure. Missing metadata is not a privacy guarantee.
    const footer = [
      entry?.hasUserByokAvailable === true ? "BYOK" : undefined,
      entry?.mayTrainOnYourPrompts === true ? "May train" : undefined,
    ]
      .filter(Boolean)
      .join(" · ")
    const presentation = { ...model, ...(footer ? { footer } : {}) }
    const rank = ranked.findIndex((entry) => entry.id === model.modelID)
    // autoRouting describes targets for an Auto model; it does not make a regular model Auto.
    if (isKiloAutoID(model.modelID))
      return [{ ...presentation, category: "Kilo Auto", order: rank < 0 ? ranked.length : rank }]
    if (rank >= 0) return [{ ...presentation, category: "Recommended", order: ranked.length + 1 + rank }]
    return footer ? [presentation] : []
  })
}
