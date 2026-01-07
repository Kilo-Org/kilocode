// kilocode_change - new file
// Task 3.2.1: Unified Index Service

import * as vscode from "vscode"
import { CodeIndexManager } from "../code-index/manager"
import { IncrementalContextManager } from "../context/incremental-context-manager"
import { DatabaseManager } from "../storage/database-manager"
import { ParserService } from "../parser/parser-service"
import { EmbeddingCacheService, getEmbeddingCacheService } from "../code-index/cache/embedding-cache"

/**
 * Index status
 */
export type IndexStatus = "idle" | "indexing" | "ready" | "error" | "disabled"

/**
 * Index statistics
 */
export interface UnifiedIndexStats {
	status: IndexStatus
	totalFiles: number
	indexedFiles: number
	totalChunks: number
	totalSymbols: number
	lastIndexedAt: Date | null
	indexingProgress: number
	cacheHitRate: number
	errorMessage?: string
}

/**
 * Search result from unified index
 */
export interface UnifiedSearchResult {
	id: string
	filePath: string
	content: string
	type: "chunk" | "symbol" | "file"
	score: number
	startLine?: number
	endLine?: number
	symbolName?: string
	symbolType?: string
	metadata?: Record<string, any>
}

/**
 * Search options
 */
export interface UnifiedSearchOptions {
	/** Maximum results to return */
	limit?: number
	/** Minimum score threshold */
	minScore?: number
	/** Filter by file types */
	fileTypes?: string[]
	/** Filter by directory prefix */
	directoryPrefix?: string
	/** Include symbols in search */
	includeSymbols?: boolean
	/** Include chunks in search */
	includeChunks?: boolean
	/** Include files in search */
	includeFiles?: boolean
}

/**
 * Configuration for unified index
 */
export interface UnifiedIndexConfig {
	/** Enable code indexing */
	enableCodeIndex: boolean
	/** Enable incremental context */
	enableIncrementalContext: boolean
	/** Enable symbol indexing */
	enableSymbolIndex: boolean
	/** Batch size for indexing */
	batchSize: number
	/** Use embedding cache */
	useEmbeddingCache: boolean
}

const DEFAULT_CONFIG: UnifiedIndexConfig = {
	enableCodeIndex: true,
	enableIncrementalContext: true,
	enableSymbolIndex: true,
	batchSize: 50,
	useEmbeddingCache: true,
}

/**
 * Unified Index Service that combines CodeIndexManager and IncrementalContextManager
 * into a single, coherent indexing system.
 */
export class UnifiedIndexService {
	private static instances: Map<string, UnifiedIndexService> = new Map()

	private codeIndexManager: CodeIndexManager | null = null
	private incrementalContextManager: IncrementalContextManager | null = null
	private databaseManager: DatabaseManager | null = null
	private embeddingCache: EmbeddingCacheService | null = null

	private config: UnifiedIndexConfig
	private workspacePath: string
	private context: vscode.ExtensionContext
	private status: IndexStatus = "idle"
	private lastError: string | null = null
	private isInitialized = false

	// Statistics
	private stats = {
		totalFiles: 0,
		indexedFiles: 0,
		totalChunks: 0,
		totalSymbols: 0,
		lastIndexedAt: null as Date | null,
		indexingProgress: 0,
	}

