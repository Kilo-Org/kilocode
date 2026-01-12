// kilocode_change - new file

/**
 * Entity models for Chat Service
 * Provides data structures and validation for chat sessions, messages, and citations
 */

import { v4 as uuidv4, validate as uuidValidate } from "uuid"
import type { ChatSession, ChatMessage, Citation, SessionMetadata, MessageMetadata, CitationMetadata } from "./types"

/**
 * ChatSession Entity
 * Represents a conversation with the AI
 */
export class ChatSessionEntity implements ChatSession {
	id: string
	userId: string
	title: string
	createdAt: Date
	updatedAt: Date
	context?: any
	metadata?: SessionMetadata

	constructor(data: Partial<ChatSession> = {}) {
		this.id = data.id || uuidv4()
		this.userId = data.userId || ""
		this.title = data.title || ""
		this.createdAt = data.createdAt || new Date()
		this.updatedAt = data.updatedAt || new Date()
		this.context = data.context
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid session ID")
		}

		if (!this.userId || this.userId.trim().length === 0) {
			errors.push("User ID is required")
		}

		if (!this.title || this.title.trim().length === 0) {
			errors.push("Title is required")
		}

		if (this.title && this.title.length > 255) {
			errors.push("Title exceeds maximum length of 255 characters")
		}

		if (!(this.createdAt instanceof Date)) {
			errors.push("Invalid createdAt timestamp")
		}

		if (!(this.updatedAt instanceof Date)) {
			errors.push("Invalid updatedAt timestamp")
		}

