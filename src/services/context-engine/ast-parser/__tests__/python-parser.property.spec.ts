// kilocode_change - new file
/**
 * Property-Based Tests for Python Parser
 *
 * Feature: advanced-context-engine
 * Property 1: Entity Extraction Completeness (Python)
 *
 * For any valid Python source code file, parsing the file
 * SHALL extract all declared entities (functions, classes, variables)
 * with correct metadata (name, type, location).
 *
 * **Validates: Requirements 2.2**
 */

import * as fc from "fast-check"
import { PythonParser } from "../python-parser"

describe("PythonParser Property Tests", () => {
	let parser: PythonParser

	beforeEach(() => {
		parser = new PythonParser()
	})

	// Arbitraries for generating valid Python code constructs
	const validFunctionName = fc.stringMatching(/^[a-z][a-z0-9_]{2,15}$/)
	const validClassName = fc.stringMatching(/^[A-Z][a-zA-Z0-9]{2,15}$/)
	const validConstantName = fc.stringMatching(/^[A-Z][A-Z0-9_]{2,10}$/)

	const pythonType = fc.oneof(
		fc.constant("str"),
		fc.constant("int"),
		fc.constant("float"),
		fc.constant("bool"),
		fc.constant("None"),
		fc.constant("Any"),
		fc.constant("List[str]"),
		fc.constant("Dict[str, int]"),
	)

	const functionDeclaration = fc.tuple(validFunctionName, pythonType).map(([name, returnType]) => ({
		code: `def ${name}() -> ${returnType}:\n    pass`,
		expectedName: name,
		expectedType: "function" as const,
	}))

	const asyncFunctionDeclaration = fc.tuple(validFunctionName, pythonType).map(([name, returnType]) => ({
		code: `async def ${name}() -> ${returnType}:\n    pass`,
		expectedName: name,
		expectedType: "function" as const,
	}))

	const classDeclaration = validClassName.map((name) => ({
		code: `class ${name}:\n    def __init__(self):\n        pass`,
		expectedName: name,
		expectedType: "class" as const,
	}))

	const classWithBaseDeclaration = fc.tuple(validClassName, validClassName).map(([name, base]) => ({
		code: `class ${name}(${base}):\n    def __init__(self):\n        pass`,
		expectedName: name,
		expectedType: "class" as const,
	}))

	const constantDeclaration = validConstantName.map((name) => ({
		code: `${name} = 42`,
		expectedName: name,
		expectedType: "variable" as const,
	}))

	const typedVariableDeclaration = fc.tuple(validFunctionName, pythonType).map(([name, type]) => ({
		code: `${name}: ${type} = None`,
		expectedName: name,
		expectedType: "variable" as const,
	}))

	// Code constructs that the parser can extract
	const codeConstruct = fc.oneof(
		functionDeclaration,
		asyncFunctionDeclaration,
		classDeclaration,
		classWithBaseDeclaration,
		constantDeclaration,
		typedVariableDeclaration,
	)

	describe("Property 1: Entity Extraction Completeness (Python)", () => {
		/**
		 * Feature: advanced-context-engine, Property 1: Entity Extraction Completeness (Python)
		 * **Validates: Requirements 2.2**
		 */

		it("should extract single entity with correct name and type", async () => {
			await fc.assert(
				fc.asyncProperty(codeConstruct, async (construct) => {
					const result = await parser.parse("/test/file.py", construct.code)

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
					const result = await parser.parse("/test/file.py", code)

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
				fc.constant("/src/main.py"),
				fc.constant("/lib/utils.py"),
				fc.constant("/test/test_spec.py"),
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
					const result = await parser.parse("/test/file.py", construct.code)

					expect(result.success).toBe(true)

					for (const entity of result.entities) {
						expect(entity.startLine).toBeGreaterThanOrEqual(1)
						expect(entity.endLine).toBeGreaterThanOrEqual(entity.startLine)
					}
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract async functions with isAsync metadata", async () => {
			await fc.assert(
				fc.asyncProperty(asyncFunctionDeclaration, async (construct) => {
					const result = await parser.parse("/test/file.py", construct.code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === construct.expectedName)
					expect(entity).toBeDefined()
					expect(entity?.metadata.isAsync).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract class inheritance relationships", async () => {
			await fc.assert(
				fc.asyncProperty(classWithBaseDeclaration, async (construct) => {
					const result = await parser.parse("/test/file.py", construct.code)

					expect(result.success).toBe(true)

					// Should have extends relationship
					const extendsRel = result.relationships.find((r) => r.type === "extends")
					expect(extendsRel).toBeDefined()
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Import Extraction", () => {
		const moduleImport = fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/).map((name) => ({
			code: `import ${name}`,
			expectedName: name,
			expectedType: "import" as const,
		}))

		const fromImport = fc
			.tuple(fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/), fc.stringMatching(/^[a-z][a-z0-9_]{2,10}$/))
			.map(([module, name]) => ({
				code: `from ${module} import ${name}`,
				expectedName: module,
				expectedType: "import" as const,
			}))

		it("should extract import statements", async () => {
			await fc.assert(
				fc.asyncProperty(moduleImport, async (construct) => {
					const result = await parser.parse("/test/file.py", construct.code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === construct.expectedName)
					expect(entity).toBeDefined()
					expect(entity?.type).toBe("import")
				}),
				{ numRuns: 100 },
			)
		})

		it("should extract from...import statements", async () => {
			await fc.assert(
				fc.asyncProperty(fromImport, async (construct) => {
					const result = await parser.parse("/test/file.py", construct.code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === construct.expectedName)
					expect(entity).toBeDefined()
					expect(entity?.type).toBe("import")
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Method Extraction", () => {
		const classWithMethod = fc.tuple(validClassName, validFunctionName).map(([className, methodName]) => ({
			code: `class ${className}:\n    def ${methodName}(self):\n        pass`,
			className,
			methodName,
		}))

		it("should extract methods from classes", async () => {
			await fc.assert(
				fc.asyncProperty(classWithMethod, async ({ code, className, methodName }) => {
					const result = await parser.parse("/test/file.py", code)

					expect(result.success).toBe(true)

					// Find the class
					const classEntity = result.entities.find((e) => e.name === className && e.type === "class")
					expect(classEntity).toBeDefined()

					// Find the method
					const methodEntity = result.entities.find((e) => e.name === methodName && e.type === "method")
					expect(methodEntity).toBeDefined()
					expect(methodEntity?.parentId).toBe(classEntity?.id)
				}),
				{ numRuns: 100 },
			)
		})

		it("should detect special methods (dunder methods)", async () => {
			const classWithDunder = validClassName.map((className) => ({
				code: `class ${className}:\n    def __init__(self):\n        pass\n    def __str__(self):\n        return ""`,
				className,
			}))

			await fc.assert(
				fc.asyncProperty(classWithDunder, async ({ code, className }) => {
					const result = await parser.parse("/test/file.py", code)

					expect(result.success).toBe(true)

					const initMethod = result.entities.find((e) => e.name === "__init__" && e.type === "method")
					expect(initMethod).toBeDefined()
					expect(initMethod?.metadata.isDunder).toBe(true)
				}),
				{ numRuns: 100 },
			)
		})
	})

	describe("Docstring Extraction", () => {
		const functionWithDocstring = validFunctionName.map((name) => ({
			code: `def ${name}():\n    """This is a docstring."""\n    pass`,
			name,
			docstring: "This is a docstring.",
		}))

		it("should extract docstrings from functions", async () => {
			await fc.assert(
				fc.asyncProperty(functionWithDocstring, async ({ code, name, docstring }) => {
					const result = await parser.parse("/test/file.py", code)

					expect(result.success).toBe(true)

					const entity = result.entities.find((e) => e.name === name)
					expect(entity).toBeDefined()
					expect(entity?.docstring).toBe(docstring)
				}),
				{ numRuns: 100 },
			)
		})
	})
})
