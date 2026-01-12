// kilocode_change - new file

/**
 * Chat API Endpoints
 * RESTful API endpoints for chat functionality with citation support
 */

import type {
	ChatSession,
	ChatMessage,
	CreateChatSessionRequest,
	SendMessageRequest,
	ChatMessageResponse,
	UpdateContextRequest,
} from "./types"
import { getChatService } from "./chat-service"
import type { ChatService } from "./chat-service"
import { ChatServiceError } from "./types"

export interface ApiResponse<T> {
	success: boolean
	data?: T
	error?: {
		code: string
		message: string
		timestamp: string
		details?: any
	}
}

export class ChatApi {
	private chatService: ChatService

	constructor(chatService?: ChatService) {
		this.chatService = chatService || getChatService()
	}

	/**
	 * POST /chat/sessions
	 * Create a new chat session
	 */
	async createChatSession(request: CreateChatSessionRequest): Promise<ApiResponse<ChatSession>> {
		try {
			const session = await this.chatService.createSession(request)
			return {
				success: true,
				data: session,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * GET /chat/sessions/{sessionId}
	 * Get a chat session by ID
	 */
	async getChatSession(sessionId: string): Promise<ApiResponse<ChatSession>> {
		try {
			const session = await this.chatService.getSession(sessionId)
			return {
				success: true,
				data: session,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * GET /chat/sessions
	 * List chat sessions for a user
	 */
	async listChatSessions(
		userId: string,
		limit: number = 20,
		offset: number = 0,
	): Promise<ApiResponse<{ sessions: ChatSession[]; total: number; hasMore: boolean }>> {
		try {
			const result = await this.chatService.listSessions(userId, limit, offset)
			return {
				success: true,
				data: result,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * DELETE /chat/sessions/{sessionId}
	 * Delete a chat session
	 */
	async deleteChatSession(sessionId: string): Promise<ApiResponse<void>> {
		try {
			await this.chatService.deleteSession(sessionId)
			return {
				success: true,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * POST /chat/sessions/{sessionId}/messages
	 * Send a message to a chat session
	 */
	async sendMessage(sessionId: string, request: SendMessageRequest): Promise<ApiResponse<ChatMessageResponse>> {
		try {
			const response = await this.chatService.sendMessage(sessionId, request)
			return {
				success: true,
				data: response,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * GET /chat/sessions/{sessionId}/messages
	 * Get messages for a chat session
	 */
	async getChatMessages(
		sessionId: string,
		limit: number = 50,
		offset: number = 0,
	): Promise<ApiResponse<{ messages: ChatMessage[]; total: number; hasMore: boolean }>> {
		try {
			const result = await this.chatService.getMessages(sessionId, limit, offset)
			return {
				success: true,
				data: result,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * GET /chat/sessions/{sessionId}/context
	 * Get context for a chat session
	 */
	async getChatContext(sessionId: string): Promise<ApiResponse<any>> {
		try {
			const context = await this.chatService.getContext(sessionId)
			return {
				success: true,
				data: context,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	/**
	 * PUT /chat/sessions/{sessionId}/context
	 * Update context for a chat session
	 */
	async updateChatContext(sessionId: string, request: UpdateContextRequest): Promise<ApiResponse<any>> {
		try {
			const context = await this.chatService.updateContext(sessionId, request)
			return {
				success: true,
				data: context,
			}
		} catch (error) {
			return this.handleError(error)
		}
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	/**
	 * Handle errors and format as API response
	 */
	private handleError(error: any): ApiResponse<never> {
		if (error instanceof ChatServiceError) {
			return {
				success: false,
				error: {
					code: error.code,
					message: error.message,
					timestamp: new Date().toISOString(),
					details: error.originalError,
				},
			}
		}

		return {
			success: false,
			error: {
				code: "INTERNAL_ERROR",
				message: error.message || "An unexpected error occurred",
				timestamp: new Date().toISOString(),
				details: error,
			},
		}
	}
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: ChatApi | null = null

export function getChatApi(chatService?: ChatService): ChatApi {
	if (!instance) {
		instance = new ChatApi(chatService)
	}
	return instance
}

export function resetChatApi(): void {
	instance = null
}

// ============================================================================
// Route Handlers (for Express.js integration)
// ============================================================================

export function createChatRoutes(chatApi: ChatApi) {
	return {
		// Session routes
		createSession: async (req: any, res: any) => {
			const result = await chatApi.createChatSession(req.body)
			res.status(result.success ? 201 : 400).json(result)
		},

		getSession: async (req: any, res: any) => {
			const result = await chatApi.getChatSession(req.params.sessionId)
			res.status(result.success ? 200 : 404).json(result)
		},

		listSessions: async (req: any, res: any) => {
			const { userId } = req.query
			const limit = parseInt(req.query.limit || "20", 10)
			const offset = parseInt(req.query.offset || "0", 10)
			const result = await chatApi.listChatSessions(userId, limit, offset)
			res.status(result.success ? 200 : 500).json(result)
		},

		deleteSession: async (req: any, res: any) => {
			const result = await chatApi.deleteChatSession(req.params.sessionId)
			res.status(result.success ? 204 : 404).json(result)
		},

		// Message routes
		sendMessage: async (req: any, res: any) => {
			const result = await chatApi.sendMessage(req.params.sessionId, req.body)
			res.status(result.success ? 201 : 400).json(result)
		},

		getMessages: async (req: any, res: any) => {
			const limit = parseInt(req.query.limit || "50", 10)
			const offset = parseInt(req.query.offset || "0", 10)
			const result = await chatApi.getChatMessages(req.params.sessionId, limit, offset)
			res.status(result.success ? 200 : 404).json(result)
		},

		// Context routes
		getContext: async (req: any, res: any) => {
			const result = await chatApi.getChatContext(req.params.sessionId)
			res.status(result.success ? 200 : 404).json(result)
		},

		updateContext: async (req: any, res: any) => {
			const result = await chatApi.updateChatContext(req.params.sessionId, req.body)
			res.status(result.success ? 200 : 400).json(result)
		},
	}
}
