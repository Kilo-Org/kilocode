/**
 * Hook for handling regular (non-command) message sending
 * Provides a clean interface for sending user messages to the extension
 */

import { useSetAtom, useAtomValue } from "jotai"
import { useCallback, useState } from "react"
import { addMessageAtom } from "../atoms/ui.js"
import { imageReferencesAtom, clearImageReferencesAtom } from "../atoms/keyboard.js"
import { useWebviewMessage } from "./useWebviewMessage.js"
import { useTaskState } from "./useTaskState.js"
import { isServiceReadyAtom } from "../atoms/service.js"
import { isStreamingAtom } from "../atoms/ui.js"
import { isApprovalPendingAtom } from "../atoms/approval.js"
import type { CliMessage } from "../../types/cli.js"
import { logs } from "../../services/logs.js"
import { getTelemetryService } from "../../services/telemetry/index.js"
import { processMessageImages } from "../../media/processMessageImages.js"
import { useOutgoingMessageQueue } from "./useOutgoingMessageQueue.js"

function shouldQueueOnNotReadyError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	const message = error.message.toLowerCase()
	return (
		message.includes("extensionservice not ready") ||
		message.includes("extensionservice not available") ||
		message.includes("not ready")
	)
}

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
 * including processing @path image mentions and handling errors.
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
	const imageReferences = useAtomValue(imageReferencesAtom)
	const clearImageReferences = useSetAtom(clearImageReferencesAtom)
	const { sendMessage, sendAskResponse } = useWebviewMessage()
	const { hasActiveTask } = useTaskState()
	const isServiceReady = useAtomValue(isServiceReadyAtom)
	const isStreaming = useAtomValue(isStreamingAtom)
	const isApprovalPending = useAtomValue(isApprovalPendingAtom)
	const outgoingQueue = useOutgoingMessageQueue()

	const sendUserMessage = useCallback(
		async (text: string): Promise<void> => {
			const trimmedText = text.trim()
			if (!trimmedText) {
				return
			}

			setIsSending(true)

			try {
				// Convert image references Map to object for processMessageImages
				const imageRefsObject = Object.fromEntries(imageReferences)

				// Process any @path image mentions and [Image #N] references in the message
				const processed = await processMessageImages(trimmedText, imageRefsObject)

				// Show any image loading errors to the user
				if (processed.errors.length > 0) {
					for (const error of processed.errors) {
						const errorMessage: CliMessage = {
							id: `img-err-${Date.now()}-${Math.random()}`,
							type: "error",
							content: error,
							ts: Date.now(),
						}
						addMessage(errorMessage)
					}
				}

				// Track telemetry
				getTelemetryService().trackUserMessageSent(
					processed.text.length,
					processed.hasImages,
					hasActiveTask,
					undefined,
				)

				// Build message payload
					const payload = {
						text: processed.text,
						...(processed.hasImages && { images: processed.images }),
					}

					const enqueueOutgoing = () => {
						outgoingQueue.enqueue({
							text: processed.text,
							...(processed.hasImages && { images: processed.images }),
						})
					}

					// Clear image references after processing (even if we queue)
					if (imageReferences.size > 0) {
						clearImageReferences()
					}

					const shouldQueueForCurrentState = !isServiceReady || isStreaming || isApprovalPending
					if (shouldQueueForCurrentState) {
						enqueueOutgoing()
						return
					}

					// Send to extension - either as response to active task or as new task
					try {
						if (hasActiveTask) {
						logs.debug("Sending message as response to active task", "useMessageHandler", {
							hasImages: processed.hasImages,
						})
						await sendAskResponse({ response: "messageResponse", ...payload })
					} else {
						logs.debug("Starting new task", "useMessageHandler", {
							hasImages: processed.hasImages,
						})
							await sendMessage({ type: "newTask", ...payload })
						}
					} catch (error) {
						// If readiness raced (we looked ready but weren't), enqueue instead of failing.
						if (shouldQueueOnNotReadyError(error)) {
							enqueueOutgoing()
							return
						}
						throw error
					}
				} catch (error) {
				const errorMessage: CliMessage = {
					id: Date.now().toString(),
					type: "error",
					content: `Error sending message: ${error instanceof Error ? error.message : String(error)}`,
					ts: Date.now(),
				}
				addMessage(errorMessage)
			} finally {
				setIsSending(false)
			}
		},
		[
			addMessage,
			ciMode,
			sendMessage,
			sendAskResponse,
			hasActiveTask,
			imageReferences,
			clearImageReferences,
			isServiceReady,
			isStreaming,
			isApprovalPending,
			outgoingQueue,
		],
	)

	return {
		sendUserMessage,
		isSending,
	}
}
