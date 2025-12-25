import * as vscode from "vscode"
import * as path from "path"
import * as os from "os"
import type { ContextEngineConfig, IndexingStats, PerformanceMetrics, SearchQuery, VectorSearchResult } from "./types"
import { VectorDatabase } from "./indexing/vector-database"
import { MetadataDatabase } from "./memory/metadata-database"
import { CodeChunker } from "./indexing/code-chunker"
import { EmbeddingService } from "./indexing/embedding-service"
import { MemoryManager } from "./memory/memory-manager"
import { CacheManager } from "./cache/cache-manager"
import { FileWatcher } from "./indexing/file-watcher"
import { ContextRetriever } from "./retrieval/context-retriever"

/**
 * Main Context Engine orchestrating all components
 */
export class ContextEngine {
	private config: ContextEngineConfig
	private vectorDb: VectorDatabase
	private metadataDb: MetadataDatabase
	private chunker: CodeChunker
	private memoryManager: MemoryManager
	private cacheManager: CacheManager<any>
	private fileWatcher: FileWatcher
	private retriever: ContextRetriever
	private initialized: boolean
	private indexingInProgress: boolean
	private indexingStats: IndexingStats

	constructor(config?: Partial<ContextEngineConfig>) {
		this.initialized = false
		this.indexingInProgress = false

		// Set default configuration
		this.config = this.getDefaultConfig()
		if (config) {
			this.config = { ...this.config, ...config }
		}

		// Initialize stats
		this.indexingStats = {
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			indexedChunks: 0,
			failedFiles: [],
			lastIndexTime: 0,
			databaseSize: 0,
		}

		// Get OpenAI API key from VS Code settings if available
		let openaiApiKey: string | undefined
		let openaiBaseUrl: string | undefined

		try {
			const vscode = require("vscode")
			const workspaceConfig = vscode.workspace.getConfiguration("kilo-code")
			openaiApiKey = workspaceConfig.get("openAiApiKey")
			openaiBaseUrl = workspaceConfig.get("openAiBaseUrl")
		} catch (error) {
			// VS Code not available or settings not configured
			console.log("Could not read VS Code settings, using default/env values")
		}

		// Initialize components
		this.vectorDb = new VectorDatabase(
			this.config.vectorDbPath,
			this.config.embeddingModel,
			openaiApiKey,
			openaiBaseUrl,
		)

		this.metadataDb = new MetadataDatabase(this.config.metadataDbPath)

		this.chunker = new CodeChunker(this.config.maxChunkSize, this.config.chunkOverlap)

		this.cacheManager = new CacheManager(this.config.cacheEnabled, this.config.cacheTTL)

		// These will be initialized after databases are ready
		this.memoryManager = null as any
		this.fileWatcher = null as any
		this.retriever = null as any
	}

	/**
	 * Initialize the context engine
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return
		}

		console.log("Initializing Context Engine...")

		try {
			// Initialize databases
			await this.vectorDb.initialize()
			await this.metadataDb.initialize()

			// Initialize memory manager
			this.memoryManager = new MemoryManager(this.metadataDb)
			await this.memoryManager.start()

			// Initialize file watcher
			this.fileWatcher = new FileWatcher(this.vectorDb, this.chunker, this.cacheManager)

			// Initialize context retriever
			this.retriever = new ContextRetriever(this.vectorDb, this.metadataDb, this.cacheManager, this.memoryManager)

			// Start watching workspace
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (workspaceFolders) {
				await this.fileWatcher.start(workspaceFolders)
			}

			this.initialized = true
			console.log("Context Engine initialized successfully")
		} catch (error) {
			console.error("Failed to initialize Context Engine:", error)
			throw error
		}
	}

	/**
	 * Perform full project indexing
	 */
	async indexProject(progressCallback?: (progress: number, message: string) => void): Promise<IndexingStats> {
		if (!this.initialized) {
			await this.initialize()
		}

		if (this.indexingInProgress) {
			throw new Error("Indexing already in progress")
		}

		this.indexingInProgress = true
		this.indexingStats = {
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			indexedChunks: 0,
			failedFiles: [],
			lastIndexTime: Date.now(),
			databaseSize: 0,
		}

		try {
			const workspaceFolders = vscode.workspace.workspaceFolders
			if (!workspaceFolders || workspaceFolders.length === 0) {
				throw new Error("No workspace folder found")
			}

			// Find all code files
			const files = await this.findCodeFiles(workspaceFolders)
			this.indexingStats.totalFiles = files.length

			console.log(`Found ${files.length} code files to index`)

			// Process files in batches
			const batchSize = this.config.indexingBatchSize
			for (let i = 0; i < files.length; i += batchSize) {
				const batch = files.slice(i, Math.min(i + batchSize, files.length))

				await this.indexBatch(batch)

				// Update progress
				const progress = (this.indexingStats.indexedFiles / this.indexingStats.totalFiles) * 100
				if (progressCallback) {
					progressCallback(
						progress,
						`Indexed ${this.indexingStats.indexedFiles}/${this.indexingStats.totalFiles} files`,
					)
				}

				// Add small delay to prevent overwhelming the system
				await this.delay(100)
			}

			// Update database size
			const vectorStats = await this.vectorDb.getStats()
			const metadataSize = await this.metadataDb.getSize()
			this.indexingStats.databaseSize = metadataSize
			this.indexingStats.totalChunks = vectorStats.totalChunks

			console.log("Indexing completed:", this.indexingStats)

			return this.indexingStats
		} finally {
			this.indexingInProgress = false
		}
	}