	private constructor(
		workspacePath: string,
		context: vscode.ExtensionContext,
		config: Partial<UnifiedIndexConfig> = {},
	) {
		this.workspacePath = workspacePath
		this.context = context
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Get or create instance for a workspace
	 */
	static getInstance(
		workspacePath: string,
		context: vscode.ExtensionContext,
		config?: Partial<UnifiedIndexConfig>,
	): UnifiedIndexService {
		const existing = this.instances.get(workspacePath)
		if (existing) return existing

		const instance = new UnifiedIndexService(workspacePath, context, config)
		this.instances.set(workspacePath, instance)
		return instance
	}

	/**
	 * Dispose all instances
	 */
	static disposeAll(): void {
		for (const instance of this.instances.values()) {
			instance.dispose()
		}
		this.instances.clear()
	}

	/**
	 * Initialize the unified index service
	 */
	async initialize(storageDir: string): Promise<void> {
		if (this.isInitialized) return

		try {
			this.status = "indexing"

			// Initialize database manager
			this.databaseManager = new DatabaseManager(this.workspacePath, storageDir)
			await this.databaseManager.initialize()

			// Initialize embedding cache
			if (this.config.useEmbeddingCache) {
				this.embeddingCache = getEmbeddingCacheService()
				await this.embeddingCache.initialize(this.databaseManager)
			}

			// Initialize code index manager
			if (this.config.enableCodeIndex) {
				this.codeIndexManager = CodeIndexManager.getInstance(this.context, this.workspacePath)
			}

			// Initialize incremental context manager
			if (this.config.enableIncrementalContext) {
				const parserService = new ParserService()
				this.incrementalContextManager = new IncrementalContextManager(this.databaseManager, parserService)
				await this.incrementalContextManager.initialize()
			}

			this.status = "ready"
			this.isInitialized = true
		} catch (error) {
			this.status = "error"
			this.lastError = error instanceof Error ? error.message : String(error)
			throw error
		}
	}

	/**
	 * Start indexing the workspace
	 */
	async startIndexing(): Promise<void> {
		if (!this.isInitialized) {
			throw new Error("Service not initialized")
		}

		this.status = "indexing"
		this.stats.indexingProgress = 0

		try {
			// Start code indexing
			if (this.codeIndexManager) {
				await this.codeIndexManager.startIndexing()
			}

			// Scan for dirty files and index incrementally
			if (this.incrementalContextManager) {
				const dirtyFiles = await this.incrementalContextManager.scanDirtyFiles(this.workspacePath)
				const indexStats = await this.incrementalContextManager.indexDirtyFiles(dirtyFiles)

				this.stats.totalFiles = indexStats.totalFiles
				this.stats.indexedFiles = indexStats.totalFiles - indexStats.cleanFiles
			}

			this.stats.lastIndexedAt = new Date()
			this.stats.indexingProgress = 100
			this.status = "ready"
		} catch (error) {
			this.status = "error"
			this.lastError = error instanceof Error ? error.message : String(error)
			throw error
		}
	}

	/**
	 * Search the unified index
	 */
	async search(query: string, options: UnifiedSearchOptions = {}): Promise<UnifiedSearchResult[]> {
		if (!this.isInitialized) {
			return []
		}

		const results: UnifiedSearchResult[] = []
		const limit = options.limit ?? 20
		const minScore = options.minScore ?? 0.3

		// Search code index
		if (this.codeIndexManager && (options.includeChunks ?? true)) {
			try {
				const codeResults = await this.codeIndexManager.searchIndex(query, options.directoryPrefix)

				for (const result of codeResults) {
					if (result.score >= minScore) {
						results.push({
							id: result.filePath + ":" + (result.startLine ?? 0),
							filePath: result.filePath,
							content: result.content ?? "",
							type: "chunk",
							score: result.score,
							startLine: result.startLine,
							endLine: result.endLine,
							metadata: result.metadata,
						})
					}
				}
			} catch {
				// Continue with other search methods
			}
		}

		// Search symbols from database
		if (this.databaseManager && (options.includeSymbols ?? true)) {
			try {
				const symbols = await this.searchSymbols(query)
				for (const symbol of symbols) {
					results.push({
						id: symbol.id,
						filePath: symbol.filePath,
						content: symbol.content,
						type: "symbol",
						score: symbol.score,
						startLine: symbol.startLine,
						endLine: symbol.endLine,
						symbolName: symbol.name,
						symbolType: symbol.symbolType,
					})
				}
			} catch {
				// Continue with other search methods
			}
		}

		// Sort by score and limit
		results.sort((a, b) => b.score - a.score)
		return results.slice(0, limit)
	}

	/**
	 * Get context for a specific file and line
	 */
	async getContextForLocation(filePath: string, line: number, radius = 50): Promise<UnifiedSearchResult[]> {
		if (!this.incrementalContextManager) {
			return []
		}

		try {
			const chunks = await this.incrementalContextManager.getRelevantContext(filePath, line, radius)

			return chunks.map((chunk) => ({
				id: chunk.id,
				filePath: chunk.filePath,
				content: chunk.content,
				type: "chunk" as const,
				score: 1.0,
				startLine: chunk.startLine,
				endLine: chunk.endLine,
			}))
		} catch {
			return []
		}
	}

	/**
	 * Get statistics
	 */
	getStats(): UnifiedIndexStats {
		const cacheStats = this.embeddingCache?.getStats()

		return {
			status: this.status,
			totalFiles: this.stats.totalFiles,
			indexedFiles: this.stats.indexedFiles,
			totalChunks: this.stats.totalChunks,
			totalSymbols: this.stats.totalSymbols,
			lastIndexedAt: this.stats.lastIndexedAt,
			indexingProgress: this.stats.indexingProgress,
			cacheHitRate: cacheStats?.hitRate ?? 0,
			errorMessage: this.lastError ?? undefined,
		}
	}

	/**
	 * Clear all index data
	 */
	async clearIndex(): Promise<void> {
		if (this.codeIndexManager) {
			await this.codeIndexManager.clearIndexData()
		}

		if (this.incrementalContextManager) {
			this.incrementalContextManager.clearCache()
		}

		if (this.embeddingCache) {
			await this.embeddingCache.clear()
		}

		this.stats = {
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			totalSymbols: 0,
			lastIndexedAt: null,
			indexingProgress: 0,
		}
	}

	/**
	 * Dispose the service
	 */
	dispose(): void {
		if (this.codeIndexManager) {
			this.codeIndexManager.dispose()
		}

		this.isInitialized = false
		this.status = "idle"
	}

	// Private methods

	private async searchSymbols(query: string): Promise<
		Array<{
			id: string
			filePath: string
			content: string
			score: number
			name: string
			symbolType: string
			startLine: number
			endLine: number
		}>
	> {
		if (!this.databaseManager) return []

		const db = (this.databaseManager as any).db
		if (!db) return []

		// Simple text search in symbol names
		const queryLower = query.toLowerCase()
		const rows = await db.all(
			`SELECT s.*, f.path as file_path 
			FROM symbols s 
			JOIN files f ON s.file_id = f.id 
			WHERE LOWER(s.name) LIKE ? 
			ORDER BY 
				CASE WHEN LOWER(s.name) = ? THEN 1
					 WHEN LOWER(s.name) LIKE ? THEN 2
					 ELSE 3 END
			LIMIT 20`,
			[`%${queryLower}%`, queryLower, `${queryLower}%`],
		)

		return rows.map((row: any) => ({
			id: row.id,
			filePath: row.file_path,
			content: `${row.type} ${row.name}`,
			score:
				row.name.toLowerCase() === queryLower ? 1.0 : row.name.toLowerCase().startsWith(queryLower) ? 0.8 : 0.6,
			name: row.name,
			symbolType: row.type,
			startLine: row.start_line,
			endLine: row.end_line,
		}))
	}
}

// Convenience function
export function getUnifiedIndexService(
	workspacePath: string,
	context: vscode.ExtensionContext,
	config?: Partial<UnifiedIndexConfig>,
): UnifiedIndexService {
	return UnifiedIndexService.getInstance(workspacePath, context, config)
}
