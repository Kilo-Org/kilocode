// kilocode_change - new file

import { ContextRetriever, RetrievalConfig, RetrievalContext, ContextResult } from "./context-retriever"
import { PromptBuilder, PromptBuilderConfig } from "./prompt-builder"
import { DatabaseManager } from "../storage/database-manager"
import { ParserService } from "../parser/parser-service"

export interface AIServiceConfig {
	retrieval: Partial<RetrievalConfig>
	promptBuilder: Partial<PromptBuilderConfig>
	enableCaching: boolean
	maxCacheSize: number
}

export interface QueryRequest {
	query: string
	currentFile?: string
	currentLine?: number
	sessionFiles: string[]
	recentlyModified: string[]
	projectType?: "odoo" | "django" | "generic"
}

export interface QueryResponse {
	prompt: string
	contextResults: ContextResult[]
	tokenCount: number
	retrievalTime: number
	projectType: string
}

/**
 * Main AI service that orchestrates context retrieval and prompt building
 */
export class AIService {
	private contextRetriever: ContextRetriever
	private promptBuilder: PromptBuilder
	private config: AIServiceConfig
	private queryCache: Map<string, QueryResponse> = new Map()

	constructor(databaseManager: DatabaseManager, parserService: ParserService, config: Partial<AIServiceConfig> = {}) {
		this.config = {
			retrieval: {
				maxResults: 20,
				tokenLimit: 10000,
				vectorWeight: 0.6,
				keywordWeight: 0.4,
				proximityBoost: 0.2,
				inheritanceBoost: 0.3,
				recencyBoost: 0.1,
			},
			promptBuilder: {
				maxTokens: 10000,
				systemPrompt: `You are an expert software engineer with deep knowledge of multiple programming languages, frameworks, and best practices.`,
				includeLineNumbers: true,
				includeFilePaths: true,
			},
			enableCaching: true,
			maxCacheSize: 50,
			...config,
		}

		this.contextRetriever = new ContextRetriever(databaseManager, parserService, this.config.retrieval)

		this.promptBuilder = new PromptBuilder(this.config.promptBuilder)
	}

	/**
	 * Process a query and return the complete prompt with context
	 */
	async processQuery(request: QueryRequest): Promise<QueryResponse> {
		const startTime = Date.now()

		// Check cache first
		if (this.config.enableCaching) {
			const cacheKey = this.generateCacheKey(request)
			const cached = this.queryCache.get(cacheKey)
			if (cached) {
				console.log(`[AIService] Cache hit for query: ${request.query.substring(0, 50)}...`)
				return cached
			}
		}

		try {
			// Detect project type if not specified
			const projectType = await this.detectProjectType(request.projectType || undefined)

			// Build retrieval context
			const retrievalContext: RetrievalContext = {
				...request,
				projectType,
			}

			// Retrieve relevant context
			const contextResults = await this.contextRetriever.retrieveContext(retrievalContext)

			// Get project structure
			const projectStructure = await this.getProjectStructure()

			// Build prompt
			const prompt = await this.promptBuilder.getFormattedPrompt(
				contextResults,
				request.query,
				projectType,
				request.currentFile,
				projectStructure,
			)

			// Calculate token count
			const tokenCount = this.estimateTokenCount(prompt)

			// Build response
			const response: QueryResponse = {
				prompt,
				contextResults,
				tokenCount,
				retrievalTime: Date.now() - startTime,
				projectType,
			}

			// Cache response
			if (this.config.enableCaching) {
				this.cacheResponse(request, response)
			}

			console.log(
				`[AIService] Processed query in ${response.retrievalTime}ms, ${tokenCount} tokens, ${contextResults.length} results`,
			)

			return response
		} catch (error) {
			console.error("[AIService] Error processing query:", error)

			// Return fallback response
			return {
				prompt: this.buildFallbackPrompt(request.query),
				contextResults: [],
				tokenCount: this.estimateTokenCount(request.query),
				retrievalTime: Date.now() - startTime,
				projectType: request.projectType || "generic",
			}
		}
	}

	/**
	 * Process multiple queries in parallel
	 */
	async processQueries(requests: QueryRequest[]): Promise<QueryResponse[]> {
		const promises = requests.map((request) => this.processQuery(request))
		return Promise.all(promises)
	}

