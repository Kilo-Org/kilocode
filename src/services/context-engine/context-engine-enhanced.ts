// kilocode_change - new file

/**
 * Enhanced Context Engine for Context-Aware Completions
 * Extends the base ContextEngine with completions-specific features
 */

import * as vscode from "vscode"
import type { CompletionContext, ProjectContext, SemanticContext } from "../completions/types"
import type { CompletionContextEntity, ProjectContextEntity, SemanticContextEntity } from "../completions/models"
import { ContextEngine, getContextEngine } from "./engine"
import type { ContextEngineConfig, IContextEngine } from "./engine"

/**
 * Enhanced configuration for completions
 */
export interface CompletionsContextConfig extends ContextEngineConfig {
	/** Maximum number of files to include in context */
	maxContextFiles: number
	/** Maximum context window size in tokens */
	maxContextTokens: number
	/** Semantic similarity threshold for including files */
	semanticThreshold: number
	/** Include test files in context */
	includeTests: boolean
	/** Include dependency files in context */
	includeDependencies: boolean
	/** Cache context results */
	enableContextCache: boolean
	/** Context cache TTL in milliseconds */
	contextCacheTTL: number
}

/**
 * Default completions context configuration
 */
const DEFAULT_COMPLETIONS_CONFIG: Partial<CompletionsContextConfig> = {
	maxContextFiles: 50,
	maxContextTokens: 8000,
	semanticThreshold: 0.8,
	includeTests: false,
	includeDependencies: true,
	enableContextCache: true,
	contextCacheTTL: 5 * 60 * 1000, // 5 minutes
}

/**
 * Context cache entry
 */
interface ContextCacheEntry {
	context: CompletionContextEntity
	timestamp: number
}

/**
 * Enhanced Context Engine for completions
 */
export class ContextEngineEnhanced implements IContextEngine {
	private baseEngine: ContextEngine
	private config: CompletionsContextConfig
	private contextCache: Map<string, ContextCacheEntry> = new Map()

	constructor(config: Partial<CompletionsContextConfig> = {}) {
		this.config = { ...DEFAULT_COMPLETIONS_CONFIG, ...config } as CompletionsContextConfig
		this.baseEngine = getContextEngine(this.config)
	}

	/**
	 * Initialize the enhanced context engine
	 */
	async initialize(workspacePaths: string[]): Promise<void> {
		await this.baseEngine.initialize(workspacePaths)
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.baseEngine.dispose()
		this.contextCache.clear()
	}

	/**
	 * Get context for code completions
	 */
	async getCompletionContext(
		filePath: string,
		position: number,
		surroundingCode: string,
		options?: {
			includeSemantic?: boolean
			includeDependencies?: boolean
			includeTests?: boolean
			maxFiles?: number
			windowSize?: number
		},
	): Promise<CompletionContextEntity> {
		const { CompletionContextFactory, ProjectContextFactory, SemanticContextFactory } = await import(
			"../completions/models"
		)

		// Check cache first
		const cacheKey = this.getCompletionCacheKey(filePath, position, surroundingCode, options)
		const cached = this.contextCache.get(cacheKey)

		if (cached && this.isCacheValid(cached)) {
			return cached.context
		}

		// Build project context
		const projectContext = await this.buildProjectContext(filePath, options)

		// Build semantic context
		const semanticContext = options?.includeSemantic
			? await this.buildSemanticContext(filePath, position, surroundingCode, options)
			: SemanticContextFactory.createFromSearch([], [], [], [])

		// Create completion context
		const completionContext = CompletionContextFactory.createFull(
			filePath,
			position,
			surroundingCode,
			projectContext,
			semanticContext,
			{
				windowSize: options?.windowSize || this.config.maxContextTokens,
				maxFiles: options?.maxFiles || this.config.maxContextFiles,
				semanticThreshold: this.config.semanticThreshold,
				indexingTime: Date.now(),
			},
		)

		// Cache the result
		if (this.config.enableContextCache) {
			this.contextCache.set(cacheKey, {
				context: completionContext,
				timestamp: Date.now(),
			})

			// Evict old entries if cache is too large
			this.evictOldCacheEntries()
		}

		return completionContext
	}

