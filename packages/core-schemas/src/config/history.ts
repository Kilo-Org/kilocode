import { z } from "zod"

/**
 * Single history entry
 */
export const historyEntrySchema = z.object({
	prompt: z.string(),
	timestamp: z.number(),
})

/**
 * History data structure
 */
export const historyDataSchema = z.object({
	version: z.string(),
	maxSize: z.number(),
	entries: z.array(historyEntrySchema),
})

// Inferred types
export type HistoryEntry = z.infer<typeof historyEntrySchema>
export type HistoryData = z.infer<typeof historyDataSchema>
