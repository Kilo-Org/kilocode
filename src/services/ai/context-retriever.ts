// kilocode_change - new file

import { VectorStoreSearchResult } from "../code-index/interfaces"
import { DatabaseManager } from "../storage/database-manager"
import { ParserService } from "../parser/parser-service"

export interface RetrievalConfig {
	maxResults: number
	tokenLimit: number
	vectorWeight: number
	keywordWeight: number
	proximityBoost: number
	inheritanceBoost: number
	recencyBoost: number
}

export interface ContextResult {
	id: string
	filePath: string
	content: string
	startLine: number
	endLine: number
	score: number
	source: "vector" | "keyword" | "hybrid"
	metadata?: Record<string, any>
}

export interface RetrievalContext {
	query: string
	currentFile?: string
	currentLine?: number
	sessionFiles: string[]
	recentlyModified: string[]
	projectType?: "odoo" | "django" | "generic"
}

/**
 * Sophisticated context retrieval and ranking system
 */
export class ContextRetriever {
	private databaseManager: DatabaseManager
	private parserService: ParserService
	private config: RetrievalConfig
	private queryCache: Map<string, ContextResult[]> = new Map()

	constructor(databaseManager: DatabaseManager, parserService: ParserService, config: Partial<RetrievalConfig> = {}) {
		this.databaseManager = databaseManager
		this.parserService = parserService
		this.config = {
			maxResults: 20,
			tokenLimit: 10000,
			vectorWeight: 0.6,
			keywordWeight: 0.4,
			proximityBoost: 0.2,
			inheritanceBoost: 0.3,
			recencyBoost: 0.1,
			...config,
		}
	}

	/**
	 * Perform hybrid retrieval combining vector and keyword search
	 */
	async retrieveContext(context: RetrievalContext): Promise<ContextResult[]> {
		const startTime = Date.now()

		// Check cache first
		const cacheKey = this.generateCacheKey(context)
		if (this.queryCache.has(cacheKey)) {
			return this.queryCache.get(cacheKey)!
		}

		try {
			// Step 1: Vector Search
			const vectorResults = await this.performVectorSearch(context)

			// Step 2: Keyword Search (BM25-style)
			const keywordResults = await this.performKeywordSearch(context)

			// Step 3: Merge with Reciprocal Rank Fusion
			const mergedResults = this.mergeResults(vectorResults, keywordResults)

			// Step 4: Graph-aware reranking
			const rerankedResults = await this.rerankResults(mergedResults, context)

			// Step 5: Apply token budgeting
			const finalResults = this.applyTokenBudgeting(rerankedResults)

			// Cache results
			this.queryCache.set(cacheKey, finalResults)

			// Clean cache if too large
			if (this.queryCache.size > 100) {
				const firstKey = this.queryCache.keys().next().value
				if (firstKey) {
					this.queryCache.delete(firstKey)
				}
			}

			const retrievalTime = Date.now() - startTime
			console.log(`[ContextRetriever] Retrieved ${finalResults.length} results in ${retrievalTime}ms`)

			return finalResults
		} catch (error) {
			console.error("[ContextRetriever] Error during retrieval:", error)
			return []
		}
	}

	/**
	 * Perform vector similarity search
	 */
	private async performVectorSearch(context: RetrievalContext): Promise<ContextResult[]> {
		try {
			// Use existing search service for vector search
			const searchResults = await this.databaseManager.searchVectorContext(
				new Array(1536).fill(0.1), // Placeholder vector - in real implementation, generate from query
				this.config.maxResults,
			)

			return searchResults.map((result, index) => ({
				id: result.id,
				filePath: result.file_path,
				content: result.content,
				startLine: result.start_line,
				endLine: result.end_line,
				score: 1 - index / searchResults.length, // Simple ranking
				source: "vector" as const,
				metadata: result,
			}))
		} catch (error) {
			console.error("[ContextRetriever] Vector search error:", error)
			return []
		}
	}

	/**
	 * Perform keyword-based search (BM25-style)
	 */
	private async performKeywordSearch(context: RetrievalContext): Promise<ContextResult[]> {
		try {
			const keywords = this.extractKeywords(context.query)
			const results: ContextResult[] = []

			// Search for symbols matching keywords
			for (const keyword of keywords) {
				// This would use the database to search for symbol names
				// For now, we'll simulate with a basic approach
				const symbolResults = await this.searchSymbolsByKeyword(keyword)
				results.push(...symbolResults)
			}

			// Remove duplicates and sort by relevance
			const uniqueResults = this.deduplicateResults(results)
			return uniqueResults.slice(0, this.config.maxResults)
		} catch (error) {
			console.error("[ContextRetriever] Keyword search error:", error)
			return []
		}
	}

