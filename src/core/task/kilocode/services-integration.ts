// kilocode_change - new file
// Integration layer for new Memory, Index, and Context services

import * as vscode from "vscode"
import { DatabaseManager } from "../../../services/storage/database-manager"
import { EmbeddingCacheService, getEmbeddingCacheService } from "../../../services/code-index/cache/embedding-cache"
import { TokenCountingCache, getTokenCountingCache } from "../../context-management/token-cache"
import { ConversationMemoryStore, getConversationMemoryStore } from "../../../services/memory/conversation-memory-store"
import { ContextPrioritizer, getContextPrioritizer } from "../../context-management/prioritizer"
import { RelevanceEngine, getRelevanceEngine } from "../../../services/context/relevance-engine"
import { SemanticCompressor, getSemanticCompressor } from "../../context-management/semantic-compressor"
import { HierarchicalSummarizer, getHierarchicalSummarizer } from "../../condense/hierarchical-summarizer"
import { UnifiedIndexService, getUnifiedIndexService } from "../../../services/index/unified-index-service"

/**
 * Service container for all integrated services
 */
export interface KiloCodeServices {
	embeddingCache: EmbeddingCacheService
	tokenCache: TokenCountingCache
	memoryStore: ConversationMemoryStore
	prioritizer: ContextPrioritizer
	relevanceEngine: RelevanceEngine
	compressor: SemanticCompressor
	summarizer: HierarchicalSummarizer
	indexService: UnifiedIndexService | null
}

/**
 * Initialization status
 */
export interface ServicesStatus {
	isInitialized: boolean
	initializationError?: string
	servicesReady: {
		embeddingCache: boolean
		tokenCache: boolean
		memoryStore: boolean
		prioritizer: boolean
		relevanceEngine: boolean
		compressor: boolean
		summarizer: boolean
		indexService: boolean
	}
}

// Singleton services container
let services: KiloCodeServices | null = null
let servicesStatus: ServicesStatus = {
	isInitialized: false,
	servicesReady: {
		embeddingCache: false,
		tokenCache: false,
		memoryStore: false,
		prioritizer: false,
		relevanceEngine: false,
		compressor: false,
		summarizer: false,
		indexService: false,
	},
}

/**
 * Initialize all KiloCode services
 */
export async function initializeKiloCodeServices(
	context: vscode.ExtensionContext,
	workspacePath: string,
	storageDir: string,
): Promise<KiloCodeServices> {
	if (services && servicesStatus.isInitialized) {
		return services
	}

	try {
		// Initialize database manager
		const databaseManager = new DatabaseManager(workspacePath, storageDir)
		await databaseManager.initialize()

		// Initialize embedding cache
		const embeddingCache = getEmbeddingCacheService()
		await embeddingCache.initialize(databaseManager)
		servicesStatus.servicesReady.embeddingCache = true

		// Initialize token counting cache
		const tokenCache = getTokenCountingCache()
		servicesStatus.servicesReady.tokenCache = true

		// Initialize conversation memory store
		const memoryStore = getConversationMemoryStore()
		await memoryStore.initialize(databaseManager)
		servicesStatus.servicesReady.memoryStore = true

		// Initialize context prioritizer
		const prioritizer = getContextPrioritizer()
		servicesStatus.servicesReady.prioritizer = true

		// Initialize relevance engine
		const relevanceEngine = getRelevanceEngine()
		servicesStatus.servicesReady.relevanceEngine = true

		// Initialize semantic compressor
		const compressor = getSemanticCompressor()
		servicesStatus.servicesReady.compressor = true

		// Initialize hierarchical summarizer
		const summarizer = getHierarchicalSummarizer()
		servicesStatus.servicesReady.summarizer = true

		// Initialize unified index service
		let indexService: UnifiedIndexService | null = null
		try {
			indexService = getUnifiedIndexService(workspacePath, context)
			await indexService.initialize(storageDir)
			servicesStatus.servicesReady.indexService = true
		} catch (error) {
			console.warn("[KiloCodeServices] Failed to initialize index service:", error)
		}

		services = {
			embeddingCache,
			tokenCache,
			memoryStore,
			prioritizer,
			relevanceEngine,
			compressor,
			summarizer,
			indexService,
		}

		servicesStatus.isInitialized = true
		console.log("[KiloCodeServices] All services initialized successfully")

		return services
	} catch (error) {
		servicesStatus.initializationError = error instanceof Error ? error.message : String(error)
		console.error("[KiloCodeServices] Initialization failed:", error)
		throw error
	}
}

