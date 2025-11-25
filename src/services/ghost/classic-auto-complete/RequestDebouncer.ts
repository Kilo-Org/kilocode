/**
 * Handles debouncing of autocomplete requests with intelligent flushing
 */
export class RequestDebouncer {
	private timer: NodeJS.Timeout | null = null
	private pendingResolvers: Array<() => void> = []
	private lastRequest: { execute: () => Promise<void> } | null = null

	/**
	 * Debounce a request execution
	 * @param execute - Function to execute after debounce delay
	 * @param delay - Delay in milliseconds
	 * @param shouldFlush - Optional function to determine if pending request should flush immediately
	 * @returns Promise that resolves when request completes
	 */
	debounce(
		execute: () => Promise<void>,
		delay: number,
		shouldFlush?: (lastRequest: { execute: () => Promise<void> } | null) => boolean,
	): Promise<void> {
		// Check if we should flush the pending request immediately
		if (this.timer && shouldFlush?.(this.lastRequest)) {
			this.flush()
		} else if (this.timer) {
			// Just clear the timer to restart debounce
			clearTimeout(this.timer)
		}

		// Store the current request
		this.lastRequest = { execute }

		return new Promise<void>((resolve) => {
			// Add this resolver to the list
			this.pendingResolvers.push(resolve)

			this.timer = setTimeout(async () => {
				this.timer = null
				// Execute the last request that was set
				if (this.lastRequest) {
					try {
						await this.lastRequest.execute()
					} catch (error) {
						// Silently catch errors - they should be handled by the execute function
						console.error("Error in debounced request:", error)
					}
					this.lastRequest = null
				}

				// Resolve all pending promises
				const resolvers = this.pendingResolvers.splice(0)
				resolvers.forEach((r) => r())
			}, delay)
		})
	}

	/**
	 * Flush any pending debounced request immediately
	 */
	flush(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}

		// Execute the pending request if it exists
		if (this.lastRequest) {
			const request = this.lastRequest
			this.lastRequest = null
			const resolvers = this.pendingResolvers.splice(0)

			request
				.execute()
				.catch((error) => {
					// Silently catch errors
					console.error("Error in flushed request:", error)
				})
				.then(() => {
					resolvers.forEach((r) => r())
				})
		}
	}

	/**
	 * Clear all pending requests without executing them
	 */
	clear(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		this.pendingResolvers = []
		this.lastRequest = null
	}

	/**
	 * Check if there's a pending debounced request
	 */
	hasPending(): boolean {
		return this.timer !== null
	}
}
