/**
 * Core types for the Advanced Context System
 */

export interface CodeChunk {
	id: string
	filePath: string
	content: string
	summary: string
	startLine: number
	endLine: number
	type: ChunkType
	language: string
	embedding?: number[]
	metadata: ChunkMetadata
}

export type ChunkType = "function" | "class" | "method" | "interface" | "type" | "variable" | "import" | "comment"

export interface ChunkMetadata {
	symbolName?: string
	parentSymbol?: string
	imports?: string[]
	exports?: string[]
	dependencies?: string[]
	lastModified: number
	framework?: FrameworkType
	relationships?: Relationship[]
}

export interface Relationship {
	type: RelationType
	target: string
	filePath?: string
}

export type RelationType =
	| "imports"
	| "exports"
	| "extends"
	| "implements"
	| "calls"
	| "uses"
	| "inherits"
	| "references"

export type FrameworkType =
	| "odoo"
	| "react"
	| "vue"
	| "angular"
	| "django"
	| "fastapi"
	| "nextjs"
	| "nuxtjs"
	| "generic"

export interface EmbeddingModel {
	name: string
	dimensions: number
	provider: "openai" | "voyage" | "local"
	modelId: string
	maxTokens: number
	costPer1kTokens?: number
}

export interface VectorSearchResult {
	chunk: CodeChunk
	score: number
	distance: number
}

export interface SearchQuery {
	query: string
	limit?: number
	filters?: SearchFilters
	includeEmbeddings?: boolean
}

export interface SearchFilters {
	filePattern?: string
	languages?: string[]
	chunkTypes?: ChunkType[]
	frameworks?: FrameworkType[]
	dateRange?: {
		from: number
		to: number
	}
}

export interface IndexingStats {
	totalFiles: number
	indexedFiles: number
	totalChunks: number
	indexedChunks: number
	failedFiles: string[]
	lastIndexTime: number
	databaseSize: number
}

export interface MemoryEntry {
	id: string
	key: string
	value: any
	type: MemoryType
	timestamp: number
	ttl?: number
	metadata?: Record<string, any>
}

export type MemoryType = "short-term" | "long-term" | "ephemeral"

export interface CacheEntry<T> {
	key: string
	value: T
	timestamp: number
	ttl: number
	hits: number
}

export interface PerformanceMetrics {
	queryLatencyP50: number
	queryLatencyP95: number
	cacheHitRate: number
	indexingSpeed: number
	memoryFootprint: number
	cpuUsage: number
}

export interface ContextEngineConfig {
	embeddingModel: EmbeddingModel
	vectorDbPath: string
	metadataDbPath: string
	cacheEnabled: boolean
	cacheTTL: number
	maxChunkSize: number
	chunkOverlap: number
	indexingBatchSize: number
	cpuLimit: "low" | "medium" | "high"
	ramLimit: number
	secretFiltering: boolean
	encryptionEnabled: boolean
}

export interface QueryAnalytics {
	queryId: string
	query: string
	timestamp: number
	latency: number
	resultsCount: number
	cacheHit: boolean
	sources: string[]
}
