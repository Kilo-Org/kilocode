import type { CacheEntry } from "../types"

/**
 * Multi-layer caching system with different TTLs and invalidation strategies
 */
export class CacheManager<T = any> {
	private queryCache: Map<string, CacheEntry<T>>
	private embeddingCache: Map<string, CacheEntry<number[]>>
	private graphCache: Map<string, CacheEntry<any>>
	private metadataCache: Map<string, CacheEntry<any>>
	private enabled: boolean
	private defaultTTL: number

	constructor(enabled: boolean = true, defaultTTL: number = 300000) {
		// Default: 5 minutes
		this.queryCache = new Map()
		this.embeddingCache = new Map()
		this.graphCache = new Map()
		this.metadataCache = new Map()
		this.enabled = enabled
		this.defaultTTL = defaultTTL
	}

	/**
	 * Get from query cache
	 */
	getQuery(key: string): T | null {
		if (!this.enabled) return null

		const entry = this.queryCache.get(key)
		if (!entry) return null

		// Check if expired
		if (this.isExpired(entry)) {
			this.queryCache.delete(key)
			return null
		}

		entry.hits++
		return entry.value
	}

	/**
	 * Set query cache
	 */
	setQuery(key: string, value: T, ttl?: number): void {
		if (!this.enabled) return

		this.queryCache.set(key, {
			key,
			value,
			timestamp: Date.now(),
			ttl: ttl || this.defaultTTL,
			hits: 0,
		})
	}

	/**
	 * Get from embedding cache (persistent)
	 */
	getEmbedding(key: string): number[] | null {
		if (!this.enabled) return null

		const entry = this.embeddingCache.get(key)
		if (!entry) return null

		entry.hits++
		return entry.value
	}

	/**
	 * Set embedding cache (no expiry)
	 */
	setEmbedding(key: string, value: number[]): void {
		if (!this.enabled) return

		this.embeddingCache.set(key, {
			key,
			value,
			timestamp: Date.now(),
			ttl: Infinity, // Never expires (until file change)
			hits: 0,
		})
	}

	/**
	 * Invalidate embedding cache for a file
	 */
	invalidateEmbeddingByFile(filePath: string): void {
		for (const [key, _] of this.embeddingCache.entries()) {
			if (key.startsWith(filePath)) {
				this.embeddingCache.delete(key)
			}
		}
	}

	/**
	 * Get from graph cache (session-scoped)
	 */
	getGraph(key: string): any | null {
		if (!this.enabled) return null

		const entry = this.graphCache.get(key)
		if (!entry) return null

		if (this.isExpired(entry)) {
			this.graphCache.delete(key)
			return null
		}

		entry.hits++
		return entry.value
	}

	/**
	 * Set graph cache
	 */
	setGraph(key: string, value: any, ttl?: number): void {
		if (!this.enabled) return

		this.graphCache.set(key, {
			key,
			value,
			timestamp: Date.now(),
			ttl: ttl || this.defaultTTL,
			hits: 0,
		})
	}

	/**
	 * Invalidate graph cache when files change
	 */
	invalidateGraph(): void {
		this.graphCache.clear()
	}

	/**
	 * Get from metadata cache (persistent)
	 */
	getMetadata(key: string): any | null {
		if (!this.enabled) return null

		const entry = this.metadataCache.get(key)
		if (!entry) return null

		entry.hits++
		return entry.value
	}

	/**
	 * Set metadata cache
	 */
	setMetadata(key: string, value: any): void {
		if (!this.enabled) return

		this.metadataCache.set(key, {
			key,
			value,
			timestamp: Date.now(),
			ttl: Infinity, // Until file content changes
			hits: 0,
		})
	}

	/**
	 * Invalidate metadata cache for a file
	 */
	invalidateMetadataByFile(filePath: string): void {
		for (const [key, _] of this.metadataCache.entries()) {
			if (key.startsWith(filePath)) {
				this.metadataCache.delete(key)
			}
		}
	}

	/**
	 * Handle file modification - invalidate related caches
	 */
	onFileModified(filePath: string): void {
		this.invalidateEmbeddingByFile(filePath)
		this.invalidateMetadataByFile(filePath)
		this.invalidateGraph()
	}

	/**
	 * Handle file deletion - invalidate all related caches
	 */
	onFileDeleted(filePath: string): void {
		this.onFileModified(filePath)
	}

	/**
	 * Clear all query cache
	 */
	clearQueryCache(): void {
		this.queryCache.clear()
	}

	/**
	 * Clear all caches
	 */
	clearAll(): void {
		this.queryCache.clear()
		this.embeddingCache.clear()
		this.graphCache.clear()
		this.metadataCache.clear()
	}

	/**
	 * Get cache statistics
	 */
	getStats(): {
		queryCache: { size: number; hits: number }
		embeddingCache: { size: number; hits: number }
		graphCache: { size: number; hits: number }
		metadataCache: { size: number; hits: number }
		hitRate: number
	} {
		const queryCacheHits = this.getTotalHits(this.queryCache)
		const embeddingCacheHits = this.getTotalHits(this.embeddingCache)
		const graphCacheHits = this.getTotalHits(this.graphCache)
		const metadataCacheHits = this.getTotalHits(this.metadataCache)

		const totalHits = queryCacheHits + embeddingCacheHits + graphCacheHits + metadataCacheHits
		const totalSize =
			this.queryCache.size + this.embeddingCache.size + this.graphCache.size + this.metadataCache.size

		return {
			queryCache: { size: this.queryCache.size, hits: queryCacheHits },
			embeddingCache: { size: this.embeddingCache.size, hits: embeddingCacheHits },
			graphCache: { size: this.graphCache.size, hits: graphCacheHits },
			metadataCache: { size: this.metadataCache.size, hits: metadataCacheHits },
			hitRate: totalSize > 0 ? totalHits / totalSize : 0,
		}
	}

	/**
	 * Clean up expired entries
	 */
	cleanup(): number {
		let deleted = 0

		deleted += this.cleanupCache(this.queryCache)
		deleted += this.cleanupCache(this.graphCache)

		return deleted
	}

	private cleanupCache(cache: Map<string, CacheEntry<any>>): number {
		let deleted = 0
		for (const [key, entry] of cache.entries()) {
			if (this.isExpired(entry)) {
				cache.delete(key)
				deleted++
			}
		}
		return deleted
	}

	private isExpired(entry: CacheEntry<any>): boolean {
		if (entry.ttl === Infinity) return false
		return Date.now() - entry.timestamp > entry.ttl
	}

	private getTotalHits(cache: Map<string, CacheEntry<any>>): number {
		let total = 0
		for (const entry of cache.values()) {
			total += entry.hits
		}
		return total
	}

	/**
	 * Enable/disable caching
	 */
	setEnabled(enabled: boolean): void {
		this.enabled = enabled
		if (!enabled) {
			this.clearAll()
		}
	}
}
