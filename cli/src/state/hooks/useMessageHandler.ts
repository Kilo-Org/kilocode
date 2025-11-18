/**
 * Hook for handling regular (non-command) message sending
 * Provides a clean interface for sending user messages to the extension
 */

import { useSetAtom, useAtomValue } from "jotai"
import { useCallback, useState } from "react"
import { addMessageAtom } from "../atoms/ui.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { useTaskState } from "./useTaskState.js"
import type { CliMessage } from "../../types/cli.js"
import { logs } from "../../services/logs.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import { sessionIdAtom } from "../atoms/session.js"
import { initializeSessionAtom } from "../atoms/actions/session.js"

/**
 * Options for useMessageHandler hook
 */
export interface UseMessageHandlerOptions {
	/** Whether CI mode is active */
	ciMode?: boolean
}

/**
 * Return type for useMessageHandler hook
 */
export interface UseMessageHandlerReturn {
	/** Send a user message to the extension */
	sendUserMessage: (text: string) => Promise<void>
	/** Whether a message is currently being sent */
	isSending: boolean
}

/**
 * Hook that provides message sending functionality
 *
 * This hook handles sending regular user messages (non-commands) to the extension,
 * including adding the message to the UI and handling errors.
 *
 * @example
 * ```tsx
 * function ChatInput() {
 *   const { sendUserMessage, isSending } = useMessageHandler()
 *
 *   const handleSubmit = async (input: string) => {
 *     await sendUserMessage(input)
 *   }
 *
 *   return (
 *     <input
 *       onSubmit={handleSubmit}
 *       disabled={isSending}
 *     />
 *   )
 * }
 * ```
 */
export function useMessageHandler(options: UseMessageHandlerOptions = {}): UseMessageHandlerReturn {
	const { ciMode = false } = options
	const [isSending, setIsSending] = useState(false)
	const addMessage = useSetAtom(addMessageAtom)
	const { sendMessage, sendAskResponse } = useWebviewMessage()
	const { hasActiveTask } = useTaskState()
	const sessionId = useAtomValue(sessionIdAtom)
	const initializeSession = useSetAtom(initializeSessionAtom)

	const sendUserMessage = useCallback(
		async (text: string): Promise<void> => {
			const trimmedText = text.trim()

			if (!trimmedText) {
				return
			}

			// Don't add user message to CLI state - the extension will handle it
			// This prevents duplicate messages in the UI

			// Set sending state
			setIsSending(true)

			try {
				// Initialize session on first message if not already initialized
				if (!sessionId) {
					logs.info("Initializing session on first message send", "useMessageHandler")
					try {
						const newSessionId = await initializeSession()
						if (newSessionId) {
							logs.info("Session created on first message", "useMessageHandler", {
								sessionId: newSessionId,
							})
							// Add a system message to notify the user
							const systemMessage: CliMessage = {
								id: `session-${Date.now()}`,
								type: "system",
								content: `Session started: ${newSessionId}`,
								ts: Date.now(),
							}
							addMessage(systemMessage)
						}
					} catch (error) {
						logs.warn("Failed to initialize session, continuing without session", "useMessageHandler", {
							error,
						})
						// Continue even if session creation fails
					}
				}

				// Track user message
				getTelemetryService().trackUserMessageSent(
					trimmedText.length,
					false, // hasImages - CLI doesn't support images yet
					hasActiveTask,
					undefined, // taskId - will be added when we have task tracking
				)

				// Check if there's an active task to determine message type
				// This matches the webview behavior in ChatView.tsx (lines 650-683)
				if (hasActiveTask) {
					// Send as response to existing task (like webview does)
					logs.debug("Sending message as response to active task", "useMessageHandler")
					await sendAskResponse({
						response: "messageResponse",
						text: trimmedText,
					})
				} else {
					// Start new task (no active conversation)
					logs.debug("Starting new task", "useMessageHandler")
					await sendMessage({
						type: "newTask",
						text: trimmedText,
					})
				}
			} catch (error) {
				// Add error message if sending failed
				const errorMessage: CliMessage = {
					id: Date.now().toString(),
					type: "error",
					content: `Error sending message: ${error instanceof Error ? error.message : String(error)}`,
					ts: Date.now(),
				}
				addMessage(errorMessage)
			} finally {
				// Reset sending state
				setIsSending(false)
			}
		},
		[addMessage, ciMode, sendMessage, sendAskResponse, hasActiveTask, sessionId, initializeSession],
	)

	return {
		sendUserMessage,
		isSending,
	}
}
