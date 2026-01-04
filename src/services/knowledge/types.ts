// kilocode_change - new file

export interface DocumentationSource {
	id: string
	name: string
	type: "url" | "local_file" | "pdf"
	source: string // URL or file path
	metadata: {
		lastUpdated: Date
		version?: string
		tags: string[]
		priority: number
	}
}

export interface DocumentationChunk {
	id: string
	sourceId: string
	content: string
	metadata: {
		sourceUrl?: string
		sourceFile?: string
		lastUpdated: Date
		docVersion?: string
		tags: string[]
		chunkIndex: number
		totalChunks: number
		title?: string
		section?: string
	}
	vectorEmbedding?: ArrayBuffer
	createdAt: Date
}

export interface DocumentationIndex {
	id: string
	sourceId: string
	chunkId: string
	content: string
	vectorEmbedding: ArrayBuffer
	metadata: string
	createdAt: Date
}

export interface ScrapingConfig {
	maxDepth: number
	followExternalLinks: boolean
	respectRobotsTxt: boolean
	rateLimitMs: number
	userAgent: string
	allowedDomains: string[]
	excludedPatterns: string[]
}

export interface HtmlToMarkdownOptions {
	preserveLinks: boolean
	preserveImages: boolean
	preserveCodeBlocks: boolean
	removeSelectors: string[]
	headingStrategy: "keep" | "simplify" | "remove"
}

export interface SearchQuery {
	query: string
	sourceIds?: string[]
	tags?: string[]
	limit: number
	threshold: number
}

export interface SearchResult {
	chunk: DocumentationChunk
	score: number
	relevance: string
}

export interface KnowledgeRetrievalResult {
	query: string
	results: SearchResult[]
	totalResults: number
	sources: DocumentationSource[]
	executionTime: number
}

export interface CrawlerProgress {
	sourceId: string
	status: "pending" | "crawling" | "processing" | "completed" | "failed"
	progress: number
	totalPages: number
	processedPages: number
	errors: string[]
	startTime: Date
	estimatedCompletion?: Date
}
