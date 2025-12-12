import type { IExtensionMessenger } from "../../shared/kilocode/cli-sessions/types/IExtensionMessenger"
import type { WebviewMessage } from "../../shared/kilocode/cli-sessions/types/IExtensionMessenger"
import type { ExtensionMessage } from "../../shared/ExtensionMessage"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { webviewMessageHandler } from "../../core/webview/webviewMessageHandler"

export class ExtensionMessengerImpl implements IExtensionMessenger {
	constructor(private readonly provider: ClineProvider) {}

	// we can directly handle whatever is sent
	async sendWebviewMessage(message: WebviewMessage): Promise<void> {
		return webviewMessageHandler(this.provider, message)
	}

	async requestSingleCompletion(prompt: string, timeoutMs: number): Promise<string> {
		const state = await this.provider.getState()
		if (!state?.apiConfiguration) {
			throw new Error("No API configuration available")
		}

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("Single completion request timed out")), timeoutMs)
		})

		try {
			const completionPromise = singleCompletionHandler(state.apiConfiguration, prompt)
			return await Promise.race([completionPromise, timeoutPromise])
		} catch (error) {
			if (error instanceof Error && error.message.includes("timed out")) {
				throw new Error("Single completion request timed out")
			}
			throw error
		}
	}
}
