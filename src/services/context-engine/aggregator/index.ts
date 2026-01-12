// kilocode_change - new file
/**
 * Context Aggregator
 *
 * Aggregates context from multiple sources (Knowledge Graph, Git History,
 * Pattern Detection) to provide rich, relevant context for AI assistance.
 */

import { CodeEntity, EntityRelationship } from "../types"
import { IKnowledgeGraph } from "../knowledge-graph"
import { IGitHistoryAnalyzer, CommitInfo, Contributor } from "../git-analyzer"
import { IPatternDetectorService, DetectedPattern } from "../pattern-detector"
import {
	IContextAggregator,
	AggregatedContext,
	ContextOptions,
	AggregatorConfig,
	RelatedEntityGroup,
	ImportContext,
	ExportContext,
	PrioritizationStrategy,
} from "./types"

// Re-export types
export * from "./types"

const DEFAULT_CONFIG: Required<AggregatorConfig> = {
	defaultMaxTokens: 8000,
	defaultMaxDepth: 3,
	defaultPrioritization: "balanced",
	tokensPerChar: 0.25, // Rough estimate: 4 chars per token
}

/**
 * Context Aggregator implementation
 */
export class ContextAggregator implements IContextAggregator {
	private config: Required<AggregatorConfig>
	private knowledgeGraph: IKnowledgeGraph | null = null
	private gitAnalyzer: IGitHistoryAnalyzer | null = null
	private patternDetector: IPatternDetectorService | null = null
	private entityIndex: Map<string, CodeEntity> = new Map()

