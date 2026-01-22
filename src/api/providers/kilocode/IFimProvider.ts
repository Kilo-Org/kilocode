import { ApiHandlerCreateMessageMetadata } from "../.."
import { CompletionUsage } from "../openrouter"

/**
 * Interface for FIM (Fill-In-the-Middle) completion providers.
 * This interface defines the contract for providers that support FIM operations,
 * allowing for code completion between a prefix and suffix.
 */
export interface IFimProvider {
	/**
	 * Check if the provider supports FIM operations
	 * @returns true if FIM is supported, false otherwise
	 */
	supportsFim(): boolean

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
	 * Get custom request options for API calls
	 * @param metadata - Optional metadata including taskId, projectId, and mode
	 * @returns Custom request options with headers
	 */
	customRequestOptions(metadata?: ApiHandlerCreateMessageMetadata): { headers: Record<string, string> } | undefined
}
