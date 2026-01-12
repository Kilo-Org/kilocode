// kilocode_change - new file
/**
 * Property-Based Tests for AST Round-Trip
 *
 * Feature: advanced-context-engine
 * Property 6: AST Round-Trip
 *
 * For any valid AST produced by parsing, serializing and deserializing
 * the AST SHALL produce an equivalent structure.
 *
 * **Validates: Requirements 2.6**
 */

import * as fc from "fast-check"
import { TypeScriptParser } from "../typescript-parser"
import { PythonParser } from "../python-parser"
import { CodeEntity, EntityRelationship, ParseResult } from "../../types"

describe("AST Round-Trip Property Tests", () => {
	let tsParser: TypeScriptParser
	let pyParser: PythonParser

	beforeEach(() => {
		tsParser = new TypeScriptParser()
		pyParser = new PythonParser()
	})

	/**
	 * Serialize a ParseResult to JSON and back
	 */
	function roundTrip(result: ParseResult): ParseResult {
		const serialized = JSON.stringify(result)
		return JSON.parse(serialized)
	}

	/**
	 * Compare two CodeEntity objects for equivalence
	 */
	function entitiesEqual(a: CodeEntity, b: CodeEntity): boolean {
		return (
			a.id === b.id &&
			a.name === b.name &&
			a.type === b.type &&
			a.filePath === b.filePath &&
			a.startLine === b.startLine &&
			a.endLine === b.endLine &&
			a.startColumn === b.startColumn &&
			a.endColumn === b.endColumn &&
			a.signature === b.signature &&
			a.docstring === b.docstring &&
			a.parentId === b.parentId &&
			JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
		)
	}

	/**
	 * Compare two EntityRelationship objects for equivalence
	 */
	function relationshipsEqual(a: EntityRelationship, b: EntityRelationship): boolean {
		return (
			a.sourceId === b.sourceId &&
			a.targetId === b.targetId &&
			a.type === b.type &&
			JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
		)
	}

	/**
	 * Compare two ParseResult objects for equivalence
	 */
	function parseResultsEqual(a: ParseResult, b: ParseResult): boolean {
		if (a.filePath !== b.filePath) return false
		if (a.language !== b.language) return false
		if (a.success !== b.success) return false
		if (a.entities.length !== b.entities.length) return false
		if (a.relationships.length !== b.relationships.length) return false
		if (a.errors.length !== b.errors.length) return false

		// Compare entities
		for (let i = 0; i < a.entities.length; i++) {
			if (!entitiesEqual(a.entities[i], b.entities[i])) {
				return false
			}
		}

		// Compare relationships
		for (let i = 0; i < a.relationships.length; i++) {
			if (!relationshipsEqual(a.relationships[i], b.relationships[i])) {
				return false
			}
		}

		// Compare errors
		for (let i = 0; i < a.errors.length; i++) {
			if (a.errors[i].message !== b.errors[i].message) {
				return false
			}
		}

		return true
	}

	// Arbitraries for generating valid code
	const validFunctionName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,15}$/)
	const validClassName = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{2,15}$/)

	const typeScriptCode = fc.oneof(
		validFunctionName.map((name) => `function ${name}(): void { }`),
		validFunctionName.map((name) => `async function ${name}(): Promise<void> { }`),
		validClassName.map((name) => `class ${name} { constructor() {} }`),
		validClassName.map((name) => `interface ${name} { id: string; }`),
		validClassName.map((name) => `type ${name} = string | number;`),
		validFunctionName.map((name) => `export const ${name}: string = "test";`),
	)

	const pythonCode = fc.oneof(
		validFunctionName.map((name) => `def ${name}():\n    pass`),
		validFunctionName.map((name) => `async def ${name}():\n    pass`),
		validClassName.map((name) => `class ${name}:\n    pass`),
		validClassName.map((name) => `class ${name}(Base):\n    pass`),
		fc.stringMatching(/^[A-Z][A-Z0-9_]{2,10}$/).map((name) => `${name} = 42`),
	)

	describe("Property 6: AST Round-Trip", () => {
		/**
		 * Feature: advanced-context-engine, Property 6: AST Round-Trip
		 * **Validates: Requirements 2.6**
		 */

		it("TypeScript ParseResult should survive JSON round-trip", async () => {
			await fc.assert(
				fc.asyncProperty(typeScriptCode, async (code) => {
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					expect(parseResultsEqual(original, roundTripped)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("Python ParseResult should survive JSON round-trip", async () => {
			await fc.assert(
				fc.asyncProperty(pythonCode, async (code) => {
					const original = await pyParser.parse("/test/file.py", code)
					const roundTripped = roundTrip(original)

					expect(parseResultsEqual(original, roundTripped)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("Multiple TypeScript entities should survive round-trip", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(typeScriptCode, { minLength: 1, maxLength: 5 }), async (codeSnippets) => {
					const code = codeSnippets.join("\n\n")
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					expect(parseResultsEqual(original, roundTripped)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("Multiple Python entities should survive round-trip", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(pythonCode, { minLength: 1, maxLength: 5 }), async (codeSnippets) => {
					const code = codeSnippets.join("\n\n")
					const original = await pyParser.parse("/test/file.py", code)
					const roundTripped = roundTrip(original)

					expect(parseResultsEqual(original, roundTripped)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("Entity IDs should be deterministic", async () => {
			await fc.assert(
				fc.asyncProperty(typeScriptCode, async (code) => {
					// Parse the same code twice
					const result1 = await tsParser.parse("/test/file.ts", code)
					const result2 = await tsParser.parse("/test/file.ts", code)

					// Entity IDs should be the same
					expect(result1.entities.length).toBe(result2.entities.length)
					for (let i = 0; i < result1.entities.length; i++) {
						expect(result1.entities[i].id).toBe(result2.entities[i].id)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("Relationship IDs should reference valid entities", async () => {
			const codeWithRelationships = fc
				.tuple(validClassName, validFunctionName)
				.map(([className, methodName]) => `class ${className} {\n  ${methodName}() { return 1; }\n}`)

			await fc.assert(
				fc.asyncProperty(codeWithRelationships, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(result)

					// All relationship source/target IDs should exist in entities
					const entityIds = new Set(roundTripped.entities.map((e) => e.id))

					for (const rel of roundTripped.relationships) {
						// Source should always be a valid entity
						expect(entityIds.has(rel.sourceId)).toBe(true)

						// Target might be unresolved (external reference) or valid entity
						const isUnresolved = rel.targetId.startsWith("unresolved:")
						const isModule = rel.targetId.startsWith("module:")
						const isValidEntity = entityIds.has(rel.targetId)

						expect(isUnresolved || isModule || isValidEntity).toBe(true)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("Line numbers should be preserved through round-trip", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(typeScriptCode, { minLength: 2, maxLength: 5 }), async (codeSnippets) => {
					const code = codeSnippets.join("\n\n")
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					for (let i = 0; i < original.entities.length; i++) {
						expect(roundTripped.entities[i].startLine).toBe(original.entities[i].startLine)
						expect(roundTripped.entities[i].endLine).toBe(original.entities[i].endLine)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("Metadata should be preserved through round-trip", async () => {
			const asyncFunction = validFunctionName.map((name) => `async function ${name}(): Promise<void> { }`)

			await fc.assert(
				fc.asyncProperty(asyncFunction, async (code) => {
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					for (let i = 0; i < original.entities.length; i++) {
						expect(JSON.stringify(roundTripped.entities[i].metadata)).toBe(
							JSON.stringify(original.entities[i].metadata),
						)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("Empty parse results should survive round-trip", async () => {
			const emptyCode = fc.constant("")

			await fc.assert(
				fc.asyncProperty(emptyCode, async (code) => {
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					expect(parseResultsEqual(original, roundTripped)).toBe(true)
				}),
				{ numRuns: 10 },
			)
		})

		it("Parse results with errors should survive round-trip", async () => {
			const invalidCode = fc.constant("function () {}")

			await fc.assert(
				fc.asyncProperty(invalidCode, async (code) => {
					const original = await tsParser.parse("/test/file.ts", code)
					const roundTripped = roundTrip(original)

					// Note: originalError won't survive JSON serialization, but message should
					expect(roundTripped.filePath).toBe(original.filePath)
					expect(roundTripped.language).toBe(original.language)
					expect(roundTripped.success).toBe(original.success)
				}),
				{ numRuns: 10 },
			)
		})
	})

	describe("CodeEntity Serialization", () => {
		it("All CodeEntity fields should be JSON-serializable", async () => {
			await fc.assert(
				fc.asyncProperty(typeScriptCode, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					for (const entity of result.entities) {
						// Should not throw
						const serialized = JSON.stringify(entity)
						const deserialized = JSON.parse(serialized)

						expect(deserialized.id).toBe(entity.id)
						expect(deserialized.name).toBe(entity.name)
						expect(deserialized.type).toBe(entity.type)
					}
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("EntityRelationship Serialization", () => {
		it("All EntityRelationship fields should be JSON-serializable", async () => {
			const codeWithRelationships = validClassName.map((name) => `class ${name} extends Base { method() {} }`)

			await fc.assert(
				fc.asyncProperty(codeWithRelationships, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					for (const rel of result.relationships) {
						// Should not throw
						const serialized = JSON.stringify(rel)
						const deserialized = JSON.parse(serialized)

						expect(deserialized.sourceId).toBe(rel.sourceId)
						expect(deserialized.targetId).toBe(rel.targetId)
						expect(deserialized.type).toBe(rel.type)
					}
				}),
				{ numRuns: 100 },
			)
		})
	})
})
