// kilocode_change - new file

/**
 * Chat Service
 * Manages chat sessions, messages, and AI interactions with citation support
 */

import type {
	ChatSession,
	ChatMessage,
	CreateChatSessionRequest,
	SendMessageRequest,
	ChatMessageResponse,
} from "./types"
import { EntityFactory } from "./models"
import { getDatabaseManager } from "../../core/database/manager"
import type { DatabaseManager } from "../../core/database/manager"
import { ChatServiceError, ContextError } from "./types"

export interface ChatServiceConfig {
	/** Maximum number of messages per session */
	maxMessagesPerSession?: number
	/** Maximum message length */
	maxMessageLength?: number
	/** Whether to enable citations by default */
	enableCitations?: boolean
	/** Citation confidence threshold */
	citationThreshold?: number
}

export class ChatService {
	private db: DatabaseManager
	private config: Required<ChatServiceConfig>

	constructor(config: ChatServiceConfig = {}) {
		this.db = getDatabaseManager()
		this.config = {
			maxMessagesPerSession: config.maxMessagesPerSession ?? 1000,
			maxMessageLength: config.maxMessageLength ?? 100000,
			enableCitations: config.enableCitations ?? true,
			citationThreshold: config.citationThreshold ?? 0.7,
		}
	}

	/**
	 * Create a new chat session
	 */
	async createSession(request: CreateChatSessionRequest): Promise<ChatSession> {
		try {
			// Validate title length
			if (request.title.length > 255) {
				throw new ChatServiceError("Title exceeds maximum length of 255 characters", "INVALID_INPUT")
			}

			// Create session entity
			const session = EntityFactory.createChatSession({
				userId: "default-user", // TODO: Get from auth context
				title: request.title,
				context: request.initialContext,
			})

			// Save to database
			const sessionId = this.db.createChatSession({
				user_id: session.userId,
				title: session.title,
				context_id: request.initialContext?.id,
				metadata: JSON.stringify(session.metadata),
			})

			session.id = sessionId

			// If initial context provided, save it
			if (request.initialContext) {
				await this.saveContext(request.initialContext, sessionId)
			}

			return session.toJSON()
		} catch (error) {
			if (error instanceof ChatServiceError) {
				throw error
			}
			throw new ChatServiceError(`Failed to create session: ${error}`, "CREATE_SESSION_FAILED", error)
		}
	}

	/**
	 * Get a chat session by ID
	 */
	async getSession(sessionId: string): Promise<ChatSession> {
		try {
			const row = this.db.getChatSession(sessionId)
			if (!row) {
				throw new ChatServiceError("Session not found", "SESSION_NOT_FOUND")
			}

			const session = EntityFactory.createChatSession({
				id: row.id,
				userId: row.user_id,
				title: row.title,
				createdAt: new Date(row.created_at),
				updatedAt: new Date(row.updated_at),
				metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
			})

			// Load context if exists
			if (row.context_id) {
				const contextRow = this.db.getCompletionContext(row.context_id)
				if (contextRow) {
					session.context = this.parseContextRow(contextRow)
				}
			}

			return session.toJSON()
		} catch (error) {
			if (error instanceof ChatServiceError) {
				throw error
			}
			throw new ChatServiceError(`Failed to get session: ${error}`, "GET_SESSION_FAILED", error)
		}
	}

	/**
	 * List chat sessions for a user
	 */
	async listSessions(
		userId: string,
		limit: number = 20,
		offset: number = 0,
	): Promise<{ sessions: ChatSession[]; total: number; hasMore: boolean }> {
		try {
			const rows = this.db.getChatSessionsByUserId(userId)
			const total = rows.length

			const sessions: ChatSession[] = rows.slice(offset, offset + limit).map((row) =>
				EntityFactory.createChatSession({
					id: row.id,
					userId: row.user_id,
					title: row.title,
					createdAt: new Date(row.created_at),
					updatedAt: new Date(row.updated_at),
					metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
				}).toJSON(),
			)

			return {
				sessions,
				total,
				hasMore: offset + limit < total,
			}
		} catch (error) {
			throw new ChatServiceError(`Failed to list sessions: ${error}`, "LIST_SESSIONS_FAILED", error)
		}
	}

