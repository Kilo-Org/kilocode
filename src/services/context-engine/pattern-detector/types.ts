// kilocode_change - new file
/**
 * Pattern Detector - Type Definitions
 */

import { CodeEntity, RelationshipType } from "../types"

/**
 * Types of architectural patterns that can be detected
 */
export type PatternType =
	| "repository"
	| "factory"
	| "singleton"
	| "service"
	| "controller"
	| "middleware"
	| "observer"
	| "strategy"
	| "decorator"
	| "adapter"
	| "facade"
	| "mvc"
	| "mvvm"

/**
 * Confidence level for pattern detection
 */
export type ConfidenceLevel = "high" | "medium" | "low"

/**
 * A detected pattern instance
 */
export interface DetectedPattern {
	/** Type of pattern detected */
	type: PatternType
	/** Confidence level of the detection */
	confidence: ConfidenceLevel
	/** Numeric confidence score (0-1) */
	confidenceScore: number
	/** Entities involved in this pattern */
	entities: PatternEntity[]
	/** File paths where the pattern is implemented */
	filePaths: string[]
	/** Human-readable description of the pattern */
	description: string
	/** Relationships between entities in the pattern */
	relationships: PatternRelationship[]
}

/**
 * An entity that participates in a pattern
 */
export interface PatternEntity {
	/** Entity ID from the knowledge graph */
	entityId: string
	/** Role in the pattern (e.g., "repository", "interface", "implementation") */
	role: string
	/** Entity name */
	name: string
	/** File path */
	filePath: string
}

/**
 * A relationship within a pattern
 */
export interface PatternRelationship {
	/** Source entity ID */
	sourceId: string
	/** Target entity ID */
	targetId: string
	/** Type of relationship */
	type: RelationshipType
	/** Role description */
	roleDescription: string
}

/**
 * Interface for individual pattern detectors
 */
export interface IPatternDetector {
	/** Pattern type this detector handles */
	readonly patternType: PatternType

	/**
	 * Detect patterns in the given entities
	 * @param entities Entities to analyze
	 * @param getRelatedEntities Function to get related entities from the graph
	 */
	detect(
		entities: CodeEntity[],
		getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[]
}

/**
 * Interface for the Pattern Detector Service
 */
export interface IPatternDetectorService {
	/**
	 * Register a pattern detector
	 */
	registerDetector(detector: IPatternDetector): void

	/**
	 * Detect all patterns in the given entities
	 */
	detectPatterns(
		entities: CodeEntity[],
		getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[]

	/**
	 * Detect specific pattern types
	 */
	detectPatternTypes(
		patternTypes: PatternType[],
		entities: CodeEntity[],
		getRelatedEntities: (entityId: string, depth?: number) => CodeEntity[],
	): DetectedPattern[]

	/**
	 * Get all registered pattern types
	 */
	getRegisteredPatterns(): PatternType[]
}

/**
 * Options for pattern detection
 */
export interface PatternDetectorOptions {
	/** Minimum confidence score to include (0-1) */
	minConfidence?: number
	/** Pattern types to detect (empty = all) */
	patternTypes?: PatternType[]
}
