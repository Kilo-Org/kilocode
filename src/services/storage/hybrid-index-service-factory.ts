// kilocode_change - new file

import { DatabaseManager, CodebaseContextAPI, SQLiteVectorStore } from "../storage"
import { CodeIndexServiceFactory } from "../code-index/service-factory"
import { CacheManager } from "../code-index/cache-manager"
import { CodeIndexConfigManager } from "../code-index/config-manager"
import { ContextProxy } from "../../core/config/ContextProxy"
import * as vscode from "vscode"
import path from "path"

/**
 * Enhanced service factory that integrates SQLite storage with the existing indexing system
 */
export class HybridIndexServiceFactory {
	private readonly databaseManager: DatabaseManager
	private readonly contextAPI: CodebaseContextAPI
	private readonly workspacePath: string
	private readonly configManager: CodeIndexConfigManager
	private readonly baseFactory: CodeIndexServiceFactory

	constructor(
		configManager: CodeIndexConfigManager,
		workspacePath: string,
		cacheManager: CacheManager,
		storageDir: string,
	) {
		this.configManager = configManager
		this.workspacePath = workspacePath

		// Initialize base factory
		this.baseFactory = new CodeIndexServiceFactory(configManager, workspacePath, cacheManager)

		// Initialize SQLite database manager
		this.databaseManager = new DatabaseManager(workspacePath, storageDir)
		this.contextAPI = new CodebaseContextAPI(this.databaseManager)
	}

	/**
	 * Initialize the hybrid storage system
	 */
	async initialize(): Promise<void> {
		await this.databaseManager.initialize()
		console.log("[HybridIndexServiceFactory] SQLite database initialized")
	}

	/**
	 * Create enhanced services with SQLite integration
	 */
	createEnhancedServices(
		context: vscode.ExtensionContext,
		cacheManager: CacheManager,
		ignoreInstance: any,
		rooIgnoreController: any,
	) {
		// Get base services from parent factory
		const baseServices = this.baseFactory.createServices(context, cacheManager, ignoreInstance, rooIgnoreController)

		// Replace vector store with SQLite hybrid implementation
		const sqliteVectorStore = new SQLiteVectorStore(
			this.workspacePath,
			this.databaseManager,
			1536, // Default dimension for OpenAI text-embedding-3-small
		)

		return {
			...baseServices,
			vectorStore: sqliteVectorStore,
			// Expose new APIs for agent tools
			contextAPI: this.contextAPI,
			databaseManager: this.databaseManager,
		}
	}

	/**
	 * Get the context API for agent tools
	 */
	getContextAPI(): CodebaseContextAPI {
		return this.contextAPI
	}

	/**
	 * Get the database manager for direct access
	 */
	getDatabaseManager(): DatabaseManager {
		return this.databaseManager
	}

	/**
	 * Cleanup resources
	 */
	async dispose(): Promise<void> {
		await this.databaseManager.close()
	}
}
