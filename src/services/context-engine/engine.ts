// kilocode_change - new file
/**
 * Context Engine - Main Class
 *
 * The main entry point for the Advanced Context Engine.
 * Wires together all components: AST Parser, Knowledge Graph,
 * Git Analyzer, Pattern Detector, Search, and Context Aggregator.
 */

import * as vscode from "vscode"
import * as path from "path"
import { CodeEntity, EntityRelationship, ParseResult } from "./types"
import { ASTParserService, getASTParserService } from "./ast-parser"
import { KnowledgeGraph, getKnowledgeGraph } from "./knowledge-graph"
import { GitHistoryAnalyzer, getGitHistoryAnalyzer } from "./git-analyzer"
import { PatternDetectorService, getPatternDetectorService } from "./pattern-detector"
import { CrossRepoManager, getCrossRepoManager } from "./cross-repo"
import { HybridSearchService, getHybridSearchService, SearchResult, SearchOptions } from "./search"
import { ContextAggregator, getContextAggregator, AggregatedContext, ContextOptions } from "./aggregator"

// ============================================================================
// Types
// ============================================================================

/**
 * Engine status
 */
export type EngineState = "uninitialized" | "initializing" | "ready" | "indexing" | "paused" | "error"

/**
 * Engine status information
 */
export interface EngineStatus {
	state: EngineState
	indexedFiles: number
	totalEntities: number
	lastUpdate: Date | null
	error?: string
	progress?: {
		current: number
		total: number
		currentFile?: string
	}
}

/**
 * Configuration options for the Context Engine
 */
export interface ContextEngineConfig {
	/** Enable/disable the engine */
	enabled: boolean
	/** Maximum memory usage (percentage) before pausing */
	maxMemoryUsage: number
	/** Paths to exclude from indexing */
	excludedPaths: string[]
	/** File size limit in bytes */
	maxFileSize: number
	/** Debounce delay for file changes (ms) */
	debounceDelay: number
	/** Enable git history analysis */
	enableGitHistory: boolean
	/** Enable pattern detection */
	enablePatternDetection: boolean
	/** Path to store the graph */
	storagePath: string
	/** Batch size for parallel processing */
	batchSize: number
	/** Maximum retry attempts for failed operations */
	maxRetries: number
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: ContextEngineConfig = {
	enabled: true,
	maxMemoryUsage: 0.7,
	excludedPaths: ["node_modules", ".git", "dist", "build", ".next", "coverage"],
	maxFileSize: 1024 * 1024, // 1MB
	debounceDelay: 500,
	enableGitHistory: true,
	enablePatternDetection: true,
	storagePath: ".kilo-code/context-engine",
	batchSize: 50,
	maxRetries: 3,
}

/**
 * Pending update operation
 */
interface PendingUpdate {
	filePath: string
	content?: string
	operation: "changed" | "saved" | "deleted"
	timestamp: number
	retryCount: number
}

/**
 * Interface for the Context Engine
 */
export interface IContextEngine {
	// Initialization
	initialize(workspacePaths: string[]): Promise<void>
	dispose(): void

	// Context retrieval
	getContext(filePath: string, line: number, options?: ContextOptions): Promise<AggregatedContext>
	getEntityContext(entityId: string, options?: ContextOptions): Promise<AggregatedContext>

	// Search
	search(query: string, options?: SearchOptions): Promise<SearchResult[]>

	// Entity operations
	getEntity(entityId: string): Promise<CodeEntity | null>
	getRelatedEntities(entityId: string, depth?: number): Promise<CodeEntity[]>

	// Real-time updates
	onFileChanged(filePath: string, content: string): Promise<void>
	onFileSaved(filePath: string): Promise<void>
	onFileDeleted(filePath: string): Promise<void>

	// Status
	getStatus(): EngineStatus
	onStatusChanged: vscode.Event<EngineStatus>
}

// ============================================================================
// Context Engine Implementation
// ============================================================================

/**
 * Advanced Context Engine
 *
 * Main class that orchestrates all context engine components.
 */
export class ContextEngine implements IContextEngine {
	private config: ContextEngineConfig
	private status: EngineStatus
	private workspacePaths: string[] = []

	// Components
	private astParser: ASTParserService
	private knowledgeGraph: KnowledgeGraph
	private gitAnalyzer: GitHistoryAnalyzer
	private patternDetector: PatternDetectorService
	private crossRepoManager: CrossRepoManager
	private searchService: HybridSearchService
	private contextAggregator: ContextAggregator

	// Real-time update handling
	private pendingUpdates: Map<string, PendingUpdate> = new Map()
	private shadowBuffers: Map<string, string> = new Map()
	private debounceTimers: Map<string, NodeJS.Timeout> = new Map()
	private updateQueue: PendingUpdate[] = []
	private isProcessingQueue: boolean = false
	private indexingPaused: boolean = false

