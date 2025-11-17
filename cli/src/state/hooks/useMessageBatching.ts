/**
 * Hook for batching messages to backend
 * Subscribes to message changes and triggers batching effect
 */

import { useAtomValue, useSetAtom } from "jotai"
import { useEffect } from "react"
import { mergedMessagesAtom } from "../atoms/ui.js"
import { batchNewMessagesEffectAtom } from "../atoms/message-batching.js"

/**
 * Hook to automatically batch messages when they change
 * This should be used in a top-level component to ensure messages are batched
 */
export function useMessageBatching() {
	const messages = useAtomValue(mergedMessagesAtom)
	const batchMessages = useSetAtom(batchNewMessagesEffectAtom)

	useEffect(() => {
		// Trigger the batching effect whenever messages change
		batchMessages()
	}, [messages, batchMessages])
}
