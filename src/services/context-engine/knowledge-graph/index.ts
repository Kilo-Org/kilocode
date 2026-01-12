// kilocode_change - new file
/**
 * Knowledge Graph
 *
 * In-memory graph database for storing code entities and their relationships.
 * Supports traversal, querying, and persistence.
 */

import * as fs from "fs/promises"
import * as path from "path"
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
	SerializedNode,
	SerializedEdge,
} from "../types"
import { IKnowledgeGraph, GraphStorage, EdgeList, GraphOptions } from "./types"

// Re-export types
export * from "./types"

const GRAPH_VERSION = "1.0.0"

/**
 * Knowledge Graph implementation using adjacency lists
 */
export class KnowledgeGraph implements IKnowledgeGraph {
	private storage: GraphStorage

	constructor(options: GraphOptions = {}) {
		this.storage = {
			nodes: new Map(),
			adjacencyList: new Map(),
			reverseAdjacencyList: new Map(),
			metadata: {
				version: GRAPH_VERSION,
				createdAt: new Date(),
				lastModified: new Date(),
				nodeCount: 0,
				edgeCount: 0,
				workspacePaths: options.workspacePaths || [],
			},
		}
	}

	// ============================================================================
	// Node Operations
	// ============================================================================

	async addNode(entity: CodeEntity): Promise<void> {
		if (this.storage.nodes.has(entity.id)) {
			// Update existing node
			await this.updateNode(entity.id, entity)
			return
		}

		this.storage.nodes.set(entity.id, { ...entity })
		this.storage.metadata.nodeCount++
		this.storage.metadata.lastModified = new Date()
	}

	async updateNode(entityId: string, updates: Partial<CodeEntity>): Promise<void> {
		const existing = this.storage.nodes.get(entityId)
		if (!existing) {
			throw new Error(`Node not found: ${entityId}`)
		}

		this.storage.nodes.set(entityId, { ...existing, ...updates, id: entityId })
		this.storage.metadata.lastModified = new Date()
	}

	async removeNode(entityId: string): Promise<void> {
		if (!this.storage.nodes.has(entityId)) {
			return
		}

		// Remove all edges connected to this node
		const outEdges = this.storage.adjacencyList.get(entityId)
		if (outEdges) {
			for (const [targetId, relationships] of outEdges.edges) {
				this.storage.metadata.edgeCount -= relationships.length
				// Remove from reverse adjacency
				const reverseEdges = this.storage.reverseAdjacencyList.get(targetId)
				if (reverseEdges) {
					reverseEdges.edges.delete(entityId)
				}
			}
			this.storage.adjacencyList.delete(entityId)
		}

		const inEdges = this.storage.reverseAdjacencyList.get(entityId)
		if (inEdges) {
			for (const [sourceId, relationships] of inEdges.edges) {
				this.storage.metadata.edgeCount -= relationships.length
				// Remove from forward adjacency
				const forwardEdges = this.storage.adjacencyList.get(sourceId)
				if (forwardEdges) {
					forwardEdges.edges.delete(entityId)
				}
			}
			this.storage.reverseAdjacencyList.delete(entityId)
		}

		this.storage.nodes.delete(entityId)
		this.storage.metadata.nodeCount--
		this.storage.metadata.lastModified = new Date()
	}

	async getNode(entityId: string): Promise<CodeEntity | null> {
		return this.storage.nodes.get(entityId) || null
	}

	async getAllNodes(): Promise<CodeEntity[]> {
		return Array.from(this.storage.nodes.values())
	}

	// ============================================================================
	// Edge Operations
	// ============================================================================

