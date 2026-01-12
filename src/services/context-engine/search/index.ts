// kilocode_change - new file
/**
 * Hybrid Search Service
 *
 * Combines text-based search with Knowledge Graph relationships
 * to provide contextually relevant search results.
 */

import { CodeEntity, EntityRelationship } from "../types"
import { IKnowledgeGraph } from "../knowledge-graph"
import { IGitHistoryAnalyzer } from "../git-analyzer"
import { IPatternDetectorService, DetectedPattern } from "../pattern-detector"
import {
	IHybridSearchService,
	SearchResult,
	SearchOptions,
	SearchWeights,
	SearchServiceConfig,
	ScoreBreakdown,
	RelationshipPath,
	MatchHighlight,
} from "./types"

// Re-export types
export * from "./types"

const DEFAULT_WEIGHTS: Required<SearchWeights> = {
	textSimilarity: 0.4,
	graphRelationship: 0.3,
	recency: 0.15,
	frequency: 0.1,
	pattern: 0.05,
}

const DEFAULT_CONFIG: Required<SearchServiceConfig> = {
	defaultWeights: DEFAULT_WEIGHTS,
	defaultLimit: 20,
	defaultMinScore: 0.1,
	enableCache: true,
	cacheTTL: 60000, // 1 minute
}

/**
 * Hybrid Search Service implementation
 */
export class HybridSearchService implements IHybridSearchService {
	private config: Required<SearchServiceConfig>
	private knowledgeGraph: IKnowledgeGraph | null = null
	private gitAnalyzer: IGitHistoryAnalyzer | null = null
	private patternDetector: IPatternDetectorService | null = null
	private entityIndex: Map<string, CodeEntity> = new Map()
	private cache: Map<string, { results: SearchResult[]; timestamp: number }> = new Map()

