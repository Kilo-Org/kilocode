import { useAtomValue, useSetAtom } from "jotai"
import { isProcessingAtom } from "../atoms/ui.js"
import { useEffect } from "react"
import { useExtensionMessage } from "./useExtensionMessage.js"

/**
 * Hook to manage isProcessing state based on extension messages
 *
 * Sets isProcessing to false when:
 * - Any "ask" message is received (AI is waiting for user input)
 * - This includes: completion_result, followup, tool approval, command approval, etc.
 */
export default function useIsProcessingSubscription() {
	const { lastMessage } = useExtensionMessage()
	const setIsProcessing = useSetAtom(isProcessingAtom)

	useEffect(() => {
		if (!lastMessage) return

		// Any "ask" message means the AI is waiting for user input, so processing is complete
		if (lastMessage.type === "ask") {
			setIsProcessing(false)
		}
	}, [lastMessage, setIsProcessing])

	return null
}