	/**
	 * Build project context for completions
	 */
	private async buildProjectContext(
		filePath: string,
		options?: {
			includeDependencies?: boolean
			includeTests?: boolean
		},
	): Promise<ProjectContextEntity> {
		const { ProjectContextFactory } = await import("../completions/models")

		// Get workspace folder
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath))
		const projectPath = workspaceFolder?.uri.fsPath || ""

		// Detect language
		const language = this.detectLanguage(filePath)

		// Get dependencies
		const dependencies = options?.includeDependencies ? await this.getProjectDependencies(projectPath) : []

		// Get recent files
		const recentFiles = await this.getRecentFiles(projectPath, options?.includeTests ?? false)

		// Detect framework
		const framework = await this.detectFramework(projectPath, language)

		return ProjectContextFactory.createFromScan(projectPath, language, dependencies, recentFiles)
	}

	/**
	 * Build semantic context for completions
	 */
	private async buildSemanticContext(
		filePath: string,
		position: number,
		surroundingCode: string,
		options?: {
			maxFiles?: number
			includeDependencies?: boolean
			includeTests?: boolean
		},
	): Promise<SemanticContextEntity> {
		const { SemanticContextFactory } = await import("../completions/models")

		// Get embeddings for surrounding code
		const embeddings = await this.getCodeEmbeddings(surroundingCode)

		// Get relevant files using semantic search
		const relevantFiles = await this.getRelevantFiles(
			filePath,
			surroundingCode,
			options?.maxFiles || this.config.maxContextFiles,
			options?.includeTests ?? false,
		)

		// Extract concepts from code
		const concepts = await this.extractCodeConcepts(surroundingCode, relevantFiles)

		// Build concept relationships
		const relationships = await this.buildConceptRelationships(concepts, relevantFiles)

		return SemanticContextFactory.createFromSearch(embeddings, relevantFiles, concepts, relationships)
	}

	/**
	 * Get relevant files using semantic search
	 */
	private async getRelevantFiles(
		filePath: string,
		surroundingCode: string,
		maxFiles: number,
		includeTests: boolean,
	): Promise<any[]> {
		// Use the base engine's search functionality
		const searchResults = await this.baseEngine.search(surroundingCode, {
			limit: maxFiles,
			minScore: this.config.semanticThreshold,
			excludePatterns: includeTests
				? undefined
				: ["**/*.test.ts", "**/*.test.js", "**/*.spec.ts", "**/*.spec.js"],
		})

		// Convert search results to file references
		return searchResults.map((result) => ({
			id: result.entity.id,
			filePath: result.entity.filePath,
			changeType: "update" as const,
		}))
	}

	/**
	 * Get code embeddings
	 */
	private async getCodeEmbeddings(code: string): Promise<number[][]> {
		// Placeholder - in production, this would use an embedding model
		// For now, return empty array
		return []
	}

	/**
	 * Extract code concepts
	 */
	private async extractCodeConcepts(code: string, relevantFiles: any[]): Promise<string[]> {
		// Placeholder - in production, this would use NLP or AST analysis
		// Extract function names, variable names, etc.
		const concepts: string[] = []

		// Simple regex-based extraction
		const functionMatches = code.match(/function\s+(\w+)/g)
		if (functionMatches) {
			concepts.push(...functionMatches.map((m) => m.replace("function ", "")))
		}

		const constMatches = code.match(/const\s+(\w+)/g)
		if (constMatches) {
			concepts.push(...constMatches.map((m) => m.replace("const ", "")))
		}

		const classMatches = code.match(/class\s+(\w+)/g)
		if (classMatches) {
			concepts.push(...classMatches.map((m) => m.replace("class ", "")))
		}

		return [...new Set(concepts)] // Remove duplicates
	}

	/**
	 * Build concept relationships
	 */
	private async buildConceptRelationships(concepts: string[], relevantFiles: any[]): Promise<any[]> {
		// Placeholder - in production, this would analyze relationships between concepts
		// For now, return empty array
		return []
	}

	/**
	 * Detect language from file path
	 */
	private detectLanguage(filePath: string): string {
		const ext = filePath.split(".").pop()?.toLowerCase()
		const languageMap: Record<string, string> = {
			ts: "typescript",
			tsx: "typescript",
			js: "javascript",
			jsx: "javascript",
			py: "python",
			java: "java",
			go: "go",
			rs: "rust",
			cpp: "cpp",
			c: "c",
		}
		return languageMap[ext || ""] || "unknown"
	}

	/**
	 * Detect project framework
	 */
	private async detectFramework(projectPath: string, language: string): Promise<string | undefined> {
		// Placeholder - in production, this would analyze package.json, requirements.txt, etc.
		// For now, return undefined
		return undefined
	}

	/**
	 * Get project dependencies
	 */
	private async getProjectDependencies(projectPath: string): Promise<string[]> {
		// Placeholder - in production, this would read package.json, requirements.txt, etc.
		// For now, return empty array
		return []
	}

	/**
	 * Get recent files
	 */
	private async getRecentFiles(projectPath: string, includeTests: boolean): Promise<string[]> {
		// Placeholder - in production, this would use VSCode's recent files tracking
		// For now, return empty array
		return []
	}

	/**
	 * Get cache key for completion context
	 */
	private getCompletionCacheKey(filePath: string, position: number, surroundingCode: string, options?: any): string {
		return `${filePath}:${position}:${surroundingCode.length}:${JSON.stringify(options)}`
	}

	/**
	 * Check if cache entry is valid
	 */
	private isCacheValid(entry: ContextCacheEntry): boolean {
		return Date.now() - entry.timestamp < this.config.contextCacheTTL
	}

	/**
	 * Evict old cache entries
	 */
	private evictOldCacheEntries(): void {
		const maxCacheSize = 100
		if (this.contextCache.size > maxCacheSize) {
			// Sort by timestamp and remove oldest entries
			const entries = Array.from(this.contextCache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp)
			const toRemove = entries.slice(0, entries.length - maxCacheSize)
			for (const [key] of toRemove) {
				this.contextCache.delete(key)
			}
		}
	}

	/**
	 * Clear context cache
	 */
	clearContextCache(): void {
		this.contextCache.clear()
	}

	// ============================================================================
	// Delegate to base engine
	// ============================================================================

	async getContext(filePath: string, line: number, options?: any): Promise<any> {
		return this.baseEngine.getContext(filePath, line, options)
	}

	async getEntityContext(entityId: string, options?: any): Promise<any> {
		return this.baseEngine.getEntityContext(entityId, options)
	}

	async search(query: string, options?: any): Promise<any[]> {
		return this.baseEngine.search(query, options)
	}

	async getEntity(entityId: string): Promise<any> {
		return this.baseEngine.getEntity(entityId)
	}

	async getRelatedEntities(entityId: string, depth?: number): Promise<any[]> {
		return this.baseEngine.getRelatedEntities(entityId, depth)
	}

	async onFileChanged(filePath: string, content: string): Promise<void> {
		await this.baseEngine.onFileChanged(filePath, content)
	}

	async onFileSaved(filePath: string): Promise<void> {
		await this.baseEngine.onFileSaved(filePath)
	}

	async onFileDeleted(filePath: string): Promise<void> {
		await this.baseEngine.onFileDeleted(filePath)
	}

	getStatus(): any {
		return this.baseEngine.getStatus()
	}

	get onStatusChanged(): vscode.Event<any> {
		return this.baseEngine.onStatusChanged
	}
}

/**
 * Get the enhanced context engine instance
 */
let enhancedInstance: ContextEngineEnhanced | null = null

export function getContextEngineEnhanced(config?: Partial<CompletionsContextConfig>): ContextEngineEnhanced {
	if (!enhancedInstance) {
		enhancedInstance = new ContextEngineEnhanced(config)
	}
	return enhancedInstance
}

/**
 * Reset the enhanced context engine instance
 */
export function resetContextEngineEnhanced(): void {
	if (enhancedInstance) {
		enhancedInstance.dispose()
		enhancedInstance = null
	}
}
