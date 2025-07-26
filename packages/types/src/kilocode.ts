import { z } from "zod"

export const kilocodeDefaultModelId = "anthropic/claude-sonnet-4"

export const ghostServiceSettingsSchema = z
	.object({
		enableQuickInlineTaskKeybinding: z.boolean().optional(),
		enableAutoInlineTaskKeybinding: z.boolean().optional(),
		apiConfigId: z.string().optional(),
	})
	.optional()

export type GhostServiceSettings = z.infer<typeof ghostServiceSettingsSchema>
