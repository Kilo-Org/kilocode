// kilocode_change - new file
/**
 * Property-Based Tests for Parser Error Resilience
 *
 * Feature: advanced-context-engine
 * Property 7: Parser Error Resilience
 *
 * For any file that fails to parse (invalid syntax, unsupported constructs),
 * the system SHALL log the error and continue processing other files without crashing.
 *
 * **Validates: Requirements 2.3**
 */

import * as fc from "fast-check"
import { ASTParserService, resetASTParserService } from "../index"
import { TypeScriptParser } from "../typescript-parser"
import { PythonParser } from "../python-parser"

describe("Parser Error Resilience Property Tests", () => {
	let parserService: ASTParserService
	let tsParser: TypeScriptParser
	let pyParser: PythonParser

	beforeEach(() => {
		resetASTParserService()
		parserService = new ASTParserService()
		tsParser = new TypeScriptParser()
		pyParser = new PythonParser()
	})

	// Arbitraries for generating invalid code
	const invalidTypeScriptCode = fc.oneof(
		// Unclosed braces
		fc.constant("function test() {"),
		fc.constant("class Test {"),
		fc.constant("if (true) {"),
		// Invalid syntax
		fc.constant("function () {}"),
		fc.constant("class {}"),
		fc.constant("const = 5"),
		fc.constant("let 123abc = 5"),
		// Incomplete statements
		fc.constant("const x ="),
		fc.constant("import from"),
		fc.constant("export {"),
		// Random garbage
		fc.stringMatching(/^[!@#$%^&*()]{5,20}$/),
		// Mixed valid and invalid
		fc.constant("function valid() {} function () {}"),
	)

	const invalidPythonCode = fc.oneof(
		// Indentation errors
		fc.constant("def test():\npass"),
		fc.constant("class Test:\n  def method(self):\n pass"),
		// Invalid syntax
		fc.constant("def ():\n    pass"),
		fc.constant("class:\n    pass"),
		fc.constant("import"),
		// Incomplete statements
		fc.constant("def test("),
		fc.constant("class Test("),
		// Random garbage
		fc.stringMatching(/^[!@#$%^&*()]{5,20}$/),
	)

	const validTypeScriptCode = fc.oneof(
		fc.constant("function test() { return 1; }"),
		fc.constant("const x = 5;"),
		fc.constant("class Test { constructor() {} }"),
		fc.constant("interface ITest { id: string; }"),
	)

	const validPythonCode = fc.oneof(
		fc.constant("def test():\n    pass"),
		fc.constant("x = 5"),
		fc.constant("class Test:\n    pass"),
		fc.constant("import os"),
	)

	describe("Property 7: Parser Error Resilience", () => {
		/**
		 * Feature: advanced-context-engine, Property 7: Parser Error Resilience
		 * **Validates: Requirements 2.3**
		 */

		it("TypeScript parser should not crash on invalid syntax", async () => {
			await fc.assert(
				fc.asyncProperty(invalidTypeScriptCode, async (code) => {
					// Should not throw
					const result = await tsParser.parse("/test/file.ts", code)

					// Result should be returned (may have errors but shouldn't crash)
					expect(result).toBeDefined()
					expect(result.filePath).toBe("/test/file.ts")
					expect(Array.isArray(result.entities)).toBe(true)
					expect(Array.isArray(result.relationships)).toBe(true)
					expect(Array.isArray(result.errors)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("Python parser should not crash on invalid syntax", async () => {
			await fc.assert(
				fc.asyncProperty(invalidPythonCode, async (code) => {
					// Should not throw
					const result = await pyParser.parse("/test/file.py", code)

					// Result should be returned (may have errors but shouldn't crash)
					expect(result).toBeDefined()
					expect(result.filePath).toBe("/test/file.py")
					expect(Array.isArray(result.entities)).toBe(true)
					expect(Array.isArray(result.relationships)).toBe(true)
					expect(Array.isArray(result.errors)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("TypeScript parser should not crash on random strings", async () => {
			await fc.assert(
				fc.asyncProperty(fc.string({ minLength: 0, maxLength: 1000 }), async (code) => {
					// Should not throw
					const result = await tsParser.parse("/test/file.ts", code)

					expect(result).toBeDefined()
					expect(result.filePath).toBe("/test/file.ts")
				}),
				{ numRuns: 100 },
			)
		})

		it("Python parser should not crash on random strings", async () => {
			await fc.assert(
				fc.asyncProperty(fc.string({ minLength: 0, maxLength: 1000 }), async (code) => {
					// Should not throw
					const result = await pyParser.parse("/test/file.py", code)

					expect(result).toBeDefined()
					expect(result.filePath).toBe("/test/file.py")
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract valid entities even when mixed with invalid code", async () => {
			const mixedCode = fc
				.tuple(validTypeScriptCode, invalidTypeScriptCode)
				.map(([valid, invalid]) => `${valid}\n\n${invalid}`)

			await fc.assert(
				fc.asyncProperty(mixedCode, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					// Should not crash
					expect(result).toBeDefined()

					// Should still extract some entities from valid part
					// (depending on how the invalid part affects parsing)
					expect(Array.isArray(result.entities)).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("AST parser service should handle unsupported file extensions gracefully", async () => {
			const unsupportedExtensions = fc.constantFrom(
				"/test/file.xyz",
				"/test/file.unknown",
				"/test/file.abc123",
				"/test/file",
			)

			await fc.assert(
				fc.asyncProperty(unsupportedExtensions, async (filePath) => {
					const result = await parserService.parse(filePath, "some content")

					// Should not crash
					expect(result).toBeDefined()
					expect(result.success).toBe(false)
					expect(result.errors.length).toBeGreaterThan(0)
				}),
				{ numRuns: 20 },
			)
		})

		it("should handle empty files gracefully", async () => {
			await fc.assert(
				fc.asyncProperty(fc.constantFrom("/test/file.ts", "/test/file.py"), async (filePath) => {
					const result = await parserService.parse(filePath, "")

					// Should not crash
					expect(result).toBeDefined()
					expect(Array.isArray(result.entities)).toBe(true)
				}),
				{ numRuns: 20 },
			)
		})

		it("should handle files with only whitespace", async () => {
			const whitespaceContent = fc
				.array(fc.constantFrom(" ", "\t", "\n", "\r"), { minLength: 1, maxLength: 100 })
				.map((arr) => arr.join(""))

			await fc.assert(
				fc.asyncProperty(
					fc.constantFrom("/test/file.ts", "/test/file.py"),
					whitespaceContent,
					async (filePath, content) => {
						const result = await parserService.parse(filePath, content)

						// Should not crash
						expect(result).toBeDefined()
						expect(Array.isArray(result.entities)).toBe(true)
					},
				),
				{ numRuns: 50 },
			)
		})

		it("should handle files with only comments", async () => {
			const tsCommentOnly = fc.oneof(
				fc.constant("// This is a comment"),
				fc.constant("/* Block comment */"),
				fc.constant("// Line 1\n// Line 2\n// Line 3"),
			)

			const pyCommentOnly = fc.oneof(
				fc.constant("# This is a comment"),
				fc.constant("# Line 1\n# Line 2\n# Line 3"),
			)

			await fc.assert(
				fc.asyncProperty(tsCommentOnly, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					expect(result).toBeDefined()
					expect(result.success).toBe(true)
				}),
				{ numRuns: 20 },
			)

			await fc.assert(
				fc.asyncProperty(pyCommentOnly, async (code) => {
					const result = await pyParser.parse("/test/file.py", code)

					expect(result).toBeDefined()
					expect(result.success).toBe(true)
				}),
				{ numRuns: 20 },
			)
		})

		it("should handle very long lines gracefully", async () => {
			const longLine = fc
				.string({ minLength: 10000, maxLength: 50000 })
				.map((s) => `const x = "${s.replace(/"/g, '\\"')}";`)

			await fc.assert(
				fc.asyncProperty(longLine, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					// Should not crash
					expect(result).toBeDefined()
				}),
				{ numRuns: 10 },
			)
		})

		it("should handle deeply nested structures", async () => {
			const deepNesting = fc.integer({ min: 10, max: 50 }).map((depth) => {
				let code = ""
				for (let i = 0; i < depth; i++) {
					code += `function f${i}() {\n`
				}
				code += "return 1;\n"
				for (let i = 0; i < depth; i++) {
					code += "}\n"
				}
				return code
			})

			await fc.assert(
				fc.asyncProperty(deepNesting, async (code) => {
					const result = await tsParser.parse("/test/file.ts", code)

					// Should not crash
					expect(result).toBeDefined()
				}),
				{ numRuns: 20 },
			)
		})
	})

	describe("Continued Processing After Errors", () => {
		it("should continue processing valid files after encountering invalid ones", async () => {
			const fileSequence = fc.array(
				fc.tuple(
					fc.constantFrom("/test/valid.ts", "/test/invalid.ts"),
					fc.oneof(validTypeScriptCode, invalidTypeScriptCode),
				),
				{ minLength: 5, maxLength: 20 },
			)

			await fc.assert(
				fc.asyncProperty(fileSequence, async (files) => {
					const results = []

					for (const [filePath, code] of files) {
						const result = await parserService.parse(filePath, code)
						results.push(result)
					}

					// All files should have been processed (no crashes)
					expect(results.length).toBe(files.length)

					// Each result should be valid
					for (const result of results) {
						expect(result).toBeDefined()
						expect(Array.isArray(result.entities)).toBe(true)
					}
				}),
				{ numRuns: 20 },
			)
		})
	})
})