	constructor(config: Partial<AggregatorConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Set the knowledge graph
	 */
	setKnowledgeGraph(graph: IKnowledgeGraph): void {
		this.knowledgeGraph = graph
	}

	/**
	 * Set the git analyzer
	 */
	setGitAnalyzer(analyzer: IGitHistoryAnalyzer): void {
		this.gitAnalyzer = analyzer
	}

	/**
	 * Set the pattern detector
	 */
	setPatternDetector(detector: IPatternDetectorService): void {
		this.patternDetector = detector
	}

	/**
	 * Index entities for context lookup
	 */
	indexEntities(entities: CodeEntity[]): void {
		for (const entity of entities) {
			this.entityIndex.set(entity.id, entity)
		}
	}

	/**
	 * Get aggregated context for a file position
	 */
	async getContext(filePath: string, line: number, options?: ContextOptions): Promise<AggregatedContext> {
		const opts = this.mergeOptions(options)

		// Find the entity at this position
		const focalEntity = this.findEntityAtPosition(filePath, line)

		if (!focalEntity) {
			return this.createEmptyContext()
		}

		return this.getEntityContext(focalEntity.id, opts)
	}

	/**
	 * Get context for a specific entity
	 */
	async getEntityContext(entityId: string, options?: ContextOptions): Promise<AggregatedContext> {
		const opts = this.mergeOptions(options)
		const focalEntity = this.entityIndex.get(entityId)

		if (!focalEntity) {
			return this.createEmptyContext()
		}

		const context: AggregatedContext = {
			focalEntity,
			relatedEntities: [],
			patterns: [],
			recentHistory: [],
			contributors: [],
			imports: [],
			exports: [],
			similarEntities: [],
			tokenCount: 0,
			wasTruncated: false,
		}

		// Get related entities from knowledge graph
		if (this.knowledgeGraph) {
			context.relatedEntities = await this.getRelatedEntityGroups(entityId, opts.maxDepth!)
			context.imports = await this.getImportContext(entityId)
			context.exports = await this.getExportContext(entityId)
		}

		// Get git history
		if (opts.includeHistory && this.gitAnalyzer?.isAvailable()) {
			context.recentHistory = await this.gitAnalyzer.getFileHistory(focalEntity.filePath, 10)
			context.contributors = await this.gitAnalyzer.getContributors(focalEntity.filePath)
		}

		// Get patterns
		if (opts.includePatterns && this.patternDetector && this.knowledgeGraph) {
			const allEntities = Array.from(this.entityIndex.values())
			// Pre-fetch related entities for pattern detection
			const relatedCache = new Map<string, CodeEntity[]>()
			for (const entity of allEntities) {
				const related = await this.knowledgeGraph.getRelatedEntities(entity.id, 1)
				relatedCache.set(entity.id, related)
			}
			const getRelated = (id: string): CodeEntity[] => relatedCache.get(id) || []
			const patterns = this.patternDetector.detectPatterns(allEntities, getRelated)
			context.patterns = patterns.filter((p) => p.entities.some((e) => e.entityId === entityId))
		}

		// Get similar entities
		if (opts.includeSimilar) {
			context.similarEntities = this.findSimilarEntities(focalEntity, 5)
		}

		// Apply prioritization
		this.applyPrioritization(context, opts.prioritization!)

		// Calculate token count
		context.tokenCount = this.estimateTokenCount(context)

		// Truncate if needed
		if (context.tokenCount > opts.maxTokens!) {
			return this.truncateContext(context, opts.maxTokens!)
		}

		return context
	}

	/**
	 * Get context for a function (callers, callees, tests)
	 */
	async getFunctionContext(functionId: string, options?: ContextOptions): Promise<AggregatedContext> {
		const opts = this.mergeOptions(options)
		const context = await this.getEntityContext(functionId, opts)

		if (!context.focalEntity || context.focalEntity.type !== "function") {
			return context
		}

		// Prioritize callers and callees for functions
		const callers = context.relatedEntities.find(
			(g) => g.relationshipType === "calls" && g.direction === "incoming",
		)
		const callees = context.relatedEntities.find(
			(g) => g.relationshipType === "calls" && g.direction === "outgoing",
		)

		// Boost relevance for callers/callees
		if (callers) callers.relevanceScore *= 1.5
		if (callees) callees.relevanceScore *= 1.5

		// Find related tests
		const testEntities = Array.from(this.entityIndex.values()).filter(
			(e) =>
				e.type === "function" &&
				(e.name.toLowerCase().includes("test") ||
					e.filePath.includes("__tests__") ||
					e.filePath.includes(".spec.") ||
					e.filePath.includes(".test.")),
		)

		// Add tests that might be related to this function
		const relatedTests = testEntities.filter((test) => {
			const testNameLower = test.name.toLowerCase()
			const funcNameLower = context.focalEntity!.name.toLowerCase()
			return testNameLower.includes(funcNameLower) || test.filePath.includes(context.focalEntity!.name)
		})

		if (relatedTests.length > 0) {
			context.relatedEntities.push({
				relationshipType: "uses",
				direction: "incoming",
				entities: relatedTests.slice(0, 5),
				relevanceScore: 0.8,
			})
		}

		// Re-sort by relevance
		context.relatedEntities.sort((a, b) => b.relevanceScore - a.relevanceScore)

		return context
	}

	/**
	 * Truncate context to fit token budget
	 */
	truncateContext(context: AggregatedContext, maxTokens: number): AggregatedContext {
		const truncated = { ...context, wasTruncated: false }
		let currentTokens = this.estimateTokenCount(truncated)

		if (currentTokens <= maxTokens) {
			return truncated
		}

		truncated.wasTruncated = true

		// Remove least relevant items first
		// 1. Remove similar entities
		if (currentTokens > maxTokens) {
			truncated.similarEntities = []
			currentTokens = this.estimateTokenCount(truncated)
		}

		// 2. Reduce history
		if (currentTokens > maxTokens) {
			truncated.recentHistory = truncated.recentHistory.slice(0, 3)
			currentTokens = this.estimateTokenCount(truncated)
		}

		// 3. Reduce contributors
		if (currentTokens > maxTokens) {
			truncated.contributors = truncated.contributors.slice(0, 2)
			currentTokens = this.estimateTokenCount(truncated)
		}

		// 4. Reduce patterns
		if (currentTokens > maxTokens) {
			truncated.patterns = truncated.patterns.slice(0, 2)
			currentTokens = this.estimateTokenCount(truncated)
		}

		// 5. Reduce related entities per group
		if (currentTokens > maxTokens) {
			truncated.relatedEntities = truncated.relatedEntities.map((group) => ({
				...group,
				entities: group.entities.slice(0, 3),
			}))
			currentTokens = this.estimateTokenCount(truncated)
		}

		// 6. Remove lowest relevance groups
		while (currentTokens > maxTokens && truncated.relatedEntities.length > 1) {
			truncated.relatedEntities.pop()
			currentTokens = this.estimateTokenCount(truncated)
		}

		truncated.tokenCount = currentTokens
		return truncated
	}

	/**
	 * Format context as structured JSON
	 */
	formatAsJson(context: AggregatedContext): string {
		return JSON.stringify(
			{
				focal: context.focalEntity
					? {
							name: context.focalEntity.name,
							type: context.focalEntity.type,
							file: context.focalEntity.filePath,
							lines: `${context.focalEntity.startLine}-${context.focalEntity.endLine}`,
						}
					: null,
				related: context.relatedEntities.map((group) => ({
					relationship: group.relationshipType,
					direction: group.direction,
					entities: group.entities.map((e) => ({
						name: e.name,
						type: e.type,
						file: e.filePath,
					})),
				})),
				patterns: context.patterns.map((p) => ({
					type: p.type,
					confidence: p.confidence,
					description: p.description,
				})),
				history: context.recentHistory.slice(0, 5).map((c) => ({
					date: c.date.toISOString(),
					author: c.author,
					message: c.message.substring(0, 100),
				})),
				tokenCount: context.tokenCount,
				truncated: context.wasTruncated,
			},
			null,
			2,
		)
	}

	/**
	 * Format context as markdown
	 */
	formatAsMarkdown(context: AggregatedContext): string {
		const lines: string[] = []

		if (context.focalEntity) {
			lines.push(`## ${context.focalEntity.type}: ${context.focalEntity.name}`)
			lines.push(`File: \`${context.focalEntity.filePath}\``)
			lines.push(`Lines: ${context.focalEntity.startLine}-${context.focalEntity.endLine}`)
			lines.push("")
		}

		if (context.relatedEntities.length > 0) {
			lines.push("### Related Entities")
			for (const group of context.relatedEntities) {
				lines.push(`#### ${group.direction} ${group.relationshipType}`)
				for (const entity of group.entities.slice(0, 5)) {
					lines.push(`- ${entity.type} \`${entity.name}\` (${entity.filePath})`)
				}
				lines.push("")
			}
		}

		if (context.patterns.length > 0) {
			lines.push("### Detected Patterns")
			for (const pattern of context.patterns) {
				lines.push(`- **${pattern.type}** (${pattern.confidence}): ${pattern.description}`)
			}
			lines.push("")
		}

		if (context.recentHistory.length > 0) {
			lines.push("### Recent History")
			for (const commit of context.recentHistory.slice(0, 5)) {
				lines.push(`- ${commit.date.toLocaleDateString()}: ${commit.message.substring(0, 60)}...`)
			}
			lines.push("")
		}

		if (context.wasTruncated) {
			lines.push("*Context was truncated to fit token budget*")
		}

		return lines.join("\n")
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private findEntityAtPosition(filePath: string, line: number): CodeEntity | undefined {
		let bestMatch: CodeEntity | undefined
		let smallestRange = Infinity

		for (const entity of this.entityIndex.values()) {
			if (entity.filePath !== filePath) continue
			if (line < entity.startLine || line > entity.endLine) continue

			const range = entity.endLine - entity.startLine
			if (range < smallestRange) {
				smallestRange = range
				bestMatch = entity
			}
		}

		return bestMatch
	}

	private async getRelatedEntityGroups(entityId: string, _maxDepth: number): Promise<RelatedEntityGroup[]> {
		if (!this.knowledgeGraph) return []

		const groups: Map<string, RelatedEntityGroup> = new Map()
		const edges = await this.knowledgeGraph.getEdges(entityId, "both")

		for (const edge of edges) {
			const isOutgoing = edge.sourceId === entityId
			const relatedId = isOutgoing ? edge.targetId : edge.sourceId
			const relatedEntity = this.entityIndex.get(relatedId)

			if (!relatedEntity) continue

			const key = `${edge.type}-${isOutgoing ? "outgoing" : "incoming"}`

			if (!groups.has(key)) {
				groups.set(key, {
					relationshipType: edge.type,
					direction: isOutgoing ? "outgoing" : "incoming",
					entities: [],
					relevanceScore: this.getRelationshipRelevance(edge.type),
				})
			}

			groups.get(key)!.entities.push(relatedEntity)
		}

		return Array.from(groups.values()).sort((a, b) => b.relevanceScore - a.relevanceScore)
	}

	private getRelationshipRelevance(type: EntityRelationship["type"]): number {
		const relevanceMap: Record<EntityRelationship["type"], number> = {
			calls: 0.9,
			imports: 0.8,
			exports: 0.7,
			extends: 0.85,
			implements: 0.85,
			uses: 0.6,
			defines: 0.5,
			returns: 0.4,
			parameter: 0.4,
			contains: 0.3,
		}
		return relevanceMap[type] || 0.5
	}

	private async getImportContext(entityId: string): Promise<ImportContext[]> {
		if (!this.knowledgeGraph) return []

		const imports: ImportContext[] = []
		const edges = await this.knowledgeGraph.getEdges(entityId, "out")

		for (const edge of edges) {
			if (edge.type === "imports" && edge.sourceId === entityId) {
				const targetEntity = this.entityIndex.get(edge.targetId)
				if (targetEntity) {
					imports.push({
						modulePath: targetEntity.filePath,
						symbols: [targetEntity.name],
						isExternal: targetEntity.filePath.includes("node_modules"),
					})
				}
			}
		}

		return imports
	}

	private async getExportContext(entityId: string): Promise<ExportContext[]> {
		if (!this.knowledgeGraph) return []

		const exports: ExportContext[] = []
		const edges = await this.knowledgeGraph.getEdges(entityId, "in")

		for (const edge of edges) {
			if (edge.targetId === entityId) {
				const sourceEntity = this.entityIndex.get(edge.sourceId)
				if (sourceEntity) {
					exports.push({
						consumerPath: sourceEntity.filePath,
						usageType: edge.type as "import" | "extends" | "implements" | "calls",
					})
				}
			}
		}

		return exports
	}

	private findSimilarEntities(entity: CodeEntity, limit: number): CodeEntity[] {
		const similar: Array<{ entity: CodeEntity; score: number }> = []
		const nameLower = entity.name.toLowerCase()
		const nameWords = this.extractWords(nameLower)

		for (const other of this.entityIndex.values()) {
			if (other.id === entity.id) continue
			if (other.type !== entity.type) continue

			const otherNameLower = other.name.toLowerCase()
			const otherWords = this.extractWords(otherNameLower)
			let score = 0

			// Check for shared words (e.g., "User" in "UserService" and "UserRepository")
			for (const word of nameWords) {
				if (otherWords.includes(word)) {
					score += 0.4
				}
			}

			// Check for similar names
			if (otherNameLower.includes(nameLower) || nameLower.includes(otherNameLower)) {
				score += 0.3
			}

			// Check for same directory
			const entityDir = entity.filePath.substring(0, entity.filePath.lastIndexOf("/"))
			const otherDir = other.filePath.substring(0, other.filePath.lastIndexOf("/"))
			if (entityDir === otherDir) {
				score += 0.2
			}

			if (score > 0) {
				similar.push({ entity: other, score })
			}
		}

		return similar
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((s) => s.entity)
	}

	private extractWords(name: string): string[] {
		// Split camelCase and PascalCase into words
		return name
			.replace(/([a-z])([A-Z])/g, "$1 $2")
			.toLowerCase()
			.split(/\s+/)
			.filter((w) => w.length > 2)
	}

	private applyPrioritization(context: AggregatedContext, strategy: PrioritizationStrategy): void {
		// Sort related entities based on strategy
		switch (strategy) {
			case "proximity":
				// Already sorted by graph distance (default)
				break
			case "recency":
				// Would need async git data - skip for now
				break
			case "frequency":
				// Would need usage data - skip for now
				break
			case "balanced":
			default:
				// Keep default relevance-based sorting
				break
		}
	}

	private estimateTokenCount(context: AggregatedContext): number {
		const json = this.formatAsJson(context)
		return Math.ceil(json.length * this.config.tokensPerChar)
	}

	private createEmptyContext(): AggregatedContext {
		return {
			focalEntity: undefined,
			relatedEntities: [],
			patterns: [],
			recentHistory: [],
			contributors: [],
			imports: [],
			exports: [],
			similarEntities: [],
			tokenCount: 0,
			wasTruncated: false,
		}
	}

	private mergeOptions(options?: ContextOptions): Required<ContextOptions> {
		return {
			maxTokens: options?.maxTokens ?? this.config.defaultMaxTokens,
			maxDepth: options?.maxDepth ?? this.config.defaultMaxDepth,
			includeHistory: options?.includeHistory ?? true,
			includePatterns: options?.includePatterns ?? true,
			includeSimilar: options?.includeSimilar ?? true,
			prioritization: options?.prioritization ?? this.config.defaultPrioritization,
			entityTypes: options?.entityTypes ?? [],
			maxEntitiesPerGroup: options?.maxEntitiesPerGroup ?? 10,
		}
	}
}

/**
 * Create a singleton instance
 */
let instance: ContextAggregator | null = null

export function getContextAggregator(config?: Partial<AggregatorConfig>): ContextAggregator {
	if (!instance) {
		instance = new ContextAggregator(config)
	}
	return instance
}

export function resetContextAggregator(): void {
	instance = null
}
