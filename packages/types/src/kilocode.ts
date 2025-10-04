import { z } from "zod"

export const ghostProfileSchema = z.object({
	id: z.string(),
	name: z.string(),
	apiConfigId: z.string(),
	strategyId: z.string(),
})

export type GhostProfile = z.infer<typeof ghostProfileSchema>

export const ghostServiceSettingsSchema = z
	.object({
		enableAutoTrigger: z.boolean().optional(),
		autoTriggerDelay: z.number().min(1).max(30).default(3).optional(),
		enableQuickInlineTaskKeybinding: z.boolean().optional(),
		enableSmartInlineTaskKeybinding: z.boolean().optional(),
		enableCustomProvider: z.boolean().optional(),
		apiConfigId: z.string().optional(),
		ghostStrategyId: z.string().optional(),
		showGutterAnimation: z.boolean().optional(),
	})
	.optional()

export type GhostServiceSettings = z.infer<typeof ghostServiceSettingsSchema>

export const commitRangeSchema = z.object({
	from: z.string(),
	to: z.string(),
})

export type CommitRange = z.infer<typeof commitRangeSchema>

export const kiloCodeMetaDataSchema = z.object({
	commitRange: commitRangeSchema.optional(),
})

export type KiloCodeMetaData = z.infer<typeof kiloCodeMetaDataSchema>

export const fastApplyModelSchema = z.enum([
	"auto",
	"morph/morph-v3-fast",
	"morph/morph-v3-large",
	"relace/relace-apply-3",
])

export type FastApplyModel = z.infer<typeof fastApplyModelSchema>
