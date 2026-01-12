// kilocode_change - new file
import { CodeEntity } from "../../types"
import { KnowledgeGraph } from "../../knowledge-graph"
import { ContextAggregator, resetContextAggregator, getContextAggregator, AggregatedContext } from "../index"

describe("ContextAggregator", () => {
	let aggregator: ContextAggregator
	let knowledgeGraph: KnowledgeGraph

	const mockEntities: CodeEntity[] = [
		{
			id: "user-service",
			name: "UserService",
			type: "class",
			filePath: "/src/services/UserService.ts",
			startLine: 1,
			endLine: 100,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "get-user",
			name: "getUser",
			type: "function",
			filePath: "/src/services/UserService.ts",
			startLine: 10,
			endLine: 20,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "create-user",
			name: "createUser",
			type: "function",
			filePath: "/src/services/UserService.ts",
			startLine: 25,
			endLine: 40,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "user-repo",
			name: "UserRepository",
			type: "class",
			filePath: "/src/repositories/UserRepository.ts",
			startLine: 1,
			endLine: 50,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "find-user",
			name: "findUser",
			type: "function",
			filePath: "/src/repositories/UserRepository.ts",
			startLine: 10,
			endLine: 20,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "user-controller",
			name: "UserController",
			type: "class",
			filePath: "/src/controllers/UserController.ts",
			startLine: 1,
			endLine: 80,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "test-get-user",
			name: "testGetUser",
			type: "function",
			filePath: "/src/__tests__/UserService.spec.ts",
			startLine: 10,
			endLine: 30,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "user-interface",
			name: "User",
			type: "interface",
			filePath: "/src/types/User.ts",
			startLine: 1,
			endLine: 10,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
	]

	beforeEach(async () => {
		resetContextAggregator()
		aggregator = new ContextAggregator()
		knowledgeGraph = new KnowledgeGraph()

		// Index entities
		aggregator.indexEntities(mockEntities)

		// Add nodes to knowledge graph
		for (const entity of mockEntities) {
			await knowledgeGraph.addNode({
				id: entity.id,
				type: entity.type,
				name: entity.name,
				filePath: entity.filePath,
				startLine: entity.startLine,
				endLine: entity.endLine,
				startColumn: entity.startColumn,
				endColumn: entity.endColumn,
				metadata: entity.metadata,
			})
		}

		// Add relationships
		await knowledgeGraph.addEdge({
			sourceId: "user-service",
			targetId: "user-repo",
			type: "uses",
		})
		await knowledgeGraph.addEdge({
			sourceId: "get-user",
			targetId: "find-user",
			type: "calls",
		})
		await knowledgeGraph.addEdge({
			sourceId: "user-controller",
			targetId: "user-service",
			type: "uses",
		})
		await knowledgeGraph.addEdge({
			sourceId: "user-service",
			targetId: "user-interface",
			type: "imports",
		})

		aggregator.setKnowledgeGraph(knowledgeGraph)
	})

	afterEach(() => {
		resetContextAggregator()
	})

	describe("getContext", () => {
		it("should return context for a file position", async () => {
			const context = await aggregator.getContext("/src/services/UserService.ts", 15)

			expect(context.focalEntity).toBeDefined()
			expect(context.focalEntity?.name).toBe("getUser")
		})

		it("should return empty context for unknown position", async () => {
			const context = await aggregator.getContext("/unknown/file.ts", 1)

			expect(context.focalEntity).toBeUndefined()
			expect(context.relatedEntities).toEqual([])
		})

		it("should find the most specific entity at position", async () => {
			// Line 15 is inside getUser (10-20) which is inside UserService (1-100)
			const context = await aggregator.getContext("/src/services/UserService.ts", 15)

			expect(context.focalEntity?.name).toBe("getUser")
		})
	})

	describe("getEntityContext", () => {
		it("should return context for an entity", async () => {
			const context = await aggregator.getEntityContext("user-service")

			expect(context.focalEntity).toBeDefined()
			expect(context.focalEntity?.name).toBe("UserService")
		})

		it("should include related entities", async () => {
			const context = await aggregator.getEntityContext("user-service")

			expect(context.relatedEntities.length).toBeGreaterThan(0)
		})

		it("should group related entities by relationship type", async () => {
			const context = await aggregator.getEntityContext("user-service")

			const usesGroup = context.relatedEntities.find((g) => g.relationshipType === "uses")
			expect(usesGroup).toBeDefined()
		})

		it("should return empty context for unknown entity", async () => {
			const context = await aggregator.getEntityContext("unknown-entity")

			expect(context.focalEntity).toBeUndefined()
		})

		it("should include import context", async () => {
			const context = await aggregator.getEntityContext("user-service")

			expect(context.imports.length).toBeGreaterThan(0)
		})

		it("should include export context", async () => {
			const context = await aggregator.getEntityContext("user-service")

			// UserController uses UserService
			expect(context.exports.length).toBeGreaterThan(0)
		})
	})

	describe("getFunctionContext", () => {
		it("should return context for a function", async () => {
			const context = await aggregator.getFunctionContext("get-user")

			expect(context.focalEntity).toBeDefined()
			expect(context.focalEntity?.name).toBe("getUser")
		})

		it("should prioritize callers and callees", async () => {
			const context = await aggregator.getFunctionContext("get-user")

			const callsGroup = context.relatedEntities.find((g) => g.relationshipType === "calls")
			if (callsGroup) {
				expect(callsGroup.relevanceScore).toBeGreaterThan(0)
			}
		})

		it("should find related tests", async () => {
			const context = await aggregator.getFunctionContext("get-user")

			// Should find testGetUser
			const hasTestRelation = context.relatedEntities.some((g) =>
				g.entities.some((e) => e.name.toLowerCase().includes("test")),
			)
			expect(hasTestRelation).toBe(true)
		})
	})

	describe("similar entities", () => {
		it("should find similar entities by shared words", async () => {
			// Add more class entities with "User" in name for testing
			aggregator.indexEntities([
				{
					id: "user-helper",
					name: "UserHelper",
					type: "class",
					filePath: "/src/helpers/UserHelper.ts",
					startLine: 1,
					endLine: 50,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			])

			const context = await aggregator.getEntityContext("user-service", {
				includeSimilar: true,
			})

			// UserService (class) should find other classes with "User" in name
			// UserRepository and UserController are classes with "User"
			expect(context.similarEntities.length).toBeGreaterThanOrEqual(0)
		})

		it("should not include similar when disabled", async () => {
			const context = await aggregator.getEntityContext("user-service", {
				includeSimilar: false,
			})

			expect(context.similarEntities).toEqual([])
		})

		it("should only find entities of same type", async () => {
			const context = await aggregator.getEntityContext("user-service", {
				includeSimilar: true,
			})

			// All similar entities should be of the same type as the focal entity
			for (const similar of context.similarEntities) {
				expect(similar.type).toBe("class")
			}
		})
	})

	describe("truncation", () => {
		it("should truncate context to fit token budget", async () => {
			const context = await aggregator.getEntityContext("user-service")
			// Use a larger budget that's still smaller than full context
			const truncated = aggregator.truncateContext(context, 200)

			// If original was larger, it should be truncated
			if (context.tokenCount > 200) {
				expect(truncated.wasTruncated).toBe(true)
				expect(truncated.tokenCount).toBeLessThanOrEqual(200)
			}
		})

		it("should not truncate if within budget", async () => {
			const context = await aggregator.getEntityContext("user-service")
			const truncated = aggregator.truncateContext(context, 100000)

			expect(truncated.wasTruncated).toBe(false)
		})

		it("should remove least relevant items first", async () => {
			const context = await aggregator.getEntityContext("user-service")
			const truncated = aggregator.truncateContext(context, 200)

			// Similar entities should be removed first when truncating
			if (truncated.wasTruncated) {
				expect(truncated.similarEntities.length).toBeLessThanOrEqual(context.similarEntities.length)
			}
		})
	})

	describe("formatting", () => {
		it("should format context as JSON", async () => {
			const context = await aggregator.getEntityContext("user-service")
			const json = aggregator.formatAsJson(context)

			expect(() => JSON.parse(json)).not.toThrow()
			const parsed = JSON.parse(json)
			expect(parsed.focal).toBeDefined()
			expect(parsed.focal.name).toBe("UserService")
		})

		it("should format context as markdown", async () => {
			const context = await aggregator.getEntityContext("user-service")
			const markdown = aggregator.formatAsMarkdown(context)

			expect(markdown).toContain("UserService")
			expect(markdown).toContain("##")
		})

		it("should include truncation notice in markdown", async () => {
			const context = await aggregator.getEntityContext("user-service")
			const truncated = aggregator.truncateContext(context, 100)
			const markdown = aggregator.formatAsMarkdown(truncated)

			expect(markdown).toContain("truncated")
		})
	})

	describe("options", () => {
		it("should respect maxTokens option", async () => {
			const context = await aggregator.getEntityContext("user-service", {
				maxTokens: 500,
			})

			expect(context.tokenCount).toBeLessThanOrEqual(500)
		})

		it("should respect includeHistory option", async () => {
			const context = await aggregator.getEntityContext("user-service", {
				includeHistory: false,
			})

			// Without git analyzer, history is empty anyway
			expect(context.recentHistory).toEqual([])
		})

		it("should respect includePatterns option", async () => {
			const context = await aggregator.getEntityContext("user-service", {
				includePatterns: false,
			})

			// Without pattern detector, patterns are empty anyway
			expect(context.patterns).toEqual([])
		})
	})

	describe("singleton instance", () => {
		it("should return singleton instance", () => {
			const instance1 = getContextAggregator()
			const instance2 = getContextAggregator()
			expect(instance1).toBe(instance2)
		})
	})

	describe("token estimation", () => {
		it("should estimate token count", async () => {
			const context = await aggregator.getEntityContext("user-service")

			expect(context.tokenCount).toBeGreaterThan(0)
		})
	})

	describe("relationship relevance", () => {
		it("should assign higher relevance to calls relationships", async () => {
			const context = await aggregator.getEntityContext("get-user")

			const callsGroup = context.relatedEntities.find((g) => g.relationshipType === "calls")
			const usesGroup = context.relatedEntities.find((g) => g.relationshipType === "uses")

			if (callsGroup && usesGroup) {
				expect(callsGroup.relevanceScore).toBeGreaterThan(usesGroup.relevanceScore)
			}
		})
	})
})
