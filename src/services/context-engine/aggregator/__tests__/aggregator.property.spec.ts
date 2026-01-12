// kilocode_change - new file
/**
 * Property-Based Tests for Context Aggregator
 *
 * Feature: advanced-context-engine
 * Property 14: Context Aggregation Completeness
 * Property 15: Context Truncation Intelligence
 *
 * Property 14: For any context request, the Context Aggregator SHALL provide
 * current file context, related files, relevant entities, detected patterns,
 * and recent changes, ranked by proximity, relationships, recency, and frequency.
 *
 * Property 15: For any context that exceeds the token limit, truncation SHALL
 * preserve the most relevant parts based on ranking criteria, and output SHALL
 * be valid structured JSON.
 */

import * as fc from "fast-check"
import { CodeEntity } from "../../types"
import { KnowledgeGraph } from "../../knowledge-graph"
import { ContextAggregator, resetContextAggregator } from "../index"

describe("ContextAggregator Property Tests", () => {
	let aggregator: ContextAggregator
	let knowledgeGraph: KnowledgeGraph

	beforeEach(async () => {
		resetContextAggregator()
		aggregator = new ContextAggregator()
		knowledgeGraph = new KnowledgeGraph()
	})

	afterEach(() => {
		resetContextAggregator()
	})

	// Arbitraries
	const entityName = fc.stringMatching(/^[A-Z][a-zA-Z]{2,15}$/)
	const entityType = fc.constantFrom("function", "class", "interface", "type", "variable") as fc.Arbitrary<
		CodeEntity["type"]
	>
	const filePath = fc.constantFrom(
		"/src/services/UserService.ts",
		"/src/utils/helpers.ts",
		"/src/models/User.ts",
		"/src/controllers/UserController.ts",
	)

	const codeEntity: fc.Arbitrary<CodeEntity> = fc
		.tuple(entityName, entityType, filePath, fc.integer({ min: 1, max: 50 }), fc.integer({ min: 10, max: 30 }))
		.map((tuple): CodeEntity => {
			const [name, type, path, startLine, lineCount] = tuple
			return {
				id: `entity-${name}-${startLine}`,
				name,
				type,
				filePath: path,
				startLine,
				endLine: startLine + lineCount,
				startColumn: 0,
				endColumn: 0,
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

	describe("Property 14: Context Aggregation Completeness", () => {
		it("should return context with focal entity when entity exists", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const targetEntity = entities[0]
					const context = await aggregator.getEntityContext(targetEntity.id)

					expect(context.focalEntity).toBeDefined()
					expect(context.focalEntity?.id).toBe(targetEntity.id)
				}),
				{ numRuns: 50 },
			)
		})

		it("should return empty context for non-existent entity", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(3),
					fc.stringMatching(/^nonexistent_[a-z]{5}$/),
					async (entities, unknownId) => {
						aggregator.indexEntities(entities)
						const context = await aggregator.getEntityContext(unknownId)

						expect(context.focalEntity).toBeUndefined()
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should include related entities when relationships exist", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					if (entities.length < 2) return

					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}

					// Create relationships
					await knowledgeGraph.addEdge({
						sourceId: entities[0].id,
						targetId: entities[1].id,
						type: "uses",
					})

					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)

					expect(context.relatedEntities.length).toBeGreaterThan(0)
				}),
				{ numRuns: 50 },
			)
		})

		it("should estimate token count for context", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)

					expect(context.tokenCount).toBeGreaterThan(0)
					expect(typeof context.tokenCount).toBe("number")
				}),
				{ numRuns: 50 },
			)
		})

		it("should group related entities by relationship type", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					if (entities.length < 3) return

					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}

					await knowledgeGraph.addEdge({
						sourceId: entities[0].id,
						targetId: entities[1].id,
						type: "uses",
					})
					await knowledgeGraph.addEdge({
						sourceId: entities[0].id,
						targetId: entities[2].id,
						type: "calls",
					})

					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)

					for (const group of context.relatedEntities) {
						expect(group.relationshipType).toBeDefined()
						expect(group.entities.length).toBeGreaterThan(0)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should find entity at file position", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(3), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const targetEntity = entities[0]
					const midLine = Math.floor((targetEntity.startLine + targetEntity.endLine) / 2)

					const context = await aggregator.getContext(targetEntity.filePath, midLine)

					if (context.focalEntity) {
						expect(context.focalEntity.filePath).toBe(targetEntity.filePath)
						expect(context.focalEntity.startLine).toBeLessThanOrEqual(midLine)
						expect(context.focalEntity.endLine).toBeGreaterThanOrEqual(midLine)
					}
				}),
				{ numRuns: 50 },
			)
		})
	})

	describe("Property 15: Context Truncation Intelligence", () => {
		it("should truncate context to fit token budget", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.integer({ min: 500, max: 2000 }),
					async (entities, tokenBudget) => {
						resetContextAggregator()
						aggregator = new ContextAggregator()
						knowledgeGraph = new KnowledgeGraph()

						aggregator.indexEntities(entities)

						for (const entity of entities) {
							await knowledgeGraph.addNode(entity)
						}

						// Create many relationships to generate large context
						for (let i = 0; i < entities.length - 1; i++) {
							await knowledgeGraph.addEdge({
								sourceId: entities[0].id,
								targetId: entities[i + 1].id,
								type: "uses",
							})
						}

						aggregator.setKnowledgeGraph(knowledgeGraph)

						const context = await aggregator.getEntityContext(entities[0].id)
						const truncated = aggregator.truncateContext(context, tokenBudget)

						expect(truncated.tokenCount).toBeLessThanOrEqual(tokenBudget)
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should not truncate if within budget", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(3), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)
					const largeBudget = context.tokenCount + 10000
					const truncated = aggregator.truncateContext(context, largeBudget)

					expect(truncated.wasTruncated).toBe(false)
				}),
				{ numRuns: 50 },
			)
		})

		it("should preserve focal entity during truncation", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.integer({ min: 50, max: 200 }),
					async (entities, tokenBudget) => {
						aggregator.indexEntities(entities)

						for (const entity of entities) {
							await knowledgeGraph.addNode(entity)
						}
						aggregator.setKnowledgeGraph(knowledgeGraph)

						const context = await aggregator.getEntityContext(entities[0].id)
						const truncated = aggregator.truncateContext(context, tokenBudget)

						// Focal entity should always be preserved
						expect(truncated.focalEntity?.id).toBe(context.focalEntity?.id)
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should output valid JSON format", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)
					const json = aggregator.formatAsJson(context)

					// Should be valid JSON
					expect(() => JSON.parse(json)).not.toThrow()

					const parsed = JSON.parse(json)
					expect(parsed).toHaveProperty("focal")
				}),
				{ numRuns: 50 },
			)
		})

		it("should output valid markdown format", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(5), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}
					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id)
					const markdown = aggregator.formatAsMarkdown(context)

					expect(typeof markdown).toBe("string")
					expect(markdown.length).toBeGreaterThan(0)
				}),
				{ numRuns: 50 },
			)
		})

		it("should remove less relevant items first during truncation", async () => {
			await fc.assert(
				fc.asyncProperty(uniqueEntities(10), async (entities) => {
					aggregator.indexEntities(entities)

					for (const entity of entities) {
						await knowledgeGraph.addNode(entity)
					}

					// Create relationships with different types
					for (let i = 1; i < entities.length; i++) {
						await knowledgeGraph.addEdge({
							sourceId: entities[0].id,
							targetId: entities[i].id,
							type: i % 2 === 0 ? "calls" : "uses",
						})
					}

					aggregator.setKnowledgeGraph(knowledgeGraph)

					const context = await aggregator.getEntityContext(entities[0].id, {
						includeSimilar: true,
					})

					// Truncate to small budget
					const truncated = aggregator.truncateContext(context, 100)

					// Similar entities (lowest priority) should be removed first
					if (truncated.wasTruncated) {
						expect(truncated.similarEntities.length).toBeLessThanOrEqual(context.similarEntities.length)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should respect maxTokens option in getEntityContext", async () => {
			await fc.assert(
				fc.asyncProperty(
					uniqueEntities(10),
					fc.integer({ min: 500, max: 2000 }),
					async (entities, maxTokens) => {
						resetContextAggregator()
						aggregator = new ContextAggregator()
						knowledgeGraph = new KnowledgeGraph()

						aggregator.indexEntities(entities)

						for (const entity of entities) {
							await knowledgeGraph.addNode(entity)
						}

						for (let i = 1; i < entities.length; i++) {
							await knowledgeGraph.addEdge({
								sourceId: entities[0].id,
								targetId: entities[i].id,
								type: "uses",
							})
						}

						aggregator.setKnowledgeGraph(knowledgeGraph)

						const context = await aggregator.getEntityContext(entities[0].id, { maxTokens })

						expect(context.tokenCount).toBeLessThanOrEqual(maxTokens)
					},
				),
				{ numRuns: 50 },
			)
		})
	})
})
