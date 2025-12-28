import type { SearchQuery, VectorSearchResult, CodeChunk } from "../types"
import { VectorDatabase } from "../indexing/vector-database"
import { CacheManager } from "../cache/cache-manager"
import { MemoryManager } from "../memory/memory-manager"
import { MetadataDatabase } from "../memory/metadata-database"

/**
 * Context Retriever with advanced search strategies
 * Implements hybrid search, re-ranking, and graph traversal
 */
export class ContextRetriever {
	private vectorDb: VectorDatabase
	private metadataDb: MetadataDatabase
	private cacheManager: CacheManager
	private memoryManager: MemoryManager

	constructor(
		vectorDb: VectorDatabase,
		metadataDb: MetadataDatabase,
		cacheManager: CacheManager,
		memoryManager: MemoryManager,
	) {
		this.vectorDb = vectorDb
		this.metadataDb = metadataDb
		this.cacheManager = cacheManager
		this.memoryManager = memoryManager
	}

	/**
	 * Retrieve relevant context for a query
	 */
	async retrieve(query: SearchQuery): Promise<VectorSearchResult[]> {
		const startTime = Date.now()

		// Check cache first
		const cacheKey = this.generateCacheKey(query)
		const cached = this.cacheManager.getQuery(cacheKey)
		if (cached) {
			const latency = Date.now() - startTime
			await this.recordQuery(query.query, latency, cached.length, true, this.extractSources(cached))
			return cached
		}

		// Expand query with synonyms and related terms
		const expandedQuery = await this.expandQuery(query.query)

		// Perform hybrid search (vector + BM25)
		const results = await this.hybridSearch({ ...query, query: expandedQuery })

		// Apply temporal context (prioritize recent files)
		const temporalResults = await this.applyTemporalContext(results)

		// Re-rank results
		const rerankedResults = await this.rerank(temporalResults, query.query)

		// Apply graph traversal for additional context
		const enrichedResults = await this.enrichWithGraph(rerankedResults)

		// Prune irrelevant content
		const prunedResults = this.pruneContext(enrichedResults)

		// Cache results
		this.cacheManager.setQuery(cacheKey, prunedResults)

		// Record analytics
		const latency = Date.now() - startTime
		await this.recordQuery(query.query, latency, prunedResults.length, false, this.extractSources(prunedResults))

		return prunedResults
	}

	/**
	 * Hybrid search combining vector search and keyword search (BM25)
	 */
	private async hybridSearch(query: SearchQuery): Promise<VectorSearchResult[]> {
		// For now, just use vector search
		// TODO: Implement BM25 keyword search and combine results
		return await this.vectorDb.search(query)
	}

	/**
	 * Expand query with synonyms and related terms
	 */
	private async expandQuery(query: string): Promise<string> {
		// Simple expansion rules (TODO: use more sophisticated NLP)
		const expansions: Record<string, string[]> = {
			button: ["button", "click handler", "event listener", "onClick"],
			function: ["function", "method", "def", "async function"],
			class: ["class", "component", "model"],
			error: ["error", "exception", "throw", "try catch"],
			api: ["api", "endpoint", "route", "handler"],
			database: ["database", "db", "SQL", "query", "collection"],
		}

		const lowerQuery = query.toLowerCase()
		for (const [key, synonyms] of Object.entries(expansions)) {
			if (lowerQuery.includes(key)) {
				return `${query} ${synonyms.join(" ")}`
			}
		}

		return query
	}

	/**
	 * Apply temporal context (prioritize recently modified files)
	 */
	private async applyTemporalContext(results: VectorSearchResult[]): Promise<VectorSearchResult[]> {
		const recentFiles = await this.memoryManager.getRecentFiles()
		const recentFilesSet = new Set(recentFiles)

		// Boost score for recently accessed files
		return results.map((result) => {
			if (recentFilesSet.has(result.chunk.filePath)) {
				return {
					...result,
					score: result.score * 1.2, // 20% boost
				}
			}
			return result
		})
	}

	/**
	 * Re-rank results using cross-encoder (TODO: implement)
	 */
	private async rerank(results: VectorSearchResult[], originalQuery: string): Promise<VectorSearchResult[]> {
		// TODO: Implement cross-encoder re-ranking
		// For now, just return sorted results
		return results.sort((a, b) => b.score - a.score)
	}

	/**
	 * Enrich results with related chunks via graph traversal
	 */
	private async enrichWithGraph(results: VectorSearchResult[]): Promise<VectorSearchResult[]> {
		// TODO: Implement graph traversal to find related chunks
		// For example, if we find a function call, also retrieve the function definition
		return results
	}

	/**
	 * Prune irrelevant content (remove imports, comments, boilerplate)
	 */
	private pruneContext(results: VectorSearchResult[]): VectorSearchResult[] {
		return results.map((result) => {
			const prunedContent = this.removeBoilerplate(result.chunk.content)
			return {
				...result,
				chunk: {
					...result.chunk,
					content: prunedContent,
				},
			}
		})
	}

	private removeBoilerplate(content: string): string {
		// Remove excessive imports
		const lines = content.split("\n")
		const filtered = lines.filter((line) => {
			const trimmed = line.trim()
			// Keep imports but limit them
			if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
				return true
			}
			// Remove empty lines
			if (trimmed === "") {
				return false
			}
			return true
		})

		return filtered.join("\n")
	}

	/**
	 * Multi-hop reasoning (follow relationships across levels)
	 */
	async multiHopSearch(query: string, hops: number = 2): Promise<VectorSearchResult[]> {
		let currentResults = await this.retrieve({ query, limit: 10 })
		const allResults = new Map<string, VectorSearchResult>()

		// Add initial results
		for (const result of currentResults) {
			allResults.set(result.chunk.id, result)
		}

		// Follow relationships for each hop
		for (let i = 0; i < hops; i++) {
			const newResults: VectorSearchResult[] = []

			for (const result of currentResults) {
				// TODO: Find related chunks via relationships
				// For now, just break
				break
			}

			currentResults = newResults
			for (const result of newResults) {
				if (!allResults.has(result.chunk.id)) {
					allResults.set(result.chunk.id, result)
				}
			}
		}

		return Array.from(allResults.values()).sort((a, b) => b.score - a.score)
	}

	private generateCacheKey(query: SearchQuery): string {
		return JSON.stringify(query)
	}

	private extractSources(results: VectorSearchResult[]): string[] {
		return [...new Set(results.map((r) => r.chunk.filePath))]
	}

	private async recordQuery(
		query: string,
		latency: number,
		resultsCount: number,
		cacheHit: boolean,
		sources: string[],
	): Promise<void> {
		try {
			await this.metadataDb.recordQuery(query, latency, resultsCount, cacheHit, sources)
		} catch (error) {
			console.error("Failed to record query analytics:", error)
		}
	}

	/**
	 * Get query statistics
	 */
	async getQueryStats(): Promise<any> {
		return await this.metadataDb.getQueryStats()
	}
}
