// kilocode_change - new file

/**
 * Completions service types for context-aware intelligent completions
 * Provides TypeScript interfaces for enhanced code completion system
 */

export interface CompletionContext {
	id: string
	sessionId?: string
	filePath: string
	position: number
	surroundingCode: string
	projectContext: ProjectContext
	semanticContext: SemanticContext
	metadata?: ContextMetadata
}

export interface ProjectContext {
	projectPath: string
	language: string
	framework?: string
	dependencies: string[]
	recentFiles: string[]
	gitBranch?: string
	metadata?: ProjectMetadata
}

export interface SemanticContext {
	embeddings: number[][]
	relevantFiles: FileReference[]
	concepts: string[]
	relationships: ConceptRelationship[]
	metadata?: SemanticMetadata
}

export interface FileReference {
	id: string
	filePath: string
	changeType: "create" | "update" | "delete"
	oldContent?: string
	newContent?: string
	metadata?: FileMetadata
}

export interface ConceptRelationship {
	concept1: string
	concept2: string
	relationshipType: "related" | "depends_on" | "similar_to" | "opposite_of"
	strength: number
}

// Metadata interfaces
export interface ContextMetadata {
	windowSize?: number
	overlapRatio?: number
	semanticThreshold?: number
	maxFiles?: number
	indexingTime?: number
}

export interface ProjectMetadata {
	totalFiles?: number
	totalLines?: number
	languages?: string[]
	frameworks?: string[]
	lastIndexed?: Date
}

export interface SemanticMetadata {
	embeddingModel?: string
	vectorDimensions?: number
	searchMethod?: string
	indexingStrategy?: string
}

export interface FileMetadata {
	size?: number
	lines?: number
	language?: string
	lastModified?: Date
	checksum?: string
	encoding?: string
}

// Completion types
export interface CodeCompletion {
	id: string
	text: string
	type: "snippet" | "function" | "class" | "interface" | "variable" | "import"
	priority: "high" | "medium" | "low"
	source: "local" | "dependency" | "documentation" | "ai-generated"
	confidence: number
	filePath?: string
	position?: {
		line: number
		column: number
	}
	insertText?: string
	documentation?: string
	metadata?: CompletionMetadata
}

export interface CompletionMetadata {
	model?: string
	provider?: string
	responseTime?: number
	contextSize?: number
	relevanceScore?: number
	sourceFiles?: string[]
	isFromCache?: boolean
}

// Request/Response types
export interface GetCompletionsRequest {
	filePath: string
	position: number
	surroundingCode: string
	context?: {
		includeSemantic?: boolean
		includeDependencies?: boolean
		includeTests?: boolean
		maxFiles?: number
		windowSize?: number
	}
	language?: string
}

export interface NaturalLanguageToCodeRequest {
	comment: string
	filePath: string
	position: number
	context?: CompletionContext
	language?: string
}

export interface CompletionResponse {
	completions: CodeCompletion[]
	context: CompletionContext
	responseTime: number
	metadata?: ResponseMetadata
}

export interface ResponseMetadata {
	totalCompletions?: number
	filteredCount?: number
	cacheHit?: boolean
	model?: string
	provider?: string
	processingTime?: number
}

// Analysis types
export interface SemanticSearchResult {
	file: FileReference
	relevanceScore: number
	matchingConcepts: string[]
	snippet: string
	lineNumbers?: number[]
}

export interface ConceptAnalysis {
	concept: string
	frequency: number
	context: string[]
	relatedConcepts: string[]
	importance: number
}

export interface CodePattern {
	type: "function" | "class" | "import" | "variable" | "interface"
	pattern: string
	language: string
	examples: string[]
	context: string[]
}

// Error types
export class CompletionsServiceError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly originalError?: any,
	) {
		super(message)
		this.name = "CompletionsServiceError"
	}
}

export class ContextError extends CompletionsServiceError {
	constructor(
		message: string,
		public override readonly originalError?: any,
	) {
		super(message, "CONTEXT_ERROR", originalError)
	}
}

export class SemanticSearchError extends CompletionsServiceError {
	constructor(
		message: string,
		public override readonly originalError?: any,
	) {
		super(message, "SEMANTIC_SEARCH_ERROR", originalError)
	}
}

// Utility types
export type CompletionType = "snippet" | "function" | "class" | "interface" | "variable" | "import"
export type CompletionSource = "local" | "dependency" | "documentation" | "ai-generated"
export type CompletionPriority = "high" | "medium" | "low"

// Configuration types
export interface CompletionsSettings {
	contextWindowSize: number
	semanticThreshold: number
	debounceMs: number
	maxCompletions: number
	includeDependencies: boolean
	includeTests: boolean
	enableNaturalLanguage: boolean
	cacheSize: number
}

// Event types
export interface CompletionsEvent {
	type: "completion_requested" | "completion_provided" | "context_updated" | "cache_cleared"
	filePath?: string
	timestamp: Date
	data?: any
}
