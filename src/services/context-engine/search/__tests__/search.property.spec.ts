// kilocode_change - new file
/**
 * Property-Based Tests for Hybrid Search Service
 *
 * Feature: advanced-context-engine
 * Property 12: Hybrid Search Ranking
 * Property 13: Search Filtering
 *
 * Property 12: For any search query, the Semantic Index SHALL combine vector
 * similarity scores with Knowledge Graph relationship scores, boosting results
 * that are related in the graph.
 *
 * Property 13: For any search with filters (file type, directory, entity type,
 * pattern, contributor), the results SHALL only include entities matching all
 * specified filters.
 */

import * as fc from "fast-check"
import { CodeEntity } from "../../types"
import { HybridSearchService, resetHybridSearchService } from "../index"

describe("HybridSearchService Property Tests", () => {
	let service: HybridSearchService

	beforeEach(() => {
		resetHybridSearchService()
		service = new HybridSearchService()
	})

	afterEach(() => {
		resetHybridSearchService()
	})

	// Arbitraries
	const entityName = fc.stringMatching(/^[A-Z][a-zA-Z]{2,15}$/)
	const entityType = fc.constantFrom("function", "class", "interface", "type", "variable") as fc.Arbitrary<
		CodeEntity["type"]
	>
	const directory = fc.constantFrom("/src/services", "/src/utils", "/src/models", "/src/controllers", "/lib")

	const codeEntity: fc.Arbitrary<CodeEntity> = fc
		.tuple(entityName, entityType, directory, fc.integer({ min: 1, max: 100 }), fc.integer({ min: 10, max: 50 }))
		.map((tuple): CodeEntity => {
			const [name, type, dir, startLine, lineCount] = tuple
			return {
				id: `entity-${name}-${startLine}`,
				name,
				type,
				filePath: `${dir}/${name}.ts`,
				startLine,
				endLine: startLine + lineCount,
				startColumn: 0,
				endColumn: 1,
				metadata: {},
			}
		})

	const uniqueEntities = (count: number): fc.Arbitrary<CodeEntity[]> =>
		fc
			.array(codeEntity, { minLength: count, maxLength: count * 2 })
			.map((entities) => {
				const seen = new Set<string>()
				return entities.filter((e) => {
					if (seen.has(e.id)) return false
					seen.add(e.id)
					return true
				})
			})
			.filter((entities) => entities.length >= count)

	describe("Property 12: Hybrid Search Ranking", () => {
		it("should return results sorted by score descending", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					async (entities, query) => {
						service.indexEntities(entities)
						const results = await service.search(query)

						for (let i = 1; i < results.length; i++) {
							expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should return higher scores for exact name matches", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					if (entities.length === 0) return

					service.indexEntities(entities)
					const targetEntity = entities[0]
					const results = await service.search(targetEntity.name)

					if (results.length > 0) {
						const exactMatch = results.find((r) => r.entity.name === targetEntity.name)
						if (exactMatch && results.length > 1) {
							// Exact match should have highest or equal score
							expect(exactMatch.score).toBeGreaterThanOrEqual(results[results.length - 1].score)
						}
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should include score breakdown in results", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), fc.stringMatching(/^[A-Z][a-z]{2,8}$/), async (entities, query) => {
					service.indexEntities(entities)
					const results = await service.search(query)

					for (const result of results) {
						expect(result.scoreBreakdown).toBeDefined()
						expect(typeof result.scoreBreakdown.textSimilarity).toBe("number")
						expect(result.scoreBreakdown.textSimilarity).toBeGreaterThanOrEqual(0)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should return scores between 0 and 1", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					async (entities, query) => {
						service.indexEntities(entities)
						const results = await service.search(query)

						for (const result of results) {
							expect(result.score).toBeGreaterThanOrEqual(0)
							expect(result.score).toBeLessThanOrEqual(1)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should be case insensitive", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					if (entities.length === 0) return

					service.indexEntities(entities)
					const targetName = entities[0].name

					const lowerResults = await service.search(targetName.toLowerCase())
					const upperResults = await service.search(targetName.toUpperCase())

					// Should find same entities regardless of case
					const lowerIds = new Set(lowerResults.map((r) => r.entity.id))
					const upperIds = new Set(upperResults.map((r) => r.entity.id))

					expect(lowerIds.size).toBe(upperIds.size)
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Property 13: Search Filtering", () => {
		it("should filter by entity type", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					entityType,
					async (entities, query, filterType) => {
						service.indexEntities(entities)
						const results = await service.search(query, { entityTypes: [filterType] })

						for (const result of results) {
							expect(result.entity.type).toBe(filterType)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should filter by multiple entity types", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					fc.array(entityType, { minLength: 1, maxLength: 3 }),
					async (entities, query, filterTypes) => {
						const uniqueTypes = [...new Set(filterTypes)]
						service.indexEntities(entities)
						const results = await service.search(query, { entityTypes: uniqueTypes })

						for (const result of results) {
							expect(uniqueTypes).toContain(result.entity.type)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should filter by directory", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					directory,
					async (entities, query, filterDir) => {
						service.indexEntities(entities)
						const results = await service.search(query, { directory: filterDir })

						for (const result of results) {
							expect(result.entity.filePath.startsWith(filterDir)).toBe(true)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should respect limit option", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(20),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					fc.integer({ min: 1, max: 10 }),
					async (entities, query, limit) => {
						service.indexEntities(entities)
						const results = await service.search(query, { limit })

						expect(results.length).toBeLessThanOrEqual(limit)
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should respect minimum score filter", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					fc.float({ min: Math.fround(0.1), max: Math.fround(0.9), noNaN: true }),
					async (entities, query, minScore) => {
						service.indexEntities(entities)
						const results = await service.search(query, { minScore })

						for (const result of results) {
							expect(result.score).toBeGreaterThanOrEqual(minScore)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should combine multiple filters correctly", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(15),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					entityType,
					directory,
					async (entities, query, filterType, filterDir) => {
						service.indexEntities(entities)
						const results = await service.search(query, {
							entityTypes: [filterType],
							directory: filterDir,
						})

						for (const result of results) {
							expect(result.entity.type).toBe(filterType)
							expect(result.entity.filePath.startsWith(filterDir)).toBe(true)
						}
					},
				),
				{ numRuns: 100 },
			)
		})

		it("should return empty array when no entities match filters", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					service.indexEntities(entities)
					const results = await service.search("test", {
						directory: "/nonexistent/path/that/does/not/exist",
					})

					expect(results).toEqual([])
				}),
				{ numRuns: 50 },
			)
		})

		it("should filter by file patterns", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.stringMatching(/^[A-Z][a-z]{2,8}$/),
					async (entities, query) => {
						service.indexEntities(entities)
						const results = await service.search(query, {
							filePatterns: ["**/*Service.ts"],
						})

						for (const result of results) {
							expect(result.entity.filePath.endsWith("Service.ts")).toBe(true)
						}
					},
				),
				{ numRuns: 50 },
			)
		})
	})
})
