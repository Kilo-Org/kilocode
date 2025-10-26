import type { ProviderSettings } from "@roo-code/types"
import { buildApiHandler, SingleCompletionHandler, ApiHandler } from "../api"

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

        // kilocode_change start
        // Force gemini-cli to use completePrompt
        if (apiConfiguration.apiProvider === "gemini-cli") {
            if ("completePrompt" in handler) { // Add check for safety
                return (handler as SingleCompletionHandler).completePrompt(promptText)
            } else {
                throw new Error("Gemini-cli handler does not support completePrompt as expected.")
            }
        }
        // kilocode_change end

        // Check if handler supports single completions
        if ("completePrompt" in handler) { // If completePrompt exists, use it
            return (handler as SingleCompletionHandler).completePrompt(promptText)
        } else { // Otherwise, stream responses
            return await streamResponseFromHandler(handler, promptText)
        }
}

// kilocode_change start - Stream responses using createMessage
async function streamResponseFromHandler(handler: ApiHandler, promptText: string): Promise<string> {
        const stream = handler.createMessage("", [{ role: "user", content: [{ type: "text", text: promptText }] }])

        let response: string = ""
        for await (const chunk of stream) {
                if (chunk.type === "text") {
                        response += chunk.text
                }
        }
        return response
}
// kilocode_change end - streamResponseFromHandler
