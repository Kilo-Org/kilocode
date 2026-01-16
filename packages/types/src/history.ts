import { z } from "zod"

/**
 * HistoryItem
 */

export const historyItemSchema = z.object({
	id: z.string(),
	rootTaskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	number: z.number(),
	ts: z.number(),
	task: z.string(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
	totalCost: z.number(),
	size: z.number().optional(),
	workspace: z.string().optional(),
	isFavorited: z.boolean().optional(), // kilocode_change
	mode: z.string().optional(),
	/**
	 * The tool protocol used by this task. Once a task uses tools with a specific
	 * protocol (XML or Native), it is permanently locked to that protocol.
	 *
	 * - "xml": Tool calls are parsed from XML text (no tool IDs)
	 * - "native": Tool calls come as tool_call chunks with IDs
	 *
	 * This ensures task resumption works correctly even when NTC settings change.
	 */
	toolProtocol: z.enum(["xml", "native"]).optional(),
	status: z.enum(["active", "completed", "delegated"]).optional(),
	delegatedToId: z.string().optional(), // Last child this parent delegated to
	childIds: z.array(z.string()).optional(), // All children spawned by this task
	awaitingChildId: z.string().optional(), // Child currently awaited (set when delegated)
	completedByChildId: z.string().optional(), // Child that completed and resumed this parent
	completionResultSummary: z.string().optional(), // Summary from completed child
})

export type HistoryItem = z.infer<typeof historyItemSchema>