/**
 * Get initialized services (must call initializeKiloCodeServices first)
 */
export function getKiloCodeServices(): KiloCodeServices | null {
	return services
}

/**
 * Get service initialization status
 */
export function getServicesStatus(): ServicesStatus {
	return { ...servicesStatus }
}

/**
 * Helper to use token cache for counting
 */
export async function countTokensWithCache(
	content: string,
	model: string,
	computeFn: () => Promise<number>,
): Promise<number> {
	const cache = services?.tokenCache ?? getTokenCountingCache()
	return cache.getOrCompute(content, model, computeFn)
}

/**
 * Helper to store important conversation memory
 */
export async function storeConversationMemory(params: {
	taskId: string
	workspaceRoot: string
	title: string
	summary: string
	content: string
	type: "semantic" | "episodic" | "procedural"
	priority: "critical" | "high" | "medium" | "low"
	tags: string[]
	relatedFiles: string[]
}): Promise<string | null> {
	const store = services?.memoryStore
	if (!store) {
		console.warn("[KiloCodeServices] Memory store not initialized")
		return null
	}

	return store.store({
		taskId: params.taskId,
		workspaceRoot: params.workspaceRoot,
		title: params.title,
		summary: params.summary,
		content: params.content,
		type: params.type,
		priority: params.priority,
		tags: params.tags,
		relatedFiles: params.relatedFiles,
		metadata: {},
	})
}

/**
 * Helper to search relevant memories
 */
export async function searchRelevantMemories(params: {
	query: string
	workspaceRoot?: string
	limit?: number
}): Promise<Array<{ id: string; content: string; score: number }>> {
	const store = services?.memoryStore
	if (!store) {
		return []
	}

	const results = await store.search({
		query: params.query,
		workspaceRoot: params.workspaceRoot,
		limit: params.limit ?? 5,
	})

	return results.map((r) => ({
		id: r.memory.id,
		content: r.memory.content,
		score: r.relevanceScore,
	}))
}

/**
 * Helper to prioritize context items
 */
export function prioritizeContext(
	items: Array<{
		id: string
		content: string
		type: "file" | "symbol" | "memory" | "documentation" | "conversation"
		source: string
		relevanceScore?: number
		timestamp?: number
		tokenCount: number
	}>,
	tokenBudget: number,
	activeFilePath?: string,
): Array<{ id: string; content: string; score: number }> {
	const prioritizer = services?.prioritizer ?? getContextPrioritizer()

	const result = prioritizer.prioritize(items, {
		tokenBudget,
		activeFilePath,
	})

	return result.includedItems.map((item) => ({
		id: item.id,
		content: item.content,
		score: item.combinedScore,
	}))
}

/**
 * Helper to compress context
 */
export function compressContext(content: string, targetTokens: number): { compressed: string; ratio: number } {
	const compressor = services?.compressor ?? getSemanticCompressor()

	const level = compressor.getOptimalLevel(content, targetTokens)
	const result = compressor.compress(content, level)

	return {
		compressed: result.compressedContent,
		ratio: result.compressionRatio,
	}
}

/**
 * Helper to search unified index
 */
export async function searchUnifiedIndex(
	query: string,
	options?: {
		limit?: number
		includeSymbols?: boolean
		directoryPrefix?: string
	},
): Promise<Array<{ filePath: string; content: string; score: number }>> {
	const indexService = services?.indexService
	if (!indexService) {
		return []
	}

	const results = await indexService.search(query, options)

	return results.map((r) => ({
		filePath: r.filePath,
		content: r.content,
		score: r.score,
	}))
}

/**
 * Record user feedback for relevance learning
 */
export function recordRelevanceFeedback(itemId: string, wasUseful: boolean, context?: string): void {
	const engine = services?.relevanceEngine ?? getRelevanceEngine()

	engine.recordFeedback({
		itemId,
		wasUseful,
		context: context ?? "general",
		timestamp: Date.now(),
	})
}

/**
 * Cleanup and reset all services
 */
export async function resetKiloCodeServices(): Promise<void> {
	if (services?.indexService) {
		services.indexService.dispose()
	}

	services = null
	servicesStatus = {
		isInitialized: false,
		servicesReady: {
			embeddingCache: false,
			tokenCache: false,
			memoryStore: false,
			prioritizer: false,
			relevanceEngine: false,
			compressor: false,
			summarizer: false,
			indexService: false,
		},
	}
}
