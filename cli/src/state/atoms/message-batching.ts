/**
 * Message batching atoms for collecting and sending messages to backend
 */

import { atom } from "jotai"
import { sessionIdAtom } from "./session.js"
import { logs } from "../../services/logs.js"
import { configAtom } from "./config.js"
import { ExtensionChatMessage } from "src/types/messages.js"
import { mergedMessagesAtom, type UnifiedMessage } from "./ui.js"

/**
 * State for message batching
 */
interface MessageBatchState {
	messages: ExtensionChatMessage[]
	lastFlushTime: number
	flushTimer: NodeJS.Timeout | null
}

/**
 * Atom to hold the message batch state
 */
const messageBatchStateAtom = atom<MessageBatchState>({
	messages: [],
	lastFlushTime: Date.now(),
	flushTimer: null,
})

/**
 * Constants for batching behavior
 */
const MAX_BATCH_SIZE = 100
const FLUSH_INTERVAL_MS = 1000

/**
 * Send batched messages to backend
 */
async function sendBatchedMessages(sessionId: string, messages: ExtensionChatMessage[], token: string): Promise<void> {
	if (messages.length === 0) {
		return
	}

	try {
		const apiBaseUrl = process.env.KILOCODE_BACKEND_BASE_URL || "https://api.kilocode.ai"

		logs.debug(`Sending batch of ${messages.length} messages to backend`, "MessageBatching", {
			sessionId,
			messageCount: messages.length,
		})

		const response = await fetch(`${apiBaseUrl}/api/trpc/sessionMessages.batchCreate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				session_id: sessionId,
				messages,
			}),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Failed to send messages: ${response.status} ${errorText}`)
		}

		logs.debug(`Successfully sent batch of ${messages.length} messages`, "MessageBatching")
	} catch (error) {
		logs.error("Failed to send batched messages to backend", "MessageBatching", {
			error,
			messageCount: messages.length,
		})
		// Don't throw - allow CLI to continue even if backend sync fails
	}
}

/**
 * Action atom to flush messages to backend
 */
const flushMessagesAtom = atom(null, async (get, set) => {
	const batchState = get(messageBatchStateAtom)
	const sessionId = get(sessionIdAtom)
	const config = get(configAtom)

	// Nothing to flush
	if (batchState.messages.length === 0) {
		return
	}

	// No session ID - can't send messages
	if (!sessionId) {
		logs.debug("No session ID, skipping message flush", "MessageBatching")
		// Clear messages anyway to prevent memory leak
		set(messageBatchStateAtom, {
			messages: [],
			lastFlushTime: Date.now(),
			flushTimer: null,
		})
		return
	}

	// No token - can't send messages
	const token = config?.kilocodeToken
	if (!token) {
		logs.debug("No Kilocode token, skipping message flush", "MessageBatching")
		// Clear messages anyway to prevent memory leak
		set(messageBatchStateAtom, {
			messages: [],
			lastFlushTime: Date.now(),
			flushTimer: null,
		})
		return
	}

	// Get messages to send
	const messagesToSend = [...batchState.messages]

	// Clear the batch and update last flush time
	set(messageBatchStateAtom, {
		messages: [],
		lastFlushTime: Date.now(),
		flushTimer: null,
	})

	// Send messages in background
	await sendBatchedMessages(sessionId, messagesToSend, token)
})

/**
 * Action atom to add a message to the batch
 */
const addMessageToBatchAtom = atom(null, async (get, set, message: ExtensionChatMessage) => {
	const batchState = get(messageBatchStateAtom)

	// Add message to batch
	const newMessages = [...batchState.messages, message]

	// Check if we should flush immediately due to message count
	const shouldFlushByCount = newMessages.length >= MAX_BATCH_SIZE

	if (shouldFlushByCount) {
		// Clear existing timer if any
		if (batchState.flushTimer) {
			clearTimeout(batchState.flushTimer)
		}

		// Update state with new messages but no timer (we're flushing immediately)
		set(messageBatchStateAtom, {
			messages: newMessages,
			lastFlushTime: batchState.lastFlushTime,
			flushTimer: null,
		})

		// Flush immediately
		await set(flushMessagesAtom)
	} else {
		// Only setup timer if we don't have one already
		let timer = batchState.flushTimer
		if (!timer) {
			// Calculate remaining time until next flush
			const timeSinceLastFlush = Date.now() - batchState.lastFlushTime
			const remainingTime = Math.max(0, FLUSH_INTERVAL_MS - timeSinceLastFlush)
			timer = setTimeout(async () => {
				await set(flushMessagesAtom)
			}, remainingTime)
		}

		// Update state with new messages and timer
		set(messageBatchStateAtom, {
			messages: newMessages,
			lastFlushTime: batchState.lastFlushTime,
			flushTimer: timer,
		})
	}
})

/**
 * Generate a unique key for a message to track changes
 * Exported for use in JsonRenderer and other components
 */
export function getMessageKey(message: UnifiedMessage): string {
	const baseKey = `${message.source}-${message.message.ts}`
	const content = message.source === "cli" ? message.message.content : message.message.text || ""
	const partial = message.message.partial ? "partial" : "complete"
	return `${baseKey}-${content.length}-${partial}`
}

const sentMessages = new Set<string>()

/**
 * Effect atom that batches extension messages when new messages are added
 * Filters out CLI messages and only batches extension messages
 * This should be triggered whenever messages change
 */
export const batchNewMessagesEffectAtom = atom(null, (get, set) => {
	const messages = get(mergedMessagesAtom)

	for (const message of messages) {
		if (
			message.source === "cli" ||
			message.message.partial ||
			!message.message.text ||
			sentMessages.has(getMessageKey(message))
		) {
			continue
		}

		sentMessages.add(getMessageKey(message))

		set(addMessageToBatchAtom, message?.message)
	}
})

/**
 * Cleanup atom - should be called when CLI is shutting down
 */
export const cleanupMessageBatchingAtom = atom(null, async (get, set) => {
	const batchState = get(messageBatchStateAtom)

	// Clear timer
	if (batchState.flushTimer) {
		clearTimeout(batchState.flushTimer)
	}

	// Flush any remaining messages
	await set(flushMessagesAtom)
})