	/**
	 * Merge results using Reciprocal Rank Fusion (RRF)
	 */
	private mergeResults(vectorResults: ContextResult[], keywordResults: ContextResult[]): ContextResult[] {
		const k = 60 // RRF constant
		const mergedMap = new Map<string, ContextResult>()

		// Process vector results
		vectorResults.forEach((result, index) => {
			const rrfScore = this.config.vectorWeight / (k + index + 1)
			mergedMap.set(result.id, { ...result, score: rrfScore, source: "hybrid" as const })
		})

		// Process keyword results
		keywordResults.forEach((result, index) => {
			const rrfScore = this.config.keywordWeight / (k + index + 1)
			const existing = mergedMap.get(result.id)
			if (existing) {
				existing.score += rrfScore
			} else {
				mergedMap.set(result.id, { ...result, score: rrfScore, source: "hybrid" as const })
			}
		})

		// Sort by score and return top results
		return Array.from(mergedMap.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, this.config.maxResults)
	}

	/**
	 * Graph-aware reranking based on proximity, inheritance, and recency
	 */
	private async rerankResults(results: ContextResult[], context: RetrievalContext): Promise<ContextResult[]> {
		const rerankedResults = [...results]

		for (let i = 0; i < rerankedResults.length; i++) {
			const result = rerankedResults[i]
			let boostScore = 0

			// Proximity boost
			if (context.currentFile) {
				const proximityScore = this.calculateProximityScore(result.filePath, context.currentFile)
				boostScore += proximityScore * this.config.proximityBoost
			}

			// Inheritance boost for Odoo projects
			if (context.projectType === "odoo") {
				const inheritanceScore = await this.calculateInheritanceScore(result, context)
				boostScore += inheritanceScore * this.config.inheritanceBoost
			}

			// Recency boost
			const recencyScore = this.calculateRecencyScore(result.filePath, context.recentlyModified)
			boostScore += recencyScore * this.config.recencyBoost

			// Apply boost
			result.score *= 1 + boostScore
		}

		// Re-sort after applying boosts
		return rerankedResults.sort((a, b) => b.score - a.score)
	}

	/**
	 * Apply token budgeting to stay within limits
	 */
	private applyTokenBudgeting(results: ContextResult[]): ContextResult[] {
		const budgetedResults: ContextResult[] = []
		let totalTokens = 0
		const tokensPerChunk = 4 // Rough estimate of tokens per character

		for (const result of results) {
			const resultTokens = result.content.length * tokensPerChunk

			if (totalTokens + resultTokens <= this.config.tokenLimit) {
				budgetedResults.push(result)
				totalTokens += resultTokens
			} else {
				// Try to include a partial result if it fits
				const remainingTokens = this.config.tokenLimit - totalTokens
				if (remainingTokens > 100) {
					// Minimum meaningful chunk
					const truncatedContent = result.content.substring(0, Math.floor(remainingTokens / tokensPerChunk))
					budgetedResults.push({
						...result,
						content: truncatedContent,
						score: result.score * 0.8, // Slightly penalize truncated results
					})
				}
				break
			}
		}

		return budgetedResults
	}

	// Helper methods

	private generateCacheKey(context: RetrievalContext): string {
		return `${context.query}:${context.currentFile}:${context.currentLine}:${context.sessionFiles.join(",")}`
	}

	private extractKeywords(query: string): string[] {
		// Simple keyword extraction - in production, use more sophisticated NLP
		return query
			.toLowerCase()
			.split(/\s+/)
			.filter((word) => word.length > 2)
			.filter((word) => !["the", "and", "or", "but", "in", "on", "at", "to", "for"].includes(word))
	}

	private async searchSymbolsByKeyword(keyword: string): Promise<ContextResult[]> {
		// This would search the database for symbols matching the keyword
		// For now, return empty array - would be implemented with actual database queries
		return []
	}

	private deduplicateResults(results: ContextResult[]): ContextResult[] {
		const seen = new Set<string>()
		return results.filter((result) => {
			const key = `${result.filePath}:${result.startLine}:${result.endLine}`
			if (seen.has(key)) {
				return false
			}
			seen.add(key)
			return true
		})
	}

	private calculateProximityScore(filePath: string, currentFile: string): number {
		if (filePath === currentFile) return 1.0

		const currentDir = currentFile.split("/").slice(0, -1).join("/")
		const targetDir = filePath.split("/").slice(0, -1).join("/")

		if (currentDir === targetDir) return 0.8

		// Calculate directory distance
		const currentParts = currentDir.split("/")
		const targetParts = targetDir.split("/")

		let commonDepth = 0
		const minLength = Math.min(currentParts.length, targetParts.length)

		for (let i = 0; i < minLength; i++) {
			if (currentParts[i] === targetParts[i]) {
				commonDepth++
			} else {
				break
			}
		}

		const distance = currentParts.length - commonDepth + (targetParts.length - commonDepth)
		return Math.max(0, 1 - distance * 0.1)
	}

	private async calculateInheritanceScore(result: ContextResult, context: RetrievalContext): Promise<number> {
		// This would use the relationships table to find inheritance connections
		// For now, return a simple heuristic
		if (result.metadata?._name || result.metadata?._inherit) {
			return 0.5
		}
		return 0
	}

	private calculateRecencyScore(filePath: string, recentlyModified: string[]): number {
		const index = recentlyModified.indexOf(filePath)
		if (index === -1) return 0
		return 1 - index / recentlyModified.length
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.queryCache.clear()
	}

	/**
	 * Get retrieval statistics
	 */
	getStats(): any {
		return {
			cacheSize: this.queryCache.size,
			config: this.config,
		}
	}
}
