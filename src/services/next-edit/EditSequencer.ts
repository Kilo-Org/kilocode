/**
 * EditSequencer Service
 *
 * Orders edit suggestions based on dependencies and priorities.
 * Resolves dependencies and detects circular dependencies.
 *
 * @module EditSequencer
 */

import type { EditSuggestion, EditSequence } from "./types"
import { createDependencyNotMetError } from "./errors"
import { generateUUID } from "./utils"

// ============================================================================
// Logging Utilities
// ============================================================================

/**
 * Logs a message with timestamp
 */
function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
	const timestamp = new Date().toISOString()
	const logMessage = `[${timestamp}] [EditSequencer] [${level.toUpperCase()}] ${message}`

	if (level === "error") {
		console.error(logMessage, data)
	} else if (level === "warn") {
		console.warn(logMessage, data)
	} else {
		console.log(logMessage, data)
	}
}

// ============================================================================
// Interface
// ============================================================================

/**
 * Result of edit sequencing
 */
export interface SequencingResult {
	/** Ordered list of edit IDs in execution order */
	orderedEditIds: string[]
	/** Number of sequences created */
	sequenceCount: number
	/** Circular dependencies detected (if any) */
	circularDependencies: Array<{
		editId: string
		dependencyCycle: string[]
	}>
}

/**
 * Interface for EditSequencer service
 */
export interface IEditSequencer {
	/**
	 * Orders edits based on dependencies and priorities
	 *
	 * @param edits - Array of edit suggestions to sequence
	 * @returns Promise with sequencing result
	 */
	sequenceEdits(edits: EditSuggestion[]): Promise<SequencingResult>

	/**
	 * Resolves dependencies between edits
	 *
	 * @param edits - Array of edit suggestions
	 * @returns Promise with resolved dependencies
	 */
	resolveDependencies(edits: EditSuggestion[]): Promise<Map<string, string[]>>

	/**
	 * Detects circular dependencies in edit graph
	 *
	 * @param edits - Array of edit suggestions
	 * @returns Array of circular dependency cycles
	 */
	detectCircularDependencies(edits: EditSuggestion[]): Array<{
		editId: string
		dependencyCycle: string[]
	}>

	/**
	 * Groups edits into sequences based on dependencies
	 *
	 * @param edits - Array of edit suggestions
	 * @param sessionId - Parent session ID
	 * @returns Promise with generated sequences
	 */
	generateSequences(edits: EditSuggestion[], sessionId: string): Promise<EditSequence[]>