		if (errors.length > 0) {
			throw new Error(`ChatSession validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): ChatSession {
		return {
			id: this.id,
			userId: this.userId,
			title: this.title,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
			context: this.context,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: ChatSession): ChatSessionEntity {
		return new ChatSessionEntity(data)
	}

	updateTimestamp(): void {
		this.updatedAt = new Date()
	}

	incrementMessageCount(): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.messageCount = (this.metadata.messageCount || 0) + 1
		this.updateTimestamp()
	}

	updateLastActivity(): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.lastActivity = new Date()
		this.updateTimestamp()
	}
}

/**
 * ChatMessage Entity
 * Represents individual messages within a chat session
 */
export class ChatMessageEntity implements ChatMessage {
	id: string
	sessionId: string
	role: "user" | "assistant"
	content: string
	citations?: Citation[]
	timestamp: Date
	metadata?: MessageMetadata

	constructor(data: Partial<ChatMessage> = {}) {
		this.id = data.id || uuidv4()
		this.sessionId = data.sessionId || ""
		this.role = data.role || "user"
		this.content = data.content || ""
		this.citations = data.citations || []
		this.timestamp = data.timestamp || new Date()
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid message ID")
		}

		if (!this.sessionId || this.sessionId.trim().length === 0) {
			errors.push("Session ID is required")
		}

		if (!["user", "assistant"].includes(this.role)) {
			errors.push("Invalid role: must be 'user' or 'assistant'")
		}

		if (!this.content || this.content.trim().length === 0) {
			errors.push("Content is required")
		}

		if (this.content.length > 100000) {
			errors.push("Content exceeds maximum length of 100,000 characters")
		}

		if (!(this.timestamp instanceof Date)) {
			errors.push("Invalid timestamp")
		}

		if (errors.length > 0) {
			throw new Error(`ChatMessage validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): ChatMessage {
		return {
			id: this.id,
			sessionId: this.sessionId,
			role: this.role,
			content: this.content,
			citations: this.citations,
			timestamp: this.timestamp,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: ChatMessage): ChatMessageEntity {
		return new ChatMessageEntity(data)
	}

	addCitation(citation: Citation): void {
		if (!this.citations) {
			this.citations = []
		}
		this.citations.push(citation)
	}

	setCitations(citations: Citation[]): void {
		this.citations = citations
	}

	hasCitations(): boolean {
		return this.citations !== undefined && this.citations.length > 0
	}

	getCitationCount(): number {
		return this.citations?.length || 0
	}

	isUserMessage(): boolean {
		return this.role === "user"
	}

	isAssistantMessage(): boolean {
		return this.role === "assistant"
	}

	setTokenCount(count: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.tokenCount = count
	}

	setResponseTime(time: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.responseTime = time
	}

	setModel(model: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.model = model
	}
}

/**
 * Citation Entity
 * Represents a source reference within AI responses
 */
export class CitationEntity implements Citation {
	id: string
	messageId: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
	metadata?: CitationMetadata

	constructor(data: Partial<Citation> = {}) {
		this.id = data.id || uuidv4()
		this.messageId = data.messageId || ""
		this.sourceType = data.sourceType || "file"
		this.sourcePath = data.sourcePath || ""
		this.startLine = data.startLine
		this.endLine = data.endLine
		this.snippet = data.snippet || ""
		this.confidence = data.confidence || 0.5
		this.metadata = data.metadata || {}
	}

	validate(): boolean {
		const errors: string[] = []

		if (!this.id || !uuidValidate(this.id)) {
			errors.push("Invalid citation ID")
		}

		if (!this.messageId || this.messageId.trim().length === 0) {
			errors.push("Message ID is required")
		}

		if (!["file", "documentation", "url"].includes(this.sourceType)) {
			errors.push("Invalid sourceType: must be 'file', 'documentation', or 'url'")
		}

		if (!this.sourcePath || this.sourcePath.trim().length === 0) {
			errors.push("Source path is required")
		}

		if (this.sourcePath.length > 1000) {
			errors.push("Source path exceeds maximum length of 1000 characters")
		}

		if (this.confidence < 0 || this.confidence > 1) {
			errors.push("Confidence must be between 0 and 1")
		}

		if (this.startLine !== undefined && this.startLine < 1) {
			errors.push("Start line must be a positive integer")
		}

		if (this.endLine !== undefined && this.endLine < 1) {
			errors.push("End line must be a positive integer")
		}

		if (this.startLine !== undefined && this.endLine !== undefined && this.endLine < this.startLine) {
			errors.push("End line must be greater than or equal to start line")
		}

		if (!this.snippet || this.snippet.trim().length === 0) {
			errors.push("Snippet is required")
		}

		if (this.snippet.length > 1000) {
			errors.push("Snippet exceeds maximum length of 1000 characters")
		}

		if (errors.length > 0) {
			throw new Error(`Citation validation failed: ${errors.join(", ")}`)
		}

		return true
	}

	toJSON(): Citation {
		return {
			id: this.id,
			messageId: this.messageId,
			sourceType: this.sourceType,
			sourcePath: this.sourcePath,
			startLine: this.startLine,
			endLine: this.endLine,
			snippet: this.snippet,
			confidence: this.confidence,
			metadata: this.metadata,
		}
	}

	static fromJSON(data: Citation): CitationEntity {
		return new CitationEntity(data)
	}

	isFileCitation(): boolean {
		return this.sourceType === "file"
	}

	isDocumentationCitation(): boolean {
		return this.sourceType === "documentation"
	}

	isUrlCitation(): boolean {
		return this.sourceType === "url"
	}

	hasLineNumbers(): boolean {
		return this.startLine !== undefined && this.endLine !== undefined
	}

	setExtractedAt(date: Date): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.extractedAt = date
	}

	setVerified(verified: boolean): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.verified = verified
	}

	setRelevanceScore(score: number): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.relevanceScore = score
	}

	setSourceVersion(version: string): void {
		if (!this.metadata) {
			this.metadata = {}
		}
		this.metadata.sourceVersion = version
	}

	isHighConfidence(threshold: number = 0.8): boolean {
		return this.confidence >= threshold
	}

	isMediumConfidence(): boolean {
		return this.confidence >= 0.5 && this.confidence < 0.8
	}

	isLowConfidence(): boolean {
		return this.confidence < 0.5
	}
}

/**
 * Factory functions for creating entities
 */
export const EntityFactory = {
	createChatSession(data: Partial<ChatSession> = {}): ChatSessionEntity {
		const entity = new ChatSessionEntity(data)
		entity.validate()
		return entity
	},

	createChatMessage(data: Partial<ChatMessage> = {}): ChatMessageEntity {
		const entity = new ChatMessageEntity(data)
		entity.validate()
		return entity
	},

	createCitation(data: Partial<Citation> = {}): CitationEntity {
		const entity = new CitationEntity(data)
		entity.validate()
		return entity
	},

	createUserMessage(sessionId: string, content: string): ChatMessageEntity {
		return this.createChatMessage({
			sessionId,
			role: "user",
			content,
		})
	},

	createAssistantMessage(sessionId: string, content: string, citations: Citation[] = []): ChatMessageEntity {
		return this.createChatMessage({
			sessionId,
			role: "assistant",
			content,
			citations,
		})
	},
}
