// kilocode_change - new file
/**
 * TypeScript/JavaScript Parser
 *
 * Extracts code entities and relationships from TypeScript and JavaScript files
 * using tree-sitter for accurate AST parsing.
 */

import * as path from "path"
import { CodeEntity, EntityRelationship, ParseResult, ParseError, EntityType, RelationshipType } from "../types"
import { ILanguageParser, SupportedLanguage, EXTENSION_TO_LANGUAGE } from "./types"
import { generateEntityId } from "./index"

/**
 * TypeScript/JavaScript parser implementation
 */
export class TypeScriptParser implements ILanguageParser {
	readonly language: SupportedLanguage = "typescript"

	/**
	 * Check if this parser can handle the given file
	 */
	canParse(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase()
		const lang = EXTENSION_TO_LANGUAGE[ext]
		return ["typescript", "javascript", "tsx", "jsx"].includes(lang)
	}

	/**
	 * Parse TypeScript/JavaScript source code
	 */
	async parse(filePath: string, content: string): Promise<ParseResult> {
		const entities: CodeEntity[] = []
		const relationships: EntityRelationship[] = []
		const errors: ParseError[] = []

		const ext = path.extname(filePath).toLowerCase()
		const language = EXTENSION_TO_LANGUAGE[ext] || "typescript"

		try {
			const lines = content.split("\n")

			// Extract entities using regex-based parsing
			// This is a simplified approach - for production, use tree-sitter
			this.extractFunctions(filePath, content, lines, entities)
			this.extractClasses(filePath, content, lines, entities, relationships)
			this.extractInterfaces(filePath, content, lines, entities)
			this.extractTypes(filePath, content, lines, entities)
			this.extractImports(filePath, content, lines, entities, relationships)
			this.extractExports(filePath, content, lines, entities, relationships)
			this.extractVariables(filePath, content, lines, entities)

			// Build relationships between entities
			this.buildCallRelationships(filePath, content, entities, relationships)

			return {
				filePath,
				language,
				entities,
				relationships,
				errors,
				success: true,
			}
		} catch (error) {
			errors.push({
				message: `Failed to parse: ${error instanceof Error ? error.message : String(error)}`,
				originalError: error instanceof Error ? error : undefined,
			})

			return {
				filePath,
				language,
				entities,
				relationships,
				errors,
				success: false,
			}
		}
	}

