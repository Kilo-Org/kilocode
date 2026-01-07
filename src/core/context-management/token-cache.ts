// kilocode_change - new file
// Task 1.2.1: Token Counting Cache

import crypto from "crypto"

/**
 * Token count cache entry
 */
interface TokenCacheEntry {
	count: number
	timestamp: number
	model: string
}

/**
 * Token cache configuration
 */
export interface TokenCacheConfig {
	/** Maximum number of entries to keep */
	maxEntries: number
	/** Time-to-live in milliseconds (default: 1 hour) */
	ttlMs: number
}

const DEFAULT_CONFIG: TokenCacheConfig = {
	maxEntries: 50000,
	ttlMs: 60 * 60 * 1000, // 1 hour
}

/**
 * High-performance token counting cache using content hashing.
 * Provides O(1) lookup for previously counted content.
 */
export class TokenCountingCache {
	private cache: Map<string, TokenCacheEntry> = new Map()
	private accessOrder: string[] = []
	private config: TokenCacheConfig

	// Statistics
	private hits = 0
	private misses = 0

	constructor(config: Partial<TokenCacheConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Generate a hash key for the content
	 */
	private generateKey(content: string, model: string): string {
		// Use first 100 chars + length + hash for quick key generation
		const quickHash = crypto.createHash("md5").update(content).digest("hex").substring(0, 16)
		return `${model}:${content.length}:${quickHash}`
	}

	/**
	 * Get cached token count
	 * @returns Token count or null if not cached
	 */
	get(content: string, model: string): number | null {
		const key = this.generateKey(content, model)
		const entry = this.cache.get(key)

		if (!entry) {
			this.misses++
			return null
		}

		// Check if expired
		if (Date.now() - entry.timestamp > this.config.ttlMs) {
			this.cache.delete(key)
			this.removeFromAccessOrder(key)
			this.misses++
			return null
		}

		this.hits++
		this.updateAccessOrder(key)
		return entry.count
	}

	/**
	 * Store token count in cache
	 */
	set(content: string, model: string, count: number): void {
		const key = this.generateKey(content, model)

		// Evict if at capacity (LRU)
		while (this.cache.size >= this.config.maxEntries) {
			const oldestKey = this.accessOrder.shift()
			if (oldestKey) {
				this.cache.delete(oldestKey)
			}
		}

		this.cache.set(key, {
			count,
			timestamp: Date.now(),
			model,
		})

		this.updateAccessOrder(key)
	}

	/**
	 * Get or compute token count with caching
	 */
	async getOrCompute(content: string, model: string, computeFn: () => Promise<number>): Promise<number> {
		const cached = this.get(content, model)
		if (cached !== null) {
			return cached
		}

		const count = await computeFn()
		this.set(content, model, count)
		return count
	}

	/**
	 * Synchronous version of getOrCompute
	 */
	getOrComputeSync(content: string, model: string, computeFn: () => number): number {
		const cached = this.get(content, model)
		if (cached !== null) {
			return cached
		}

		const count = computeFn()
		this.set(content, model, count)
		return count
	}

	/**
	 * Batch get token counts
	 */
	batchGet(
		items: Array<{ content: string; model: string }>,
	): Array<{ content: string; model: string; count: number | null }> {
		return items.map((item) => ({
			...item,
			count: this.get(item.content, item.model),
		}))
	}

	/**
	 * Batch set token counts
	 */
	batchSet(items: Array<{ content: string; model: string; count: number }>): void {
		for (const item of items) {
			this.set(item.content, item.model, item.count)
		}
	}

	/**
	 * Check if content is cached
	 */
	has(content: string, model: string): boolean {
		const key = this.generateKey(content, model)
		const entry = this.cache.get(key)

		if (!entry) return false
		if (Date.now() - entry.timestamp > this.config.ttlMs) {
			this.cache.delete(key)
			this.removeFromAccessOrder(key)
			return false
		}

		return true
	}

	/**
	 * Clear all cache entries
	 */
	clear(): void {
		this.cache.clear()
		this.accessOrder = []
		this.hits = 0
		this.misses = 0
	}

	/**
	 * Get cache statistics
	 */
	getStats(): {
		size: number
		maxSize: number
		hitRate: number
		hits: number
		misses: number
		memoryEstimateBytes: number
	} {
		const total = this.hits + this.misses
		return {
			size: this.cache.size,
			maxSize: this.config.maxEntries,
			hitRate: total > 0 ? this.hits / total : 0,
			hits: this.hits,
			misses: this.misses,
			memoryEstimateBytes: this.estimateMemoryUsage(),
		}
	}

	/**
	 * Cleanup expired entries
	 */
	cleanup(): number {
		const now = Date.now()
		const keysToDelete: string[] = []

		for (const [key, entry] of this.cache) {
			if (now - entry.timestamp > this.config.ttlMs) {
				keysToDelete.push(key)
			}
		}

		for (const key of keysToDelete) {
			this.cache.delete(key)
			this.removeFromAccessOrder(key)
		}

		return keysToDelete.length
	}

	/**
	 * Preload cache with known content
	 */
	preload(items: Array<{ content: string; model: string; count: number }>): void {
		for (const item of items) {
			this.set(item.content, item.model, item.count)
		}
	}

	// Private methods

	private updateAccessOrder(key: string): void {
		this.removeFromAccessOrder(key)
		this.accessOrder.push(key)
	}

	private removeFromAccessOrder(key: string): void {
		const index = this.accessOrder.indexOf(key)
		if (index > -1) {
			this.accessOrder.splice(index, 1)
		}
	}

	private estimateMemoryUsage(): number {
		// Estimate: key (~50 chars) + entry (24 bytes) per item
		return this.cache.size * 74
	}
}

// Singleton instance
let tokenCacheInstance: TokenCountingCache | null = null

export function getTokenCountingCache(config?: Partial<TokenCacheConfig>): TokenCountingCache {
	if (!tokenCacheInstance) {
		tokenCacheInstance = new TokenCountingCache(config)
	}
	return tokenCacheInstance
}

export function resetTokenCountingCache(): void {
	tokenCacheInstance = null
}