	constructor(config: Partial<SearchServiceConfig> = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config,
			defaultWeights: { ...DEFAULT_WEIGHTS, ...config.defaultWeights },
		}
	}

	/**
	 * Set the knowledge graph for relationship-based boosting
	 */
	setKnowledgeGraph(graph: IKnowledgeGraph): void {
		this.knowledgeGraph = graph
	}

	/**
	 * Set the git analyzer for recency scoring
	 */
	setGitAnalyzer(analyzer: IGitHistoryAnalyzer): void {
		this.gitAnalyzer = analyzer
	}

	/**
	 * Set the pattern detector for pattern-based boosting
	 */
	setPatternDetector(detector: IPatternDetectorService): void {
		this.patternDetector = detector
	}

	/**
	 * Index entities for searching
	 */
	indexEntities(entities: CodeEntity[]): void {
		for (const entity of entities) {
			this.entityIndex.set(entity.id, entity)
		}
		this.clearCache()
	}

	/**
	 * Clear the entity index
	 */
	clearIndex(): void {
		this.entityIndex.clear()
		this.clearCache()
	}

	/**
	 * Search for entities matching a query
	 */
	async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
		const cacheKey = this.getCacheKey(query, options)

		if (this.config.enableCache) {
			const cached = this.getFromCache(cacheKey)
			if (cached) return cached
		}

		const opts = this.mergeOptions(options)
		let results = await this.performSearch(query, opts)

		// Apply filters
		results = this.applyFilters(results, opts)

		// Sort by score
		results.sort((a, b) => b.score - a.score)

		// Apply limit
		results = results.slice(0, opts.limit)

		if (this.config.enableCache) {
			this.addToCache(cacheKey, results)
		}

		return results
	}

	/**
	 * Search with a context entity for relationship boosting
	 */
	async searchWithContext(query: string, contextEntityId: string, options?: SearchOptions): Promise<SearchResult[]> {
		return this.search(query, { ...options, contextEntityId })
	}

	/**
	 * Find entities related to a given entity
	 */
	async findRelated(entityId: string, options?: SearchOptions): Promise<SearchResult[]> {
		const opts = this.mergeOptions(options)
		const results: SearchResult[] = []

		if (!this.knowledgeGraph) {
			return results
		}

		// Get related entities from the graph
		const relatedEntities = await this.knowledgeGraph.getRelatedEntities(entityId, 2)

		for (const related of relatedEntities) {
			const entity = this.entityIndex.get(related.id)
			if (!entity) continue

			// Calculate relationship-based score
			const path = await this.knowledgeGraph.findPath(entityId, related.id)
			const graphScore = path && path.length > 0 ? 1 / (path.length + 1) : 0

			const scoreBreakdown: ScoreBreakdown = {
				textSimilarity: 0,
				graphRelationship: graphScore,
				recencyBoost: 0,
				frequencyBoost: 0,
				patternBoost: 0,
			}

			const score = this.calculateFinalScore(scoreBreakdown, this.config.defaultWeights)

			if (score >= opts.minScore!) {
				results.push({
					entity,
					score,
					scoreBreakdown,
					relationshipPath:
						path && path.length > 0
							? {
									entities: path.map((n) => n.targetId),
									relationships: [],
									length: path.length,
								}
							: undefined,
				})
			}
		}

		// Apply filters and sort
		const filtered = this.applyFilters(results, opts)
		filtered.sort((a, b) => b.score - a.score)

		return filtered.slice(0, opts.limit)
	}

	/**
	 * Get entities by type with optional filtering
	 */
	async getByType(entityType: CodeEntity["type"], options?: SearchOptions): Promise<SearchResult[]> {
		const opts = this.mergeOptions(options)
		const results: SearchResult[] = []

		for (const entity of this.entityIndex.values()) {
			if (entity.type !== entityType) continue

			const scoreBreakdown: ScoreBreakdown = {
				textSimilarity: 1,
				graphRelationship: 0,
				recencyBoost: 0,
				frequencyBoost: 0,
				patternBoost: 0,
			}

			// Add recency boost if available
			if (this.gitAnalyzer?.isAvailable()) {
				const recencyScore = await this.gitAnalyzer.calculateRecencyScore(entity.filePath, 1)
				scoreBreakdown.recencyBoost = recencyScore - 1
			}

			const score = this.calculateFinalScore(scoreBreakdown, this.config.defaultWeights)

			results.push({
				entity,
				score,
				scoreBreakdown,
			})
		}

		const filtered = this.applyFilters(results, opts)
		filtered.sort((a, b) => b.score - a.score)

		return filtered.slice(0, opts.limit)
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private async performSearch(query: string, options: Required<SearchOptions>): Promise<SearchResult[]> {
		const results: SearchResult[] = []
		const queryLower = query.toLowerCase()
		const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 0)

		for (const entity of this.entityIndex.values()) {
			const scoreBreakdown = await this.calculateScoreBreakdown(entity, queryTerms, options)
			const score = this.calculateFinalScore(scoreBreakdown, this.config.defaultWeights)

			if (score >= options.minScore!) {
				const highlights = this.findHighlights(entity, queryTerms)

				results.push({
					entity,
					score,
					scoreBreakdown,
					highlights,
					snippet: this.generateSnippet(entity, queryTerms),
				})
			}
		}

		return results
	}

	private async calculateScoreBreakdown(
		entity: CodeEntity,
		queryTerms: string[],
		options: Required<SearchOptions>,
	): Promise<ScoreBreakdown> {
		const breakdown: ScoreBreakdown = {
			textSimilarity: 0,
			graphRelationship: 0,
			recencyBoost: 0,
			frequencyBoost: 0,
			patternBoost: 0,
		}

		// Text similarity
		breakdown.textSimilarity = this.calculateTextSimilarity(entity, queryTerms)

		// Graph relationship boost
		if (options.contextEntityId && this.knowledgeGraph) {
			breakdown.graphRelationship = await this.calculateGraphScore(entity.id, options.contextEntityId)
		}

		// Recency boost
		if (this.gitAnalyzer?.isAvailable()) {
			try {
				const recencyScore = await this.gitAnalyzer.calculateRecencyScore(entity.filePath, 1)
				breakdown.recencyBoost = Math.max(0, recencyScore - 1)
			} catch {
				// Ignore errors
			}
		}

		return breakdown
	}

	private calculateTextSimilarity(entity: CodeEntity, queryTerms: string[]): number {
		if (queryTerms.length === 0) return 0

		const nameLower = entity.name.toLowerCase()
		const filePathLower = entity.filePath.toLowerCase()

		let matchCount = 0
		let exactMatch = false

		for (const term of queryTerms) {
			// Exact name match
			if (nameLower === term) {
				exactMatch = true
				matchCount += 2
			}
			// Name contains term
			else if (nameLower.includes(term)) {
				matchCount += 1
			}
			// File path contains term
			else if (filePathLower.includes(term)) {
				matchCount += 0.5
			}
		}

		// Normalize score
		let score = matchCount / (queryTerms.length * 2)

		// Boost for exact matches
		if (exactMatch) {
			score = Math.min(1, score + 0.3)
		}

		return Math.min(1, score)
	}

	private async calculateGraphScore(entityId: string, contextEntityId: string): Promise<number> {
		if (!this.knowledgeGraph) return 0

		const path = await this.knowledgeGraph.findPath(contextEntityId, entityId)
		if (!path || path.length === 0) return 0

		// Score decreases with distance
		// Direct connection (length 2) = 1.0
		// 2 hops (length 3) = 0.5
		// 3 hops (length 4) = 0.33
		return 1 / (path.length - 1)
	}

	private calculateFinalScore(breakdown: ScoreBreakdown, weights: SearchWeights): number {
		return (
			breakdown.textSimilarity * (weights.textSimilarity ?? 0.4) +
			breakdown.graphRelationship * (weights.graphRelationship ?? 0.3) +
			breakdown.recencyBoost * (weights.recency ?? 0.15) +
			breakdown.frequencyBoost * (weights.frequency ?? 0.1) +
			breakdown.patternBoost * (weights.pattern ?? 0.05)
		)
	}

	private findHighlights(entity: CodeEntity, queryTerms: string[]): MatchHighlight[] {
		const highlights: MatchHighlight[] = []
		const nameLower = entity.name.toLowerCase()

		for (const term of queryTerms) {
			let index = nameLower.indexOf(term)
			while (index !== -1) {
				highlights.push({
					start: index,
					end: index + term.length,
					text: entity.name.substring(index, index + term.length),
				})
				index = nameLower.indexOf(term, index + 1)
			}
		}

		return highlights
	}

	private generateSnippet(entity: CodeEntity, _queryTerms: string[]): string {
		// Generate a simple snippet from entity info
		const parts: string[] = []

		if (entity.type) {
			parts.push(entity.type)
		}

		parts.push(entity.name)

		if (entity.signature) {
			parts.push(entity.signature)
		}

		return parts.join(" ")
	}

	private applyFilters(results: SearchResult[], options: Required<SearchOptions>): SearchResult[] {
		return results.filter((result) => {
			// Filter by entity type
			if (options.entityTypes && options.entityTypes.length > 0) {
				if (!options.entityTypes.includes(result.entity.type)) {
					return false
				}
			}

			// Filter by directory
			if (options.directory) {
				if (!result.entity.filePath.startsWith(options.directory)) {
					return false
				}
			}

			// Filter by file patterns
			if (options.filePatterns && options.filePatterns.length > 0) {
				const matches = options.filePatterns.some((pattern) => this.matchGlob(result.entity.filePath, pattern))
				if (!matches) return false
			}

			// Exclude patterns
			if (options.excludePatterns && options.excludePatterns.length > 0) {
				const excluded = options.excludePatterns.some((pattern) =>
					this.matchGlob(result.entity.filePath, pattern),
				)
				if (excluded) return false
			}

			return true
		})
	}

	private matchGlob(filePath: string, pattern: string): boolean {
		// Simple glob matching (supports * and **)
		// Escape special regex characters except *
		let regexPattern = pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special chars
			.replace(/\*\*/g, "{{DOUBLE_STAR}}")
			.replace(/\*/g, "[^/]*")
			.replace(/{{DOUBLE_STAR}}/g, ".*")

		const regex = new RegExp(regexPattern)
		return regex.test(filePath)
	}

	private mergeOptions(options?: SearchOptions): Required<SearchOptions> {
		return {
			limit: options?.limit ?? this.config.defaultLimit,
			minScore: options?.minScore ?? this.config.defaultMinScore,
			entityTypes: options?.entityTypes ?? [],
			filePatterns: options?.filePatterns ?? [],
			excludePatterns: options?.excludePatterns ?? [],
			directory: options?.directory ?? "",
			contextEntityId: options?.contextEntityId ?? "",
			includeRelationshipPaths: options?.includeRelationshipPaths ?? false,
			weights: { ...this.config.defaultWeights, ...options?.weights },
		}
	}

	private getCacheKey(query: string, options?: SearchOptions): string {
		return JSON.stringify({ query, options })
	}

	private getFromCache(key: string): SearchResult[] | null {
		const cached = this.cache.get(key)
		if (!cached) return null

		if (Date.now() - cached.timestamp > this.config.cacheTTL) {
			this.cache.delete(key)
			return null
		}

		return cached.results
	}

	private addToCache(key: string, results: SearchResult[]): void {
		this.cache.set(key, { results, timestamp: Date.now() })
	}

	private clearCache(): void {
		this.cache.clear()
	}
}

/**
 * Create a singleton instance
 */
let instance: HybridSearchService | null = null

export function getHybridSearchService(config?: Partial<SearchServiceConfig>): HybridSearchService {
	if (!instance) {
		instance = new HybridSearchService(config)
	}
	return instance
}

export function resetHybridSearchService(): void {
	instance = null
}
