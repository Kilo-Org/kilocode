// kilocode_change - new file
/**
 * AST Parser Service - Type Definitions
 */

import { CodeEntity, EntityRelationship, ParseError, ParseResult } from "../types"

/**
 * Supported programming languages
 */
export type SupportedLanguage =
	| "typescript"
	| "javascript"
	| "tsx"
	| "jsx"
	| "python"
	| "java"
	| "go"
	| "rust"
	| "c"
	| "cpp"
	| "csharp"

/**
 * Map of file extensions to languages
 */
export const EXTENSION_TO_LANGUAGE: Record<string, SupportedLanguage> = {
	".ts": "typescript",
	".tsx": "tsx",
	".js": "javascript",
	".jsx": "jsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".java": "java",
	".go": "go",
	".rs": "rust",
	".c": "c",
	".h": "c",
	".cpp": "cpp",
	".hpp": "cpp",
	".cc": "cpp",
	".cs": "csharp",
}

/**
 * Interface for language-specific parsers
 */
export interface ILanguageParser {
	/** Language this parser handles */
	readonly language: SupportedLanguage

	/** Parse source code and extract entities */
	parse(filePath: string, content: string): Promise<ParseResult>

	/** Check if this parser can handle the given file */
	canParse(filePath: string): boolean
}

/**
 * Interface for the main AST Parser Service
 */
export interface IASTParserService {
	/**
	 * Parse a file and extract code entities and relationships
	 * @param filePath Path to the file
	 * @param content File content (optional, will read from disk if not provided)
	 */
	parse(filePath: string, content?: string): Promise<ParseResult>

	/**
	 * Get list of supported languages
	 */
	getSupportedLanguages(): SupportedLanguage[]

	/**
	 * Check if a file can be parsed
	 */
	canParse(filePath: string): boolean

	/**
	 * Register a custom language parser
	 */
	registerParser(parser: ILanguageParser): void
}

/**
 * Options for parsing
 */
export interface ParseOptions {
	/** Include docstrings/comments */
	includeDocstrings?: boolean
	/** Include private members */
	includePrivate?: boolean
	/** Maximum file size to parse (bytes) */
	maxFileSize?: number
}

/**
 * Raw capture from tree-sitter
 */
export interface TreeSitterCapture {
	name: string
	text: string
	startRow: number
	endRow: number
	startColumn: number
	endColumn: number
	parentType?: string
}
