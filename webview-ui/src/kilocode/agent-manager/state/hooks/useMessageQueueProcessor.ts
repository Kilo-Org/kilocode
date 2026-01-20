import { useEffect, useCallback } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import {
	sessionMessageQueueAtomFamily,
	sessionSendingMessageIdAtomFamily,
	updateMessageStatusAtom,
	removeFromQueueAtom,
	setSendingMessageAtom,
} from "../atoms/messageQueue"
import { vscode } from "../../utils/vscode"

/**
 * Hook that processes the message queue for a session.
 * Listens for message status updates from the extension and:
 * - Updates queue item status
 * - Removes sent messages from queue
 * - Sends next queued message when current one completes
 *
 * @param sessionId - The current session ID (can be null)
 */
export function useMessageQueueProcessor(sessionId: string | null) {
	const queue = useAtomValue(sessionMessageQueueAtomFamily(sessionId || ""))
	const sendingMessageId = useAtomValue(sessionSendingMessageIdAtomFamily(sessionId || ""))
	const updateStatus = useSetAtom(updateMessageStatusAtom)
	const removeFromQueue = useSetAtom(removeFromQueueAtom)
	const setSendingMessage = useSetAtom(setSendingMessageAtom)

	// Send the next queued message (including images if present)
	const sendNextMessage = useCallback(
		(messageId: string, content: string, images?: string[]) => {
			if (!sessionId) return

			setSendingMessage({ sessionId, messageId })
			vscode.postMessage({
				type: "agentManager.messageQueued",
				sessionId,
				messageId,
				content,
				images,
			})
		},
		[sessionId, setSendingMessage],
	)

	// Listen for message status updates from the extension
	useEffect(() => {
		if (!sessionId) return

		const handleMessage = (event: MessageEvent) => {
			if (event.data.type !== "agentManager.messageStatus") return

			const { sessionId: eventSessionId, messageId, status, error } = event.data

			if (eventSessionId !== sessionId) return

			if (status === "sending" || status === "failed") {
				updateStatus({ sessionId, messageId, status, error })
			}

			if (status === "sent") {
				removeFromQueue({ sessionId, messageId })
				setSendingMessage({ sessionId, messageId: null })
				// Next message is picked up by the auto-process effect when sendingMessageId becomes null
			}

			if (status === "failed") {
				setSendingMessage({ sessionId, messageId: null })
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [sessionId, updateStatus, removeFromQueue, setSendingMessage])

	// Auto-process queue when it changes and nothing is currently sending
	useEffect(() => {
		if (!sessionId) return
		if (sendingMessageId) return

		const queuedMsg = queue.find((msg) => msg.status === "queued")
		if (queuedMsg) {
			sendNextMessage(queuedMsg.id, queuedMsg.content, queuedMsg.images)
		}
	}, [sessionId, queue, sendingMessageId, sendNextMessage])
}
