// kilocode_change - new file
import type { ModelInfo } from "@roo-code/types"
import type { CompletionUsage } from "../openrouter"

/**
 * Interface for FIM (Fill-In-the-Middle) completion handlers.
 */
export interface FimHandler {
	/**
	 * Stream code completion between a prefix and suffix
	 * @param prefix - The code before the cursor/insertion point
	 * @param suffix - The code after the cursor/insertion point
	 * @param taskId - Optional task ID for tracking
	 * @param onUsage - Optional callback invoked with usage information when available
	 * @returns An async generator yielding code chunks as strings
	 */
	streamFim(
		prefix: string,
		suffix: string,
		taskId?: string,
		onUsage?: (usage: CompletionUsage) => void,
	): AsyncGenerator<string>

	/**
	 * Get the model information for the FIM handler
	 * @returns Object containing model id, info, and optional maxTokens
	 */
	getModel(): { id: string; info: ModelInfo; maxTokens?: number }

	/**
	 * Calculate the total cost for a completion based on usage
	 * @param usage - The completion usage information
	 * @returns The total cost in dollars
	 */
	getTotalCost(usage: CompletionUsage): number
}
