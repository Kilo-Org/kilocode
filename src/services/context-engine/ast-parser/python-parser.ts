// kilocode_change - new file
/**
 * Python Parser
 *
 * Extracts code entities and relationships from Python files
 * using regex-based parsing for accurate AST analysis.
 */

import * as path from "path"
import { CodeEntity, EntityRelationship, ParseResult, ParseError, EntityType, RelationshipType } from "../types"
import { ILanguageParser, SupportedLanguage, EXTENSION_TO_LANGUAGE } from "./types"
import { generateEntityId } from "./index"

/**
 * Python parser implementation
 */
export class PythonParser implements ILanguageParser {
	readonly language: SupportedLanguage = "python"

	/**
	 * Check if this parser can handle the given file
	 */
	canParse(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase()
		const lang = EXTENSION_TO_LANGUAGE[ext]
		return lang === "python"
	}

	/**
	 * Parse Python source code
	 */
	async parse(filePath: string, content: string): Promise<ParseResult> {
		const entities: CodeEntity[] = []
		const relationships: EntityRelationship[] = []
		const errors: ParseError[] = []

		try {
			const lines = content.split("\n")

			// Extract entities using regex-based parsing
			this.extractImports(filePath, content, lines, entities, relationships)
			this.extractClasses(filePath, content, lines, entities, relationships)
			this.extractFunctions(filePath, content, lines, entities)
			this.extractVariables(filePath, content, lines, entities)

			// Build relationships between entities
			this.buildCallRelationships(filePath, content, entities, relationships)

			return {
				filePath,
				language: "python",
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
				language: "python",
				entities,
				relationships,
				errors,
				success: false,
			}
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
		// Match: import module
		const importRegex = /^(\s*)import\s+(\w+(?:\.\w+)*)/gm

		let match
		while ((match = importRegex.exec(content)) !== null) {
			const indent = match[1]
			const moduleName = match[2]

			const startLine = content.substring(0, match.index).split("\n").length

			const entity: CodeEntity = {
				id: generateEntityId(filePath, moduleName, "import", startLine),
				name: moduleName,
				type: "import",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: indent.length,
				endColumn: lines[startLine - 1]?.length || 0,
				metadata: {
					modulePath: moduleName,
					importType: "module",
				},
			}

			entities.push(entity)

			// Create import relationship
			relationships.push({
				sourceId: generateEntityId(filePath, path.basename(filePath), "module", 1),
				targetId: `module:${moduleName}`,
				type: "imports",
				metadata: { modulePath: moduleName },
			})
		}

		// Match: from module import name1, name2
		const fromImportRegex = /^(\s*)from\s+(\w+(?:\.\w+)*)\s+import\s+(.+)/gm

		while ((match = fromImportRegex.exec(content)) !== null) {
			const indent = match[1]
			const moduleName = match[2]
			const importedNames = match[3]

			const startLine = content.substring(0, match.index).split("\n").length

			// Parse imported names (handle multiline imports)
			let names: string[] = []
			if (importedNames.includes("(")) {
				// Multiline import
				const endLine = this.findParenEnd(lines, startLine - 1)
				const importContent = lines.slice(startLine - 1, endLine).join("\n")
				const namesMatch = importContent.match(/\(([^)]+)\)/)
				if (namesMatch) {
					names = namesMatch[1]
						.split(",")
						.map((n) => n.trim())
						.filter((n) => n && !n.startsWith("#"))
				}
			} else {
				names = importedNames
					.split(",")
					.map((n) => n.trim().split(/\s+as\s+/)[0])
					.filter((n) => n && !n.startsWith("#"))
			}

			const entity: CodeEntity = {
				id: generateEntityId(filePath, moduleName, "import", startLine),
				name: moduleName,
				type: "import",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: indent.length,
				endColumn: lines[startLine - 1]?.length || 0,
				metadata: {
					modulePath: moduleName,
					importType: "from",
					namedImports: names,
				},
			}

			entities.push(entity)

			// Create import relationship
			relationships.push({
				sourceId: generateEntityId(filePath, path.basename(filePath), "module", 1),
				targetId: `module:${moduleName}`,
				type: "imports",
				metadata: { modulePath: moduleName, namedImports: names },
			})
		}
	}