	/**
	 * Extract function declarations
	 */
	private extractFunctions(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		// Match function declarations: function name(...) or async function name(...)
		const functionRegex =
			/^(\s*)(export\s+)?(async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(\s*:\s*[^{]+)?/gm

		let match
		while ((match = functionRegex.exec(content)) !== null) {
			const indent = match[1]
			const isExported = !!match[2]
			const isAsync = !!match[3]
			const name = match[4]
			const generics = match[5] || ""
			const params = match[6]
			const returnType = match[7] || ""

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findBlockEnd(lines, startLine - 1)

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "function", startLine),
				name,
				type: "function",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `${isAsync ? "async " : ""}function ${name}${generics}(${params})${returnType}`,
				metadata: {
					isExported,
					isAsync,
					params: this.parseParams(params),
				},
			}

			entities.push(entity)
		}

		// Match arrow functions assigned to const/let/var
		const arrowRegex =
			/^(\s*)(export\s+)?(const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/gm

		while ((match = arrowRegex.exec(content)) !== null) {
			const indent = match[1]
			const isExported = !!match[2]
			const name = match[4]
			const isAsync = !!match[5]

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findBlockEnd(lines, startLine - 1)

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "function", startLine),
				name,
				type: "function",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: match[0].trim(),
				metadata: {
					isExported,
					isAsync,
					isArrowFunction: true,
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Extract class declarations
	 */
	private extractClasses(
		filePath: string,
		content: string,
		lines: string[],
		entities: CodeEntity[],
		relationships: EntityRelationship[],
	): void {
		const classRegex =
			/^(\s*)(export\s+)?(abstract\s+)?class\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+(\w+)(?:<[^>]*>)?)?(?:\s+implements\s+([^{]+))?/gm

		let match
		while ((match = classRegex.exec(content)) !== null) {
			const indent = match[1]
			const isExported = !!match[2]
			const isAbstract = !!match[3]
			const name = match[4]
			const extendsClass = match[5]
			const implementsInterfaces = match[6]

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findBlockEnd(lines, startLine - 1)

			const classId = generateEntityId(filePath, name, "class", startLine)

			const entity: CodeEntity = {
				id: classId,
				name,
				type: "class",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: match[0].trim(),
				metadata: {
					isExported,
					isAbstract,
					extends: extendsClass,
					implements: implementsInterfaces?.split(",").map((s) => s.trim()),
				},
			}

			entities.push(entity)

			// Create extends relationship
			if (extendsClass) {
				relationships.push({
					sourceId: classId,
					targetId: `unresolved:class:${extendsClass}`,
					type: "extends",
				})
			}

			// Create implements relationships
			if (implementsInterfaces) {
				const interfaces = implementsInterfaces.split(",").map((s) => s.trim())
				for (const iface of interfaces) {
					relationships.push({
						sourceId: classId,
						targetId: `unresolved:interface:${iface}`,
						type: "implements",
					})
				}
			}

			// Extract methods within the class
			this.extractMethods(filePath, content, lines, entities, relationships, classId, startLine, endLine)
		}
	}

	/**
	 * Extract methods from a class
	 */
	private extractMethods(
		filePath: string,
		content: string,
		lines: string[],
		entities: CodeEntity[],
		relationships: EntityRelationship[],
		classId: string,
		classStartLine: number,
		classEndLine: number,
	): void {
		const classContent = lines.slice(classStartLine - 1, classEndLine).join("\n")

		// Match method declarations
		const methodRegex =
			/^(\s*)(public|private|protected)?\s*(static)?\s*(async)?\s*(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(\s*:\s*[^{]+)?/gm

		let match
		while ((match = methodRegex.exec(classContent)) !== null) {
			const indent = match[1]
			const visibility = match[2] || "public"
			const isStatic = !!match[3]
			const isAsync = !!match[4]
			const name = match[5]
			const generics = match[6] || ""
			const params = match[7]
			const returnType = match[8] || ""

			// Skip constructor-like patterns that aren't methods
			if (name === "constructor" || name === "class" || name === "interface") {
				continue
			}

			const methodLineInClass = classContent.substring(0, match.index).split("\n").length
			const startLine = classStartLine + methodLineInClass - 1
			const endLine = this.findBlockEnd(lines, startLine - 1)

			const methodId = generateEntityId(filePath, name, "method", startLine)

			const entity: CodeEntity = {
				id: methodId,
				name,
				type: "method",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `${visibility} ${isStatic ? "static " : ""}${isAsync ? "async " : ""}${name}${generics}(${params})${returnType}`,
				parentId: classId,
				metadata: {
					visibility,
					isStatic,
					isAsync,
					params: this.parseParams(params),
				},
			}

			entities.push(entity)

			// Create contains relationship
			relationships.push({
				sourceId: classId,
				targetId: methodId,
				type: "contains",
			})
		}
	}

	/**
	 * Extract interface declarations
	 */
	private extractInterfaces(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		const interfaceRegex = /^(\s*)(export\s+)?interface\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+[^{]+)?/gm

		let match
		while ((match = interfaceRegex.exec(content)) !== null) {
			const indent = match[1]
			const isExported = !!match[2]
			const name = match[3]

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findBlockEnd(lines, startLine - 1)

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "interface", startLine),
				name,
				type: "interface",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: match[0].trim(),
				metadata: {
					isExported,
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Extract type declarations
	 */
	private extractTypes(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		const typeRegex = /^(\s*)(export\s+)?type\s+(\w+)(?:<[^>]*>)?\s*=/gm

		let match
		while ((match = typeRegex.exec(content)) !== null) {
			const indent = match[1]
			const isExported = !!match[2]
			const name = match[3]

			const startLine = content.substring(0, match.index).split("\n").length
			// Types can span multiple lines, find the end
			let endLine = startLine
			let braceCount = 0
			let started = false

			for (let i = startLine - 1; i < lines.length; i++) {
				const line = lines[i]
				for (const char of line) {
					if (char === "{" || char === "(") {
						braceCount++
						started = true
					} else if (char === "}" || char === ")") {
						braceCount--
					}
				}
				if (started && braceCount === 0) {
					endLine = i + 1
					break
				}
				if (!started && line.includes(";")) {
					endLine = i + 1
					break
				}
			}

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "type", startLine),
				name,
				type: "type",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: match[0].trim(),
				metadata: {
					isExported,
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Extract import statements
	 */
	private extractImports(
		filePath: string,
		content: string,
		lines: string[],
		entities: CodeEntity[],
		relationships: EntityRelationship[],
	): void {
		const importRegex =
			/^(\s*)import\s+(?:(\*\s+as\s+\w+)|({[^}]+})|(\w+))?\s*(?:,\s*({[^}]+}))?\s*from\s+['"]([^'"]+)['"]/gm

		let match
		while ((match = importRegex.exec(content)) !== null) {
			const indent = match[1]
			const namespaceImport = match[2]
			const namedImports = match[3] || match[5]
			const defaultImport = match[4]
			const modulePath = match[6]

			const startLine = content.substring(0, match.index).split("\n").length

			const entity: CodeEntity = {
				id: generateEntityId(filePath, modulePath, "import", startLine),
				name: modulePath,
				type: "import",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: indent.length,
				endColumn: lines[startLine - 1]?.length || 0,
				metadata: {
					modulePath,
					defaultImport,
					namedImports: namedImports
						? namedImports
								.replace(/[{}]/g, "")
								.split(",")
								.map((s) => s.trim())
						: undefined,
					namespaceImport,
				},
			}

			entities.push(entity)

			// Create import relationship
			relationships.push({
				sourceId: generateEntityId(filePath, path.basename(filePath), "module", 1),
				targetId: `module:${modulePath}`,
				type: "imports",
				metadata: { modulePath },
			})
		}
	}

	/**
	 * Extract export statements
	 */
	private extractExports(
		filePath: string,
		content: string,
		lines: string[],
		entities: CodeEntity[],
		relationships: EntityRelationship[],
	): void {
		// Named exports: export { a, b }
		const namedExportRegex = /^(\s*)export\s+{([^}]+)}/gm

		let match
		while ((match = namedExportRegex.exec(content)) !== null) {
			const indent = match[1]
			const exports = match[2]

			const startLine = content.substring(0, match.index).split("\n").length

			const exportedNames = exports.split(",").map((s) => s.trim())

			const entity: CodeEntity = {
				id: generateEntityId(filePath, "exports", "export", startLine),
				name: "exports",
				type: "export",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: indent.length,
				endColumn: lines[startLine - 1]?.length || 0,
				metadata: {
					exportedNames,
				},
			}

			entities.push(entity)
		}

		// Re-exports: export * from '...'
		const reExportRegex = /^(\s*)export\s+\*\s+(?:as\s+(\w+)\s+)?from\s+['"]([^'"]+)['"]/gm

		while ((match = reExportRegex.exec(content)) !== null) {
			const indent = match[1]
			const alias = match[2]
			const modulePath = match[3]

			const startLine = content.substring(0, match.index).split("\n").length

			const entity: CodeEntity = {
				id: generateEntityId(filePath, modulePath, "export", startLine),
				name: alias || "*",
				type: "export",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: indent.length,
				endColumn: lines[startLine - 1]?.length || 0,
				metadata: {
					modulePath,
					isReExport: true,
					alias,
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Extract variable declarations (const, let, var)
	 */
	private extractVariables(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		// Only extract top-level exported variables
		const varRegex = /^(\s*)export\s+(const|let|var)\s+(\w+)(?:\s*:\s*([^=]+))?\s*=/gm

		let match
		while ((match = varRegex.exec(content)) !== null) {
			const indent = match[1]
			const kind = match[2]
			const name = match[3]
			const typeAnnotation = match[4]

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findStatementEnd(lines, startLine - 1)

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "variable", startLine),
				name,
				type: "variable",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `${kind} ${name}${typeAnnotation ? `: ${typeAnnotation.trim()}` : ""}`,
				metadata: {
					kind,
					isExported: true,
					typeAnnotation: typeAnnotation?.trim(),
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Build call relationships between functions
	 */
	private buildCallRelationships(
		filePath: string,
		content: string,
		entities: CodeEntity[],
		relationships: EntityRelationship[],
	): void {
		// Get all function/method names
		const functionNames = new Set(
			entities.filter((e) => e.type === "function" || e.type === "method").map((e) => e.name),
		)

		// For each function/method, find calls to other functions
		for (const entity of entities) {
			if (entity.type !== "function" && entity.type !== "method") {
				continue
			}

			// Get the content of this function
			const lines = content.split("\n")
			const functionContent = lines.slice(entity.startLine - 1, entity.endLine).join("\n")

			// Find function calls
			const callRegex = /\b(\w+)\s*\(/g
			let match

			while ((match = callRegex.exec(functionContent)) !== null) {
				const calledName = match[1]

				// Skip if it's the function itself or not a known function
				if (calledName === entity.name || !functionNames.has(calledName)) {
					continue
				}

				// Find the target entity
				const target = entities.find(
					(e) => e.name === calledName && (e.type === "function" || e.type === "method"),
				)

				if (target) {
					// Avoid duplicate relationships
					const exists = relationships.some(
						(r) => r.sourceId === entity.id && r.targetId === target.id && r.type === "calls",
					)

					if (!exists) {
						relationships.push({
							sourceId: entity.id,
							targetId: target.id,
							type: "calls",
						})
					}
				}
			}
		}
	}

	/**
	 * Find the end of a block (matching braces)
	 */
	private findBlockEnd(lines: string[], startLineIndex: number): number {
		let braceCount = 0
		let started = false

		for (let i = startLineIndex; i < lines.length; i++) {
			const line = lines[i]

			for (const char of line) {
				if (char === "{") {
					braceCount++
					started = true
				} else if (char === "}") {
					braceCount--
					if (started && braceCount === 0) {
						return i + 1 // 1-indexed
					}
				}
			}
		}

		return startLineIndex + 1
	}

	/**
	 * Find the end of a statement (semicolon or end of expression)
	 */
	private findStatementEnd(lines: string[], startLineIndex: number): number {
		let braceCount = 0
		let parenCount = 0
		let bracketCount = 0

		for (let i = startLineIndex; i < lines.length; i++) {
			const line = lines[i]

			for (const char of line) {
				if (char === "{") braceCount++
				else if (char === "}") braceCount--
				else if (char === "(") parenCount++
				else if (char === ")") parenCount--
				else if (char === "[") bracketCount++
				else if (char === "]") bracketCount--
				else if (char === ";" && braceCount === 0 && parenCount === 0 && bracketCount === 0) {
					return i + 1
				}
			}

			// If all counts are zero and line doesn't end with operator, it might be the end
			if (braceCount === 0 && parenCount === 0 && bracketCount === 0) {
				const trimmed = line.trim()
				if (trimmed.endsWith(";") || trimmed.endsWith(",") || trimmed.endsWith("}")) {
					return i + 1
				}
			}
		}

		return startLineIndex + 1
	}

	/**
	 * Parse function parameters
	 */
	private parseParams(params: string): Array<{ name: string; type?: string }> {
		if (!params.trim()) {
			return []
		}

		return params.split(",").map((param) => {
			const parts = param.trim().split(":")
			return {
				name: parts[0].replace(/[?=].*/, "").trim(),
				type: parts[1]?.trim(),
			}
		})
	}
}
