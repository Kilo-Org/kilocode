import type { TUIMessage, PendingAsk, View } from "../types.js"

/**
 * Determine the current view state based on messages and pending asks
 */
export function getView(messages: TUIMessage[], pendingAsk: PendingAsk | null, isLoading: boolean): View {
	// If there's a pending ask requiring text input, show input
	if (pendingAsk?.type === "followup") {
		return "UserInput"
	}

	// If there's any pending ask (approval), don't show thinking
	if (pendingAsk) {
		return "UserInput"
	}

	// Initial state or empty - awaiting user input
	if (messages.length === 0) {
		return "UserInput"
	}

	const lastMessage = messages.at(-1)
	if (!lastMessage) {
		return "UserInput"
	}

	// User just sent a message, waiting for response
	if (lastMessage.role === "user") {
		return "AgentResponse"
	}

	// Assistant replied
	if (lastMessage.role === "assistant") {
		if (lastMessage.hasPendingToolCalls) {
			return "ToolUse"
		}

		// If loading, still waiting for more
		if (isLoading) {
			return "AgentResponse"
		}

		return "UserInput"
	}

	// Tool result received, waiting for next assistant response
	if (lastMessage.role === "tool") {
		return "AgentResponse"
	}

	return "Default"
}