	/**
	 * Extract class definitions
	 */
	private extractClasses(
		filePath: string,
		content: string,
		lines: string[],
		entities: CodeEntity[],
		relationships: EntityRelationship[],
	): void {
		// Match: class ClassName(BaseClass1, BaseClass2):
		const classRegex = /^(\s*)class\s+(\w+)(?:\s*\(([^)]*)\))?\s*:/gm

		let match
		while ((match = classRegex.exec(content)) !== null) {
			const indent = match[1]
			const name = match[2]
			const bases = match[3]

			const startLine = content.substring(0, match.index).split("\n").length
			const endLine = this.findBlockEnd(lines, startLine - 1, indent.length)

			const classId = generateEntityId(filePath, name, "class", startLine)

			// Parse base classes
			const baseClasses = bases
				? bases
						.split(",")
						.map((b) => b.trim())
						.filter((b) => b)
				: []

			// Extract docstring if present
			const docstring = this.extractDocstring(lines, startLine)

			const entity: CodeEntity = {
				id: classId,
				name,
				type: "class",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `class ${name}${bases ? `(${bases})` : ""}`,
				docstring,
				metadata: {
					bases: baseClasses,
					isPrivate: name.startsWith("_"),
				},
			}

			entities.push(entity)

			// Create extends relationships for base classes
			for (const base of baseClasses) {
				if (base && base !== "object") {
					relationships.push({
						sourceId: classId,
						targetId: `unresolved:class:${base}`,
						type: "extends",
					})
				}
			}

			// Extract methods within the class
			this.extractMethods(
				filePath,
				content,
				lines,
				entities,
				relationships,
				classId,
				startLine,
				endLine,
				indent.length,
			)
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
		classIndent: number,
	): void {
		const classContent = lines.slice(classStartLine, classEndLine).join("\n")
		const methodIndent = classIndent + 4 // Python standard indent

		// Match method definitions within class
		const methodRegex = new RegExp(
			`^(\\s{${methodIndent}})(?:@(\\w+)\\s*\\n\\s{${methodIndent}})?(async\\s+)?def\\s+(\\w+)\\s*\\(([^)]*)\\)(?:\\s*->\\s*([^:]+))?\\s*:`,
			"gm",
		)

		let match
		while ((match = methodRegex.exec(classContent)) !== null) {
			const indent = match[1]
			const decorator = match[2]
			const isAsync = !!match[3]
			const name = match[4]
			const params = match[5]
			const returnType = match[6]

			const methodLineInClass = classContent.substring(0, match.index).split("\n").length
			const startLine = classStartLine + methodLineInClass
			const endLine = this.findBlockEnd(lines, startLine - 1, indent.length)

			const methodId = generateEntityId(filePath, name, "method", startLine)

			// Extract docstring
			const docstring = this.extractDocstring(lines, startLine)

			const entity: CodeEntity = {
				id: methodId,
				name,
				type: "method",
				filePath,
				startLine,
				endLine,
				startColumn: indent.length,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `${isAsync ? "async " : ""}def ${name}(${params})${returnType ? ` -> ${returnType}` : ""}`,
				docstring,
				parentId: classId,
				metadata: {
					isAsync,
					isPrivate: name.startsWith("_") && !name.startsWith("__"),
					isDunder: name.startsWith("__") && name.endsWith("__"),
					isStatic: decorator === "staticmethod",
					isClassMethod: decorator === "classmethod",
					isProperty: decorator === "property",
					params: this.parseParams(params),
					returnType: returnType?.trim(),
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
	 * Extract function definitions (top-level)
	 */
	private extractFunctions(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		// Match top-level function definitions (no indentation or minimal)
		const functionRegex = /^(async\s+)?def\s+(\w+)\s*\(([^)]*)\)(?:\s*->\s*([^:]+))?\s*:/gm

		let match
		while ((match = functionRegex.exec(content)) !== null) {
			const isAsync = !!match[1]
			const name = match[2]
			const params = match[3]
			const returnType = match[4]

			const startLine = content.substring(0, match.index).split("\n").length

			// Check if this is a top-level function (not inside a class)
			const lineContent = lines[startLine - 1]
			const indent = lineContent.match(/^(\s*)/)?.[1]?.length || 0

			// Skip if indented (likely a method or nested function)
			if (indent > 0) {
				continue
			}

			const endLine = this.findBlockEnd(lines, startLine - 1, 0)

			// Extract docstring
			const docstring = this.extractDocstring(lines, startLine)

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "function", startLine),
				name,
				type: "function",
				filePath,
				startLine,
				endLine,
				startColumn: 0,
				endColumn: lines[endLine - 1]?.length || 0,
				signature: `${isAsync ? "async " : ""}def ${name}(${params})${returnType ? ` -> ${returnType}` : ""}`,
				docstring,
				metadata: {
					isAsync,
					isPrivate: name.startsWith("_"),
					params: this.parseParams(params),
					returnType: returnType?.trim(),
				},
			}

			entities.push(entity)
		}
	}

	/**
	 * Extract top-level variable assignments
	 */
	private extractVariables(filePath: string, content: string, lines: string[], entities: CodeEntity[]): void {
		// Match top-level variable assignments with type annotations
		const typedVarRegex = /^(\w+)\s*:\s*([^=\n]+)\s*=\s*/gm

		let match
		while ((match = typedVarRegex.exec(content)) !== null) {
			const name = match[1]
			const typeAnnotation = match[2]

			const startLine = content.substring(0, match.index).split("\n").length

			// Check if this is a top-level variable
			const lineContent = lines[startLine - 1]
			const indent = lineContent.match(/^(\s*)/)?.[1]?.length || 0

			if (indent > 0) {
				continue
			}

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "variable", startLine),
				name,
				type: "variable",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: 0,
				endColumn: lines[startLine - 1]?.length || 0,
				signature: `${name}: ${typeAnnotation.trim()}`,
				metadata: {
					typeAnnotation: typeAnnotation.trim(),
					isConstant: name === name.toUpperCase(),
				},
			}

			entities.push(entity)
		}

