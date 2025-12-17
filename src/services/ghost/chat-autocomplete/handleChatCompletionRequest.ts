import { ClineProvider } from "../../../core/webview/ClineProvider"
import { WebviewMessage } from "../../../shared/WebviewMessage"
import { GhostServiceManager } from "../GhostServiceManager"
import { ChatTextAreaAutocomplete } from "./ChatTextAreaAutocomplete"

/**
 * Handles a chat completion request from the webview.
 * Generates autocomplete suggestions using the inline completion provider.
 * Context gathering is handled by the inline completion provider itself.
 */
export async function handleChatCompletionRequest(
	message: WebviewMessage & { type: "requestChatCompletion" },
	provider: ClineProvider,
	getCurrentCwd: () => string,
): Promise<void> {
	try {
		const userText = message.text || ""
		const requestId = message.requestId || ""

		// Get the inline completion provider from the ghost service manager singleton
		const ghostServiceManager = GhostServiceManager.getInstance()
		if (!ghostServiceManager) {
			throw new Error("Ghost service manager not available")
		}

		const autocomplete = new ChatTextAreaAutocomplete(ghostServiceManager.inlineCompletionProvider)
		const { suggestion } = await autocomplete.getCompletion(userText)

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