	/**
	 * Send a message to a chat session
	 */
	async sendMessage(sessionId: string, request: SendMessageRequest): Promise<ChatMessageResponse> {
		const startTime = Date.now()

		try {
			// Validate session exists
			const session = await this.getSession(sessionId)

			// Validate message length
			if (request.content.length > this.config.maxMessageLength) {
				throw new ChatServiceError(
					`Message exceeds maximum length of ${this.config.maxMessageLength} characters`,
					"INVALID_INPUT",
				)
			}

			// Save user message
			const userMessage = EntityFactory.createUserMessage(sessionId, request.content)
			this.db.createChatMessage({
				session_id: sessionId,
				role: userMessage.role,
				content: userMessage.content,
				timestamp: userMessage.timestamp.toISOString(),
				metadata: JSON.stringify(userMessage.metadata),
			})

			// Get or update context
			let context = request.context || session.context
			if (request.context) {
				await this.saveContext(request.context, sessionId)
			} else if (session.context) {
				context = session.context
			}

			// Generate AI response (placeholder - will integrate with AI provider)
			const assistantMessage = await this.generateAIResponse(sessionId, request.content, context)

			// Extract citations if enabled
			if (request.includeCitations !== false && this.config.enableCitations) {
				assistantMessage.setCitations(await this.extractCitations(assistantMessage, context))
			}

			// Save assistant message
			this.db.createChatMessage({
				session_id: sessionId,
				role: assistantMessage.role,
				content: assistantMessage.content,
				timestamp: assistantMessage.timestamp.toISOString(),
				metadata: JSON.stringify(assistantMessage.metadata),
			})

			// Save citations
			if (assistantMessage.hasCitations()) {
				for (const citation of assistantMessage.citations!) {
					this.db.createCitation({
						message_id: assistantMessage.id,
						source_type: citation.sourceType,
						source_path: citation.sourcePath,
						start_line: citation.startLine,
						end_line: citation.endLine,
						snippet: citation.snippet,
						confidence: citation.confidence,
						metadata: JSON.stringify(citation.metadata),
					})
				}
			}

			// Update session metadata
			this.db.updateChatSession(sessionId, {
				metadata: JSON.stringify({
					...session.metadata,
					messageCount: (session.metadata?.messageCount || 0) + 2,
					lastActivity: new Date().toISOString(),
				}),
			})

			const responseTime = Date.now() - startTime

			return {
				message: assistantMessage.toJSON(),
				responseTime,
				context: context!,
			}
		} catch (error) {
			if (error instanceof ChatServiceError) {
				throw error
			}
			throw new ChatServiceError(`Failed to send message: ${error}`, "SEND_MESSAGE_FAILED", error)
		}
	}

	/**
	 * Get messages for a session
	 */
	async getMessages(
		sessionId: string,
		limit: number = 50,
		offset: number = 0,
	): Promise<{ messages: ChatMessage[]; total: number; hasMore: boolean }> {
		try {
			const rows = this.db.getChatMessagesBySessionId(sessionId)
			const total = rows.length

			const messages: ChatMessage[] = rows.slice(offset, offset + limit).map((row) => {
				const message = EntityFactory.createChatMessage({
					id: row.id,
					sessionId: row.session_id,
					role: row.role,
					content: row.content,
					timestamp: new Date(row.timestamp),
					metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
				})

				// Load citations for assistant messages
				if (message.isAssistantMessage()) {
					const citationRows = this.db.getCitationsByMessageId(row.id)
					message.setCitations(
						citationRows.map((c) => ({
							id: c.id,
							messageId: c.message_id,
							sourceType: c.source_type,
							sourcePath: c.source_path,
							startLine: c.start_line,
							endLine: c.end_line,
							snippet: c.snippet,
							confidence: c.confidence,
							metadata: c.metadata ? JSON.parse(c.metadata) : undefined,
						})),
					)
				}

				return message.toJSON()
			})

			return {
				messages,
				total,
				hasMore: offset + limit < total,
			}
		} catch (error) {
			throw new ChatServiceError(`Failed to get messages: ${error}`, "GET_MESSAGES_FAILED", error)
		}
	}

