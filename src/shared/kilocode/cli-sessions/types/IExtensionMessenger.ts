import type { HistoryItem } from "@roo-code/types"
import type { WebviewMessage } from "../../../WebviewMessage"
export type { HistoryItem, WebviewMessage }

/**
 * Interface for communicating with the extension/UI layer.
 * Implementations should handle messaging between the session manager and the extension.
 */
export interface IExtensionMessenger {
	/**
	 * Send a message to the extension
	 * @param message The message to send
	 */
	sendWebviewMessage(message: WebviewMessage): Promise<void>

	/**
	 * Request a single completion/summary from the LLM.
	 * Used for generating session titles.
	 * @param prompt The prompt to send to the LLM
	 * @param timeoutMs Timeout in milliseconds
	 * @returns The generated text completion
	 */
	requestSingleCompletion(prompt: string, timeoutMs: number): Promise<string>
}
