// kilocode_change - new file
// Task 1.1.1: Embedding Cache Service

import { DatabaseManager } from "../../storage/database-manager"
import crypto from "crypto"

/**
 * Configuration for the embedding cache
 */
export interface EmbeddingCacheConfig {
	/** Time-to-live for cache entries in milliseconds (default: 7 days) */
	ttlMs: number
	/** Maximum number of entries to keep in memory cache */
	maxMemoryCacheSize: number
	/** Enable SQLite persistence */
	persistToDisk: boolean
}

/**
 * Cached embedding entry
 */
export interface CachedEmbedding {
	id: string
	contentHash: string
	embedding: number[]
	model: string
	dimensions: number
	createdAt: number
	lastAccessedAt: number
	accessCount: number
}

/**
 * Cache statistics
 */
export interface EmbeddingCacheStats {
	memoryEntries: number
	diskEntries: number
	hitRate: number
	missRate: number
	totalHits: number
	totalMisses: number
	memorySizeBytes: number
}

const DEFAULT_CONFIG: EmbeddingCacheConfig = {
	ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
	maxMemoryCacheSize: 10000,
	persistToDisk: true,
}

/**
 * High-performance embedding cache service with SQLite persistence
 * and in-memory LRU cache for frequently accessed embeddings.
 */
export class EmbeddingCacheService {
	private memoryCache: Map<string, CachedEmbedding> = new Map()
	private accessOrder: string[] = []
	private config: EmbeddingCacheConfig
	private databaseManager: DatabaseManager | null = null
	private isInitialized = false

	// Statistics
	private totalHits = 0
	private totalMisses = 0

