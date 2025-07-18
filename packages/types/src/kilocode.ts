import { z } from "zod"

export const ghostServiceSettingsSchema = z
	.object({
		apiConfigId: z.string().optional(),
	})
	.optional()

export type GhostServiceSettings = z.infer<typeof ghostServiceSettingsSchema>
