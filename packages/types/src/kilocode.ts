import { z } from "zod"

export const kilocodeDefaultModelId = "qwen/qwen3-coder"

export const ghostServiceSettingsSchema = z
	.object({
		enableQuickInlineTaskKeybinding: z.boolean().optional(),
		enableAutoInlineTaskKeybinding: z.boolean().optional(),
		apiConfigId: z.string().optional(),
	})
	.optional()

export type GhostServiceSettings = z.infer<typeof ghostServiceSettingsSchema>
