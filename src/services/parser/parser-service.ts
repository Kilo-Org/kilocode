// kilocode_change - new file

import { Parser as ParserT } from "web-tree-sitter"
import { loadRequiredLanguageParsers, LanguageParser } from "../tree-sitter/languageParser"
import { DatabaseManager } from "../storage/database-manager"
import { PythonSymbolExtractor } from "./python-extractor"
import { JavaScriptSymbolExtractor } from "./javascript-extractor"
import { XmlSymbolExtractor } from "./xml-extractor"
import { JsonSymbolExtractor } from "./json-extractor"
import { ISymbolExtractor, ParsedFile, SymbolInfo, ScopeInfo } from "./symbol-extractor"
import { readFile } from "fs/promises"
import { createHash } from "crypto"
import path from "path"

export interface ParserServiceConfig {
	enableIncrementalParsing: boolean
	maxWorkers: number
	supportedLanguages: string[]
}

export interface ParseResult {
	filePath: string
	symbols: SymbolInfo[]
	relationships: any[]
	dependencies: string[]
	parseTime: number
	success: boolean
	error?: string
}

/**
 * High-performance parsing service with multi-language support and incremental parsing
 */
export class ParserService {
	private languageParsers: LanguageParser = {}
	private symbolExtractors: Map<string, ISymbolExtractor> = new Map()
	private databaseManager: DatabaseManager
	private config: ParserServiceConfig
	private parseCache: Map<string, ParseResult> = new Map()
	private workerPool: Worker[] = []

	constructor(databaseManager: DatabaseManager, config: Partial<ParserServiceConfig> = {}) {
		this.databaseManager = databaseManager
		this.config = {
			enableIncrementalParsing: true,
			maxWorkers: 4,
			supportedLanguages: ["python", "javascript", "typescript", "xml", "json"],
			...config,
		}

		this.initializeSymbolExtractors()
	}

	/**
	 * Initialize the parser service with required language parsers
	 */
	async initialize(filePaths: string[]): Promise<void> {
		// Load required language parsers
		this.languageParsers = await loadRequiredLanguageParsers(filePaths)

		// Initialize worker pool for async parsing
		if (this.config.maxWorkers > 0) {
			await this.initializeWorkerPool()
		}

		console.log(`[ParserService] Initialized with ${Object.keys(this.languageParsers).length} language parsers`)
	}

	/**
	 * Parse a file and extract symbols, relationships, and dependencies
	 */
	async parseFile(filePath: string, options?: { content?: string; force?: boolean }): Promise<ParseResult> {
		const startTime = Date.now()

		try {
			// Check cache first (if not forced)
			if (!options?.force && this.parseCache.has(filePath)) {
				const cached = this.parseCache.get(filePath)!
				console.log(`[ParserService] Cache hit for ${filePath}`)
				return { ...cached, parseTime: Date.now() - startTime }
			}

			// Read file content
			const content = options?.content || (await readFile(filePath, "utf8"))

			// Get file extension and language
			const ext = path.extname(filePath).slice(1).toLowerCase()
			const language = this.mapExtensionToLanguage(ext)

			if (!language || !this.languageParsers[language]) {
				return {
					filePath,
					symbols: [],
					relationships: [],
					dependencies: [],
					parseTime: Date.now() - startTime,
					success: false,
					error: `Unsupported language: ${language}`,
				}
			}

			// Parse with tree-sitter
			const parser = this.languageParsers[language].parser
			const tree = parser.parse(content)

			if (!tree || !tree.rootNode) {
				return {
					filePath,
					symbols: [],
					relationships: [],
					dependencies: [],
					parseTime: Date.now() - startTime,
					success: false,
					error: "Failed to parse file - no root node",
				}
			}

			// Extract symbols using language-specific extractor
			const extractor = this.symbolExtractors.get(language)
			if (!extractor) {
				return {
					filePath,
					symbols: [],
					relationships: [],
					dependencies: [],
					parseTime: Date.now() - startTime,
					success: false,
					error: `No symbol extractor for language: ${language}`,
				}
			}

			const parsedFile = extractor.extractSymbols(filePath, content, tree.rootNode)

			// Update database with parsed results
			await this.updateDatabase(parsedFile)

			const result: ParseResult = {
				filePath,
				symbols: parsedFile.symbols,
				relationships: parsedFile.relationships,
				dependencies: parsedFile.dependencies,
				parseTime: Date.now() - startTime,
				success: true,
			}

			// Cache result
			this.parseCache.set(filePath, result)

			return result
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			console.error(`[ParserService] Error parsing ${filePath}:`, errorMessage)

			return {
				filePath,
				symbols: [],
				relationships: [],
				dependencies: [],
				parseTime: Date.now() - startTime,
				success: false,
				error: errorMessage,
			}
		}
	}

