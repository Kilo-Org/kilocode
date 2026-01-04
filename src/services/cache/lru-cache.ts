// kilocode_change - new file

import { ContextChunk } from "../context/incremental-context-manager"

export interface LRUCacheEntry<T> {
	key: string
	value: T
	size: number
	accessCount: number
	lastAccessed: number
	createdAt: number
}

export interface LRUCacheStats {
	totalEntries: number
	totalSize: number
	maxSize: number
	hitRate: number
	missCount: number
	hitCount: number
	evictionCount: number
	memoryUsage: number
}

export interface LRUCacheConfig {
	maxSize: number // Maximum size in bytes
	maxEntries: number // Maximum number of entries
	ttlMs?: number // Time to live in milliseconds
	evictionPolicy: "lru" | "lfu" | "size"
	compressionEnabled: boolean
}

/**
 * High-performance LRU cache with memory optimization and compression
 */
export class LRUCache<T> {
	private cache: Map<string, LRUCacheEntry<T>> = new Map()
	private accessOrder: string[] = []
	private config: LRUCacheConfig
	private currentSize = 0
	private stats = {
		hitCount: 0,
		missCount: 0,
		evictionCount: 0,
	}

	constructor(config: Partial<LRUCacheConfig> = {}) {
		this.config = {
			maxSize: 100 * 1024 * 1024, // 100MB default
			maxEntries: 10000,
			evictionPolicy: "lru",
			compressionEnabled: true,
			...config,
		}
	}

	/**
	 * Get a value from the cache
	 */
	get(key: string): T | null {
		const entry = this.cache.get(key)

		if (!entry) {
			this.stats.missCount++
			return null
		}

		// Check TTL
		if (this.config.ttlMs && Date.now() - entry.createdAt > this.config.ttlMs) {
			this.delete(key)
			this.stats.missCount++
			return null
		}

		// Update access information
		entry.accessCount++
		entry.lastAccessed = Date.now()

		// Update access order for LRU
		if (this.config.evictionPolicy === "lru") {
			this.updateAccessOrder(key)
		}

		this.stats.hitCount++
		return entry.value
	}

	/**
	 * Set a value in the cache
	 */
	set(key: string, value: T, size?: number): boolean {
		// Calculate size if not provided
		const entrySize = size ?? this.calculateSize(value)

		// Check if entry is too large
		if (entrySize > this.config.maxSize) {
			console.warn(`[LRUCache] Entry too large: ${entrySize} bytes > ${this.config.maxSize} bytes`)
			return false
		}

		// Remove existing entry if present
		if (this.cache.has(key)) {
			const existingEntry = this.cache.get(key)!
			this.currentSize -= existingEntry.size
			this.removeFromAccessOrder(key)
		}

		// Ensure we have enough space
		while (!this.hasSpace(entrySize) || this.cache.size >= this.config.maxEntries) {
			if (!this.evictLeastRecentlyUsed()) {
				console.warn(`[LRUCache] Cannot make space for entry, cache full`)
				return false
			}
		}

		// Create new entry
		const entry: LRUCacheEntry<T> = {
			key,
			value: this.config.compressionEnabled ? this.compress(value) : value,
			size: entrySize,
			accessCount: 1,
			lastAccessed: Date.now(),
			createdAt: Date.now(),
		}

		// Add to cache
		this.cache.set(key, entry)
		this.currentSize += entrySize
		this.addToAccessOrder(key)

		return true
	}

	/**
	 * Delete a key from the cache
	 */
	delete(key: string): boolean {
		const entry = this.cache.get(key)
		if (!entry) {
			return false
		}

		this.currentSize -= entry.size
		this.cache.delete(key)
		this.removeFromAccessOrder(key)

		return true
	}

	/**
	 * Check if a key exists in the cache
	 */
	has(key: string): boolean {
		const entry = this.cache.get(key)

		if (!entry) {
			return false
		}

		// Check TTL
		if (this.config.ttlMs && Date.now() - entry.createdAt > this.config.ttlMs) {
			this.delete(key)
			return false
		}

		return true
	}

	/**
	 * Clear all entries from the cache
	 */
	clear(): void {
		this.cache.clear()
		this.accessOrder.length = 0
		this.currentSize = 0
		this.stats.hitCount = 0
		this.stats.missCount = 0
		this.stats.evictionCount = 0
	}

	/**
	 * Get cache statistics
	 */
	getStats(): LRUCacheStats {
		const totalRequests = this.stats.hitCount + this.stats.missCount
		const hitRate = totalRequests > 0 ? this.stats.hitCount / totalRequests : 0

		return {
			totalEntries: this.cache.size,
			totalSize: this.currentSize,
			maxSize: this.config.maxSize,
			hitRate,
			missCount: this.stats.missCount,
			hitCount: this.stats.hitCount,
			evictionCount: this.stats.evictionCount,
			memoryUsage: process.memoryUsage().heapUsed,
		}
	}

