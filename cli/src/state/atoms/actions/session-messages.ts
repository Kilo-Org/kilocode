/**
 * Session messages action atoms for fetching messages from backend
 */

import { atom } from "jotai"
import { logs } from "../../../services/logs.js"
import { configAtom } from "../config.js"
import { sessionIdAtom } from "../session.js"

/**
 * Message type from backend
 */
export interface SessionMessage {
	session_id: string
	message: {
		ts: number
		say?: string
		text: string
		partial?: boolean
	}
	created_at: string
}

/**
 * Response type from list messages endpoint
 */
export interface ListMessagesResponse {
	messages: SessionMessage[]
	nextCursor: string | null
	hasMore: boolean
}

/**
 * Backend API response structure
 */
interface BackendResponse {
	result?: {
		data?: ListMessagesResponse
	}
}

/**
 * Options for fetching session messages
 */
export interface FetchMessagesOptions {
	sessionId?: string // If not provided, uses current session from sessionIdAtom
	cursor?: string // ISO datetime cursor for pagination
	limit?: number // Number of messages per page (1-100, default 50)
}

/**
 * Action atom to fetch messages for a session with pagination support
 * Returns paginated messages with cursor for next page
 */
export const fetchSessionMessagesAtom = atom(
	null,
	async (get, set, options: FetchMessagesOptions = {}): Promise<ListMessagesResponse | null> => {
		const config = get(configAtom)
		const token = config?.kilocodeToken

		if (!token) {
			logs.debug("Kilocode token not configured, cannot fetch session messages", "SessionMessages")
			return null
		}

		// Use provided sessionId or get from current session
		const sessionId = options.sessionId || get(sessionIdAtom)

		if (!sessionId) {
			logs.warn("No session ID available for fetching messages", "SessionMessages")
			return null
		}

		const limit = options.limit && options.limit >= 1 && options.limit <= 100 ? options.limit : 50

		logs.debug("Fetching session messages", "SessionMessages", {
			sessionId,
			cursor: options.cursor,
			limit,
		})

		try {
			const apiBaseUrl = process.env.KILOCODE_BACKEND_BASE_URL || "https://api.kilocode.ai"

			// Build query params
			const queryParams: Record<string, unknown> = {
				session_id: sessionId,
				limit,
			}

			if (options.cursor) {
				queryParams.cursor = options.cursor
			}

			const response = await fetch(
				`${apiBaseUrl}/api/trpc/sessionMessages.list?input=${encodeURIComponent(JSON.stringify(queryParams))}`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${token}`,
					},
				},
			)

			if (!response.ok) {
				const errorText = await response.text()
				logs.warn("Failed to fetch session messages", "SessionMessages", {
					sessionId,
					status: response.status,
					error: errorText,
				})
				return null
			}

			const data = (await response.json()) as BackendResponse
			const result = data.result?.data

			if (!result) {
				logs.error("Invalid response format from session messages endpoint", "SessionMessages", { data })
				return null
			}

			const messagesResponse: ListMessagesResponse = {
				messages: result.messages || [],
				nextCursor: result.nextCursor || null,
				hasMore: result.hasMore || false,
			}

			logs.info("Session messages fetched successfully", "SessionMessages", {
				sessionId,
				count: messagesResponse.messages.length,
				hasMore: messagesResponse.hasMore,
			})

			return messagesResponse
		} catch (error) {
			logs.error("Failed to fetch session messages", "SessionMessages", { error, sessionId })
			return null
		}
	},
)

/**
 * Action atom to fetch all messages for a session by iterating through pages
 * This will automatically handle pagination to retrieve all messages
 */
export const fetchAllSessionMessagesAtom = atom(
	null,
	async (get, set, sessionId?: string): Promise<SessionMessage[]> => {
		const allMessages: SessionMessage[] = []
		let cursor: string | undefined
		let hasMore = true

		logs.info("Fetching all session messages", "SessionMessages", { sessionId })

		while (hasMore) {
			const options: FetchMessagesOptions = {
				limit: 100, // Use max limit for efficiency
			}

			if (sessionId) {
				options.sessionId = sessionId
			}

			if (cursor) {
				options.cursor = cursor
			}

			const response = await set(fetchSessionMessagesAtom, options)

			if (!response) {
				logs.warn("Failed to fetch page, stopping pagination", "SessionMessages", { cursor })
				break
			}

			allMessages.push(...response.messages)
			hasMore = response.hasMore
			cursor = response.nextCursor || undefined

			logs.debug("Fetched message page", "SessionMessages", {
				pageSize: response.messages.length,
				totalSoFar: allMessages.length,
				hasMore,
			})
		}

		logs.info("All session messages fetched", "SessionMessages", {
			sessionId,
			totalMessages: allMessages.length,
		})

		return allMessages
	},
)