	/**
	 * Delete a chat session
	 */
	async deleteSession(sessionId: string): Promise<void> {
		try {
			const deleted = this.db.deleteChatSession(sessionId)
			if (deleted === 0) {
				throw new ChatServiceError("Session not found", "SESSION_NOT_FOUND")
			}
		} catch (error) {
			if (error instanceof ChatServiceError) {
				throw error
			}
			throw new ChatServiceError(`Failed to delete session: ${error}`, "DELETE_SESSION_FAILED", error)
		}
	}

	/**
	 * Get context for a session
	 */
	async getContext(sessionId: string): Promise<any> {
		try {
			const session = await this.getSession(sessionId)
			if (!session.context) {
				throw new ContextError("No context found for session")
			}
			return session.context
		} catch (error) {
			if (error instanceof ContextError) {
				throw error
			}
			throw new ChatServiceError(`Failed to get context: ${error}`, "GET_CONTEXT_FAILED", error)
		}
	}

	/**
	 * Update context for a session
	 */
	async updateContext(sessionId: string, context: any): Promise<any> {
		try {
			const session = await this.getSession(sessionId)
			const contextId = session.context?.id || (await this.saveContext(context, sessionId))

			this.db.updateChatSession(sessionId, {
				context_id: contextId,
			})

			return context
		} catch (error) {
			throw new ChatServiceError(`Failed to update context: ${error}`, "UPDATE_CONTEXT_FAILED", error)
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Generate AI response (placeholder implementation)
	 */
	private async generateAIResponse(sessionId: string, userMessage: string, context?: any): Promise<any> {
		// TODO: Integrate with AI provider
		// This is a placeholder that returns a simple response
		const assistantMessage = EntityFactory.createAssistantMessage(
			sessionId,
			"This is a placeholder AI response. Integration with AI provider needed.",
		)
		assistantMessage.setModel("placeholder")
		assistantMessage.setTokenCount(50)
		return assistantMessage
	}

	/**
	 * Extract citations from AI response (placeholder implementation)
	 */
	private async extractCitations(message: any, context?: any): Promise<any[]> {
		// TODO: Integrate with knowledge service for citation extraction
		// This is a placeholder that returns empty citations
		return []
	}

	/**
	 * Save context to database
	 */
	private async saveContext(context: any, sessionId?: string): Promise<string> {
		const contextId = this.db.createCompletionContext({
			session_id: sessionId || undefined,
			file_path: context.filePath,
			position: context.position,
			surrounding_code: context.surroundingCode,
			project_context: JSON.stringify(context.projectContext),
			semantic_context: JSON.stringify(context.semanticContext),
			metadata: JSON.stringify(context.metadata),
		})

		return contextId
	}

	/**
	 * Parse context row from database
	 */
	private parseContextRow(row: any): any {
		return {
			id: row.id,
			sessionId: row.session_id,
			filePath: row.file_path,
			position: row.position,
			surroundingCode: row.surrounding_code,
			projectContext: JSON.parse(row.project_context),
			semanticContext: JSON.parse(row.semantic_context),
			metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ChatService | null = null

export function getChatService(config?: ChatServiceConfig): ChatService {
	if (!instance) {
		instance = new ChatService(config)
	}
	return instance
}

export function resetChatService(): void {
	instance = null
}
