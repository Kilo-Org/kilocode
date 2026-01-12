// kilocode_change - new file
/**
 * Property-Based Tests for Knowledge Graph
 *
 * Feature: advanced-context-engine
 * Property 2: Relationship Creation Correctness
 * Property 3: Graph Traversal Completeness
 * Property 5: Graph Persistence Round-Trip
 */

import * as fc from "fast-check"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { KnowledgeGraph } from "../index"
import { CodeEntity, EntityRelationship, RelationshipType } from "../../types"

describe("KnowledgeGraph Property Tests", () => {
	let graph: KnowledgeGraph
	let tempDir: string

	beforeEach(async () => {
		graph = new KnowledgeGraph()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kg-prop-test-"))
	})

	afterEach(async () => {
		await graph.clear()
		try {
			await fs.rm(tempDir, { recursive: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	// Arbitraries
	const entityType = fc.constantFrom(
		"function",
		"class",
		"interface",
		"type",
		"variable",
		"method",
		"property",
	) as fc.Arbitrary<CodeEntity["type"]>

	const relationshipType = fc.constantFrom(
		"calls",
		"imports",
		"exports",
		"extends",
		"implements",
		"uses",
		"defines",
		"contains",
	) as fc.Arbitrary<RelationshipType>

	// Generate entities with guaranteed unique IDs using index
	const uniqueEntities = (count: number) =>
		fc
			.tuple(
				fc.array(fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]{2,10}$/), { minLength: count, maxLength: count }),
				fc.array(entityType, { minLength: count, maxLength: count }),
			)
			.map(([names, types]) =>
				names.map((name, index) => ({
					id: `entity-${index}-${name}`,
					name: `${name}${index}`,
					type: types[index],
					filePath: `/test/file${index}.ts`,
					startLine: 1 + index * 10,
					endLine: 10 + index * 10,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				})),
			)

	describe("Property 2: Relationship Creation Correctness", () => {
		it("should create edges with correct source and target", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(2), relationshipType, async (entities, relType) => {
					await graph.clear()
					const [source, target] = entities
					await graph.addNode(source)
					await graph.addNode(target)

					const relationship: EntityRelationship = {
						sourceId: source.id,
						targetId: target.id,
						type: relType,
					}
					await graph.addEdge(relationship)

					const outEdges = await graph.getEdges(source.id, "out")
					const inEdges = await graph.getEdges(target.id, "in")

					expect(outEdges.some((e) => e.targetId === target.id && e.type === relType)).toBe(true)
					expect(inEdges.some((e) => e.sourceId === source.id && e.type === relType)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("should maintain edge count correctly", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					await graph.clear()
					for (const entity of entities) {
						await graph.addNode(entity)
					}

					// Add edges between consecutive entities
					for (let i = 0; i < entities.length - 1; i++) {
						await graph.addEdge({
							sourceId: entities[i].id,
							targetId: entities[i + 1].id,
							type: "calls",
						})
					}

					expect(graph.getEdgeCount()).toBe(entities.length - 1)
				}),
				{ numRuns: 100 },
			)
		})

		it("should not create duplicate edges", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(2), relationshipType, async (entities, relType) => {
					await graph.clear()
					const [source, target] = entities
					await graph.addNode(source)
					await graph.addNode(target)

					const relationship: EntityRelationship = {
						sourceId: source.id,
						targetId: target.id,
						type: relType,
					}

					await graph.addEdge(relationship)
					await graph.addEdge(relationship)
					await graph.addEdge(relationship)

					expect(graph.getEdgeCount()).toBe(1)
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Property 3: Graph Traversal Completeness", () => {
		it("should find all reachable nodes within depth limit", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (depth) => {
					await graph.clear()
					// Create a chain: A -> B -> C -> D
					const nodes = ["A", "B", "C", "D"].map((id, index) => ({
						id: `node-${id}`,
						name: `node${id}`,
						type: "function" as const,
						filePath: `/test/file${index}.ts`,
						startLine: 1,
						endLine: 10,
						startColumn: 0,
						endColumn: 0,
						metadata: {},
					}))

					for (const node of nodes) {
						await graph.addNode(node)
					}

					for (let i = 0; i < nodes.length - 1; i++) {
						await graph.addEdge({
							sourceId: nodes[i].id,
							targetId: nodes[i + 1].id,
							type: "calls",
						})
					}

					const result = await graph.traverse("node-A", { maxDepth: depth })

					// Should find nodes up to depth
					const expectedCount = Math.min(depth + 1, nodes.length)
					expect(result.nodes.length).toBe(expectedCount)
				}),
				{ numRuns: 100 },
			)
		})

		it("should filter by relationship type during traversal", async () => {
			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom("calls", "uses", "imports") as fc.Arbitrary<RelationshipType>,
					async (filterType) => {
						await graph.clear()
						const nodes = ["A", "B", "C"].map((id, index) => ({
							id: `node-${id}`,
							name: `node${id}`,
							type: "function" as const,
							filePath: `/test/file${index}.ts`,
							startLine: 1,
							endLine: 10,
							startColumn: 0,
							endColumn: 0,
							metadata: {},
						}))

						for (const node of nodes) {
							await graph.addNode(node)
						}

						// A -> B with filterType, A -> C with different type
						await graph.addEdge({ sourceId: "node-A", targetId: "node-B", type: filterType })
						const otherType: RelationshipType = filterType === "calls" ? "uses" : "calls"
						await graph.addEdge({ sourceId: "node-A", targetId: "node-C", type: otherType })

						const result = await graph.traverse("node-A", {
							maxDepth: 2,
							relationshipTypes: [filterType],
						})

						// Should only find A and B (connected by filterType)
						expect(result.nodes.map((n) => n.id)).toContain("node-A")
						expect(result.nodes.map((n) => n.id)).toContain("node-B")
						expect(result.nodes.map((n) => n.id)).not.toContain("node-C")
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should find shortest path between connected nodes", async () => {
			await fc.assert(
				fc.asyncProperty(fc.integer({ min: 2, max: 5 }), async (chainLength) => {
					await graph.clear()
					const nodes = Array.from({ length: chainLength }, (_, i) => ({
						id: `N${i}`,
						name: `node${i}`,
						type: "function" as const,
						filePath: `/test/file${i}.ts`,
						startLine: 1,
						endLine: 10,
						startColumn: 0,
						endColumn: 0,
						metadata: {},
					}))

					for (const node of nodes) {
						await graph.addNode(node)
					}

					for (let i = 0; i < nodes.length - 1; i++) {
						await graph.addEdge({
							sourceId: nodes[i].id,
							targetId: nodes[i + 1].id,
							type: "calls",
						})
					}

					const path = await graph.findPath("N0", `N${chainLength - 1}`)

					expect(path.length).toBe(chainLength - 1)
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Property 5: Graph Persistence Round-Trip", () => {
		it("should preserve nodes after save and load", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					await graph.clear()
					for (const entity of entities) {
						await graph.addNode(entity)
					}

					const filePath = path.join(tempDir, `graph-${Date.now()}-${Math.random()}.json`)
					await graph.save(filePath)

					const newGraph = new KnowledgeGraph()
					await newGraph.load(filePath)

					expect(newGraph.getNodeCount()).toBe(entities.length)

					for (const entity of entities) {
						const loaded = await newGraph.getNode(entity.id)
						expect(loaded).not.toBeNull()
						expect(loaded?.name).toBe(entity.name)
						expect(loaded?.type).toBe(entity.type)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should preserve edges after save and load", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(3), relationshipType, async (entities, relType) => {
					await graph.clear()
					for (const entity of entities) {
						await graph.addNode(entity)
					}

					const edges: EntityRelationship[] = []
					for (let i = 0; i < entities.length - 1; i++) {
						const edge = {
							sourceId: entities[i].id,
							targetId: entities[i + 1].id,
							type: relType,
						}
						await graph.addEdge(edge)
						edges.push(edge)
					}

					const filePath = path.join(tempDir, `graph-${Date.now()}-${Math.random()}.json`)
					await graph.save(filePath)

					const newGraph = new KnowledgeGraph()
					await newGraph.load(filePath)

					expect(newGraph.getEdgeCount()).toBe(edges.length)

					for (const edge of edges) {
						const loadedEdges = await newGraph.getEdges(edge.sourceId, "out")
						expect(loadedEdges.some((e) => e.targetId === edge.targetId && e.type === edge.type)).toBe(true)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should preserve graph structure after multiple save/load cycles", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(3), fc.integer({ min: 1, max: 3 }), async (entities, cycles) => {
					await graph.clear()
					for (const entity of entities) {
						await graph.addNode(entity)
					}

					await graph.addEdge({
						sourceId: entities[0].id,
						targetId: entities[1].id,
						type: "calls",
					})

					let currentGraph = graph
					for (let i = 0; i < cycles; i++) {
						const filePath = path.join(tempDir, `graph-cycle-${i}-${Date.now()}-${Math.random()}.json`)
						await currentGraph.save(filePath)

						currentGraph = new KnowledgeGraph()
						await currentGraph.load(filePath)
					}

					expect(currentGraph.getNodeCount()).toBe(entities.length)
					expect(currentGraph.getEdgeCount()).toBe(1)
				}),
				{ numRuns: 50 },
			)
		})
	})
})
