import { atom } from "jotai"
import { atomFamily } from "jotai/utils"

/**
 * Generate a random UUID using native crypto.randomUUID().
 * Available in all modern browsers and Node.js environments.
 */
const generateId = (): string => crypto.randomUUID()

export interface QueuedMessage {
	id: string
	sessionId: string
	content: string
	images?: string[] // Data URLs of pasted images
	status: "queued" | "sending" | "sent" | "failed"
	timestamp: number
	error?: string
	retryCount: number
	maxRetries: number
}

// Per-session message queue
export const sessionMessageQueueAtomFamily = atomFamily((_sessionId: string) => atom<QueuedMessage[]>([]))

// Track currently sending message ID per session
export const sessionSendingMessageIdAtomFamily = atomFamily((_sessionId: string) => atom<string | null>(null))

// Derived: is session queue empty?
export const isSessionQueueEmptyAtomFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const queue = get(sessionMessageQueueAtomFamily(sessionId))
		return queue.length === 0
	}),
)

// Derived: get next queued message (first one with "queued" status)
export const nextQueuedMessageAtomFamily = atomFamily((sessionId: string) =>
	atom((get) => {
		const queue = get(sessionMessageQueueAtomFamily(sessionId))
		return queue.find((msg) => msg.status === "queued") || null
	}),
)

// Action: Add message to queue
export const addToQueueAtom = atom(
	null,
	(get, set, payload: { sessionId: string; content: string; images?: string[] }) => {
		const { sessionId, content, images } = payload
		const queue = get(sessionMessageQueueAtomFamily(sessionId))

		const newMessage: QueuedMessage = {
			id: generateId(),
			sessionId,
			content,
			images,
			status: "queued",
			timestamp: Date.now(),
			retryCount: 0,
			maxRetries: 3,
		}

		set(sessionMessageQueueAtomFamily(sessionId), [...queue, newMessage])
		return newMessage
	},
)

// Action: Update message status
export const updateMessageStatusAtom = atom(
	null,
	(
		get,
		set,
		payload: {
			sessionId: string
			messageId: string
			status: "queued" | "sending" | "sent" | "failed"
			error?: string
		},
	) => {
		const { sessionId, messageId, status, error } = payload
		const queue = get(sessionMessageQueueAtomFamily(sessionId))

		const updated = queue.map((msg) =>
			msg.id === messageId
				? {
						...msg,
						status,
						error: error || undefined,
					}
				: msg,
		)

		set(sessionMessageQueueAtomFamily(sessionId), updated)
	},
)

// Action: Remove message from queue
export const removeFromQueueAtom = atom(null, (get, set, payload: { sessionId: string; messageId: string }) => {
	const { sessionId, messageId } = payload
	const queue = get(sessionMessageQueueAtomFamily(sessionId))

	const filtered = queue.filter((msg) => msg.id !== messageId)
	set(sessionMessageQueueAtomFamily(sessionId), filtered)
})

// Action: Retry a failed message
export const retryFailedMessageAtom = atom(null, (get, set, payload: { sessionId: string; messageId: string }) => {
	const { sessionId, messageId } = payload
	const queue = get(sessionMessageQueueAtomFamily(sessionId))

	const updated = queue.map((msg) => {
		if (msg.id === messageId && msg.status === "failed") {
			// Only retry if haven't exceeded max retries
			if (msg.retryCount < msg.maxRetries) {
				return {
					...msg,
					status: "queued" as const,
					error: undefined,
					retryCount: msg.retryCount + 1,
				}
			}
		}
		return msg
	})

	set(sessionMessageQueueAtomFamily(sessionId), updated)
})

// Action: Clear queue for session
export const clearSessionQueueAtom = atom(null, (_get, set, sessionId: string) => {
	set(sessionMessageQueueAtomFamily(sessionId), [])
	set(sessionSendingMessageIdAtomFamily(sessionId), null)
})

// Action: Set currently sending message
export const setSendingMessageAtom = atom(
	null,
	(_get, set, payload: { sessionId: string; messageId: string | null }) => {
		const { sessionId, messageId } = payload
		set(sessionSendingMessageIdAtomFamily(sessionId), messageId)
	},
)
