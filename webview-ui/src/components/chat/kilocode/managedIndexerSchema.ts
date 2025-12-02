import { z } from "zod"

/**
 * Zod schema for managed indexer error information
 */
export const managedIndexerErrorSchema = z.object({
	type: z.enum(["setup", "scan", "file-upsert", "git", "manifest", "config"]),
	message: z.string(),
	timestamp: z.string(),
	context: z
		.object({
			filePath: z.string().optional(),
			branch: z.string().optional(),
			operation: z.string().optional(),
		})
		.optional(),
})

export type ManagedIndexerError = z.infer<typeof managedIndexerErrorSchema>

/**
 * Zod schema for workspace folder state
 */
export const workspaceFolderStateSchema = z.object({
	workspaceFolderPath: z.string(),
	workspaceFolderName: z.string(),
	gitBranch: z.string().nullable(),
	projectId: z.string().nullable(),
	repositoryUrl: z.string().optional(),
	isIndexing: z.boolean(),
	hasManifest: z.boolean(),
	manifestFileCount: z.number(),
	hasWatcher: z.boolean(),
	error: managedIndexerErrorSchema.optional(),
})

export type WorkspaceFolderState = z.infer<typeof workspaceFolderStateSchema>

/**
 * Zod schema for the complete managed indexer state
 */
export const managedIndexerStateSchema = z.object({
	isEnabled: z.boolean(),
	isActive: z.boolean(),
	workspaceFolders: z.array(workspaceFolderStateSchema),
})

export type ManagedIndexerState = z.infer<typeof managedIndexerStateSchema>

/**
 * Zod schema for the message from extension host
 */
export const managedIndexerStateMessageSchema = z.object({
	type: z.literal("managedIndexerState"),
	managedIndexerEnabled: z.boolean(),
	managedIndexerState: z.array(workspaceFolderStateSchema),
})

export type ManagedIndexerStateMessage = z.infer<typeof managedIndexerStateMessageSchema>

/**
 * Parse and validate managed indexer state message
 */
export function parseManagedIndexerStateMessage(data: unknown): ManagedIndexerState | null {
	try {
		const parsed = managedIndexerStateMessageSchema.parse(data)
		return {
			isEnabled: parsed.managedIndexerEnabled,
			isActive: parsed.managedIndexerState.length > 0,
			workspaceFolders: parsed.managedIndexerState,
		}
	} catch (error) {
		console.error("[parseManagedIndexerStateMessage] Failed to parse message:", error)
		return null
	}
}
