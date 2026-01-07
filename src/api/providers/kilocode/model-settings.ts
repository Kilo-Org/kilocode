import { ModelInfo } from "@roo-code/types"
import { z } from "zod"

export const ModelSettingsSchema = z.object({
	included_tools: z.array(z.string()).nullish(),
	excluded_tools: z.array(z.string()).nullish(),
})

export const VersionedModelSettingsSchema = z.record(z.string(), ModelSettingsSchema)

export type ModelSettings = z.infer<typeof ModelSettingsSchema>

export type VersionedModelSettings = z.infer<typeof VersionedModelSettingsSchema>

export function parseModelSettings(settings: ModelSettings): Partial<ModelInfo> {
	return {
		includedTools: settings?.included_tools ?? undefined,
		excludedTools: settings?.excluded_tools ?? undefined,
	}
}