	/**
	 * Get all keys in the cache
	 */
	keys(): string[] {
		return Array.from(this.cache.keys())
	}

	/**
	 * Get all entries in the cache
	 */
	entries(): Array<[string, T]> {
		return Array.from(this.cache.entries()).map(([key, entry]) => [
			key,
			this.config.compressionEnabled ? this.decompress(entry.value) : entry.value,
		])
	}

	/**
	 * Get the size of the cache in bytes
	 */
	size(): number {
		return this.currentSize
	}

	/**
	 * Check if the cache is empty
	 */
	isEmpty(): boolean {
		return this.cache.size === 0
	}

	// Private methods

	private hasSpace(requiredSize: number): boolean {
		return this.currentSize + requiredSize <= this.config.maxSize
	}

	private evictLeastRecentlyUsed(): boolean {
		if (this.accessOrder.length === 0) {
			return false
		}

		let keyToEvict: string

		switch (this.config.evictionPolicy) {
			case "lru":
				keyToEvict = this.accessOrder[0]
				break
			case "lfu":
				keyToEvict = this.findLeastFrequentlyUsed()
				break
			case "size":
				keyToEvict = this.findLargestEntry()
				break
			default:
				keyToEvict = this.accessOrder[0]
		}

		const deleted = this.delete(keyToEvict)
		if (deleted) {
			this.stats.evictionCount++
		}

		return deleted
	}

	private updateAccessOrder(key: string): void {
		this.removeFromAccessOrder(key)
		this.addToAccessOrder(key)
	}

	private addToAccessOrder(key: string): void {
		this.accessOrder.push(key)
	}

	private removeFromAccessOrder(key: string): void {
		const index = this.accessOrder.indexOf(key)
		if (index > -1) {
			this.accessOrder.splice(index, 1)
		}
	}

	private findLeastFrequentlyUsed(): string {
		let leastUsedKey = ""
		let minAccessCount = Infinity

		for (const [key, entry] of this.cache.entries()) {
			if (entry.accessCount < minAccessCount) {
				minAccessCount = entry.accessCount
				leastUsedKey = key
			}
		}

		return leastUsedKey
	}

	private findLargestEntry(): string {
		let largestKey = ""
		let maxSize = 0

		for (const [key, entry] of this.cache.entries()) {
			if (entry.size > maxSize) {
				maxSize = entry.size
				largestKey = key
			}
		}

		return largestKey
	}

	private calculateSize(value: T): number {
		if (typeof value === "string") {
			return value.length * 2 // UTF-16 characters
		} else if (typeof value === "object" && value !== null) {
			return JSON.stringify(value).length * 2
		} else {
			return 8 // Approximate size for primitives
		}
	}

	private compress(value: T): T {
		// Simple compression - in production, use proper compression like gzip
		if (typeof value === "string" && value.length > 1000) {
			// For large strings, we could implement simple compression
			return value as T // Placeholder - implement actual compression
		}
		return value
	}

	private decompress(value: T): T {
		// Simple decompression - in production, use proper decompression
		return value
	}
}

/**
 * Specialized LRU cache for context chunks with intelligent eviction
 */
export class ContextChunkCache extends LRUCache<ContextChunk[]> {
	constructor(config: Partial<LRUCacheConfig> = {}) {
		super({
			maxSize: 50 * 1024 * 1024, // 50MB for context chunks
			maxEntries: 1000,
			evictionPolicy: "lru",
			compressionEnabled: true,
			ttlMs: 30 * 60 * 1000, // 30 minutes TTL
			...config,
		})
	}

	/**
	 * Get context chunks for a file path
	 */
	getContextChunks(filePath: string): ContextChunk[] | null {
		return this.get(filePath)
	}

	/**
	 * Set context chunks for a file path
	 */
	setContextChunks(filePath: string, chunks: ContextChunk[]): boolean {
		// Calculate size based on total content length
		const size = chunks.reduce((total, chunk) => total + chunk.content.length * 2, 0)
		return this.set(filePath, chunks, size)
	}

	/**
	 * Invalidate chunks for a specific file
	 */
	invalidateFile(filePath: string): boolean {
		return this.delete(filePath)
	}

	/**
	 * Get cache statistics specific to context chunks
	 */
	getContextStats(): any {
		const baseStats = this.getStats()
		const entries = this.entries()

		let totalChunks = 0
		let totalLines = 0

		for (const [, chunks] of entries) {
			totalChunks += chunks.length
			totalLines += chunks.reduce((sum, chunk) => sum + (chunk.endLine - chunk.startLine + 1), 0)
		}

		return {
			...baseStats,
			totalChunks,
			totalLines,
			avgChunksPerFile: entries.length > 0 ? totalChunks / entries.length : 0,
			avgLinesPerChunk: totalChunks > 0 ? totalLines / totalChunks : 0,
		}
	}
}
