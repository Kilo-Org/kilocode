// kilocode_change - new file
/**
 * Context Aggregator - Type Definitions
 */

import { CodeEntity, EntityRelationship } from "../types"
import { DetectedPattern } from "../pattern-detector"
import { CommitInfo, Contributor } from "../git-analyzer"

/**
 * Aggregated context for a code location
 */
export interface AggregatedContext {
	/** The focal entity (current cursor position) */
	focalEntity?: CodeEntity
	/** Related entities by relationship type */
	relatedEntities: RelatedEntityGroup[]
	/** Detected patterns involving the focal entity */
	patterns: DetectedPattern[]
	/** Recent git history */
	recentHistory: CommitInfo[]
	/** Contributors to the focal file */
	contributors: Contributor[]
	/** Import/dependency context */
	imports: ImportContext[]
	/** Export context (who uses this) */
	exports: ExportContext[]
	/** Similar entities (by name or structure) */
	similarEntities: CodeEntity[]
	/** Total token count estimate */
	tokenCount: number
	/** Whether context was truncated */
	wasTruncated: boolean
}

/**
 * Group of related entities by relationship type
 */
export interface RelatedEntityGroup {
	/** Relationship type */
	relationshipType: EntityRelationship["type"]
	/** Direction of relationship */
	direction: "incoming" | "outgoing"
	/** Related entities */
	entities: CodeEntity[]
	/** Relevance score for this group */
	relevanceScore: number
}

/**
 * Import/dependency context
 */
export interface ImportContext {
	/** Module or file being imported */
	modulePath: string
	/** Imported symbols */
	symbols: string[]
	/** Whether it's a local or external import */
	isExternal: boolean
}

/**
 * Export context (consumers of this entity)
 */
export interface ExportContext {
	/** File that imports this entity */
	consumerPath: string
	/** How the entity is used */
	usageType: "import" | "extends" | "implements" | "calls"
}

/**
 * Options for context aggregation
 */
export interface ContextOptions {
	/** Maximum token budget */
	maxTokens?: number
	/** Maximum depth for relationship traversal */
	maxDepth?: number
	/** Include git history */
	includeHistory?: boolean
	/** Include patterns */
	includePatterns?: boolean
	/** Include similar entities */
	includeSimilar?: boolean
	/** Prioritization strategy */
	prioritization?: PrioritizationStrategy
	/** Entity types to include */
	entityTypes?: CodeEntity["type"][]
	/** Maximum entities per group */
	maxEntitiesPerGroup?: number
}

/**
 * Strategy for prioritizing context
 */
export type PrioritizationStrategy =
	| "proximity" // Closer in graph = higher priority
	| "recency" // Recently modified = higher priority
	| "frequency" // Frequently accessed = higher priority
	| "balanced" // Balanced mix of all factors

/**
 * Interface for the Context Aggregator
 */
export interface IContextAggregator {
	/**
	 * Get aggregated context for a file position
	 */
	getContext(filePath: string, line: number, options?: ContextOptions): Promise<AggregatedContext>

	/**
	 * Get context for a specific entity
	 */
	getEntityContext(entityId: string, options?: ContextOptions): Promise<AggregatedContext>

	/**
	 * Get context for a function (callers, callees, tests)
	 */
	getFunctionContext(functionId: string, options?: ContextOptions): Promise<AggregatedContext>

	/**
	 * Truncate context to fit token budget
	 */
	truncateContext(context: AggregatedContext, maxTokens: number): AggregatedContext

	/**
	 * Format context as structured JSON
	 */
	formatAsJson(context: AggregatedContext): string

	/**
	 * Format context as markdown
	 */
	formatAsMarkdown(context: AggregatedContext): string
}

/**
 * Configuration for the aggregator
 */
export interface AggregatorConfig {
	/** Default max tokens */
	defaultMaxTokens?: number
	/** Default max depth */
	defaultMaxDepth?: number
	/** Default prioritization strategy */
	defaultPrioritization?: PrioritizationStrategy
	/** Tokens per character estimate */
	tokensPerChar?: number
}