	async addEdge(relationship: EntityRelationship): Promise<void> {
		const { sourceId, targetId, type } = relationship

		// Add to forward adjacency list
		if (!this.storage.adjacencyList.has(sourceId)) {
			this.storage.adjacencyList.set(sourceId, { edges: new Map() })
		}
		const forwardEdges = this.storage.adjacencyList.get(sourceId)!
		if (!forwardEdges.edges.has(targetId)) {
			forwardEdges.edges.set(targetId, [])
		}

		// Check for duplicate
		const existingForward = forwardEdges.edges.get(targetId)!
		const isDuplicate = existingForward.some(
			(r) => r.sourceId === sourceId && r.targetId === targetId && r.type === type,
		)
		if (isDuplicate) {
			return
		}

		forwardEdges.edges.get(targetId)!.push({ ...relationship })

		// Add to reverse adjacency list
		if (!this.storage.reverseAdjacencyList.has(targetId)) {
			this.storage.reverseAdjacencyList.set(targetId, { edges: new Map() })
		}
		const reverseEdges = this.storage.reverseAdjacencyList.get(targetId)!
		if (!reverseEdges.edges.has(sourceId)) {
			reverseEdges.edges.set(sourceId, [])
		}
		reverseEdges.edges.get(sourceId)!.push({ ...relationship })

		this.storage.metadata.edgeCount++
		this.storage.metadata.lastModified = new Date()
	}

	async removeEdge(sourceId: string, targetId: string, type: RelationshipType): Promise<void> {
		// Remove from forward adjacency
		const forwardEdges = this.storage.adjacencyList.get(sourceId)
		if (forwardEdges && forwardEdges.edges.has(targetId)) {
			const relationships = forwardEdges.edges.get(targetId)!
			const index = relationships.findIndex((r) => r.type === type)
			if (index !== -1) {
				relationships.splice(index, 1)
				this.storage.metadata.edgeCount--
				if (relationships.length === 0) {
					forwardEdges.edges.delete(targetId)
				}
			}
		}

		// Remove from reverse adjacency
		const reverseEdges = this.storage.reverseAdjacencyList.get(targetId)
		if (reverseEdges && reverseEdges.edges.has(sourceId)) {
			const relationships = reverseEdges.edges.get(sourceId)!
			const index = relationships.findIndex((r) => r.type === type)
			if (index !== -1) {
				relationships.splice(index, 1)
				if (relationships.length === 0) {
					reverseEdges.edges.delete(sourceId)
				}
			}
		}

		this.storage.metadata.lastModified = new Date()
	}

	async getEdges(entityId: string, direction: "in" | "out" | "both"): Promise<EntityRelationship[]> {
		const result: EntityRelationship[] = []

		if (direction === "out" || direction === "both") {
			const outEdges = this.storage.adjacencyList.get(entityId)
			if (outEdges) {
				for (const relationships of outEdges.edges.values()) {
					result.push(...relationships)
				}
			}
		}

		if (direction === "in" || direction === "both") {
			const inEdges = this.storage.reverseAdjacencyList.get(entityId)
			if (inEdges) {
				for (const relationships of inEdges.edges.values()) {
					result.push(...relationships)
				}
			}
		}

		return result
	}

	async getAllEdges(): Promise<EntityRelationship[]> {
		const result: EntityRelationship[] = []
		for (const edgeList of this.storage.adjacencyList.values()) {
			for (const relationships of edgeList.edges.values()) {
				result.push(...relationships)
			}
		}
		return result
	}

	// ============================================================================
	// Traversal
	// ============================================================================