	// Event emitter for status changes
	private _onStatusChanged = new vscode.EventEmitter<EngineStatus>()
	readonly onStatusChanged = this._onStatusChanged.event

	// Disposables
	private disposables: vscode.Disposable[] = []

	constructor(config: Partial<ContextEngineConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
		this.status = {
			state: "uninitialized",
			indexedFiles: 0,
			totalEntities: 0,
			lastUpdate: null,
		}

		// Initialize components
		this.astParser = getASTParserService({ maxFileSize: this.config.maxFileSize })
		this.knowledgeGraph = getKnowledgeGraph()
		this.gitAnalyzer = getGitHistoryAnalyzer()
		this.patternDetector = getPatternDetectorService()
		this.crossRepoManager = getCrossRepoManager()
		this.searchService = getHybridSearchService()
		this.contextAggregator = getContextAggregator()

		// Wire components together
		this.wireComponents()
	}

	/**
	 * Wire components together
	 */
	private wireComponents(): void {
		// Connect search service to knowledge graph
		this.searchService.setKnowledgeGraph(this.knowledgeGraph)
		this.searchService.setGitAnalyzer(this.gitAnalyzer)
		this.searchService.setPatternDetector(this.patternDetector)

		// Connect context aggregator
		this.contextAggregator.setKnowledgeGraph(this.knowledgeGraph)
		this.contextAggregator.setGitAnalyzer(this.gitAnalyzer)
		this.contextAggregator.setPatternDetector(this.patternDetector)
	}

	// ============================================================================
	// Initialization
	// ============================================================================

