// kilocode_change - new file
// Task 3.1.1: Unified Vector Store Interface

/**
 * Vector search result
 */
export interface UnifiedSearchResult {
	id: string
	score: number
	content?: string
	metadata?: Record<string, any>
	embedding?: number[]
}

/**
 * Vector entry for insertion
 */
export interface VectorEntry {
	id: string
	embedding: number[]
	content?: string
	metadata?: Record<string, any>
}

/**
 * Search options
 */
export interface VectorSearchOptions {
	/** Number of results to return */
	limit?: number
	/** Minimum similarity score (0-1) */
	minScore?: number
	/** Metadata filters */
	filters?: Record<string, any>
	/** Whether to include the full embedding in results */
	includeEmbedding?: boolean
	/** Whether to include content in results */
	includeContent?: boolean
}

/**
 * Vector store statistics
 */
export interface VectorStoreStats {
	totalVectors: number
	dimensions: number
	indexType: string
	storageType: "memory" | "disk" | "remote"
	sizeBytes?: number
	lastUpdated?: Date
}

/**
 * Vector store configuration
 */
export interface VectorStoreConfig {
	/** Vector dimensions */
	dimensions: number
	/** Distance metric: cosine, euclidean, dot */
	metric: "cosine" | "euclidean" | "dot"
	/** Storage path (for disk-based stores) */
	storagePath?: string
	/** Collection/table name */
	collectionName?: string
}

/**
 * Unified interface for all vector stores
 * Supports LanceDB, Qdrant, OptimizedVectorDB, and in-memory stores
 */
export interface IUnifiedVectorStore {
	/**
	 * Initialize the vector store
	 */
	initialize(config: VectorStoreConfig): Promise<void>

	/**
	 * Check if the store is initialized
	 */
	isInitialized(): boolean

	/**
	 * Insert vectors
	 */
	insert(entries: VectorEntry[]): Promise<void>

	/**
	 * Update existing vectors
	 */
	update(entries: VectorEntry[]): Promise<void>

	/**
	 * Upsert vectors (insert or update)
	 */
	upsert(entries: VectorEntry[]): Promise<void>

	/**
	 * Delete vectors by IDs
	 */
	delete(ids: string[]): Promise<void>

	/**
	 * Search for similar vectors
	 */
	search(queryEmbedding: number[], options?: VectorSearchOptions): Promise<UnifiedSearchResult[]>

	/**
	 * Get a vector by ID
	 */
	get(id: string): Promise<VectorEntry | null>

	/**
	 * Check if a vector exists
	 */
	exists(id: string): Promise<boolean>

	/**
	 * Get store statistics
	 */
	getStats(): Promise<VectorStoreStats>

	/**
	 * Clear all vectors
	 */
	clear(): Promise<void>

	/**
	 * Optimize the index (if applicable)
	 */
	optimize(): Promise<void>

	/**
	 * Close the store and release resources
	 */
	close(): Promise<void>
}

/**
 * Vector store type enum
 */
export type VectorStoreType = "lancedb" | "qdrant" | "sqlite" | "memory"

/**
 * Factory configuration for creating vector stores
 */
export interface VectorStoreFactoryConfig {
	type: VectorStoreType
	dimensions: number
	metric?: "cosine" | "euclidean" | "dot"
	storagePath?: string
	collectionName?: string

	// Type-specific options
	qdrantUrl?: string
	qdrantApiKey?: string
}

/**
 * In-memory vector store implementation
 */
export class InMemoryVectorStore implements IUnifiedVectorStore {
	private vectors: Map<string, VectorEntry> = new Map()
	private config: VectorStoreConfig | null = null
	private _isInitialized = false

	async initialize(config: VectorStoreConfig): Promise<void> {
		this.config = config
		this._isInitialized = true
	}

	isInitialized(): boolean {
		return this._isInitialized
	}

	async insert(entries: VectorEntry[]): Promise<void> {
		for (const entry of entries) {
			if (this.vectors.has(entry.id)) {
				throw new Error(`Vector with id ${entry.id} already exists`)
			}
			this.vectors.set(entry.id, entry)
		}
	}

	async update(entries: VectorEntry[]): Promise<void> {
		for (const entry of entries) {
			if (!this.vectors.has(entry.id)) {
				throw new Error(`Vector with id ${entry.id} not found`)
			}
			this.vectors.set(entry.id, entry)
		}
	}

	async upsert(entries: VectorEntry[]): Promise<void> {
		for (const entry of entries) {
			this.vectors.set(entry.id, entry)
		}
	}

	async delete(ids: string[]): Promise<void> {
		for (const id of ids) {
			this.vectors.delete(id)
		}
	}

