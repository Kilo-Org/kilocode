import type { OpenCode } from "@opencode-ai/client"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import type { TuiModelGroup, TuiModelPicker } from "@opencode-ai/tui/context/runtime"

export function createModelPicker(client: ReturnType<typeof OpenCode.make>): TuiModelPicker {
  return {
    preferredProviderID: "kilo",
    async groups(input, signal) {
      if (!input.models.some((model) => model.providerID === "kilo")) return []
      const metadata = await client
        .rpc(KiloModels.Definition)
        .list({}, { location: input.location, signal })
        .catch(() => [])
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
    const source = metadata.find((entry) => entry.id === model.modelID)
    const rank = ranked.findIndex((entry) => entry.id === model.modelID)
    // Only group IDs already available in the native catalog, never invent Auto entries.
    if (model.modelID.startsWith("kilo-auto/") || source?.autoRouting)
      return [{ ...model, category: "Kilo Auto", order: rank < 0 ? ranked.length : rank }]
    if (rank >= 0) return [{ ...model, category: "Recommended", order: ranked.length + 1 + rank }]
    return []
  })
}
