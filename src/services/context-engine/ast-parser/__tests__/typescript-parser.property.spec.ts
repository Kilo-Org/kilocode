// kilocode_change - new file
/**
 * Property-Based Tests for TypeScript Parser
 *
 * Feature: advanced-context-engine
 * Property 1: Entity Extraction Completeness
 *
 * For any valid source code file in a supported language, parsing the file
 * SHALL extract all declared entities (functions, classes, interfaces, types,
 * variables) with correct metadata (name, type, location).
 */

import * as fc from "fast-check"
import { TypeScriptParser } from "../typescript-parser"

describe("TypeScriptParser Property Tests", () => {
	let parser: TypeScriptParser

	beforeEach(() => {
		parser = new TypeScriptParser()
	})

	// Arbitraries for generating valid TypeScript code constructs
	// Use uppercase first letter for class-like names, lowercase for functions
	const validFunctionName = fc.stringMatching(/^[a-z][a-zA-Z0-9]{2,15}$/)
	const validClassName = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{2,15}$/)

	const typeAnnotation = fc.oneof(
		fc.constant("string"),
		fc.constant("number"),
		fc.constant("boolean"),
		fc.constant("void"),
		fc.constant("any"),
		fc.constant("unknown"),
	)

	const functionDeclaration = fc.tuple(validFunctionName, typeAnnotation).map(([name, returnType]) => ({
		code: `function ${name}(): ${returnType} { return undefined as any; }`,
		expectedName: name,
		expectedType: "function" as const,
	}))

	const asyncFunctionDeclaration = fc.tuple(validFunctionName, typeAnnotation).map(([name, returnType]) => ({
		code: `async function ${name}(): Promise<${returnType}> { return undefined as any; }`,
		expectedName: name,
		expectedType: "function" as const,
	}))

	const classDeclaration = validClassName.map((name) => ({
		code: `class ${name} { constructor() {} }`,
		expectedName: name,
		expectedType: "class" as const,
	}))

	const interfaceDeclaration = validClassName.map((name) => ({
		code: `interface ${name} { id: string; }`,
		expectedName: name,
		expectedType: "interface" as const,
	}))

	const typeDeclaration = validClassName.map((name) => ({
		code: `type ${name} = string | number;`,
		expectedName: name,
		expectedType: "type" as const,
	}))

	// Parser only extracts exported variables, so we test with export
	const exportedConstDeclaration = fc.tuple(validFunctionName, typeAnnotation).map(([name, type]) => ({
		code: `export const ${name}: ${type} = undefined as any;`,
		expectedName: name,
		expectedType: "variable" as const,
	}))

	// Code constructs that the parser can extract
	const codeConstruct = fc.oneof(
		functionDeclaration,
		asyncFunctionDeclaration,
		classDeclaration,
		interfaceDeclaration,
		typeDeclaration,
		exportedConstDeclaration,
	)

	describe("Property 1: Entity Extraction Completeness", () => {
		it("should extract single entity with correct name and type", async () => {
			await fc.assert(
				fc.asyncProperty(codeConstruct, async (construct) => {
					const result = await parser.parse("/test/file.ts", construct.code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === construct.expectedName)
					expect(entity).toBeDefined()
					expect(entity?.type).toBe(construct.expectedType)
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract multiple entities from combined code", async () => {
			await fc.assert(
				fc.asyncProperty(fc.array(codeConstruct, { minLength: 1, maxLength: 5 }), async (constructs) => {
					const code = constructs.map((c) => c.code).join("\n\n")
					const result = await parser.parse("/test/file.ts", code)

					expect(result.success).toBe(true)

					for (const construct of constructs) {
						const entity = result.entities.find((e) => e.name === construct.expectedName)
						expect(entity).toBeDefined()
						expect(entity?.type).toBe(construct.expectedType)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract entities with correct file path", async () => {
			const filePaths = fc.oneof(
				fc.constant("/src/index.ts"),
				fc.constant("/lib/utils.ts"),
				fc.constant("/test/spec.tsx"),
			)

			await fc.assert(
				fc.asyncProperty(codeConstruct, filePaths, async (construct, filePath) => {
					const result = await parser.parse(filePath, construct.code)

					expect(result.success).toBe(true)

					for (const entity of result.entities) {
						expect(entity.filePath).toBe(filePath)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract entities with valid line numbers", async () => {
			await fc.assert(
				fc.asyncProperty(codeConstruct, async (construct) => {
					const result = await parser.parse("/test/file.ts", construct.code)

					expect(result.success).toBe(true)

					for (const entity of result.entities) {
						expect(entity.startLine).toBeGreaterThanOrEqual(1)
						expect(entity.endLine).toBeGreaterThanOrEqual(entity.startLine)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should handle exported entities", async () => {
			// Only test constructs that support export keyword properly
			const exportableConstruct = fc
				.oneof(
					functionDeclaration,
					asyncFunctionDeclaration,
					classDeclaration,
					interfaceDeclaration,
					typeDeclaration,
				)
				.map((c) => ({
					...c,
					code: `export ${c.code}`,
				}))

			await fc.assert(
				fc.asyncProperty(exportableConstruct, async (construct) => {
					const result = await parser.parse("/test/file.ts", construct.code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === construct.expectedName)
					expect(entity).toBeDefined()
					expect(entity?.metadata.isExported).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})
	})
})
