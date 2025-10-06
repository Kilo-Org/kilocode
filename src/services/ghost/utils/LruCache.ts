/**
 * Generic LRU (Least Recently Used) Cache
 * Consolidates the duplicate LRU implementations from openedFilesLruCache and prevEditLruCache
 */

export class LruCache<K, V> {
	private cache = new Map<K, V>()
	private maxSize: number

	constructor(maxSize: number) {
		this.maxSize = maxSize
	}

	/**
	 * Set a value in the cache
	 * If key exists, it's moved to the end (most recent)
	 * If at capacity, oldest entry is removed
	 */
	set(key: K, value: V): void {
		// If key already exists, delete it first to reinsert at end
		if (this.cache.has(key)) {
			this.cache.delete(key)
		}
		// If at capacity, remove oldest (first) entry
		else if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			if (firstKey !== undefined) {
				this.cache.delete(firstKey)
			}
		}

		this.cache.set(key, value)
	}

	/**
	 * Get a value from the cache
	 * Accessing a value moves it to the end (most recent)
	 */
	get(key: K): V | undefined {
		const value = this.cache.get(key)
		if (value !== undefined) {
			// Move to end (most recent)
			this.cache.delete(key)
			this.cache.set(key, value)
		}
		return value
	}

	/**
	 * Check if a key exists in the cache
	 */
	has(key: K): boolean {
		return this.cache.has(key)
	}

	/**
	 * Clear all entries from the cache
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

	/**
	 * Iterate over entries in descending order (most recent first)
	 */
	*entriesDescending(): IterableIterator<[K, V]> {
		// Reverse the entries to get most recent first
		const entries = Array.from(this.cache.entries()).reverse()
		for (const entry of entries) {
			yield entry
		}
	}

	/**
	 * Iterate over entries in ascending order (oldest first)
	 */
	*entries(): IterableIterator<[K, V]> {
		yield* this.cache.entries()
	}
}
