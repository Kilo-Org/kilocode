// kilocode_change - new file
/**
 * Property-Based Tests for Pattern Detector
 *
 * Feature: advanced-context-engine
 * Property 9: Pattern Detection Accuracy
 *
 * For any codebase containing known architectural patterns (Repository, Factory,
 * Singleton, etc.), the Pattern Detector SHALL identify them with confidence
 * scores and correctly tag related entities.
 */

import * as fc from "fast-check"
import { CodeEntity } from "../../types"
import {
	PatternDetectorService,
	RepositoryPatternDetector,
	FactoryPatternDetector,
	SingletonPatternDetector,
	ServicePatternDetector,
	resetPatternDetectorService,
} from "../index"

describe("PatternDetector Property Tests", () => {
	let service: PatternDetectorService

	beforeEach(() => {
		resetPatternDetectorService()
		service = new PatternDetectorService()
		service.registerDetector(new RepositoryPatternDetector())
		service.registerDetector(new FactoryPatternDetector())
		service.registerDetector(new SingletonPatternDetector())
		service.registerDetector(new ServicePatternDetector())
	})

	afterEach(() => {
		resetPatternDetectorService()
	})

	const mockGetRelatedEntities = (_entityId: string, _depth?: number): CodeEntity[] => []

	// Arbitraries for generating pattern-like code structures
	const validClassName = fc.stringMatching(/^[A-Z][a-zA-Z]{2,15}$/)
	const validMethodName = fc.stringMatching(/^[a-z][a-zA-Z]{2,15}$/)

	const repositoryMethods = fc.constantFrom("findById", "findAll", "save", "delete", "update", "create", "remove")

	const factoryMethods = fc.constantFrom("create", "build", "make", "getInstance", "newInstance")

	const singletonMethods = fc.constantFrom("getInstance", "instance", "shared", "default")

	const serviceMethods = fc.constantFrom("get", "set", "update", "process", "handle", "execute")

	// Generate repository-like entities with unique IDs
	const repositoryEntities = fc
		.tuple(validClassName, fc.array(repositoryMethods, { minLength: 2, maxLength: 5 }))
		.map(([baseName, methods]) => {
			const className = `${baseName}Repository`
			const filePath = `/src/repositories/${className}.ts`

			const entities: CodeEntity[] = [
				{
					id: `${className}-class`,
					name: className,
					type: "class",
					filePath,
					startLine: 1,
					endLine: 100,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				},
			]

			let line = 10
			const usedMethods = new Set<string>()
			for (const method of methods) {
				if (usedMethods.has(method)) continue
				usedMethods.add(method)
				entities.push({
					id: `${className}-${method}-${line}`,
					name: method,
					type: "function",
					filePath,
					startLine: line,
					endLine: line + 10,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				})
				line += 15
			}

			return { entities, expectedPattern: "repository" as const }
		})

	// Generate factory-like entities with unique IDs
	const factoryEntities = fc
		.tuple(validClassName, fc.array(factoryMethods, { minLength: 1, maxLength: 3 }))
		.map(([baseName, methods]) => {
			const className = `${baseName}Factory`
			const filePath = `/src/factories/${className}.ts`

			const entities: CodeEntity[] = [
				{
					id: `${className}-class`,
					name: className,
					type: "class",
					filePath,
					startLine: 1,
					endLine: 50,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				},
			]

			let line = 10
			const usedMethods = new Set<string>()
			for (const method of methods) {
				if (usedMethods.has(method)) continue
				usedMethods.add(method)
				entities.push({
					id: `${className}-${method}-${line}`,
					name: method,
					type: "function",
					filePath,
					startLine: line,
					endLine: line + 10,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				})
				line += 15
			}

			return { entities, expectedPattern: "factory" as const }
		})

	// Generate singleton-like entities - must have getInstance method
	const singletonEntities = validClassName.map((baseName) => {
		const className = baseName
		const filePath = `/src/${className}.ts`

		const entities: CodeEntity[] = [
			{
				id: `${className}-class`,
				name: className,
				type: "class",
				filePath,
				startLine: 1,
				endLine: 40,
				startColumn: 0,
				endColumn: 0,
				metadata: {},
			},
			{
				id: `${className}-getInstance`,
				name: "getInstance",
				type: "function",
				filePath,
				startLine: 10,
				endLine: 15,
				startColumn: 0,
				endColumn: 0,
				metadata: {},
			},
			{
				id: `${className}-instance`,
				name: "instance",
				type: "variable",
				filePath,
				startLine: 5,
				endLine: 5,
				startColumn: 0,
				endColumn: 0,
				metadata: {},
			},
		]

		return { entities, expectedPattern: "singleton" as const }
	})

	// Generate service-like entities with unique IDs
	const serviceEntities = fc
		.tuple(validClassName, fc.array(serviceMethods, { minLength: 2, maxLength: 5 }))
		.map(([baseName, methods]) => {
			const className = `${baseName}Service`
			const filePath = `/src/services/${className}.ts`

			const entities: CodeEntity[] = [
				{
					id: `${className}-class`,
					name: className,
					type: "class",
					filePath,
					startLine: 1,
					endLine: 100,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				},
			]

			let line = 10
			const usedMethods = new Set<string>()
			for (const method of methods) {
				if (usedMethods.has(method)) continue
				usedMethods.add(method)
				entities.push({
					id: `${className}-${method}-${line}`,
					name: method,
					type: "function",
					filePath,
					startLine: line,
					endLine: line + 10,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				})
				line += 15
			}

			return { entities, expectedPattern: "service" as const }
		})

	describe("Property 9: Pattern Detection Accuracy", () => {
		it("should detect repository pattern with confidence > 0", () => {
			fc.assert(
				fc.property(repositoryEntities, ({ entities, expectedPattern }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
					const matchingPatterns = patterns.filter((p) => p.type === expectedPattern)

					expect(matchingPatterns.length).toBeGreaterThan(0)
					expect(matchingPatterns[0].confidenceScore).toBeGreaterThan(0)
				}),
				{ numRuns: 100 },
			)
		})

		it("should detect factory pattern with confidence > 0", () => {
			fc.assert(
				fc.property(factoryEntities, ({ entities, expectedPattern }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
					const matchingPatterns = patterns.filter((p) => p.type === expectedPattern)

					expect(matchingPatterns.length).toBeGreaterThan(0)
					expect(matchingPatterns[0].confidenceScore).toBeGreaterThan(0)
				}),
				{ numRuns: 100 },
			)
		})

		it("should detect singleton pattern with confidence > 0", () => {
			fc.assert(
				fc.property(singletonEntities, ({ entities, expectedPattern }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
					const matchingPatterns = patterns.filter((p) => p.type === expectedPattern)

					expect(matchingPatterns.length).toBeGreaterThan(0)
					expect(matchingPatterns[0].confidenceScore).toBeGreaterThan(0)
				}),
				{ numRuns: 100 },
			)
		})

		it("should detect service pattern with confidence > 0", () => {
			fc.assert(
				fc.property(serviceEntities, ({ entities, expectedPattern }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)
					const matchingPatterns = patterns.filter((p) => p.type === expectedPattern)

					expect(matchingPatterns.length).toBeGreaterThan(0)
					expect(matchingPatterns[0].confidenceScore).toBeGreaterThan(0)
				}),
				{ numRuns: 100 },
			)
		})

		it("should return patterns sorted by confidence score", () => {
			const patternEntities = fc.oneof(repositoryEntities, factoryEntities, serviceEntities)

			fc.assert(
				fc.property(fc.array(patternEntities, { minLength: 1, maxLength: 3 }), (entitySets) => {
					const allEntities = entitySets.flatMap((s) => s.entities)
					const patterns = service.detectPatterns(allEntities, mockGetRelatedEntities)

					for (let i = 1; i < patterns.length; i++) {
						expect(patterns[i - 1].confidenceScore).toBeGreaterThanOrEqual(patterns[i].confidenceScore)
					}
				}),
				{ numRuns: 50 },
			)
		})

		it("should include matched entities in pattern result", () => {
			const patternEntities = fc.oneof(repositoryEntities, factoryEntities, singletonEntities, serviceEntities)

			fc.assert(
				fc.property(patternEntities, ({ entities }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)

					for (const pattern of patterns) {
						expect(pattern.entities.length).toBeGreaterThan(0)
						// All matched entities should have names that exist in the input
						const inputNames = new Set(entities.map((e) => e.name))
						for (const matchedEntity of pattern.entities) {
							expect(inputNames.has(matchedEntity.name)).toBe(true)
						}
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should have confidence scores between 0 and 1", () => {
			const patternEntities = fc.oneof(repositoryEntities, factoryEntities, singletonEntities, serviceEntities)

			fc.assert(
				fc.property(patternEntities, ({ entities }) => {
					const patterns = service.detectPatterns(entities, mockGetRelatedEntities)

					for (const pattern of patterns) {
						expect(pattern.confidenceScore).toBeGreaterThanOrEqual(0)
						expect(pattern.confidenceScore).toBeLessThanOrEqual(1)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should not detect patterns in non-pattern entities", () => {
			const nonPatternEntities = fc.array(validClassName, { minLength: 1, maxLength: 3 }).map((names) =>
				names.map((name, i) => ({
					id: `entity-${i}`,
					name,
					type: "class" as const,
					filePath: `/src/${name}.ts`,
					startLine: 1,
					endLine: 10,
					startColumn: 0,
					endColumn: 0,
					metadata: {},
				})),
			)

			fc.assert(
				fc.property(nonPatternEntities, (entities) => {
					const highConfidenceService = new PatternDetectorService({ minConfidence: 0.8 })
					highConfidenceService.registerDetector(new RepositoryPatternDetector())
					highConfidenceService.registerDetector(new FactoryPatternDetector())
					highConfidenceService.registerDetector(new SingletonPatternDetector())

					const patterns = highConfidenceService.detectPatterns(entities, mockGetRelatedEntities)

					// With high confidence threshold, generic classes shouldn't match
					expect(patterns.length).toBe(0)
				}),
				{ numRuns: 50 },
			)
		})
	})
})