	async traverse(startId: string, options: TraversalOptions): Promise<TraversalResult> {
		const { maxDepth, relationshipTypes, entityTypes, limit, direction = "out" } = options

		const visited = new Set<string>()
		const nodes: CodeEntity[] = []
		const edges: EntityRelationship[] = []
		const paths: EntityRelationship[][] = []

		const queue: Array<{ id: string; depth: number; path: EntityRelationship[] }> = [
			{ id: startId, depth: 0, path: [] },
		]

		while (queue.length > 0 && (!limit || nodes.length < limit)) {
			const { id, depth, path } = queue.shift()!

			if (visited.has(id) || depth > maxDepth) {
				continue
			}
			visited.add(id)

			const node = await this.getNode(id)
			if (node) {
				// Filter by entity type if specified
				if (!entityTypes || entityTypes.includes(node.type)) {
					nodes.push(node)
					if (path.length > 0) {
						paths.push([...path])
					}
				}
			}

			// Get edges based on direction
			const nodeEdges = await this.getEdges(id, direction)

			for (const edge of nodeEdges) {
				// Filter by relationship type if specified
				if (relationshipTypes && !relationshipTypes.includes(edge.type)) {
					continue
				}

				edges.push(edge)

				const nextId = direction === "in" ? edge.sourceId : edge.targetId
				if (!visited.has(nextId)) {
					queue.push({
						id: nextId,
						depth: depth + 1,
						path: [...path, edge],
					})
				}
			}
		}

		return { nodes, edges, paths }
	}

	async findPath(sourceId: string, targetId: string): Promise<EntityRelationship[]> {
		if (sourceId === targetId) {
			return []
		}

		const visited = new Set<string>()
		const queue: Array<{ id: string; path: EntityRelationship[] }> = [{ id: sourceId, path: [] }]

		while (queue.length > 0) {
			const { id, path } = queue.shift()!

			if (visited.has(id)) {
				continue
			}
			visited.add(id)

			const edges = await this.getEdges(id, "out")

			for (const edge of edges) {
				const newPath = [...path, edge]

				if (edge.targetId === targetId) {
					return newPath
				}

				if (!visited.has(edge.targetId)) {
					queue.push({ id: edge.targetId, path: newPath })
				}
			}
		}

		return [] // No path found
	}

	// ============================================================================
	// Queries
	// ============================================================================

	async findEntities(query: EntityQuery): Promise<CodeEntity[]> {
		const { name, types, filePath, parentId, limit } = query
		const results: CodeEntity[] = []

		for (const entity of this.storage.nodes.values()) {
			// Filter by name (supports wildcards)
			if (name) {
				const pattern = name.replace(/\*/g, ".*")
				const regex = new RegExp(`^${pattern}$`, "i")
				if (!regex.test(entity.name)) {
					continue
				}
			}

			// Filter by types
			if (types && !types.includes(entity.type)) {
				continue
			}

			// Filter by file path (supports wildcards)
			if (filePath) {
				const pattern = filePath.replace(/\*/g, ".*")
				const regex = new RegExp(pattern, "i")
				if (!regex.test(entity.filePath)) {
					continue
				}
			}

			// Filter by parent ID
			if (parentId && entity.parentId !== parentId) {
				continue
			}

			results.push(entity)

			if (limit && results.length >= limit) {
				break
			}
		}

		return results
	}

	async getRelatedEntities(entityId: string, depth: number): Promise<CodeEntity[]> {
		const result = await this.traverse(entityId, {
			maxDepth: depth,
			direction: "both",
		})
		return result.nodes.filter((n) => n.id !== entityId)
	}

	// ============================================================================
	// Bulk Operations
	// ============================================================================

	async addNodes(entities: CodeEntity[]): Promise<void> {
		for (const entity of entities) {
			await this.addNode(entity)
		}
	}

	async addEdges(relationships: EntityRelationship[]): Promise<void> {
		for (const relationship of relationships) {
			await this.addEdge(relationship)
		}
	}

	async removeNodesByFile(filePath: string): Promise<void> {
		const normalizedPath = path.normalize(filePath)
		const nodesToRemove: string[] = []

		for (const [id, entity] of this.storage.nodes) {
			if (path.normalize(entity.filePath) === normalizedPath) {
				nodesToRemove.push(id)
			}
		}

		for (const id of nodesToRemove) {
			await this.removeNode(id)
		}
	}

	// ============================================================================
	// Persistence
	// ============================================================================

