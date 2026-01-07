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
	// kilocode_change - Hierarchical indexing config
	enableHierarchicalIndexing: boolean
	hierarchyLevels: ("repo" | "module" | "file")[]
	crossRepositorySearch: boolean
	maxRepositories: number
	maxModulesPerRepo: number
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
	// kilocode_change - Cross-repo context
	repositoryId?: string
	modulePath?: string
	targetRepositories?: string[]
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
			enableHierarchicalIndexing: true,
			hierarchyLevels: ["repo", "module", "file"],
			crossRepositorySearch: false,
			maxRepositories: 3,
			maxModulesPerRepo: 5,
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
			let vectorResults: ContextResult[] = []
			let keywordResults: ContextResult[] = []

			// kilocode_change - Use hierarchical indexing if enabled
			if (this.config.enableHierarchicalIndexing) {
				const hierarchicalResults = await this.performHierarchicalSearch(context)
				vectorResults = hierarchicalResults
			} else {
				// Standard vector search
				vectorResults = await this.performVectorSearch(context)
			}

			// Step 2: Keyword Search (BM25-style)
			keywordResults = await this.performKeywordSearch(context)

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
	 * kilocode_change - Perform hierarchical vector search
	 * Searches at Repo → Module → File levels for optimized retrieval
	 */
	private async performHierarchicalSearch(context: RetrievalContext): Promise<ContextResult[]> {
		const allResults: ContextResult[] = []

		// Determine search scope based on context
		const searchScope = this.determineSearchScope(context)

		// Search at each hierarchy level
		for (const level of this.config.hierarchyLevels) {
			const levelResults = await this.searchAtHierarchyLevel(level, searchScope, context)
			allResults.push(...levelResults)
		}

		// Deduplicate and rank results
		const uniqueResults = this.deduplicateResults(allResults)
		return uniqueResults.slice(0, this.config.maxResults)
	}

	/**
	 * Determine search scope based on context and configuration
	 */
	private determineSearchScope(context: RetrievalContext): {
		repositories: string[]
		modules: string[]
		files: string[]
	} {
		const repositories: string[] = []
		const modules: string[] = []
		const files: string[] = []

		// If cross-repository search is enabled, include multiple repos
		if (this.config.crossRepositorySearch && context.targetRepositories) {
			repositories.push(...context.targetRepositories.slice(0, this.config.maxRepositories))
		} else if (context.repositoryId) {
			repositories.push(context.repositoryId)
		}

		// Extract modules from session files
		for (const file of context.sessionFiles) {
			const modulePath = this.extractModulePath(file)
			if (modulePath && !modules.includes(modulePath)) {
				modules.push(modulePath)
			}
		}

		// Include current module if specified
		if (context.modulePath && !modules.includes(context.modulePath)) {
			modules.push(context.modulePath)
		}

		// Limit modules per repository
		const modulesByRepo = this.groupModulesByRepository(modules)
		const limitedModules: string[] = []
		for (const [repo, repoModules] of Object.entries(modulesByRepo)) {
			limitedModules.push(...repoModules.slice(0, this.config.maxModulesPerRepo))
		}

		return {
			repositories,
			modules: limitedModules,
			files: context.sessionFiles,
		}
	}

	/**
	 * Search at a specific hierarchy level
	 */
	private async searchAtHierarchyLevel(
		level: "repo" | "module" | "file",
		scope: { repositories: string[]; modules: string[]; files: string[] },
		context: RetrievalContext,
	): Promise<ContextResult[]> {
		try {
			const db = this.databaseManager.getDatabase()
			if (!db) return []

			let query = ""
			let params: any[] = []

			switch (level) {
				case "repo":
					// Search across entire repositories
					if (scope.repositories.length > 0) {
						const repoPlaceholders = scope.repositories.map(() => "?").join(",")
						query = `
							SELECT
								cc.id,
								cc.content,
								cc.start_line,
								cc.end_line,
								f.path as file_path,
								s.name as symbol_name
							FROM code_chunks cc
							JOIN files f ON cc.file_id = f.id
							LEFT JOIN symbols s ON cc.symbol_id = s.id
							WHERE f.path LIKE ?
							AND cc.vector_embedding IS NOT NULL
							ORDER BY random()
							LIMIT ?
						`
						params = [
							...scope.repositories.map((r) => `${r}%`),
							Math.ceil(this.config.maxResults / this.config.hierarchyLevels.length),
						]
					}
					break

				case "module":
					// Search within specific modules
					if (scope.modules.length > 0) {
						const modulePlaceholders = scope.modules.map(() => "?").join(",")
						query = `
							SELECT
								cc.id,
								cc.content,
								cc.start_line,
								cc.end_line,
								f.path as file_path,
								s.name as symbol_name
							FROM code_chunks cc
							JOIN files f ON cc.file_id = f.id
							LEFT JOIN symbols s ON cc.symbol_id = s.id
							WHERE (${scope.modules.map(() => "f.path LIKE ?").join(" OR ")})
							AND cc.vector_embedding IS NOT NULL
							ORDER BY random()
							LIMIT ?
						`
						params = [
							...scope.modules.map((m) => `%${m}%`),
							Math.ceil(this.config.maxResults / this.config.hierarchyLevels.length),
						]
					}
					break

				case "file":
					// Search within specific files
					if (scope.files.length > 0) {
						const filePlaceholders = scope.files.map(() => "?").join(",")
						query = `
							SELECT
								cc.id,
								cc.content,
								cc.start_line,
								cc.end_line,
								f.path as file_path,
								s.name as symbol_name
							FROM code_chunks cc
							JOIN files f ON cc.file_id = f.id
							LEFT JOIN symbols s ON cc.symbol_id = s.id
							WHERE f.path IN (${filePlaceholders})
							AND cc.vector_embedding IS NOT NULL
							ORDER BY random()
							LIMIT ?
						`
						params = [
							...scope.files,
							Math.ceil(this.config.maxResults / this.config.hierarchyLevels.length),
						]
					}
					break
			}

			if (!query) return []

			const results = await db.all(query, ...params)

			return results.map((result: any, index: number) => ({
				id: result.id,
				filePath: result.file_path,
				content: result.content,
				startLine: result.start_line,
				endLine: result.end_line,
				score: 1 - index / results.length,
				source: "vector" as const,
				metadata: result,
			}))
		} catch (error) {
			console.error(`[ContextRetriever] Hierarchical search error at ${level} level:`, error)
			return []
		}
	}

	/**
	 * Extract module path from file path
	 */
	private extractModulePath(filePath: string): string | null {
		const parts = filePath.split("/")
		// Find common module indicators (e.g., 'src', 'lib', 'app', 'modules')
		const moduleIndicators = ["src", "lib", "app", "modules", "components", "services"]
		const moduleIndex = parts.findIndex((part) => moduleIndicators.includes(part))

		if (moduleIndex >= 0 && moduleIndex < parts.length - 1) {
			return parts.slice(0, moduleIndex + 2).join("/")
		}

		return null
	}

	/**
	 * Group modules by repository
	 */
	private groupModulesByRepository(modules: string[]): Record<string, string[]> {
		const grouped: Record<string, string[]> = {}

		for (const module of modules) {
			const repo = module.split("/")[0]
			if (!grouped[repo]) {
				grouped[repo] = []
			}
			if (!grouped[repo].includes(module)) {
				grouped[repo].push(module)
			}
		}

		return grouped
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