	/**
	 * Initialize the context engine for the given workspace paths
	 */
	async initialize(workspacePaths: string[]): Promise<void> {
		if (!this.config.enabled) {
			this.updateStatus({ state: "ready", indexedFiles: 0, totalEntities: 0 })
			return
		}

		try {
			this.updateStatus({ state: "initializing" })
			this.workspacePaths = workspacePaths

			// Add repositories to cross-repo manager
			for (const wsPath of workspacePaths) {
				await this.crossRepoManager.addRepository(wsPath)
			}

			// Initialize git analyzer for primary repository
			if (this.config.enableGitHistory && workspacePaths.length > 0) {
				await this.gitAnalyzer.initialize(workspacePaths[0])
			}

			// Try to load existing graph
			const graphPath = this.getGraphPath()
			try {
				await this.knowledgeGraph.load(graphPath)
				const metadata = this.knowledgeGraph.getMetadata()
				this.updateStatus({
					state: "ready",
					indexedFiles: metadata.nodeCount,
					totalEntities: metadata.nodeCount,
					lastUpdate: metadata.lastModified,
				})
			} catch {
				// No existing graph, will need to index
				this.updateStatus({ state: "ready", indexedFiles: 0, totalEntities: 0 })
			}

			// Index entities for search and aggregator
			await this.refreshEntityIndex()
		} catch (error) {
			this.updateStatus({
				state: "error",
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * Dispose of resources
	 */
	dispose(): void {
		// Clear timers
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer)
		}
		this.debounceTimers.clear()

		// Dispose event emitter
		this._onStatusChanged.dispose()

		// Dispose other disposables
		for (const disposable of this.disposables) {
			disposable.dispose()
		}
		this.disposables = []

		// Clear state
		this.pendingUpdates.clear()
		this.shadowBuffers.clear()
		this.updateQueue = []
	}

	// ============================================================================
	// Context Retrieval
	// ============================================================================

	/**
	 * Get aggregated context for a file position
	 */
	async getContext(filePath: string, line: number, options?: ContextOptions): Promise<AggregatedContext> {
		return this.contextAggregator.getContext(filePath, line, options)
	}

	/**
	 * Get context for a specific entity
	 */
	async getEntityContext(entityId: string, options?: ContextOptions): Promise<AggregatedContext> {
		return this.contextAggregator.getEntityContext(entityId, options)
	}

	// ============================================================================
	// Search
	// ============================================================================

	/**
	 * Search for entities
	 */
	async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
		return this.searchService.search(query, options)
	}

	// ============================================================================
	// Entity Operations
	// ============================================================================

	/**
	 * Get an entity by ID
	 */
	async getEntity(entityId: string): Promise<CodeEntity | null> {
		return this.knowledgeGraph.getNode(entityId)
	}

	/**
	 * Get related entities
	 */
	async getRelatedEntities(entityId: string, depth: number = 2): Promise<CodeEntity[]> {
		return this.knowledgeGraph.getRelatedEntities(entityId, depth)
	}

	// ============================================================================
	// Real-time Updates
	// ============================================================================

	/**
	 * Handle file content change (unsaved)
	 */
	async onFileChanged(filePath: string, content: string): Promise<void> {
		if (!this.config.enabled || this.shouldExclude(filePath)) {
			return
		}

		// Store in shadow buffer for temporary analysis
		this.shadowBuffers.set(filePath, content)

		// Debounce the update
		this.debounceUpdate(filePath, content, "changed")
	}

	/**
	 * Handle file save
	 */
	async onFileSaved(filePath: string): Promise<void> {
		if (!this.config.enabled || this.shouldExclude(filePath)) {
			return
		}

		// Clear shadow buffer
		this.shadowBuffers.delete(filePath)

		// Queue update with higher priority
		this.queueUpdate({
			filePath,
			operation: "saved",
			timestamp: Date.now(),
			retryCount: 0,
		})
	}

	/**
	 * Handle file deletion
	 */
	async onFileDeleted(filePath: string): Promise<void> {
		if (!this.config.enabled) {
			return
		}

		// Clear shadow buffer
		this.shadowBuffers.delete(filePath)

		// Queue deletion
		this.queueUpdate({
			filePath,
			operation: "deleted",
			timestamp: Date.now(),
			retryCount: 0,
		})
	}

	// ============================================================================
	// Status
	// ============================================================================

	/**
	 * Get current engine status
	 */
	getStatus(): EngineStatus {
		return { ...this.status }
	}

	// ============================================================================
	// Indexing
	// ============================================================================

	/**
	 * Index a single file
	 */
	async indexFile(filePath: string, content?: string): Promise<ParseResult | null> {
		if (!this.astParser.canParse(filePath)) {
			return null
		}

		try {
			// Check memory before processing
			if (this.shouldPauseForMemory()) {
				await this.pauseIndexing()
			}

			const result = await this.astParser.parse(filePath, content)

			if (result.success) {
				// Remove old entities for this file
				await this.knowledgeGraph.removeNodesByFile(filePath)

				// Add new entities
				await this.knowledgeGraph.addNodes(result.entities)
				await this.knowledgeGraph.addEdges(result.relationships)

				// Update search index
				this.searchService.indexEntities(result.entities)
				this.contextAggregator.indexEntities(result.entities)

				this.updateStatus({
					indexedFiles: this.status.indexedFiles + 1,
					totalEntities: this.knowledgeGraph.getNodeCount(),
					lastUpdate: new Date(),
				})
			}

			return result
		} catch (error) {
			console.error(`[ContextEngine] Failed to index file ${filePath}:`, error)
			return null
		}
	}

	/**
	 * Index all files in workspace
	 */
	async indexWorkspace(): Promise<void> {
		this.updateStatus({ state: "indexing" })

		try {
			const files = await this.findFilesToIndex()
			const total = files.length
			let current = 0

			// Process in batches
			for (let i = 0; i < files.length; i += this.config.batchSize) {
				if (this.indexingPaused) {
					await this.waitForResume()
				}

				const batch = files.slice(i, i + this.config.batchSize)

				await Promise.all(
					batch.map(async (file) => {
						await this.indexFile(file)
						current++
						this.updateStatus({
							progress: { current, total, currentFile: file },
						})
					}),
				)
			}

			// Save graph
			await this.saveGraph()

			this.updateStatus({
				state: "ready",
				progress: undefined,
			})
		} catch (error) {
			this.updateStatus({
				state: "error",
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * Perform incremental update for a file
	 */
	async incrementalUpdate(filePath: string, content?: string): Promise<void> {
		// Get old entities for this file
		const oldEntities = await this.knowledgeGraph.findEntities({ filePath })
		const oldEntityIds = new Set(oldEntities.map((e) => e.id))

		// Parse the file
		const result = await this.indexFile(filePath, content)

		if (result?.success) {
			// Find entities that were removed
			const newEntityIds = new Set(result.entities.map((e) => e.id))

			for (const oldId of oldEntityIds) {
				if (!newEntityIds.has(oldId)) {
					// Entity was removed, update cross-repo links
					const links = this.crossRepoManager.getCrossRepoLinks(oldId)
					// Links will be cleaned up when the entity is removed
				}
			}
		}
	}

	// ============================================================================
	// Private Helpers
	// ============================================================================

	/**
	 * Debounce file updates
	 */
	private debounceUpdate(filePath: string, content: string, operation: "changed" | "saved"): void {
		// Clear existing timer
		const existingTimer = this.debounceTimers.get(filePath)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		// Set new timer
		const timer = setTimeout(() => {
			this.debounceTimers.delete(filePath)
			this.queueUpdate({
				filePath,
				content,
				operation,
				timestamp: Date.now(),
				retryCount: 0,
			})
		}, this.config.debounceDelay)

		this.debounceTimers.set(filePath, timer)
	}

	/**
	 * Queue an update for processing
	 */
	private queueUpdate(update: PendingUpdate): void {
		// Remove any existing update for this file
		this.updateQueue = this.updateQueue.filter((u) => u.filePath !== update.filePath)

		// Add new update
		this.updateQueue.push(update)

		// Process queue if not already processing
		if (!this.isProcessingQueue) {
			this.processUpdateQueue()
		}
	}

	/**
	 * Process the update queue
	 */
	private async processUpdateQueue(): Promise<void> {
		if (this.isProcessingQueue || this.updateQueue.length === 0) {
			return
		}

		this.isProcessingQueue = true

		try {
			while (this.updateQueue.length > 0) {
				// Batch simultaneous updates
				const batch = this.updateQueue.splice(0, this.config.batchSize)

				await Promise.all(batch.map((update) => this.processUpdate(update)))
			}
		} finally {
			this.isProcessingQueue = false
		}
	}

	/**
	 * Process a single update
	 */
	private async processUpdate(update: PendingUpdate): Promise<void> {
		try {
			switch (update.operation) {
				case "changed":
				case "saved":
					await this.incrementalUpdate(update.filePath, update.content)
					break
				case "deleted":
					await this.knowledgeGraph.removeNodesByFile(update.filePath)
					await this.refreshEntityIndex()
					break
			}
		} catch (error) {
			console.error(`[ContextEngine] Update failed for ${update.filePath}:`, error)

			// Retry with exponential backoff
			if (update.retryCount < this.config.maxRetries) {
				const delay = Math.pow(2, update.retryCount) * 1000
				setTimeout(() => {
					this.queueUpdate({
						...update,
						retryCount: update.retryCount + 1,
					})
				}, delay)
			}
		}
	}

	/**
	 * Check if a file should be excluded
	 */
	private shouldExclude(filePath: string): boolean {
		const normalizedPath = path.normalize(filePath)
		return this.config.excludedPaths.some((excluded) => normalizedPath.includes(excluded))
	}

	/**
	 * Check if indexing should pause for memory
	 */
	private shouldPauseForMemory(): boolean {
		const memoryUsage = process.memoryUsage()
		const heapUsedRatio = memoryUsage.heapUsed / memoryUsage.heapTotal
		return heapUsedRatio > this.config.maxMemoryUsage
	}

	/**
	 * Pause indexing due to memory pressure
	 */
	private async pauseIndexing(): Promise<void> {
		this.indexingPaused = true
		this.updateStatus({ state: "paused" })

		// Wait for memory to free up
		await new Promise((resolve) => setTimeout(resolve, 5000))

		// Force garbage collection if available
		if (global.gc) {
			global.gc()
		}

		this.indexingPaused = false
		this.updateStatus({ state: "indexing" })
	}

	/**
	 * Wait for indexing to resume
	 */
	private async waitForResume(): Promise<void> {
		while (this.indexingPaused) {
			await new Promise((resolve) => setTimeout(resolve, 1000))
		}
	}

	/**
	 * Find all files to index in workspace
	 */
	private async findFilesToIndex(): Promise<string[]> {
		const files: string[] = []

		for (const wsPath of this.workspacePaths) {
			const pattern = new vscode.RelativePattern(wsPath, "**/*.{ts,tsx,js,jsx,py,java,go,rs}")
			const excludePattern = `{${this.config.excludedPaths.join(",")}}`

			const foundFiles = await vscode.workspace.findFiles(pattern, excludePattern)
			files.push(...foundFiles.map((f) => f.fsPath))
		}

		return files
	}

	/**
	 * Get the path for storing the graph
	 */
	private getGraphPath(): string {
		if (this.workspacePaths.length > 0) {
			return path.join(this.workspacePaths[0], this.config.storagePath, "graph.json")
		}
		return path.join(this.config.storagePath, "graph.json")
	}

	/**
	 * Save the graph to disk
	 */
	private async saveGraph(): Promise<void> {
		try {
			const graphPath = this.getGraphPath()
			await this.knowledgeGraph.save(graphPath)
		} catch (error) {
			console.error("[ContextEngine] Failed to save graph:", error)
		}
	}

	/**
	 * Refresh the entity index for search and aggregator
	 */
	private async refreshEntityIndex(): Promise<void> {
		const entities = await this.knowledgeGraph.getAllNodes()
		this.searchService.indexEntities(entities)
		this.contextAggregator.indexEntities(entities)
	}

	/**
	 * Update status and emit event
	 */
	private updateStatus(updates: Partial<EngineStatus>): void {
		this.status = { ...this.status, ...updates }
		this._onStatusChanged.fire(this.status)
	}
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ContextEngine | null = null

export function getContextEngine(config?: Partial<ContextEngineConfig>): ContextEngine {
	if (!instance) {
		instance = new ContextEngine(config)
	}
	return instance
}

export function resetContextEngine(): void {
	if (instance) {
		instance.dispose()
		instance = null
	}
}
