// kilocode_change - new file
/**
 * AST Parser Service
 *
 * Parses source code files and extracts code entities and relationships
 * using tree-sitter for accurate AST analysis.
 */

import * as path from "path"
import * as fs from "fs/promises"
import { CodeEntity, EntityRelationship, ParseResult, ParseError } from "../types"
import { IASTParserService, ILanguageParser, SupportedLanguage, EXTENSION_TO_LANGUAGE, ParseOptions } from "./types"

// Re-export types
export * from "./types"

/**
 * Default parse options
 */
const DEFAULT_OPTIONS: ParseOptions = {
	includeDocstrings: true,
	includePrivate: true,
	maxFileSize: 1024 * 1024, // 1MB
}

/**
 * AST Parser Service implementation
 *
 * Uses tree-sitter to parse source files and extract code entities
 * and their relationships for the Knowledge Graph.
 */
export class ASTParserService implements IASTParserService {
	private parsers: Map<SupportedLanguage, ILanguageParser> = new Map()
	private options: ParseOptions

	constructor(options: Partial<ParseOptions> = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options }
	}

	/**
	 * Parse a file and extract code entities and relationships
	 */
	async parse(filePath: string, content?: string): Promise<ParseResult> {
		const errors: ParseError[] = []
		const entities: CodeEntity[] = []
		const relationships: EntityRelationship[] = []

		try {
			// Get file extension and determine language
			const ext = path.extname(filePath).toLowerCase()
			const language = EXTENSION_TO_LANGUAGE[ext]

			if (!language) {
				return {
					filePath,
					language: "unknown",
					entities: [],
					relationships: [],
					errors: [{ message: `Unsupported file extension: ${ext}` }],
					success: false,
				}
			}

			// Read file content if not provided
			if (!content) {
				try {
					const stats = await fs.stat(filePath)
					if (stats.size > (this.options.maxFileSize || DEFAULT_OPTIONS.maxFileSize!)) {
						return {
							filePath,
							language,
							entities: [],
							relationships: [],
							errors: [{ message: `File too large: ${stats.size} bytes` }],
							success: false,
						}
					}
					content = await fs.readFile(filePath, "utf-8")
				} catch (error) {
					return {
						filePath,
						language,
						entities: [],
						relationships: [],
						errors: [
							{
								message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
								originalError: error instanceof Error ? error : undefined,
							},
						],
						success: false,
					}
				}
			}

			// Check for registered custom parser
			const customParser = this.parsers.get(language)
			if (customParser) {
				return customParser.parse(filePath, content)
			}

			// Use built-in TypeScript/JavaScript parser
			if (["typescript", "javascript", "tsx", "jsx"].includes(language)) {
				const { TypeScriptParser } = await import("./typescript-parser")
				const parser = new TypeScriptParser()
				return parser.parse(filePath, content)
			}

			// Use built-in Python parser
			if (language === "python") {
				const { PythonParser } = await import("./python-parser")
				const parser = new PythonParser()
				return parser.parse(filePath, content)
			}

			// For other languages, return basic result
			// TODO: Implement parsers for other languages
			return {
				filePath,
				language,
				entities: [],
				relationships: [],
				errors: [{ message: `Parser not yet implemented for: ${language}` }],
				success: false,
			}
		} catch (error) {
			return {
				filePath,
				language: "unknown",
				entities,
				relationships,
				errors: [
					{
						message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
						originalError: error instanceof Error ? error : undefined,
					},
				],
				success: false,
			}
		}
	}

	/**
	 * Get list of supported languages
	 */
	getSupportedLanguages(): SupportedLanguage[] {
		const builtIn: SupportedLanguage[] = ["typescript", "javascript", "tsx", "jsx", "python"]
		const custom = Array.from(this.parsers.keys())
		return [...new Set([...builtIn, ...custom])]
	}

	/**
	 * Check if a file can be parsed
	 */
	canParse(filePath: string): boolean {
		const ext = path.extname(filePath).toLowerCase()
		const language = EXTENSION_TO_LANGUAGE[ext]

		if (!language) {
			return false
		}

		// Check custom parsers
		if (this.parsers.has(language)) {
			return true
		}

		// Check built-in support
		return ["typescript", "javascript", "tsx", "jsx", "python"].includes(language)
	}

	/**
	 * Register a custom language parser
	 */
	registerParser(parser: ILanguageParser): void {
		this.parsers.set(parser.language, parser)
	}
}

/**
 * Generate a unique entity ID
 */
export function generateEntityId(filePath: string, name: string, type: string, line: number): string {
	// Create a deterministic ID based on file path, name, type, and line
	const normalized = path.normalize(filePath).replace(/\\/g, "/")
	return `${normalized}:${type}:${name}:${line}`
}

/**
 * Create a singleton instance
 */
let instance: ASTParserService | null = null

export function getASTParserService(options?: Partial<ParseOptions>): ASTParserService {
	if (!instance) {
		instance = new ASTParserService(options)
	}
	return instance
}

export function resetASTParserService(): void {
	instance = null
}
