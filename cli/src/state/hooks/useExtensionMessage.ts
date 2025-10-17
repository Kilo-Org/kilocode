/**
 * Hook for accessing extension messages and state
 * Provides access to message history, filtering, and real-time updates
 */

import { useAtomValue } from "jotai"
import { useMemo } from "react"
import type { ExtensionChatMessage } from "../../types/messages.js"
import { chatMessagesAtom, lastChatMessageAtom, hasChatMessagesAtom } from "../atoms/extension.js"

/**
 * Message filter function type
 */
export type MessageFilter = (message: ExtensionChatMessage) => boolean

/**
 * Return type for useExtensionMessage hook
 */
export interface UseExtensionMessageReturn {
	/** All messages from the extension */
	messages: ExtensionChatMessage[]
	/** The most recent message (null if no messages) */
	lastMessage: ExtensionChatMessage | null
	/** Whether there are any messages */
	hasMessages: boolean
	/** Filter messages by type */
	filterByType: (type: "ask" | "say") => ExtensionChatMessage[]
	/** Get unanswered ask messages */
	getUnansweredAsks: () => ExtensionChatMessage[]
	/** Get messages after a specific timestamp */
	getMessagesAfter: (timestamp: number) => ExtensionChatMessage[]
	/** Get messages before a specific timestamp */
	getMessagesBefore: (timestamp: number) => ExtensionChatMessage[]
	/** Filter messages with a custom function */
	filterMessages: (filter: MessageFilter) => ExtensionChatMessage[]
	/** Get the count of messages */
	messageCount: number
	/** Get the count of ask messages */
	askCount: number
	/** Get the count of say messages */
	sayCount: number
}

/**
 * Hook for accessing extension messages
 *
 * Provides access to the message history with filtering and transformation utilities.
 * Messages are automatically updated in real-time as the extension sends new messages.
 *
 * @example
 * ```tsx
 * function MessageList() {
 *   const { messages, lastMessage, filterByType } = useExtensionMessage()
 *
 *   const askMessages = filterByType('ask')
 *
 *   return (
 *     <div>
 *       <h2>All Messages ({messages.length})</h2>
 *       {messages.map(msg => (
 *         <div key={msg.ts}>{msg.text}</div>
 *       ))}
 *
 *       <h2>Ask Messages ({askMessages.length})</h2>
 *       {askMessages.map(msg => (
 *         <div key={msg.ts}>{msg.ask}</div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useExtensionMessage(): UseExtensionMessageReturn {
	// Read atoms
	const messages = useAtomValue(chatMessagesAtom)
	const lastMessage = useAtomValue(lastChatMessageAtom)
	const hasMessages = useAtomValue(hasChatMessagesAtom)

	// Memoized filter functions
	const filterByType = useMemo(
		() => (type: "ask" | "say") => {
			return messages.filter((msg) => msg.type === type)
		},
		[messages],
	)

	const getUnansweredAsks = useMemo(
		() => () => {
			return messages.filter((msg) => msg.type === "ask" && !msg.isAnswered)
		},
		[messages],
	)

	const getMessagesAfter = useMemo(
		() => (timestamp: number) => {
			return messages.filter((msg) => msg.ts > timestamp)
		},
		[messages],
	)

	const getMessagesBefore = useMemo(
		() => (timestamp: number) => {
			return messages.filter((msg) => msg.ts < timestamp)
		},
		[messages],
	)

	const filterMessages = useMemo(
		() => (filter: MessageFilter) => {
			return messages.filter(filter)
		},
		[messages],
	)

	// Memoized counts
	const messageCount = useMemo(() => messages.length, [messages])

	const askCount = useMemo(() => messages.filter((msg) => msg.type === "ask").length, [messages])

	const sayCount = useMemo(() => messages.filter((msg) => msg.type === "say").length, [messages])

	// Memoize return value
	return useMemo(
		() => ({
			messages,
			lastMessage,
			hasMessages,
			filterByType,
			getUnansweredAsks,
			getMessagesAfter,
			getMessagesBefore,
			filterMessages,
			messageCount,
			askCount,
			sayCount,
		}),
		[
			messages,
			lastMessage,
			hasMessages,
			filterByType,
			getUnansweredAsks,
			getMessagesAfter,
			getMessagesBefore,
			filterMessages,
			messageCount,
			askCount,
			sayCount,
		],
	)
}