	/**
	 * Get context for a specific file and line
	 */
	async getContextForFile(filePath: string, line?: number): Promise<ContextResult[]> {
		const request: QueryRequest = {
			query: `context for ${filePath}${line ? ` at line ${line}` : ""}`,
			currentFile: filePath,
			currentLine: line,
			sessionFiles: [filePath],
			recentlyModified: [],
		}

		const response = await this.processQuery(request)
		return response.contextResults
	}

	/**
	 * Get context for a symbol across the codebase
	 */
	async getContextForSymbol(symbolName: string, filePath?: string): Promise<ContextResult[]> {
		const request: QueryRequest = {
			query: `symbol: ${symbolName}`,
			currentFile: filePath,
			sessionFiles: filePath ? [filePath] : [],
			recentlyModified: [],
		}

		const response = await this.processQuery(request)
		return response.contextResults
	}

	/**
	 * Detect project type based on file analysis
	 */
	private async detectProjectType(specifiedType?: string): Promise<"odoo" | "django" | "generic"> {
		if (specifiedType) {
			return specifiedType as "odoo" | "django" | "generic"
		}

		// Check for Odoo indicators
		const hasOdooManifest =
			(await this.checkFileExists("__manifest__.py")) || (await this.checkFileExists("__openerp__.py"))
		if (hasOdooManifest) {
			return "odoo"
		}

		// Check for Django indicators
		const hasDjangoSettings =
			(await this.checkFileExists("settings.py")) || (await this.checkFileExists("manage.py"))
		if (hasDjangoSettings) {
			return "django"
		}

		return "generic"
	}

	/**
	 * Check if a file exists in the project
	 */
	private async checkFileExists(fileName: string): Promise<boolean> {
		try {
			// This would use the file system or database to check
			// For now, return false as placeholder
			return false
		} catch (error) {
			return false
		}
	}

	/**
	 * Get project structure overview
	 */
	private async getProjectStructure(): Promise<string> {
		try {
			// This would generate a tree structure of the project
			// For now, return a placeholder
			return "Project structure analysis not yet implemented"
		} catch (error) {
			return ""
		}
	}

	/**
	 * Build fallback prompt when context retrieval fails
	 */
	private buildFallbackPrompt(query: string): string {
		return `You are an expert software engineer. Please help with the following query:

${query}

Please provide a helpful and accurate response based on your knowledge of software development best practices.`
	}

	/**
	 * Estimate token count for a given text
	 */
	private estimateTokenCount(text: string): number {
		// Rough estimation: ~4 characters per token
		return Math.ceil(text.length / 4)
	}

	/**
	 * Generate cache key for a request
	 */
	private generateCacheKey(request: QueryRequest): string {
		const keyData = {
			query: request.query,
			currentFile: request.currentFile,
			currentLine: request.currentLine,
			sessionFiles: request.sessionFiles.sort(),
			projectType: request.projectType,
		}
		return JSON.stringify(keyData)
	}

	/**
	 * Cache a response
	 */
	private cacheResponse(request: QueryRequest, response: QueryResponse): void {
		const cacheKey = this.generateCacheKey(request)

		// Remove oldest entries if cache is full
		if (this.queryCache.size >= this.config.maxCacheSize) {
			const firstKey = this.queryCache.keys().next().value
			if (firstKey) {
				this.queryCache.delete(firstKey)
			}
		}

		this.queryCache.set(cacheKey, response)
	}

	/**
	 * Clear all caches
	 */
	clearCache(): void {
		this.queryCache.clear()
		this.contextRetriever.clearCache()
	}

	/**
	 * Get service statistics
	 */
	getStats(): any {
		return {
			cacheSize: this.queryCache.size,
			retrieverStats: this.contextRetriever.getStats(),
			promptBuilderConfig: this.promptBuilder.getConfig(),
			config: this.config,
		}
	}

	/**
	 * Update configuration
	 */
	updateConfig(config: Partial<AIServiceConfig>): void {
		this.config = { ...this.config, ...config }

		// Update sub-services
		if (config.retrieval) {
			this.contextRetriever = new ContextRetriever(
				// Would need to recreate with new config, but for now just update
				this.contextRetriever as any,
				this.contextRetriever as any,
				config.retrieval,
			)
		}

		if (config.promptBuilder) {
			this.promptBuilder.updateConfig(config.promptBuilder)
		}
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.clearCache()
	}
}
