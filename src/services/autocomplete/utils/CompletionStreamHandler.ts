import { UI_UPDATE_DEBOUNCE_MS } from "../AutocompleteProvider"

/**
 * Manages debounced completion requests to avoid excessive API calls when typing quickly
 */
export class CompletionStreamHandler {
	private static debounceTimers: Map<string, NodeJS.Timeout> = new Map()

	/**
	 * Cancels an existing debounce timer for the given request ID
	 */
	public static cancelRequest(requestId: string): void {
		const existingTimer = this.debounceTimers.get(requestId)
		if (existingTimer) {
			clearTimeout(existingTimer)
			this.debounceTimers.delete(requestId)
		}
	}

	/**
	 * Makes a debounced API request for completions
	 *
	 * @param requestId Unique identifier for this completion request
	 * @param apiCall Function that makes the actual API call and handles streaming
	 * @param _onCancelled Optional callback when the request is cancelled (currently unused)
	 * @returns A Promise that resolves when the streaming is complete or cancelled
	 */
	public static async streamWithDebounce<T>(
		requestId: string,
		apiCall: () => Promise<T>,
		_onCancelled?: () => void,
	): Promise<T | null> {
		return new Promise((resolve) => {
			// Cancel any existing timer for this request ID
			this.cancelRequest(requestId)

			// Create a new timer
			const timer = setTimeout(async () => {
				this.debounceTimers.delete(requestId)
				try {
					const result = await apiCall()
					resolve(result)
				} catch (error) {
					console.error("Error in debounced completion request:", error)
					resolve(null)
				}
			}, UI_UPDATE_DEBOUNCE_MS)

			// Store the timer
			this.debounceTimers.set(requestId, timer)
		})
	}

	/**
	 * Checks if a request is currently being debounced
	 */
	public static isDebouncing(requestId: string): boolean {
		return this.debounceTimers.has(requestId)
	}
}