	constructor(config: Partial<EmbeddingCacheConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Initialize the cache service with optional database persistence
	 */
	async initialize(databaseManager?: DatabaseManager): Promise<void> {
		if (this.isInitialized) return

		if (databaseManager && this.config.persistToDisk) {
			this.databaseManager = databaseManager
			await this.createCacheTable()
			await this.loadFrequentlyAccessedEntries()
		}

		this.isInitialized = true
	}

	/**
	 * Generate a content hash for cache key
	 */
	generateContentHash(content: string, model: string): string {
		return crypto.createHash("sha256").update(`${model}:${content}`).digest("hex")
	}

	/**
	 * Get embedding from cache
	 * @returns The cached embedding or null if not found
	 */
	async get(contentHash: string): Promise<number[] | null> {
		// Check memory cache first
		const memoryCached = this.memoryCache.get(contentHash)
		if (memoryCached) {
			this.totalHits++
			this.updateAccessOrder(contentHash)
			memoryCached.lastAccessedAt = Date.now()
			memoryCached.accessCount++
			return memoryCached.embedding
		}

		// Check disk cache if available
		if (this.databaseManager) {
			const diskCached = await this.getFromDisk(contentHash)
			if (diskCached) {
				this.totalHits++
				// Promote to memory cache
				this.addToMemoryCache(diskCached)
				return diskCached.embedding
			}
		}

		this.totalMisses++
		return null
	}

	/**
	 * Store embedding in cache
	 */
	async set(content: string, embedding: number[], model: string): Promise<string> {
		const contentHash = this.generateContentHash(content, model)

		const entry: CachedEmbedding = {
			id: crypto.randomUUID(),
			contentHash,
			embedding,
			model,
			dimensions: embedding.length,
			createdAt: Date.now(),
			lastAccessedAt: Date.now(),
			accessCount: 1,
		}

		// Add to memory cache
		this.addToMemoryCache(entry)

		// Persist to disk if available
		if (this.databaseManager) {
			await this.saveToDisk(entry)
		}

		return contentHash
	}

	/**
	 * Check if embedding exists in cache
	 */
	async has(contentHash: string): Promise<boolean> {
		if (this.memoryCache.has(contentHash)) {
			return true
		}

		if (this.databaseManager) {
			const exists = await this.existsOnDisk(contentHash)
			return exists
		}

		return false
	}

	/**
	 * Delete embedding from cache
	 */
	async delete(contentHash: string): Promise<void> {
		this.memoryCache.delete(contentHash)
		this.accessOrder = this.accessOrder.filter((h) => h !== contentHash)

		if (this.databaseManager) {
			await this.deleteFromDisk(contentHash)
		}
	}

	/**
	 * Clear all cache entries
	 */
	async clear(): Promise<void> {
		this.memoryCache.clear()
		this.accessOrder = []
		this.totalHits = 0
		this.totalMisses = 0

		if (this.databaseManager) {
			await this.clearDisk()
		}
	}

	/**
	 * Get cache statistics
	 */
	getStats(): EmbeddingCacheStats {
		const totalRequests = this.totalHits + this.totalMisses

		return {
			memoryEntries: this.memoryCache.size,
			diskEntries: 0, // Will be populated if DB is available
			hitRate: totalRequests > 0 ? this.totalHits / totalRequests : 0,
			missRate: totalRequests > 0 ? this.totalMisses / totalRequests : 0,
			totalHits: this.totalHits,
			totalMisses: this.totalMisses,
			memorySizeBytes: this.estimateMemorySize(),
		}
	}

	/**
	 * Cleanup expired entries
	 */
	async cleanup(): Promise<number> {
		const now = Date.now()
		const expiredHashes: string[] = []

		// Find expired entries in memory
		for (const [hash, entry] of this.memoryCache) {
			if (now - entry.createdAt > this.config.ttlMs) {
				expiredHashes.push(hash)
			}
		}

		// Remove expired entries
		for (const hash of expiredHashes) {
			await this.delete(hash)
		}

		// Cleanup disk entries
		if (this.databaseManager) {
			await this.cleanupExpiredOnDisk()
		}

		return expiredHashes.length
	}

	// Private methods

	private addToMemoryCache(entry: CachedEmbedding): void {
		// Evict if at capacity (LRU)
		while (this.memoryCache.size >= this.config.maxMemoryCacheSize) {
			const oldestHash = this.accessOrder.shift()
			if (oldestHash) {
				this.memoryCache.delete(oldestHash)
			}
		}

		this.memoryCache.set(entry.contentHash, entry)
		this.updateAccessOrder(entry.contentHash)
	}

	private updateAccessOrder(contentHash: string): void {
		// Remove from current position
		const index = this.accessOrder.indexOf(contentHash)
		if (index > -1) {
			this.accessOrder.splice(index, 1)
		}
		// Add to end (most recently accessed)
		this.accessOrder.push(contentHash)
	}

	private estimateMemorySize(): number {
		let size = 0
		for (const entry of this.memoryCache.values()) {
			// Estimate: hash (64 chars) + embedding (dimensions * 8 bytes) + overhead
			size += 64 + entry.dimensions * 8 + 200
		}
		return size
	}

	private async createCacheTable(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.exec(`
			CREATE TABLE IF NOT EXISTS embedding_cache (
				id TEXT PRIMARY KEY,
				content_hash TEXT UNIQUE NOT NULL,
				embedding BLOB NOT NULL,
				model TEXT NOT NULL,
				dimensions INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				last_accessed_at INTEGER NOT NULL,
				access_count INTEGER DEFAULT 1
			);
			CREATE INDEX IF NOT EXISTS idx_embedding_cache_hash ON embedding_cache(content_hash);
			CREATE INDEX IF NOT EXISTS idx_embedding_cache_accessed ON embedding_cache(last_accessed_at);
		`)
	}

	private async getFromDisk(contentHash: string): Promise<CachedEmbedding | null> {
		if (!this.databaseManager) return null

		const db = (this.databaseManager as any).db
		if (!db) return null

		const row = await db.get(`SELECT * FROM embedding_cache WHERE content_hash = ?`, [contentHash])

		if (!row) return null

		// Check if expired
		if (Date.now() - row.created_at > this.config.ttlMs) {
			await this.deleteFromDisk(contentHash)
			return null
		}

		// Update access time
		await db.run(
			`UPDATE embedding_cache SET last_accessed_at = ?, access_count = access_count + 1 WHERE content_hash = ?`,
			[Date.now(), contentHash],
		)

		return {
			id: row.id,
			contentHash: row.content_hash,
			embedding: Array.from(new Float64Array(row.embedding)),
			model: row.model,
			dimensions: row.dimensions,
			createdAt: row.created_at,
			lastAccessedAt: Date.now(),
			accessCount: row.access_count + 1,
		}
	}

	private async saveToDisk(entry: CachedEmbedding): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		const embeddingBlob = Buffer.from(new Float64Array(entry.embedding).buffer)

		await db.run(
			`INSERT OR REPLACE INTO embedding_cache 
			(id, content_hash, embedding, model, dimensions, created_at, last_accessed_at, access_count)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.id,
				entry.contentHash,
				embeddingBlob,
				entry.model,
				entry.dimensions,
				entry.createdAt,
				entry.lastAccessedAt,
				entry.accessCount,
			],
		)
	}

	private async existsOnDisk(contentHash: string): Promise<boolean> {
		if (!this.databaseManager) return false

		const db = (this.databaseManager as any).db
		if (!db) return false

		const row = await db.get(`SELECT 1 FROM embedding_cache WHERE content_hash = ? AND created_at > ?`, [
			contentHash,
			Date.now() - this.config.ttlMs,
		])

		return !!row
	}

	private async deleteFromDisk(contentHash: string): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.run(`DELETE FROM embedding_cache WHERE content_hash = ?`, [contentHash])
	}

	private async clearDisk(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.run(`DELETE FROM embedding_cache`)
	}

	private async cleanupExpiredOnDisk(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		await db.run(`DELETE FROM embedding_cache WHERE created_at < ?`, [Date.now() - this.config.ttlMs])
	}

	private async loadFrequentlyAccessedEntries(): Promise<void> {
		if (!this.databaseManager) return

		const db = (this.databaseManager as any).db
		if (!db) return

		// Load top N frequently accessed entries into memory
		const rows = await db.all(
			`SELECT * FROM embedding_cache 
			WHERE created_at > ? 
			ORDER BY access_count DESC, last_accessed_at DESC 
			LIMIT ?`,
			[Date.now() - this.config.ttlMs, Math.floor(this.config.maxMemoryCacheSize / 2)],
		)

		for (const row of rows) {
			const entry: CachedEmbedding = {
				id: row.id,
				contentHash: row.content_hash,
				embedding: Array.from(new Float64Array(row.embedding)),
				model: row.model,
				dimensions: row.dimensions,
				createdAt: row.created_at,
				lastAccessedAt: row.last_accessed_at,
				accessCount: row.access_count,
			}
			this.memoryCache.set(entry.contentHash, entry)
			this.accessOrder.push(entry.contentHash)
		}
	}
}

// Singleton instance
let embeddingCacheInstance: EmbeddingCacheService | null = null

export function getEmbeddingCacheService(config?: Partial<EmbeddingCacheConfig>): EmbeddingCacheService {
	if (!embeddingCacheInstance) {
		embeddingCacheInstance = new EmbeddingCacheService(config)
	}
	return embeddingCacheInstance
}

export function resetEmbeddingCacheService(): void {
	embeddingCacheInstance = null
}