	/**
	 * Validates that all dependencies are met for an edit
	 *
	 * @param edit - The edit to validate
	 * @param completedEditIds - IDs of completed edits
	 * @returns true if all dependencies are met
	 */
	validateDependenciesMet(edit: EditSuggestion, completedEditIds: string[]): boolean
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * EditSequencer implementation
 */
export class EditSequencer implements IEditSequencer {
	async sequenceEdits(edits: EditSuggestion[]): Promise<SequencingResult> {
		try {
			// Validate input
			if (!edits || edits.length === 0) {
				log("warn", "No edits to sequence")
				return {
					orderedEditIds: [],
					sequenceCount: 0,
					circularDependencies: [],
				}
			}

			log("info", `Sequencing ${edits.length} edits`)

			// Build dependency graph
			const graph = this.buildDependencyGraph(edits)
			log("info", "Dependency graph built", { nodeCount: graph.size })

			// Detect circular dependencies
			const cycles = this.detectCycles(graph)
			const circularDependencies = cycles.map((cycle) => ({
				editId: cycle[0],
				dependencyCycle: cycle,
			}))

			if (cycles.length > 0) {
				log("warn", `Detected ${cycles.length} circular dependencies`, { cycles })
			}

			// Perform topological sort
			const orderedEditIds = this.topologicalSort(graph)
			log("info", `Topological sort completed`, { orderedCount: orderedEditIds.length })

			// Group into sequences
			const sequences = this.groupIntoSequences(
				edits.filter((edit) => orderedEditIds.includes(edit.id)),
				"temp-session",
			)

			log("info", `Generated ${sequences.length} sequences`)

			return {
				orderedEditIds,
				sequenceCount: sequences.length,
				circularDependencies,
			}
		} catch (error) {
			log("error", "Failed to sequence edits", error)
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to sequence edits: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	async resolveDependencies(edits: EditSuggestion[]): Promise<Map<string, string[]>> {
		try {
			if (!edits) {
				return new Map()
			}

			const dependencyMap = new Map<string, string[]>()

			for (const edit of edits) {
				dependencyMap.set(edit.id, edit.dependencies || [])
			}

			return dependencyMap
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to resolve dependencies: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	detectCircularDependencies(edits: EditSuggestion[]): Array<{ editId: string; dependencyCycle: string[] }> {
		if (!edits || edits.length === 0) {
			return []
		}

		const graph = this.buildDependencyGraph(edits)
		const cycles = this.detectCycles(graph)

		return cycles.map((cycle) => ({
			editId: cycle[0],
			dependencyCycle: cycle,
		}))
	}

	async generateSequences(edits: EditSuggestion[], sessionId: string): Promise<EditSequence[]> {
		try {
			if (!edits) {
				throw new Error("Edits are required. Please provide edit suggestions to sequence.")
			}
			if (!sessionId) {
				throw new Error("Session ID is required")
			}

			// First, sequence the edits
			const result = await this.sequenceEdits(edits)

			// Get ordered edits
			const editMap = new Map(edits.map((edit) => [edit.id, edit]))
			const orderedEdits = result.orderedEditIds
				.map((id) => editMap.get(id))
				.filter((edit): edit is EditSuggestion => edit !== undefined)

			// Group into sequences
			return this.groupIntoSequences(orderedEdits, sessionId)
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(`Failed to generate sequences: ${error instanceof Error ? error.message : "Unknown error"}`)
		}
	}

	validateDependenciesMet(edit: EditSuggestion, completedEditIds: string[]): boolean {
		try {
			if (!edit) {
				throw new Error("Edit is required")
			}
			if (!completedEditIds) {
				completedEditIds = []
			}

			// If no dependencies, they're met
			if (!edit.dependencies || edit.dependencies.length === 0) {
				return true
			}

			// Check if all dependencies are completed
			return edit.dependencies.every((depId) => completedEditIds.includes(depId))
		} catch (error) {
			if (error instanceof Error && error.name === "NextEditError") {
				throw error
			}
			throw new Error(
				`Failed to validate dependencies for edit ${edit?.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
			)
		}
	}

	// ============================================================================
	// Private Helper Methods
	// ============================================================================

	/**
	 * Builds a dependency graph from edits
	 */
	private buildDependencyGraph(edits: EditSuggestion[]): Map<string, string[]> {
		const graph = new Map<string, string[]>()

		for (const edit of edits) {
			graph.set(edit.id, edit.dependencies || [])
		}

		return graph
	}

	/**
	 * Performs topological sort on dependency graph
	 * Uses Kahn's algorithm
	 */
	private topologicalSort(graph: Map<string, string[]>): string[] {
		const inDegree = new Map<string, number>()
		const reverseGraph = new Map<string, string[]>() // node -> nodes that depend on it
		const queue: string[] = []
		const result: string[] = []

		// Initialize
		for (const [node] of graph) {
			inDegree.set(node, 0)
			reverseGraph.set(node, [])
		}

		// Build reverse graph and calculate in-degree
		for (const [node, dependencies] of graph) {
			for (const dep of dependencies) {
				// node depends on dep
				// So node's in-degree increases
				inDegree.set(node, (inDegree.get(node) || 0) + 1)

				// Add node to dep's neighbors in reverse graph
				const neighbors = reverseGraph.get(dep) || []
				neighbors.push(node)
				reverseGraph.set(dep, neighbors)
			}
		}

		// Find nodes with no incoming edges
		for (const [node, degree] of inDegree) {
			if (degree === 0) {
				queue.push(node)
			}
		}

		// Process nodes
		while (queue.length > 0) {
			const node = queue.shift()!
			result.push(node)

			// Reduce in-degree of neighbors (nodes that depend on this node)
			const neighbors = reverseGraph.get(node) || []
			for (const neighbor of neighbors) {
				const newDegree = (inDegree.get(neighbor) || 0) - 1
				inDegree.set(neighbor, newDegree)

				if (newDegree === 0) {
					queue.push(neighbor)
				}
			}
		}

		return result
	}

	/**
	 * Detects cycles in a dependency graph using DFS
	 */
	private detectCycles(graph: Map<string, string[]>): string[][] {
		const visited = new Set<string>()
		const recursionStack = new Set<string>()
		const cycles: string[][] = []

		const dfs = (node: string, path: string[]): void => {
			visited.add(node)
			recursionStack.add(node)

			const neighbors = graph.get(node) || []
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					dfs(neighbor, [...path, neighbor])
				} else if (recursionStack.has(neighbor)) {
					// Found a cycle
					const cycleStart = path.indexOf(neighbor)
					if (cycleStart !== -1) {
						cycles.push([...path.slice(cycleStart), neighbor])
					}
				}
			}

			recursionStack.delete(node)
		}

		for (const [node] of graph) {
			if (!visited.has(node)) {
				dfs(node, [node])
			}
		}

		return cycles
	}

	/**
	 * Groups independent edits into sequences
	 */
	private groupIntoSequences(orderedEdits: EditSuggestion[], sessionId: string): EditSequence[] {
		const sequences: EditSequence[] = []
		let currentSequence: EditSequence | null = null
		let currentDependencies: string[] = []

		for (const edit of orderedEdits) {
			// If edit has dependencies that aren't in current sequence, start new sequence
			if (
				edit.dependencies &&
				edit.dependencies.length > 0 &&
				!edit.dependencies.every((dep) => currentDependencies.includes(dep))
			) {
				if (currentSequence) {
					sequences.push(currentSequence)
				}
				currentSequence = null
				currentDependencies = []
			}

			// Create new sequence if needed
			if (!currentSequence) {
				currentSequence = {
					id: generateUUID(),
					sessionId,
					name: `Sequence ${sequences.length + 1}`,
					editIds: [],
					createdAt: new Date(),
					estimatedTime: 0,
					dependencies: [...currentDependencies],
				}
			}

			// Add edit to current sequence
			currentSequence.editIds.push(edit.id)
			currentDependencies.push(edit.id)
			currentSequence.estimatedTime += 30 // 30 seconds per edit
		}

		// Add last sequence
		if (currentSequence) {
			sequences.push(currentSequence)
		}

		return sequences
	}
}