	/**
	 * Parse multiple files in parallel
	 */
	async parseFiles(filePaths: string[], options?: { force?: boolean }): Promise<ParseResult[]> {
		const promises = filePaths.map((filePath) => this.parseFile(filePath, options))
		return Promise.all(promises)
	}

	/**
	 * Get symbols for a specific file
	 */
	async getSymbols(filePath: string): Promise<SymbolInfo[]> {
		const result = await this.parseFile(filePath)
		return result.symbols
	}

	/**
	 * Get scope information for a specific line in a file
	 */
	async getScope(filePath: string, line: number): Promise<ScopeInfo | null> {
		try {
			const content = await readFile(filePath, "utf8")
			const ext = path.extname(filePath).slice(1).toLowerCase()
			const language = this.mapExtensionToLanguage(ext)

			if (!language || !this.languageParsers[language]) {
				return null
			}

			const parser = this.languageParsers[language].parser
			const tree = parser.parse(content)

			if (!tree || !tree.rootNode) {
				return null
			}

			const extractor = this.symbolExtractors.get(language)
			if (!extractor) {
				return null
			}

			return extractor.getScope(filePath, content, tree.rootNode, line)
		} catch (error) {
			console.error(`[ParserService] Error getting scope for ${filePath}:${line}:`, error)
			return null
		}
	}

	/**
	 * Get dependencies for a specific file
	 */
	async getDependencies(filePath: string): Promise<string[]> {
		const result = await this.parseFile(filePath)
		return result.dependencies
	}

	/**
	 * Get file structure explanation for agents
	 */
	async explainStructure(filePath: string): Promise<string> {
		const result = await this.parseFile(filePath)

		if (!result.success) {
			return `Unable to analyze ${filePath}: ${result.error}`
		}

		const structure = this.generateStructureExplanation(result)
		return structure
	}

	/**
	 * Clear parse cache
	 */
	clearCache(): void {
		this.parseCache.clear()
	}

	/**
	 * Get parsing statistics
	 */
	getStats(): any {
		return {
			cachedFiles: this.parseCache.size,
			supportedLanguages: this.config.supportedLanguages,
			loadedParsers: Object.keys(this.languageParsers).length,
			workerPoolSize: this.workerPool.length,
		}
	}

	/**
	 * Dispose of resources
	 */
	async dispose(): Promise<void> {
		// Terminate worker pool
		for (const worker of this.workerPool) {
			worker.terminate()
		}
		this.workerPool = []

		// Clear cache
		this.parseCache.clear()
	}

	// Private methods

	private initializeSymbolExtractors(): void {
		this.symbolExtractors.set("python", new PythonSymbolExtractor(this.databaseManager))
		this.symbolExtractors.set("javascript", new JavaScriptSymbolExtractor(this.databaseManager))
		this.symbolExtractors.set("typescript", new JavaScriptSymbolExtractor(this.databaseManager))
		this.symbolExtractors.set("xml", new XmlSymbolExtractor(this.databaseManager))
		this.symbolExtractors.set("json", new JsonSymbolExtractor(this.databaseManager))
	}

	private async initializeWorkerPool(): Promise<void> {
		// TODO: Implement worker pool for async parsing
		// This would use Worker threads to prevent blocking the main thread
		console.log(`[ParserService] Worker pool initialization not yet implemented`)
	}

	private mapExtensionToLanguage(ext: string): string | null {
		const mapping: Record<string, string> = {
			py: "python",
			js: "javascript",
			jsx: "javascript",
			ts: "typescript",
			tsx: "typescript",
			xml: "xml",
			json: "json",
		}
		return mapping[ext] || null
	}

