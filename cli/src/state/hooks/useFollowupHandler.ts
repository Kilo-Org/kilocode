/**
 * Hook for handling followup question messages
 * Automatically detects followup messages and populates suggestions
 */

import { useEffect } from "react"
import { useExtensionMessage } from "./useExtensionMessage.js"
import { useFollowupSuggestions } from "./useFollowupSuggestions.js"
import { parseFollowUpData } from "../../ui/messages/extension/utils.js"
import { logs } from "../../services/logs.js"

/**
 * Hook for handling followup questions
 *
 * Automatically monitors extension messages for followup questions and
 * populates the suggestions menu when a followup question is detected.
 * Clears suggestions when the question is answered.
 *
 * @example
 * ```tsx
 * function App() {
 *   // Just call the hook - it handles everything automatically
 *   useFollowupHandler()
 *
 *   return <div>...</div>
 * }
 * ```
 */
export function useFollowupHandler(): void {
	const { messages } = useExtensionMessage()
	const { setSuggestions, clearSuggestions } = useFollowupSuggestions()

	useEffect(() => {
		// Get the last message from the messages array
		const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

		// Check if the last message is an unanswered followup question
		// Wait for non-partial messages with text content
		if (
			lastMessage &&
			lastMessage.type === "ask" &&
			lastMessage.ask === "followup" &&
			!lastMessage.isAnswered &&
			!lastMessage.partial &&
			lastMessage.text
		) {
			// Parse the followup data
			const followupData = parseFollowUpData(lastMessage)

			if (followupData && followupData.suggest && followupData.suggest.length > 0) {
				// Set the suggestions
				setSuggestions(followupData.suggest)
			} else {
				// No suggestions, clear any existing ones
				clearSuggestions()
			}
		} else if (
			lastMessage &&
			lastMessage.type === "ask" &&
			lastMessage.ask === "followup" &&
			lastMessage.isAnswered
		) {
			// Question was answered, clear suggestions
			logs.debug("Clearing suggestions - question answered", "useFollowupHandler")
			clearSuggestions()
		} else if (lastMessage && (lastMessage.type !== "ask" || lastMessage.ask !== "followup")) {
			// Last message is not a followup question, clear any existing suggestions
			// This handles cases where a new message type (like command) comes in
			clearSuggestions()
		}
	}, [messages, setSuggestions, clearSuggestions])
}
