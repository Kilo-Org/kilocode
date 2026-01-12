// kilocode_change - new file
/**
 * Hybrid Search Service - Type Definitions
 */

import { CodeEntity, EntityRelationship } from "../types"

/**
 * A search result with relevance scoring
 */
export interface SearchResult {
	/** The matched entity */
	entity: CodeEntity
	/** Overall relevance score (0-1) */
	score: number
	/** Individual score components */
	scoreBreakdown: ScoreBreakdown
	/** Relationship path from query context (if any) */
	relationshipPath?: RelationshipPath
	/** Snippet of matching content */
	snippet?: string
	/** Match highlights */
	highlights?: MatchHighlight[]
}

/**
 * Breakdown of how the score was calculated
 */
export interface ScoreBreakdown {
	/** Text/semantic similarity score */
	textSimilarity: number
	/** Graph relationship score */
	graphRelationship: number
	/** Recency boost */
	recencyBoost: number
	/** Frequency/hotspot boost */
	frequencyBoost: number
	/** Pattern relevance boost */
	patternBoost: number
}

/**
 * Path through the knowledge graph
 */
export interface RelationshipPath {
	/** Entities in the path */
	entities: string[]
	/** Relationships connecting them */
	relationships: EntityRelationship[]
	/** Total path length */
	length: number
}

/**
 * A highlighted match in content
 */
export interface MatchHighlight {
	/** Start position */
	start: number
	/** End position */
	end: number
	/** Matched text */
	text: string
}

/**
 * Options for search queries
 */
export interface SearchOptions {
	/** Maximum number of results */
	limit?: number
	/** Minimum score threshold (0-1) */
	minScore?: number
	/** Filter by entity types */
	entityTypes?: CodeEntity["type"][]
	/** Filter by file patterns (glob) */
	filePatterns?: string[]
	/** Exclude file patterns (glob) */
	excludePatterns?: string[]
	/** Filter by directory */
	directory?: string
	/** Context entity ID for graph-based boosting */
	contextEntityId?: string
	/** Include relationship paths in results */
	includeRelationshipPaths?: boolean
	/** Weight configuration for scoring */
	weights?: SearchWeights
}

/**
 * Weights for different scoring components
 */
export interface SearchWeights {
	/** Weight for text similarity (default: 0.4) */
	textSimilarity?: number
	/** Weight for graph relationships (default: 0.3) */
	graphRelationship?: number
	/** Weight for recency (default: 0.15) */
	recency?: number
	/** Weight for frequency (default: 0.1) */
	frequency?: number
	/** Weight for pattern relevance (default: 0.05) */
	pattern?: number
}

/**
 * Interface for the Hybrid Search Service
 */
export interface IHybridSearchService {
	/**
	 * Search for entities matching a query
	 */
	search(query: string, options?: SearchOptions): Promise<SearchResult[]>

	/**
	 * Search with a context entity for relationship boosting
	 */
	searchWithContext(query: string, contextEntityId: string, options?: SearchOptions): Promise<SearchResult[]>

	/**
	 * Find entities related to a given entity
	 */
	findRelated(entityId: string, options?: SearchOptions): Promise<SearchResult[]>

	/**
	 * Get entities by type with optional filtering
	 */
	getByType(entityType: CodeEntity["type"], options?: SearchOptions): Promise<SearchResult[]>
}

/**
 * Configuration for the search service
 */
export interface SearchServiceConfig {
	/** Default weights for scoring */
	defaultWeights?: SearchWeights
	/** Default result limit */
	defaultLimit?: number
	/** Default minimum score */
	defaultMinScore?: number
	/** Enable caching */
	enableCache?: boolean
	/** Cache TTL in milliseconds */
	cacheTTL?: number
}