	private async updateDatabase(parsedFile: ParsedFile): Promise<void> {
		try {
			// Upsert file record
			const fileHash = this.createFileHash(parsedFile.filePath)
			await this.databaseManager.upsertFile({
				id: fileHash,
				path: parsedFile.filePath,
				content_hash: fileHash,
				metadata: JSON.stringify({
					symbolsCount: parsedFile.symbols.length,
					relationshipsCount: parsedFile.relationships.length,
					dependenciesCount: parsedFile.dependencies.length,
				}),
			})

			// Upsert symbols
			for (const symbol of parsedFile.symbols) {
				await this.databaseManager.upsertSymbol({
					id: symbol.id,
					name: symbol.name,
					type: symbol.type,
					file_id: fileHash,
					start_line: symbol.startLine,
					end_line: symbol.endLine,
					parent_symbol_id: symbol.parentSymbolId,
					metadata: JSON.stringify(symbol.metadata),
				})
			}

			// Upsert relationships
			for (const relationship of parsedFile.relationships) {
				await this.databaseManager.upsertRelationship({
					id: relationship.id,
					from_symbol_id: relationship.fromSymbolId,
					to_symbol_id: relationship.toSymbolId,
					type: relationship.type,
					metadata: relationship.metadata ? JSON.stringify(relationship.metadata) : undefined,
				})
			}
		} catch (error) {
			console.error(`[ParserService] Error updating database for ${parsedFile.filePath}:`, error)
		}
	}

	private createFileHash(filePath: string): string {
		return createHash("sha256").update(filePath).digest("hex")
	}

	private generateStructureExplanation(result: ParseResult): string {
		const { symbols, relationships, dependencies } = result

		const lines: string[] = []
		lines.push(`# File Structure Analysis: ${path.basename(result.filePath)}`)
		lines.push("")

		// Group symbols by type
		const symbolsByType = this.groupSymbolsByType(symbols)

		for (const [type, typeSymbols] of Object.entries(symbolsByType)) {
			if (typeSymbols.length > 0) {
				lines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}s (${typeSymbols.length})`)

				for (const symbol of typeSymbols) {
					const line = [`- **${symbol.name}**`]

					if (symbol.metadata.parentClass) {
						line.push(`(in ${symbol.metadata.parentClass})`)
					}

					if (symbol.metadata._name) {
						line.push(`Odoo Model: ${symbol.metadata._name}`)
					}

					if (symbol.metadata._inherit) {
						line.push(`inherits ${symbol.metadata._inherit}`)
					}

					if (symbol.metadata.odooApi) {
						line.push(`@api decorator`)
					}

					lines.push(line.join(" "))
				}
				lines.push("")
			}
		}

		// Relationships
		if (relationships.length > 0) {
			lines.push(`## Relationships (${relationships.length})`)

			const relationshipsByType = this.groupRelationshipsByType(relationships)

			for (const [type, typeRelationships] of Object.entries(relationshipsByType)) {
				lines.push(`### ${type}`)
				for (const rel of typeRelationships.slice(0, 10)) {
					// Limit to 10 for brevity
					lines.push(`- ${rel.fromSymbolId} → ${rel.toSymbolId}`)
				}
				if (typeRelationships.length > 10) {
					lines.push(`- ... and ${typeRelationships.length - 10} more`)
				}
				lines.push("")
			}
		}

		// Dependencies
		if (dependencies.length > 0) {
			lines.push(`## Dependencies (${dependencies.length})`)
			for (const dep of dependencies.slice(0, 10)) {
				// Limit to 10 for brevity
				lines.push(`- ${dep}`)
			}
			if (dependencies.length > 10) {
				lines.push(`- ... and ${dependencies.length - 10} more`)
			}
		}

		return lines.join("\n")
	}

	private groupSymbolsByType(symbols: SymbolInfo[]): Record<string, SymbolInfo[]> {
		const grouped: Record<string, SymbolInfo[]> = {}

		for (const symbol of symbols) {
			if (!grouped[symbol.type]) {
				grouped[symbol.type] = []
			}
			grouped[symbol.type].push(symbol)
		}

		return grouped
	}

	private groupRelationshipsByType(relationships: any[]): Record<string, any[]> {
		const grouped: Record<string, any[]> = {}

		for (const rel of relationships) {
			if (!grouped[rel.type]) {
				grouped[rel.type] = []
			}
			grouped[rel.type].push(rel)
		}

		return grouped
	}
}