	private async findCodeFiles(workspaceFolders: readonly vscode.WorkspaceFolder[]): Promise<vscode.Uri[]> {
		const patterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.java", "**/*.go", "**/*.rs"]

		const excludes = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**", "**/out/**", "**/*.min.js"]

		const allFiles: vscode.Uri[] = []

		for (const pattern of patterns) {
			const files = await vscode.workspace.findFiles(pattern, `{${excludes.join(",")}}`)
			allFiles.push(...files)
		}

		// Remove duplicates
		const uniqueFiles = Array.from(new Set(allFiles.map((f) => f.fsPath))).map((p) => vscode.Uri.file(p))

		return uniqueFiles
	}

	private async indexBatch(files: vscode.Uri[]): Promise<void> {
		for (const file of files) {
			try {
				await this.indexFile(file)
				this.indexingStats.indexedFiles++
			} catch (error) {
				console.error(`Failed to index ${file.fsPath}:`, error)
				this.indexingStats.failedFiles.push(file.fsPath)
			}
		}
	}

	private async indexFile(uri: vscode.Uri): Promise<void> {
		// Read file content
		const content = await vscode.workspace.fs.readFile(uri)
		const contentStr = Buffer.from(content).toString("utf8")

		// Detect language
		const language = this.detectLanguage(uri.fsPath)

		// Chunk the file
		const chunks = await this.chunker.chunkFromAST(uri.fsPath, contentStr, language)

		// Add chunks to vector database
		await this.vectorDb.addChunks(chunks)

		this.indexingStats.indexedChunks += chunks.length
	}

	private detectLanguage(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase()
		const languageMap: Record<string, string> = {
			".ts": "typescript",
			".tsx": "typescript",
			".js": "javascript",
			".jsx": "javascript",
			".py": "python",
			".java": "java",
			".go": "go",
			".rs": "rust",
		}
		return languageMap[ext] || "unknown"
	}

	/**
	 * Search for context
	 */
	async search(query: SearchQuery): Promise<VectorSearchResult[]> {
		if (!this.initialized) {
			await this.initialize()
		}

		return await this.retriever.retrieve(query)
	}

	/**
	 * Get indexing statistics
	 */
	getIndexingStats(): IndexingStats {
		return { ...this.indexingStats }
	}

	/**
	 * Get performance metrics
	 */
	async getPerformanceMetrics(): Promise<PerformanceMetrics> {
		const queryStats = await this.metadataDb.getQueryStats()
		const cacheStats = this.cacheManager.getStats()

		return {
			queryLatencyP50: queryStats.avgLatency || 0,
			queryLatencyP95: queryStats.avgLatency * 1.5 || 0, // Estimate
			cacheHitRate: cacheStats.hitRate,
			indexingSpeed:
				this.indexingStats.indexedFiles > 0
					? this.indexingStats.indexedFiles / ((Date.now() - this.indexingStats.lastIndexTime) / 60000)
					: 0,
			memoryFootprint: process.memoryUsage().heapUsed / 1024 / 1024, // MB
			cpuUsage: 0, // TODO: Implement CPU monitoring
		}
	}

	/**
	 * Clear all indices and caches
	 */
	async clear(): Promise<void> {
		await this.vectorDb.clear()
		await this.memoryManager.clearAll()
		this.cacheManager.clearAll()

		this.indexingStats = {
			totalFiles: 0,
			indexedFiles: 0,
			totalChunks: 0,
			indexedChunks: 0,
			failedFiles: [],
			lastIndexTime: 0,
			databaseSize: 0,
		}
	}

	/**
	 * Shutdown the context engine
	 */
	async shutdown(): Promise<void> {
		if (!this.initialized) {
			return
		}

		console.log("Shutting down Context Engine...")

		await this.fileWatcher.stop()
		await this.memoryManager.stop()
		await this.vectorDb.close()
		await this.metadataDb.close()

		this.initialized = false
		console.log("Context Engine shut down successfully")
	}

	private getDefaultConfig(): ContextEngineConfig {
		const dataDir = path.join(os.homedir(), ".kilocode", "context-engine")

		return {
			embeddingModel: {
				name: "text-embedding-3-small",
				dimensions: 1536,
				provider: "openai",
				modelId: "text-embedding-3-small",
				maxTokens: 8191,
			},
			vectorDbPath: path.join(dataDir, "vectors"),
			metadataDbPath: path.join(dataDir, "metadata.db"),
			cacheEnabled: true,
			cacheTTL: 300000, // 5 minutes
			maxChunkSize: 1000,
			chunkOverlap: 100,
			indexingBatchSize: 10,
			cpuLimit: "medium",
			ramLimit: 500, // MB
			secretFiltering: true,
			encryptionEnabled: false,
		}
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms))
	}
}

/**
 * Singleton instance
 */
let contextEngineInstance: ContextEngine | null = null

export function getContextEngine(config?: Partial<ContextEngineConfig>): ContextEngine {
	if (!contextEngineInstance) {
		contextEngineInstance = new ContextEngine(config)
	}
	return contextEngineInstance
}
