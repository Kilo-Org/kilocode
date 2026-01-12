// kilocode_change - new file

/**
 * Chat service types for enhanced AI features
 * Provides TypeScript interfaces for chat with source citations
 */

export interface ChatSession {
	id: string
	userId: string
	title: string
	createdAt: Date
	updatedAt: Date
	context?: CompletionContext
	metadata?: SessionMetadata
}

export interface ChatMessage {
	id: string
	sessionId: string
	role: "user" | "assistant"
	content: string
	citations?: Citation[]
	timestamp: Date
	metadata?: MessageMetadata
}

export interface Citation {
	id: string
	messageId: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
	metadata?: CitationMetadata
}

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
export interface SessionMetadata {
	messageCount?: number
	lastActivity?: Date
	contextSize?: number
	isActive?: boolean
}

export interface MessageMetadata {
	tokenCount?: number
	model?: string
	responseTime?: number
	provider?: string
	temperature?: number
}

export interface CitationMetadata {
	extractedAt?: Date
	verified?: boolean
	relevanceScore?: number
	sourceVersion?: string
}

export interface FileMetadata {
	size?: number
	lines?: number
	language?: string
	lastModified?: Date
	checksum?: string
	encoding?: string
}

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

// Request/Response types
export interface CreateChatSessionRequest {
	title: string
	initialContext?: CompletionContext
}

export interface SendMessageRequest {
	content: string
	role: "user" | "assistant"
	context?: CompletionContext
	includeCitations?: boolean
}

export interface ChatMessageResponse {
	message: ChatMessage
	responseTime: number
	context: CompletionContext
}

export interface UpdateContextRequest {
	filePath: string
	position: number
	surroundingCode: string
	projectContext?: ProjectContext
	semanticContext?: SemanticContext
}

// Error types
export class ChatServiceError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly originalError?: any,
	) {
		super(message)
		this.name = "ChatServiceError"
	}
}

export class CitationError extends ChatServiceError {
	constructor(
		message: string,
		public override readonly originalError?: any,
	) {
		super(message, "CITATION_ERROR", originalError)
	}
}

export class ContextError extends ChatServiceError {
	constructor(
		message: string,
		public override readonly originalError?: any,
	) {
		super(message, "CONTEXT_ERROR", originalError)
	}
}

// Utility types
export type MessageRole = "user" | "assistant"
export type SourceType = "file" | "documentation" | "url"
export type ChangeType = "create" | "update" | "delete"
export type RelationshipType = "related" | "depends_on" | "similar_to" | "opposite_of"

// Configuration types
export interface ChatSettings {
	maxContextFiles: number
	citationThreshold: number
	autoSaveContext: boolean
	includeLineNumbers: boolean
	maxMessageLength: number
}

// Event types
export interface ChatEvent {
	type: "message_sent" | "message_received" | "context_updated" | "session_created" | "session_deleted"
	sessionId: string
	timestamp: Date
	data?: any
}

export interface CitationClickEvent {
	type: "citation_clicked"
	citationId: string
	filePath: string
	lineNumber?: number
	timestamp: Date
}
