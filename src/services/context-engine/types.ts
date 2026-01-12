// kilocode_change - new file
/**
 * Advanced Context Engine - Shared Type Definitions
 *
 * This module contains all shared types used across the Context Engine components.
 */

// ============================================================================
// Entity Types
// ============================================================================

/**
 * Types of code entities that can be extracted from source files
 */
export type EntityType =
	| "function"
	| "class"
	| "interface"
	| "type"
	| "variable"
	| "import"
	| "export"
	| "method"
	| "property"
	| "enum"
	| "namespace"
	| "module"

/**
 * A code entity represents a named element in source code
 */
export interface CodeEntity {
	/** Unique identifier for this entity */
	id: string
	/** Name of the entity */
	name: string
	/** Type of entity */
	type: EntityType
	/** Absolute path to the file containing this entity */
	filePath: string
	/** Starting line number (1-indexed) */
	startLine: number
	/** Ending line number (1-indexed) */
	endLine: number
	/** Starting column (0-indexed) */
	startColumn: number
	/** Ending column (0-indexed) */
	endColumn: number
	/** Function/method signature if applicable */
	signature?: string
	/** Documentation string if available */
	docstring?: string
	/** Parent entity ID (for nested entities like methods in classes) */
	parentId?: string
	/** Additional metadata */
	metadata: Record<string, unknown>
}

// ============================================================================
// Relationship Types
// ============================================================================

/**
 * Types of relationships between code entities
 */
export type RelationshipType =
	| "calls" // Function A calls function B
	| "imports" // Module A imports from module B
	| "exports" // Module A exports entity B
	| "extends" // Class A extends class B
	| "implements" // Class A implements interface B
	| "uses" // Entity A uses entity B (general reference)
	| "defines" // File/module defines entity
	| "returns" // Function returns type
	| "parameter" // Function has parameter of type
	| "contains" // Class/module contains entity

/**
 * A relationship between two code entities
 */
export interface EntityRelationship {
	/** ID of the source entity */
	sourceId: string
	/** ID of the target entity */
	targetId: string
	/** Type of relationship */
	type: RelationshipType
	/** Additional metadata about the relationship */
	metadata?: Record<string, unknown>
}

// ============================================================================
// Parse Result Types
// ============================================================================

/**
 * Error that occurred during parsing
 */
export interface ParseError {
	/** Error message */
	message: string
	/** Line number where error occurred */
	line?: number
	/** Column where error occurred */
	column?: number
	/** Original error if available */
	originalError?: Error
}

/**
 * Result of parsing a source file
 */
export interface ParseResult {
	/** Path to the parsed file */
	filePath: string
	/** Language of the file */
	language: string
	/** Extracted code entities */
	entities: CodeEntity[]
	/** Relationships between entities */
	relationships: EntityRelationship[]
	/** Any errors that occurred during parsing */
	errors: ParseError[]
	/** Whether parsing was successful */
	success: boolean
}

// ============================================================================
// Graph Types
// ============================================================================

/**
 * Options for graph traversal
 */
export interface TraversalOptions {
	/** Maximum depth to traverse */
	maxDepth: number
	/** Filter by relationship types */
	relationshipTypes?: RelationshipType[]
	/** Filter by entity types */
	entityTypes?: EntityType[]
	/** Maximum number of results */
	limit?: number
	/** Direction of traversal */
	direction?: "in" | "out" | "both"
}

/**
 * Result of a graph traversal
 */
export interface TraversalResult {
	/** Nodes found during traversal */
	nodes: CodeEntity[]
	/** Edges traversed */
	edges: EntityRelationship[]
	/** Paths from start to each node */
	paths: EntityRelationship[][]
}

/**
 * Query for finding entities
 */
export interface EntityQuery {
	/** Filter by name (supports wildcards) */
	name?: string
	/** Filter by entity types */
	types?: EntityType[]
	/** Filter by file path (supports wildcards) */
	filePath?: string
	/** Filter by parent ID */
	parentId?: string
	/** Maximum results */
	limit?: number
}

// ============================================================================
// Graph Storage Types
// ============================================================================

/**
 * Metadata about the knowledge graph
 */
export interface GraphMetadata {
	/** Version of the graph format */
	version: string
	/** When the graph was created */
	createdAt: Date
	/** When the graph was last modified */
	lastModified: Date
	/** Number of nodes in the graph */
	nodeCount: number
	/** Number of edges in the graph */
	edgeCount: number
	/** Workspace paths indexed */
	workspacePaths: string[]
}

/**
 * Serialized node for persistence
 */
export interface SerializedNode {
	id: string
	data: CodeEntity
}

/**
 * Serialized edge for persistence
 */
export interface SerializedEdge {
	source: string
	target: string
	relationship: EntityRelationship
}

/**
 * Serialized graph for persistence
 */
export interface SerializedGraph {
	version: string
	metadata: GraphMetadata
	nodes: SerializedNode[]
	edges: SerializedEdge[]
}
