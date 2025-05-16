/**
 * Interface for cache entries
 */
interface CacheEntry {
	completion: string
	timestamp: number
}

/**
 * LRU-based cache for completions to improve response time and reduce API calls
 */
export class CompletionCache {
	private cache: Map<string, CacheEntry>
	private maxSize: number
	private ttl: number // Time to live in milliseconds

	/**
	 * Create a new completion cache
	 * @param maxSize Maximum number of entries in the cache
	 * @param ttl Time to live for cache entries in milliseconds
	 */
	constructor(maxSize: number = 100, ttl: number = 60 * 1000) {
		this.cache = new Map<string, CacheEntry>()
		this.maxSize = maxSize
		this.ttl = ttl
	}

	/**
	 * Generate a cache key from the input parameters
	 * @param filepath File path
	 * @param content File content
	 * @param cursorIndex Cursor position index
	 * @returns Cache key
	 */
	private generateKey(filepath: string, content: string, cursorIndex: number): string {
		// Create a context window around the cursor position to use as part of the key
		const contextSize = 200 // Characters before cursor to include in key
		const startIndex = Math.max(0, cursorIndex - contextSize)
		const contextWindow = content.substring(startIndex, cursorIndex)

		// Use filepath, cursor position and context window to create a unique key
		return `${filepath}:${cursorIndex}:${contextWindow}`
	}

	/**
	 * Get a completion from the cache
	 * @param filepath File path
	 * @param content File content
	 * @param cursorIndex Cursor position index
	 * @returns Cached completion or undefined if not found
	 */
	get(filepath: string, content: string, cursorIndex: number): string | undefined {
		const key = this.generateKey(filepath, content, cursorIndex)
		const entry = this.cache.get(key)

		if (!entry) {
			return undefined
		}

		// Check if the entry has expired
		if (Date.now() - entry.timestamp > this.ttl) {
			this.cache.delete(key)
			return undefined
		}

		// Update the entry timestamp to mark it as recently used
		entry.timestamp = Date.now()
		this.cache.set(key, entry)

		return entry.completion
	}

	/**
	 * Store a completion in the cache
	 * @param filepath File path
	 * @param content File content
	 * @param cursorIndex Cursor position index
	 * @param completion Completion to store
	 */
	set(filepath: string, content: string, cursorIndex: number, completion: string): void {
		const key = this.generateKey(filepath, content, cursorIndex)

		// If the cache is full, remove the least recently used entry
		if (this.cache.size >= this.maxSize) {
			let oldestKey: string | undefined
			let oldestTime = Infinity

			for (const [k, entry] of this.cache.entries()) {
				if (entry.timestamp < oldestTime) {
					oldestTime = entry.timestamp
					oldestKey = k
				}
			}

			if (oldestKey) {
				this.cache.delete(oldestKey)
			}
		}

		// Add the new entry
		this.cache.set(key, {
			completion,
			timestamp: Date.now(),
		})
	}

	/**
	 * Clear the cache
	 */
	clear(): void {
		this.cache.clear()
	}

	/**
	 * Get the current size of the cache
	 */
	size(): number {
		return this.cache.size
	}
}
