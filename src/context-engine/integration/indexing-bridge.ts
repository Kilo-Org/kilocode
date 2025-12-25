/**
 * Adapter to integrate Advanced Context Engine with existing Kilo Code Index Manager
 * This bridges the gap between the two indexing systems
 */

import type { ContextEngine } from "../index"
import type { CodeIndexManager } from "../../services/code-index/manager"
import type { VectorStoreSearchResult } from "../../services/code-index/interfaces"
import type { SearchQuery, VectorSearchResult } from "../types"

/**
 * Bridge between Advanced Context Engine and Kilo Code Index Manager
 * Allows both systems to work together seamlessly
 */
export class IndexingBridge {
	private contextEngine: ContextEngine
	private codeIndexManager: CodeIndexManager | undefined

	constructor(contextEngine: ContextEngine, codeIndexManager?: CodeIndexManager) {
		this.contextEngine = contextEngine
		this.codeIndexManager = codeIndexManager
	}

	/**
	 * Set the Code Index Manager instance
	 */
	setCodeIndexManager(manager: CodeIndexManager): void {
		this.codeIndexManager = manager
	}

	/**
	 * Perform hybrid search across both indexing systems
	 * Combines results from Context Engine and Code Index Manager
	 */
	async hybridSearch(query: string, limit: number = 10): Promise<CombinedSearchResult[]> {
		const results: CombinedSearchResult[] = []

		// Search in Context Engine
		try {
			const contextResults = await this.contextEngine.search({
				query,
				limit: Math.ceil(limit / 2), // Split limit between both systems
			})

			results.push(
				...contextResults.map((r) => ({
					source: "context-engine" as const,
					filePath: r.chunk.filePath,
					startLine: r.chunk.startLine,
					endLine: r.chunk.endLine,
					content: r.chunk.content,
					score: r.score,
					metadata: {
						chunkType: r.chunk.type,
						language: r.chunk.language,
					},
				})),
			)
		} catch (error) {
			console.error("[IndexingBridge] Context Engine search failed:", error)
		}

		// Search in Code Index Manager (if available)
		if (this.codeIndexManager && this.codeIndexManager.isFeatureEnabled) {
			try {
				const codeIndexResults = await this.codeIndexManager.searchIndex(query)

				results.push(
					...codeIndexResults.map((r) => ({
						source: "code-index" as const,
						filePath: r.payload?.filePath || "",
						startLine: r.payload?.startLine || 0,
						endLine: r.payload?.endLine || 0,
						content: r.payload?.codeChunk || "",
						score: r.score,
						metadata: {
							symbols: r.payload?.symbols || [],
						},
					})),
				)
			} catch (error) {
				console.error("[IndexingBridge] Code Index Manager search failed:", error)
			}
		}

		// Sort by score (descending) and limit results
		return results.sort((a, b) => b.score - a.score).slice(0, limit)
	}

	/**
	 * Trigger indexing in both systems
	 */
	async triggerFullIndexing(): Promise<void> {
		const promises: Promise<any>[] = []

		// Index with Context Engine
		promises.push(
			this.contextEngine.indexProject((progress, message) => {
				console.log(`[Context Engine] ${progress.toFixed(1)}% - ${message}`)
			}),
		)

		// Index with Code Index Manager (if available)
		if (this.codeIndexManager && this.codeIndexManager.isFeatureEnabled) {
			promises.push(this.codeIndexManager.startIndexing())
		}

		await Promise.all(promises)
	}

	/**
	 * Get combined indexing statistics
	 */
	async getIndexingStats(): Promise<CombinedIndexingStats> {
		const contextStats = this.contextEngine.getIndexingStats()

		const codeIndexStats = this.codeIndexManager
			? this.codeIndexManager.getCurrentStatus()
			: {
					systemStatus: "Standby" as const,
					processedItems: 0,
					totalItems: 0,
				}

		return {
			contextEngine: {
				totalFiles: contextStats.totalFiles,
				indexedFiles: contextStats.indexedFiles,
				totalChunks: contextStats.totalChunks,
				failedFiles: contextStats.failedFiles.length,
			},
			codeIndex: {
				status: codeIndexStats.systemStatus,
				filesIndexed: codeIndexStats.processedItems || 0,
				totalFiles: codeIndexStats.totalItems || 0,
			},
			combined: {
				totalIndexed: contextStats.indexedFiles + (codeIndexStats.processedItems || 0),
				totalFiles: contextStats.totalFiles + (codeIndexStats.totalItems || 0),
			},
		}
	}

	/**
	 * Clear both indices
	 */
	async clearAllIndices(): Promise<void> {
		await this.contextEngine.clear()

		if (this.codeIndexManager && this.codeIndexManager.isFeatureEnabled) {
			await this.codeIndexManager.clearIndexData()
		}
	}

	/**
	 * Check if both systems are ready
	 */
	isReady(): boolean {
		const contextReady = true // Context Engine is always ready after initialization
		const codeIndexReady = this.codeIndexManager
			? this.codeIndexManager.isInitialized && this.codeIndexManager.isFeatureEnabled
			: true // If no CodeIndexManager, consider it "ready" (not blocking)

		return contextReady && codeIndexReady
	}
}

/**
 * Combined search result from both indexing systems
 */
export interface CombinedSearchResult {
	source: "context-engine" | "code-index"
	filePath: string
	startLine: number
	endLine: number
	content: string
	score: number
	metadata: {
		chunkType?: string
		language?: string
		symbols?: string[]
	}
}

/**
 * Combined indexing statistics
 */
export interface CombinedIndexingStats {
	contextEngine: {
		totalFiles: number
		indexedFiles: number
		totalChunks: number
		failedFiles: number
	}
	codeIndex: {
		status: string
		filesIndexed: number
		totalFiles: number
	}
	combined: {
		totalIndexed: number
		totalFiles: number
	}
}
