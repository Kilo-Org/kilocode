import { WebviewMessage } from "../../../shared/WebviewMessage"
import { AutocompleteTelemetry } from "../classic-auto-complete/AutocompleteTelemetry"

// Singleton telemetry instance for chat-textarea autocomplete
// This ensures we use the same instance across requests and acceptance events
let telemetryInstance: AutocompleteTelemetry | null = null

/**
 * Get or create the telemetry instance for chat-textarea autocomplete
 */
export function getChatAutocompleteTelemetry(): AutocompleteTelemetry {
	if (!telemetryInstance) {
		telemetryInstance = new AutocompleteTelemetry("chat-textarea")
	}
	return telemetryInstance
}

/**
 * Handles a chat completion accepted event from the webview.
 * Captures telemetry when the user accepts a suggestion via Tab or ArrowRight.
 */
export function handleChatCompletionAccepted(message: WebviewMessage & { type: "chatCompletionAccepted" }): void {
	const telemetry = getChatAutocompleteTelemetry()
	telemetry.captureAcceptSuggestion(message.suggestionLength)
}
