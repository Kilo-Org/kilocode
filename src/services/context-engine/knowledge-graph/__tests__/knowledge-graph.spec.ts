// kilocode_change - new file
/**
 * Knowledge Graph Tests
 */

import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { KnowledgeGraph } from "../index"
import { CodeEntity, EntityRelationship } from "../../types"

describe("KnowledgeGraph", () => {
	let graph: KnowledgeGraph
	let tempDir: string

	beforeEach(async () => {
		graph = new KnowledgeGraph()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "kg-test-"))
	})

	afterEach(async () => {
		await graph.clear()
		try {
			await fs.rm(tempDir, { recursive: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	// Helper to create test entities
	const createEntity = (id: string, name: string, type: CodeEntity["type"] = "function"): CodeEntity => ({
		id,
		name,
		type,
		filePath: "/test/file.ts",
		startLine: 1,
		endLine: 10,
		startColumn: 0,
		endColumn: 0,
		metadata: {},
	})

	describe("Node Operations", () => {
		it("should add a node", async () => {
			const entity = createEntity("1", "testFunc")
			await graph.addNode(entity)

			const retrieved = await graph.getNode("1")
			expect(retrieved).toEqual(entity)
			expect(graph.getNodeCount()).toBe(1)
		})

		it("should update an existing node", async () => {
			const entity = createEntity("1", "testFunc")
			await graph.addNode(entity)

			await graph.updateNode("1", { name: "updatedFunc" })

			const retrieved = await graph.getNode("1")
			expect(retrieved?.name).toBe("updatedFunc")
		})

		it("should remove a node", async () => {
			const entity = createEntity("1", "testFunc")
			await graph.addNode(entity)
			await graph.removeNode("1")

			const retrieved = await graph.getNode("1")
			expect(retrieved).toBeNull()
			expect(graph.getNodeCount()).toBe(0)
		})

		it("should get all nodes", async () => {
			await graph.addNode(createEntity("1", "func1"))
			await graph.addNode(createEntity("2", "func2"))
			await graph.addNode(createEntity("3", "func3"))

			const nodes = await graph.getAllNodes()
			expect(nodes.length).toBe(3)
		})

		it("should handle adding duplicate nodes", async () => {
			const entity = createEntity("1", "testFunc")
			await graph.addNode(entity)
			await graph.addNode({ ...entity, name: "updated" })

			expect(graph.getNodeCount()).toBe(1)
			const retrieved = await graph.getNode("1")
			expect(retrieved?.name).toBe("updated")
		})
	})

	describe("Edge Operations", () => {
		beforeEach(async () => {
			await graph.addNode(createEntity("1", "func1"))
			await graph.addNode(createEntity("2", "func2"))
			await graph.addNode(createEntity("3", "func3"))
		})

		it("should add an edge", async () => {
			const relationship: EntityRelationship = {
				sourceId: "1",
				targetId: "2",
				type: "calls",
			}
			await graph.addEdge(relationship)

			expect(graph.getEdgeCount()).toBe(1)
		})

		it("should get outgoing edges", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "1", targetId: "3", type: "uses" })

			const edges = await graph.getEdges("1", "out")
			expect(edges.length).toBe(2)
		})

		it("should get incoming edges", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "3", targetId: "2", type: "calls" })

			const edges = await graph.getEdges("2", "in")
			expect(edges.length).toBe(2)
		})

		it("should get both directions", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "3", targetId: "2", type: "calls" })

			const edges = await graph.getEdges("2", "both")
			expect(edges.length).toBe(2)
		})

		it("should remove an edge", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.removeEdge("1", "2", "calls")

			expect(graph.getEdgeCount()).toBe(0)
		})

		it("should not add duplicate edges", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })

			expect(graph.getEdgeCount()).toBe(1)
		})

		it("should remove edges when node is removed", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "2", targetId: "3", type: "calls" })

			await graph.removeNode("2")

			expect(graph.getEdgeCount()).toBe(0)
		})
	})

	describe("Traversal", () => {
		beforeEach(async () => {
			// Create a graph: 1 -> 2 -> 3 -> 4
			//                    \-> 5
			await graph.addNode(createEntity("1", "func1"))
			await graph.addNode(createEntity("2", "func2"))
			await graph.addNode(createEntity("3", "func3"))
			await graph.addNode(createEntity("4", "func4"))
			await graph.addNode(createEntity("5", "func5"))

			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			await graph.addEdge({ sourceId: "2", targetId: "3", type: "calls" })
			await graph.addEdge({ sourceId: "2", targetId: "5", type: "calls" })
			await graph.addEdge({ sourceId: "3", targetId: "4", type: "calls" })
		})

		it("should traverse with depth limit", async () => {
			const result = await graph.traverse("1", { maxDepth: 1 })

			expect(result.nodes.length).toBe(2) // 1 and 2
			expect(result.nodes.map((n) => n.id)).toContain("1")
			expect(result.nodes.map((n) => n.id)).toContain("2")
		})

		it("should traverse full depth", async () => {
			const result = await graph.traverse("1", { maxDepth: 10 })

			expect(result.nodes.length).toBe(5)
		})

		it("should filter by relationship type", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "3", type: "uses" })

			const result = await graph.traverse("1", {
				maxDepth: 10,
				relationshipTypes: ["uses"],
			})

			expect(result.nodes.length).toBe(2) // 1 and 3
		})

		it("should limit results", async () => {
			const result = await graph.traverse("1", { maxDepth: 10, limit: 3 })

			expect(result.nodes.length).toBe(3)
		})

		it("should find path between nodes", async () => {
			const path = await graph.findPath("1", "4")

			expect(path.length).toBe(3) // 1->2, 2->3, 3->4
		})

		it("should return empty path for unreachable nodes", async () => {
			await graph.addNode(createEntity("6", "isolated"))

			const path = await graph.findPath("1", "6")

			expect(path.length).toBe(0)
		})
	})

	describe("Queries", () => {
		beforeEach(async () => {
			await graph.addNode(createEntity("1", "getUserById", "function"))
			await graph.addNode(createEntity("2", "getUsers", "function"))
			await graph.addNode(createEntity("3", "UserService", "class"))
			await graph.addNode({
				...createEntity("4", "createUser", "function"),
				filePath: "/test/other.ts",
			})
		})

		it("should find entities by name", async () => {
			const results = await graph.findEntities({ name: "getUserById" })

			expect(results.length).toBe(1)
			expect(results[0].name).toBe("getUserById")
		})

		it("should find entities by name pattern", async () => {
			const results = await graph.findEntities({ name: "get*" })

			expect(results.length).toBe(2)
		})

		it("should find entities by type", async () => {
			const results = await graph.findEntities({ types: ["class"] })

			expect(results.length).toBe(1)
			expect(results[0].name).toBe("UserService")
		})

		it("should find entities by file path", async () => {
			const results = await graph.findEntities({ filePath: "/test/other.ts" })

			expect(results.length).toBe(1)
			expect(results[0].name).toBe("createUser")
		})

		it("should limit results", async () => {
			const results = await graph.findEntities({ types: ["function"], limit: 2 })

			expect(results.length).toBe(2)
		})

		it("should get related entities", async () => {
			await graph.addEdge({ sourceId: "1", targetId: "3", type: "uses" })
			await graph.addEdge({ sourceId: "3", targetId: "2", type: "contains" })

			const related = await graph.getRelatedEntities("1", 2)

			expect(related.length).toBeGreaterThanOrEqual(1)
		})
	})

	describe("Bulk Operations", () => {
		it("should add multiple nodes", async () => {
			const entities = [createEntity("1", "func1"), createEntity("2", "func2"), createEntity("3", "func3")]

			await graph.addNodes(entities)

			expect(graph.getNodeCount()).toBe(3)
		})

		it("should add multiple edges", async () => {
			await graph.addNodes([createEntity("1", "func1"), createEntity("2", "func2"), createEntity("3", "func3")])

			await graph.addEdges([
				{ sourceId: "1", targetId: "2", type: "calls" },
				{ sourceId: "2", targetId: "3", type: "calls" },
			])

			expect(graph.getEdgeCount()).toBe(2)
		})

		it("should remove nodes by file", async () => {
			await graph.addNodes([
				{ ...createEntity("1", "func1"), filePath: "/test/a.ts" },
				{ ...createEntity("2", "func2"), filePath: "/test/a.ts" },
				{ ...createEntity("3", "func3"), filePath: "/test/b.ts" },
			])

			await graph.removeNodesByFile("/test/a.ts")

			expect(graph.getNodeCount()).toBe(1)
			const remaining = await graph.getNode("3")
			expect(remaining).not.toBeNull()
		})
	})

	describe("Persistence", () => {
		it("should save and load graph", async () => {
			await graph.addNodes([createEntity("1", "func1"), createEntity("2", "func2")])
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })

			const filePath = path.join(tempDir, "graph.json")
			await graph.save(filePath)

			// Create new graph and load
			const newGraph = new KnowledgeGraph()
			await newGraph.load(filePath)

			expect(newGraph.getNodeCount()).toBe(2)
			expect(newGraph.getEdgeCount()).toBe(1)

			const node = await newGraph.getNode("1")
			expect(node?.name).toBe("func1")
		})

		it("should handle loading non-existent file", async () => {
			const filePath = path.join(tempDir, "nonexistent.json")

			// Should not throw
			await graph.load(filePath)

			expect(graph.getNodeCount()).toBe(0)
		})

		it("should clear graph", async () => {
			await graph.addNodes([createEntity("1", "func1"), createEntity("2", "func2")])
			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })

			await graph.clear()

			expect(graph.getNodeCount()).toBe(0)
			expect(graph.getEdgeCount()).toBe(0)
		})
	})

	describe("Metadata", () => {
		it("should track node count", async () => {
			expect(graph.getNodeCount()).toBe(0)

			await graph.addNode(createEntity("1", "func1"))
			expect(graph.getNodeCount()).toBe(1)

			await graph.addNode(createEntity("2", "func2"))
			expect(graph.getNodeCount()).toBe(2)

			await graph.removeNode("1")
			expect(graph.getNodeCount()).toBe(1)
		})

		it("should track edge count", async () => {
			await graph.addNodes([createEntity("1", "func1"), createEntity("2", "func2")])

			expect(graph.getEdgeCount()).toBe(0)

			await graph.addEdge({ sourceId: "1", targetId: "2", type: "calls" })
			expect(graph.getEdgeCount()).toBe(1)

			await graph.removeEdge("1", "2", "calls")
			expect(graph.getEdgeCount()).toBe(0)
		})

		it("should return metadata", () => {
			const metadata = graph.getMetadata()

			expect(metadata.version).toBeDefined()
			expect(metadata.createdAt).toBeInstanceOf(Date)
			expect(metadata.nodeCount).toBe(0)
			expect(metadata.edgeCount).toBe(0)
		})
	})
})
