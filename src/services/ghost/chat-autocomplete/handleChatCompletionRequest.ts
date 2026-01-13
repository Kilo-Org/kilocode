import { ClineProvider } from "../../../core/webview/ClineProvider"
import { WebviewMessage } from "../../../shared/WebviewMessage"
import { VisibleCodeTracker } from "../context/VisibleCodeTracker"
import { ChatTextAreaAutocomplete } from "./ChatTextAreaAutocomplete"

/**
 * Handles a chat completion request from the webview.
 * Captures visible code context and generates a FIM-based autocomplete suggestion.
 */
export async function handleChatCompletionRequest(
	message: WebviewMessage & { type: "requestChatCompletion" },
	provider: ClineProvider,
	getCurrentCwd: () => string,
): Promise<void> {
	try {
		const userText = message.text || ""
		const requestId = message.requestId || ""

		// Pass RooIgnoreController to respect .kilocodeignore patterns
		const currentTask = provider.getCurrentTask()
		const tracker = new VisibleCodeTracker(getCurrentCwd(), currentTask?.rooIgnoreController ?? null)

		const visibleContext = await tracker.captureVisibleCode()

		const autocomplete = new ChatTextAreaAutocomplete(provider.providerSettingsManager)
		const { suggestion } = await autocomplete.getCompletion(userText, visibleContext)

		await provider.postMessageToWebview({ type: "chatCompletionResult", text: suggestion, requestId })
	} catch (error) {
		provider.log(`Error getting chat completion: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`)
		await provider.postMessageToWebview({
			type: "chatCompletionResult",
			text: "",
			requestId: message.requestId || "",
		})
	}
}