	async search(queryEmbedding: number[], options: VectorSearchOptions = {}): Promise<UnifiedSearchResult[]> {
		const limit = options.limit ?? 10
		const minScore = options.minScore ?? 0

		const results: UnifiedSearchResult[] = []

		for (const [id, entry] of this.vectors) {
			// Apply metadata filters
			if (options.filters) {
				let matches = true
				for (const [key, value] of Object.entries(options.filters)) {
					if (entry.metadata?.[key] !== value) {
						matches = false
						break
					}
				}
				if (!matches) continue
			}

			const score = this.calculateSimilarity(queryEmbedding, entry.embedding)

			if (score >= minScore) {
				results.push({
					id,
					score,
					content: options.includeContent ? entry.content : undefined,
					metadata: entry.metadata,
					embedding: options.includeEmbedding ? entry.embedding : undefined,
				})
			}
		}

		// Sort by score and limit
		results.sort((a, b) => b.score - a.score)
		return results.slice(0, limit)
	}

	async get(id: string): Promise<VectorEntry | null> {
		return this.vectors.get(id) ?? null
	}

	async exists(id: string): Promise<boolean> {
		return this.vectors.has(id)
	}

	async getStats(): Promise<VectorStoreStats> {
		return {
			totalVectors: this.vectors.size,
			dimensions: this.config?.dimensions ?? 0,
			indexType: "flat",
			storageType: "memory",
			lastUpdated: new Date(),
		}
	}

	async clear(): Promise<void> {
		this.vectors.clear()
	}

	async optimize(): Promise<void> {
		// No-op for in-memory store
	}

	async close(): Promise<void> {
		this.vectors.clear()
		this._isInitialized = false
	}

	private calculateSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) {
			throw new Error("Vectors must have the same length")
		}

		const metric = this.config?.metric ?? "cosine"

		switch (metric) {
			case "cosine":
				return this.cosineSimilarity(a, b)
			case "euclidean":
				return this.euclideanSimilarity(a, b)
			case "dot":
				return this.dotProduct(a, b)
			default:
				return this.cosineSimilarity(a, b)
		}
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		let dotProduct = 0
		let normA = 0
		let normB = 0

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i]
			normA += a[i] * a[i]
			normB += b[i] * b[i]
		}

		const magnitude = Math.sqrt(normA) * Math.sqrt(normB)
		return magnitude === 0 ? 0 : dotProduct / magnitude
	}

	private euclideanSimilarity(a: number[], b: number[]): number {
		let sum = 0
		for (let i = 0; i < a.length; i++) {
			const diff = a[i] - b[i]
			sum += diff * diff
		}
		const distance = Math.sqrt(sum)
		// Convert distance to similarity (0-1 range)
		return 1 / (1 + distance)
	}

	private dotProduct(a: number[], b: number[]): number {
		let sum = 0
		for (let i = 0; i < a.length; i++) {
			sum += a[i] * b[i]
		}
		return sum
	}
}

/**
 * Factory for creating vector stores
 */
export class VectorStoreFactory {
	private static instances: Map<string, IUnifiedVectorStore> = new Map()

	/**
	 * Create or get a vector store instance
	 */
	static async create(config: VectorStoreFactoryConfig): Promise<IUnifiedVectorStore> {
		const key = `${config.type}:${config.collectionName ?? "default"}`

		// Return existing instance if available
		const existing = this.instances.get(key)
		if (existing?.isInitialized()) {
			return existing
		}

		let store: IUnifiedVectorStore

		switch (config.type) {
			case "memory":
				store = new InMemoryVectorStore()
				break

			case "lancedb": {
				// Import and create LanceDB adapter
				const { LanceDBVectorStoreAdapter } = await import("./lancedb-adapter")
				store = new LanceDBVectorStoreAdapter()
				break
			}

			case "qdrant": {
				// Import and create Qdrant adapter
				const { QdrantVectorStoreAdapter } = await import("./qdrant-adapter")
				store = new QdrantVectorStoreAdapter(config.qdrantUrl, config.qdrantApiKey)
				break
			}

			case "sqlite": {
				// Import and create SQLite adapter
				const { SQLiteVectorStoreAdapter } = await import("./sqlite-adapter")
				store = new SQLiteVectorStoreAdapter()
				break
			}

			default:
				throw new Error(`Unknown vector store type: ${config.type}`)
		}

		await store.initialize({
			dimensions: config.dimensions,
			metric: config.metric ?? "cosine",
			storagePath: config.storagePath,
			collectionName: config.collectionName,
		})

		this.instances.set(key, store)
		return store
	}

	/**
	 * Get an existing store instance
	 */
	static get(type: VectorStoreType, collectionName?: string): IUnifiedVectorStore | null {
		const key = `${type}:${collectionName ?? "default"}`
		return this.instances.get(key) ?? null
	}

	/**
	 * Close all store instances
	 */
	static async closeAll(): Promise<void> {
		for (const store of this.instances.values()) {
			await store.close()
		}
		this.instances.clear()
	}
}

export { IUnifiedVectorStore as UnifiedVectorStore }
