// kilocode_change - new file
/**
 * Knowledge Graph - Type Definitions
 */

import {
	CodeEntity,
	EntityRelationship,
	RelationshipType,
	EntityType,
	TraversalOptions,
	TraversalResult,
	EntityQuery,
	GraphMetadata,
	SerializedGraph,
} from "../types"

/**
 * Interface for the Knowledge Graph
 */
export interface IKnowledgeGraph {
	// Node operations
	addNode(entity: CodeEntity): Promise<void>
	updateNode(entityId: string, updates: Partial<CodeEntity>): Promise<void>
	removeNode(entityId: string): Promise<void>
	getNode(entityId: string): Promise<CodeEntity | null>
	getAllNodes(): Promise<CodeEntity[]>

	// Edge operations
	addEdge(relationship: EntityRelationship): Promise<void>
	removeEdge(sourceId: string, targetId: string, type: RelationshipType): Promise<void>
	getEdges(entityId: string, direction: "in" | "out" | "both"): Promise<EntityRelationship[]>
	getAllEdges(): Promise<EntityRelationship[]>

	// Traversal
	traverse(startId: string, options: TraversalOptions): Promise<TraversalResult>
	findPath(sourceId: string, targetId: string): Promise<EntityRelationship[]>

	// Queries
	findEntities(query: EntityQuery): Promise<CodeEntity[]>
	getRelatedEntities(entityId: string, depth: number): Promise<CodeEntity[]>

	// Bulk operations
	addNodes(entities: CodeEntity[]): Promise<void>
	addEdges(relationships: EntityRelationship[]): Promise<void>
	removeNodesByFile(filePath: string): Promise<void>

	// Persistence
	save(filePath: string): Promise<void>
	load(filePath: string): Promise<void>
	clear(): Promise<void>

	// Metadata
	getMetadata(): GraphMetadata
	getNodeCount(): number
	getEdgeCount(): number
}

/**
 * Internal edge list structure
 */
export interface EdgeList {
	/** Map of target ID to relationships */
	edges: Map<string, EntityRelationship[]>
}

/**
 * Internal graph storage structure
 */
export interface GraphStorage {
	/** Map of entity ID to entity */
	nodes: Map<string, CodeEntity>
	/** Outgoing edges: source ID -> EdgeList */
	adjacencyList: Map<string, EdgeList>
	/** Incoming edges: target ID -> EdgeList (for reverse lookups) */
	reverseAdjacencyList: Map<string, EdgeList>
	/** Graph metadata */
	metadata: GraphMetadata
}

/**
 * Options for graph initialization
 */
export interface GraphOptions {
	/** Workspace paths to track */
	workspacePaths?: string[]
}