		// Match CONSTANT_STYLE variables (all caps)
		const constantRegex = /^([A-Z][A-Z0-9_]*)\s*=\s*/gm

		while ((match = constantRegex.exec(content)) !== null) {
			const name = match[1]

			const startLine = content.substring(0, match.index).split("\n").length

			// Check if this is a top-level constant
			const lineContent = lines[startLine - 1]
			const indent = lineContent.match(/^(\s*)/)?.[1]?.length || 0

			if (indent > 0) {
				continue
			}

			// Skip if already added as typed variable
			const exists = entities.some((e) => e.name === name && e.type === "variable" && e.startLine === startLine)
			if (exists) {
				continue
			}

			const entity: CodeEntity = {
				id: generateEntityId(filePath, name, "variable", startLine),
				name,
				type: "variable",
				filePath,
				startLine,
				endLine: startLine,
				startColumn: 0,
				endColumn: lines[startLine - 1]?.length || 0,
				signature: name,
				metadata: {
					isConstant: true,
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

				// Skip if it's the function itself, a keyword, or not a known function
				if (calledName === entity.name || !functionNames.has(calledName) || this.isPythonKeyword(calledName)) {
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
	 * Find the end of a Python block based on indentation
	 */
	private findBlockEnd(lines: string[], startLineIndex: number, baseIndent: number): number {
		const blockIndent = baseIndent + 4 // Python standard indent

		for (let i = startLineIndex + 1; i < lines.length; i++) {
			const line = lines[i]

			// Skip empty lines and comments
			if (line.trim() === "" || line.trim().startsWith("#")) {
				continue
			}

			// Get current line's indentation
			const currentIndent = line.match(/^(\s*)/)?.[1]?.length || 0

			// If we find a line with less or equal indentation to base, block ended
			if (currentIndent <= baseIndent) {
				return i // Return the line before this one
			}
		}

		return lines.length
	}

	/**
	 * Find the end of a parenthesized expression
	 */
	private findParenEnd(lines: string[], startLineIndex: number): number {
		let parenCount = 0
		let started = false

		for (let i = startLineIndex; i < lines.length; i++) {
			const line = lines[i]

			for (const char of line) {
				if (char === "(") {
					parenCount++
					started = true
				} else if (char === ")") {
					parenCount--
					if (started && parenCount === 0) {
						return i + 1
					}
				}
			}
		}

		return startLineIndex + 1
	}

	/**
	 * Extract docstring from the line after a definition
	 */
	private extractDocstring(lines: string[], startLine: number): string | undefined {
		// Look at the next non-empty line
		for (let i = startLine; i < Math.min(startLine + 3, lines.length); i++) {
			const line = lines[i].trim()

			// Check for triple-quoted string
			if (line.startsWith('"""') || line.startsWith("'''")) {
				const quote = line.startsWith('"""') ? '"""' : "'''"

				// Single line docstring
				if (line.endsWith(quote) && line.length > 6) {
					return line.slice(3, -3).trim()
				}

				// Multi-line docstring
				let docstring = line.slice(3)
				for (let j = i + 1; j < lines.length; j++) {
					const docLine = lines[j]
					if (docLine.includes(quote)) {
						docstring += "\n" + docLine.split(quote)[0]
						return docstring.trim()
					}
					docstring += "\n" + docLine
				}
			}
		}

		return undefined
	}

	/**
	 * Parse function parameters
	 */
	private parseParams(params: string): Array<{ name: string; type?: string; default?: string }> {
		if (!params.trim()) {
			return []
		}

		const result: Array<{ name: string; type?: string; default?: string }> = []

		// Split by comma, but handle nested brackets
		const parts: string[] = []
		let current = ""
		let depth = 0

		for (const char of params) {
			if (char === "(" || char === "[" || char === "{") {
				depth++
			} else if (char === ")" || char === "]" || char === "}") {
				depth--
			} else if (char === "," && depth === 0) {
				parts.push(current.trim())
				current = ""
				continue
			}
			current += char
		}
		if (current.trim()) {
			parts.push(current.trim())
		}

		for (const part of parts) {
			// Skip *args and **kwargs for now
			if (part.startsWith("*")) {
				continue
			}

			// Parse: name: type = default
			const defaultMatch = part.match(/^(\w+)(?:\s*:\s*([^=]+))?\s*=\s*(.+)$/)
			if (defaultMatch) {
				result.push({
					name: defaultMatch[1],
					type: defaultMatch[2]?.trim(),
					default: defaultMatch[3]?.trim(),
				})
				continue
			}

			// Parse: name: type
			const typedMatch = part.match(/^(\w+)\s*:\s*(.+)$/)
			if (typedMatch) {
				result.push({
					name: typedMatch[1],
					type: typedMatch[2].trim(),
				})
				continue
			}

			// Parse: name
			const nameMatch = part.match(/^(\w+)$/)
			if (nameMatch) {
				result.push({ name: nameMatch[1] })
			}
		}

		return result
	}

	/**
	 * Check if a name is a Python keyword
	 */
	private isPythonKeyword(name: string): boolean {
		const keywords = new Set([
			"False",
			"None",
			"True",
			"and",
			"as",
			"assert",
			"async",
			"await",
			"break",
			"class",
			"continue",
			"def",
			"del",
			"elif",
			"else",
			"except",
			"finally",
			"for",
			"from",
			"global",
			"if",
			"import",
			"in",
			"is",
			"lambda",
			"nonlocal",
			"not",
			"or",
			"pass",
			"raise",
			"return",
			"try",
			"while",
			"with",
			"yield",
			"print",
			"len",
			"range",
			"str",
			"int",
			"float",
			"list",
			"dict",
			"set",
			"tuple",
			"type",
			"isinstance",
			"hasattr",
			"getattr",
			"setattr",
			"super",
			"self",
			"cls",
		])
		return keywords.has(name)
	}
}
