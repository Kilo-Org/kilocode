import type { LLMRetrievalResult } from "./GhostInlineCompletionProvider"

export interface PendingRequest {
	prefix: string
	suffix: string
	promise: Promise<LLMRetrievalResult>
	abortController: AbortController
}

/**
 * Manages deduplication and reuse of pending autocomplete requests
 */
export class RequestDeduplicator {
	private pendingRequests = new Map<string, PendingRequest>()

	/**
	 * Create a cache key for exact match lookups
	 */
	private getCacheKey(prefix: string, suffix: string): string {
		return `${prefix}|||${suffix}`
	}

	/**
	 * Check if a request can be reused for the given prefix/suffix
	 */
	private canReuse(request: PendingRequest, prefix: string, suffix: string): boolean {
		// Must have same suffix
		if (request.suffix !== suffix) {
			return false
		}

		// Current prefix must start with the request's prefix (user typed ahead)
		return prefix.startsWith(request.prefix)
	}

	/**
	 * Find a reusable pending request for the given prefix/suffix
	 * @returns The reusable request, or null if none found
	 */
	findReusable(prefix: string, suffix: string): PendingRequest | null {
		// Check for exact match first
		const cacheKey = this.getCacheKey(prefix, suffix)
		const exactMatch = this.pendingRequests.get(cacheKey)
		if (exactMatch) {
			return exactMatch
		}

		// Check if we can reuse a request with a shorter prefix (user typed ahead)
		for (const request of this.pendingRequests.values()) {
			if (this.canReuse(request, prefix, suffix)) {
				return request
			}
		}

		return null
	}

	/**
	 * Add a new pending request
	 */
	add(prefix: string, suffix: string, request: PendingRequest): void {
		const cacheKey = this.getCacheKey(prefix, suffix)
		this.pendingRequests.set(cacheKey, request)
	}

	/**
	 * Remove a pending request
	 */
	remove(prefix: string, suffix: string): void {
		const cacheKey = this.getCacheKey(prefix, suffix)
		this.pendingRequests.delete(cacheKey)
	}

	/**
	 * Cancel and remove all pending requests that cannot be reused for the given prefix/suffix
	 */
	cancelObsolete(prefix: string, suffix: string): void {
		for (const [key, request] of this.pendingRequests.entries()) {
			// Cancel if different suffix or if prefix has diverged
			if (
				request.suffix !== suffix ||
				(!prefix.startsWith(request.prefix) && !request.prefix.startsWith(prefix))
			) {
				request.abortController.abort()
				this.pendingRequests.delete(key)
			}
		}
	}

	/**
	 * Cancel and clear all pending requests
	 */
	clear(): void {
		for (const request of this.pendingRequests.values()) {
			request.abortController.abort()
		}
		this.pendingRequests.clear()
	}

	/**
	 * Get the number of pending requests
	 */
	size(): number {
		return this.pendingRequests.size
	}
}
