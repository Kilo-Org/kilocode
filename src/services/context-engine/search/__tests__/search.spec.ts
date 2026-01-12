// kilocode_change - new file
import { CodeEntity } from "../../types"
import { HybridSearchService, resetHybridSearchService, getHybridSearchService, SearchOptions } from "../index"

describe("HybridSearchService", () => {
	let service: HybridSearchService

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
			id: "get-user",
			name: "getUser",
			type: "function",
			filePath: "/src/services/UserService.ts",
			startLine: 10,
			endLine: 20,
			startColumn: 0,
			endColumn: 1,
			signature: "(id: string) => User",
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
			id: "auth-service",
			name: "AuthService",
			type: "class",
			filePath: "/src/services/AuthService.ts",
			startLine: 1,
			endLine: 80,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
		{
			id: "login",
			name: "login",
			type: "function",
			filePath: "/src/services/AuthService.ts",
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
		{
			id: "config",
			name: "Config",
			type: "variable",
			filePath: "/src/config/index.ts",
			startLine: 1,
			endLine: 5,
			startColumn: 0,
			endColumn: 1,
			metadata: {},
		},
	]

	beforeEach(() => {
		resetHybridSearchService()
		service = new HybridSearchService()
		service.indexEntities(mockEntities)
	})

	afterEach(() => {
		resetHybridSearchService()
	})

	describe("basic search", () => {
		it("should find entities by exact name match", async () => {
			const results = await service.search("UserService")

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].entity.name).toBe("UserService")
		})

		it("should find entities by partial name match", async () => {
			const results = await service.search("User")

			expect(results.length).toBeGreaterThan(0)
			const names = results.map((r) => r.entity.name)
			expect(names).toContain("UserService")
			expect(names).toContain("UserRepository")
			expect(names).toContain("User")
		})

		it("should find entities by multiple terms", async () => {
			const results = await service.search("get user")

			expect(results.length).toBeGreaterThan(0)
			expect(results.some((r) => r.entity.name === "getUser")).toBe(true)
		})

		it("should return empty array for no matches", async () => {
			const results = await service.search("nonexistent")

			expect(results).toEqual([])
		})

		it("should be case insensitive", async () => {
			const results1 = await service.search("userservice")
			const results2 = await service.search("USERSERVICE")

			expect(results1.length).toBeGreaterThan(0)
			expect(results2.length).toBeGreaterThan(0)
			expect(results1[0].entity.id).toBe(results2[0].entity.id)
		})

		it("should sort results by score descending", async () => {
			const results = await service.search("User")

			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
			}
		})
	})

	describe("search options", () => {
		it("should respect limit option", async () => {
			const results = await service.search("User", { limit: 2 })

			expect(results.length).toBeLessThanOrEqual(2)
		})

		it("should filter by entity type", async () => {
			const results = await service.search("User", {
				entityTypes: ["class"],
			})

			expect(results.every((r) => r.entity.type === "class")).toBe(true)
		})

		it("should filter by multiple entity types", async () => {
			const results = await service.search("User", {
				entityTypes: ["class", "interface"],
			})

			expect(results.every((r) => ["class", "interface"].includes(r.entity.type))).toBe(true)
		})

		it("should filter by directory", async () => {
			const results = await service.search("User", {
				directory: "/src/services",
			})

			expect(results.every((r) => r.entity.filePath.startsWith("/src/services"))).toBe(true)
		})

		it("should filter by file patterns", async () => {
			const results = await service.search("User", {
				filePatterns: ["**/*Service.ts"],
			})

			expect(results.every((r) => r.entity.filePath.endsWith("Service.ts"))).toBe(true)
		})

		it("should exclude by patterns", async () => {
			const results = await service.search("User", {
				excludePatterns: ["**/repositories/**"],
			})

			expect(results.every((r) => !r.entity.filePath.includes("/repositories/"))).toBe(true)
		})

		it("should respect minimum score", async () => {
			const results = await service.search("User", { minScore: 0.5 })

			expect(results.every((r) => r.score >= 0.5)).toBe(true)
		})
	})

	describe("score breakdown", () => {
		it("should include score breakdown in results", async () => {
			const results = await service.search("UserService")

			expect(results[0].scoreBreakdown).toBeDefined()
			expect(results[0].scoreBreakdown.textSimilarity).toBeGreaterThan(0)
		})

		it("should have higher text similarity for exact matches", async () => {
			const results = await service.search("UserService")

			const exactMatch = results.find((r) => r.entity.name === "UserService")
			const partialMatch = results.find((r) => r.entity.name === "UserRepository")

			if (exactMatch && partialMatch) {
				expect(exactMatch.scoreBreakdown.textSimilarity).toBeGreaterThan(
					partialMatch.scoreBreakdown.textSimilarity,
				)
			}
		})
	})

	describe("highlights", () => {
		it("should include highlights for matches", async () => {
			const results = await service.search("User")

			const result = results.find((r) => r.entity.name === "UserService")
			expect(result?.highlights).toBeDefined()
			expect(result?.highlights?.length).toBeGreaterThan(0)
		})

		it("should highlight correct positions", async () => {
			const results = await service.search("User")

			const result = results.find((r) => r.entity.name === "UserService")
			if (result?.highlights && result.highlights.length > 0) {
				const highlight = result.highlights[0]
				expect(highlight.start).toBe(0)
				expect(highlight.end).toBe(4)
				expect(highlight.text).toBe("User")
			}
		})
	})

	describe("snippets", () => {
		it("should generate snippets", async () => {
			const results = await service.search("getUser")

			const result = results.find((r) => r.entity.name === "getUser")
			expect(result?.snippet).toBeDefined()
			expect(result?.snippet).toContain("getUser")
		})

		it("should include signature in snippet if available", async () => {
			const results = await service.search("getUser")

			const result = results.find((r) => r.entity.name === "getUser")
			expect(result?.snippet).toContain("(id: string) => User")
		})
	})

	describe("getByType", () => {
		it("should return all entities of a type", async () => {
			const results = await service.getByType("class")

			expect(results.length).toBe(3) // UserService, UserRepository, AuthService
			expect(results.every((r) => r.entity.type === "class")).toBe(true)
		})

		it("should respect limit option", async () => {
			const results = await service.getByType("function", { limit: 2 })

			expect(results.length).toBeLessThanOrEqual(2)
		})

		it("should apply filters", async () => {
			const results = await service.getByType("function", {
				directory: "/src/services/AuthService.ts",
			})

			expect(results.every((r) => r.entity.filePath.includes("AuthService"))).toBe(true)
		})
	})

	describe("findRelated", () => {
		it("should return empty array without knowledge graph", async () => {
			const results = await service.findRelated("user-service")

			expect(results).toEqual([])
		})
	})

	describe("searchWithContext", () => {
		it("should call search with context entity", async () => {
			const results = await service.searchWithContext("User", "auth-service")

			expect(Array.isArray(results)).toBe(true)
		})
	})

	describe("caching", () => {
		it("should cache results", async () => {
			const results1 = await service.search("User")
			const results2 = await service.search("User")

			expect(results1).toEqual(results2)
		})

		it("should clear cache when indexing new entities", async () => {
			await service.search("User")

			service.indexEntities([
				{
					id: "new-user",
					name: "NewUserService",
					type: "class",
					filePath: "/src/NewUserService.ts",
					startLine: 1,
					endLine: 10,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			])

			const results = await service.search("NewUser")
			expect(results.some((r) => r.entity.name === "NewUserService")).toBe(true)
		})

		it("should respect cache disabled option", async () => {
			const noCacheService = new HybridSearchService({ enableCache: false })
			noCacheService.indexEntities(mockEntities)

			const results1 = await noCacheService.search("User")
			const results2 = await noCacheService.search("User")

			// Results should still be equal but not cached
			expect(results1.length).toBe(results2.length)
		})
	})

	describe("index management", () => {
		it("should clear index", async () => {
			service.clearIndex()

			const results = await service.search("User")
			expect(results).toEqual([])
		})

		it("should add entities to existing index", async () => {
			service.indexEntities([
				{
					id: "extra",
					name: "ExtraService",
					type: "class",
					filePath: "/src/ExtraService.ts",
					startLine: 1,
					endLine: 10,
					startColumn: 0,
					endColumn: 1,
					metadata: {},
				},
			])

			const results = await service.search("Extra")
			expect(results.some((r) => r.entity.name === "ExtraService")).toBe(true)
		})
	})

	describe("singleton instance", () => {
		it("should return singleton instance", () => {
			const instance1 = getHybridSearchService()
			const instance2 = getHybridSearchService()
			expect(instance1).toBe(instance2)
		})
	})

	describe("custom weights", () => {
		it("should use custom weights", async () => {
			const customService = new HybridSearchService({
				defaultWeights: {
					textSimilarity: 1.0,
					graphRelationship: 0,
					recency: 0,
					frequency: 0,
					pattern: 0,
				},
			})
			customService.indexEntities(mockEntities)

			const results = await customService.search("User")
			expect(results.length).toBeGreaterThan(0)
		})

		it("should allow per-search weight override", async () => {
			const results = await service.search("User", {
				weights: {
					textSimilarity: 1.0,
					graphRelationship: 0,
				},
			})

			expect(results.length).toBeGreaterThan(0)
		})
	})
})