	async save(filePath: string): Promise<void> {
		// Collect unique edges (only from forward adjacency to avoid duplicates)
		const uniqueEdges: EntityRelationship[] = []
		const seenEdges = new Set<string>()

		for (const edgeList of this.storage.adjacencyList.values()) {
			for (const relationships of edgeList.edges.values()) {
				for (const rel of relationships) {
					const edgeKey = `${rel.sourceId}:${rel.targetId}:${rel.type}`
					if (!seenEdges.has(edgeKey)) {
						seenEdges.add(edgeKey)
						uniqueEdges.push(rel)
					}
				}
			}
		}

		const serialized: SerializedGraph = {
			version: GRAPH_VERSION,
			metadata: {
				...this.storage.metadata,
				lastModified: new Date(),
			},
			nodes: Array.from(this.storage.nodes.entries()).map(([id, data]) => ({
				id,
				data,
			})),
			edges: uniqueEdges.map((e) => ({
				source: e.sourceId,
				target: e.targetId,
				relationship: e,
			})),
		}

		// Ensure directory exists
		const dir = path.dirname(filePath)
		await fs.mkdir(dir, { recursive: true })

		// Write to file
		await fs.writeFile(filePath, JSON.stringify(serialized, null, 2), "utf-8")
	}

	async load(filePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			const serialized: SerializedGraph = JSON.parse(content)

			// Clear existing data
			await this.clear()

			// Restore metadata
			this.storage.metadata = {
				...serialized.metadata,
				createdAt: new Date(serialized.metadata.createdAt),
				lastModified: new Date(serialized.metadata.lastModified),
				nodeCount: 0,
				edgeCount: 0,
			}

			// Restore nodes
			for (const { id, data } of serialized.nodes) {
				this.storage.nodes.set(id, data)
				this.storage.metadata.nodeCount++
			}

			// Restore edges directly without using addEdge to avoid double counting
			for (const { relationship } of serialized.edges) {
				const { sourceId, targetId } = relationship

				// Add to forward adjacency list
				if (!this.storage.adjacencyList.has(sourceId)) {
					this.storage.adjacencyList.set(sourceId, { edges: new Map() })
				}
				const forwardEdges = this.storage.adjacencyList.get(sourceId)!
				if (!forwardEdges.edges.has(targetId)) {
					forwardEdges.edges.set(targetId, [])
				}
				forwardEdges.edges.get(targetId)!.push({ ...relationship })

				// Add to reverse adjacency list
				if (!this.storage.reverseAdjacencyList.has(targetId)) {
					this.storage.reverseAdjacencyList.set(targetId, { edges: new Map() })
				}
				const reverseEdges = this.storage.reverseAdjacencyList.get(targetId)!
				if (!reverseEdges.edges.has(sourceId)) {
					reverseEdges.edges.set(sourceId, [])
				}
				reverseEdges.edges.get(sourceId)!.push({ ...relationship })

				this.storage.metadata.edgeCount++
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// File doesn't exist, start fresh
				return
			}
			throw error
		}
	}

	async clear(): Promise<void> {
		this.storage.nodes.clear()
		this.storage.adjacencyList.clear()
		this.storage.reverseAdjacencyList.clear()
		this.storage.metadata.nodeCount = 0
		this.storage.metadata.edgeCount = 0
		this.storage.metadata.lastModified = new Date()
	}

	// ============================================================================
	// Metadata
	// ============================================================================

	getMetadata(): GraphMetadata {
		return { ...this.storage.metadata }
	}

	getNodeCount(): number {
		return this.storage.nodes.size
	}

	getEdgeCount(): number {
		return this.storage.metadata.edgeCount
	}
}

/**
 * Create a singleton instance
 */
let instance: KnowledgeGraph | null = null

export function getKnowledgeGraph(options?: GraphOptions): KnowledgeGraph {
	if (!instance) {
		instance = new KnowledgeGraph(options)
	}
	return instance
}

export function resetKnowledgeGraph(): void {
	instance = null
}
