import type { ProviderSettings } from "@roo-code/types"
import { buildApiHandler, SingleCompletionHandler, ApiHandler } from "../api" //kilocode_change
import { ApiStreamUsageChunk } from "../api/transform/stream" // kilocode_change

/**
 * Enhances a prompt using the configured API without creating a full Cline instance or task history.
 * This is a lightweight alternative that only uses the API's completion functionality.
 */
export async function singleCompletionHandler(apiConfiguration: ProviderSettings, promptText: string): Promise<string> {
	if (!promptText) {
		throw new Error("No prompt text provided")
	}
	if (!apiConfiguration || !apiConfiguration.apiProvider) {
		throw new Error("No valid API configuration provided")
	}

	const handler = buildApiHandler(apiConfiguration)

	// Initialize handler if it has an initialize method
	if ("initialize" in handler && typeof handler.initialize === "function") {
		await handler.initialize()
	}

	// Check if handler supports single completions
	if (!("completePrompt" in handler)) {
		// kilocode_change start - stream responses for handlers without completePrompt
		// throw new Error("The selected API provider does not support prompt enhancement")
		return (await streamResponseFromHandler(handler, promptText)).text
		// kilocode_change end
	}

	return (handler as SingleCompletionHandler).completePrompt(promptText)
}

// kilocode_change start - Stream responses using createMessage
export async function streamResponseFromHandler(
	handler: ApiHandler,
	promptText: string,
	systemPrompt = "",
): Promise<{ text: string; usage?: ApiStreamUsageChunk }> {
	const stream = handler.createMessage(systemPrompt, [
		{ role: "user", content: [{ type: "text", text: promptText }] },
	])

	let text: string = ""
	let usage: ApiStreamUsageChunk | undefined = undefined

	for await (const chunk of stream) {
		if (chunk.type === "text") {
			text += chunk.text
		} else if (chunk.type === "usage") {
			usage = chunk
		}
	}

	return { text, usage }
}
// kilocode_change end - streamResponseFromHandler
