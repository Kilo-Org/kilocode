import type { OpenCode } from "@opencode-ai/client"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import type { TuiModelGroup, TuiModelPicker } from "@opencode-ai/tui/context/runtime"
import { isKiloAutoID } from "./routed-model"

export function createModelPicker(client: ReturnType<typeof OpenCode.make>): TuiModelPicker {
  return {
    preferredProviderID: "kilo",
    async groups(input, signal) {
      if (!input.models.some((model) => model.providerID === "kilo")) return []
      const metadata = await client.rpc(KiloModels.Definition).list({}, { location: input.location, signal })
      return modelGroups(input.models, metadata)
    },
  }
}

export function modelGroups(
  models: ReadonlyArray<{ providerID: string; modelID: string }>,
  metadata: ReadonlyArray<KiloModels.Entry>,
): TuiModelGroup[] {
  const ranked = metadata
    .filter((model) => model.recommendedIndex !== undefined)
    .toSorted((a, b) => a.recommendedIndex! - b.recommendedIndex! || a.id.localeCompare(b.id))
  return models.flatMap((model) => {
    if (model.providerID !== "kilo") return []
    const entry = metadata.find((entry) => entry.id === model.modelID)
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
