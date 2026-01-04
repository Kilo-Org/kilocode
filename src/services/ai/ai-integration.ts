// kilocode_change - new file

import { AIService } from "./ai-service"
import { DatabaseManager } from "../storage/database-manager"
import { ParserService } from "../parser/parser-service"

/**
 * Integration service that connects AI capabilities with the main Kilo Code features
 */
export class AIIntegrationService {
	private aiService: AIService
	private isInitialized = false

	constructor(databaseManager: DatabaseManager, parserService: ParserService) {
		this.aiService = new AIService(databaseManager, parserService)
	}

	/**
	 * Initialize the AI integration service
	 */
	async initialize(): Promise<void> {
		if (this.isInitialized) {
			return
		}

		// TODO: Set up event listeners for main chat and inline-edit features
		// This would integrate with the existing event system

		this.isInitialized = true
		console.log("[AIIntegrationService] Initialized")
	}

	/**
	 * Process a global query (not tied to specific file)
	 */
	async processGlobalQuery(query: string, sessionContext?: any): Promise<any> {
		try {
			const response = await this.aiService.processQuery({
				query,
				sessionFiles: sessionContext?.openFiles || [],
				recentlyModified: sessionContext?.recentlyModified || [],
				projectType: sessionContext?.projectType,
			})

			return {
				query,
				enhancedPrompt: response.prompt,
				contextResults: response.contextResults,
				tokenCount: response.tokenCount,
				retrievalTime: response.retrievalTime,
				projectType: response.projectType,
			}
		} catch (error) {
			console.error("[AIIntegrationService] Error processing global query:", error)
			return {
				query,
				enhancedPrompt: query,
				contextResults: [],
				tokenCount: 0,
				retrievalTime: 0,
				projectType: "generic",
			}
		}
	}

	/**
	 * Get context for a specific symbol across the codebase
	 */
	async getSymbolContext(symbolName: string, filePath?: string): Promise<any> {
		try {
			const contextResults = await this.aiService.getContextForSymbol(symbolName, filePath)

			return {
				symbolName,
				filePath,
				contextResults,
				count: contextResults.length,
			}
		} catch (error) {
			console.error("[AIIntegrationService] Error getting symbol context:", error)
			return {
				symbolName,
				filePath,
				contextResults: [],
				count: 0,
			}
		}
	}

	/**
	 * Get integration statistics
	 */
	getStats(): any {
		return {
			isInitialized: this.isInitialized,
			aiServiceStats: this.aiService.getStats(),
		}
	}

	/**
	 * Update AI service configuration
	 */
	updateConfig(config: any): void {
		this.aiService.updateConfig(config)
	}

	/**
	 * Clear all caches
	 */
	clearCache(): void {
		this.aiService.clearCache()
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		this.aiService.dispose()
		this.isInitialized = false
	}
}
