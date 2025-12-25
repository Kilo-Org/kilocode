/**
 * Context Engine Public API
 * Export all necessary types and classes
 */

// Main engine
export { ContextEngine, getContextEngine } from "./index"

// Types
export type {
	CodeChunk,
	ChunkType,
	ChunkMetadata,
	Relationship,
	RelationType,
	FrameworkType,
	EmbeddingModel,
	VectorSearchResult,
	SearchQuery,
	SearchFilters,
	IndexingStats,
	MemoryEntry,
	MemoryType,
	CacheEntry,
	PerformanceMetrics,
	ContextEngineConfig,
	QueryAnalytics,
} from "./types"

// Indexing
export { EmbeddingService } from "./indexing/embedding-service"
export { CodeChunker } from "./indexing/code-chunker"
export { VectorDatabase } from "./indexing/vector-database"
export { FileWatcher } from "./indexing/file-watcher"

// Memory
export { MetadataDatabase } from "./memory/metadata-database"
export { MemoryManager } from "./memory/memory-manager"

// Cache
export { CacheManager } from "./cache/cache-manager"

// Retrieval
export { ContextRetriever } from "./retrieval/context-retriever"

// Framework Support
export {
	FrameworkDetector,
	FrameworkAnalyzerFactory,
	ReactAnalyzer,
	GenericAnalyzer,
} from "./framework-support/framework-detector"
export type { IFrameworkAnalyzer } from "./framework-support/framework-detector"

// Monitoring
export { PerformanceMonitor } from "./monitoring/performance-monitor"

// Security
export { SecretFilter } from "./security/secret-filter"
export type { SecretPattern } from "./security/secret-filter"
