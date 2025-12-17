import * as vscode from "vscode"
import { GhostInlineCompletionProvider } from "../classic-auto-complete/GhostInlineCompletionProvider"

/**
 * Service for providing autocomplete suggestions in ChatTextArea
 * Uses the GhostInlineCompletionProvider to avoid duplicating logic
 */
export class ChatTextAreaAutocomplete {
	private inlineCompletionProvider: GhostInlineCompletionProvider

	constructor(inlineCompletionProvider: GhostInlineCompletionProvider) {
		this.inlineCompletionProvider = inlineCompletionProvider
	}

	/**
	 * Check if we can successfully make a completion request.
	 * Validates that model is loaded and has valid credentials.
	 */
	isFimAvailable(): boolean {
		// Access the model through the provider's public properties
		const model = (this.inlineCompletionProvider as any).model
		return model?.hasValidCredentials() ?? false
	}

	async getCompletion(userText: string): Promise<{ suggestion: string }> {
		// Create a simple virtual document with just the user text
		// The inline completion provider will handle all context gathering,
		// postprocessing, and filtering
		const document = await vscode.workspace.openTextDocument({
			content: userText,
			language: "plaintext",
		})

		// Position at the end of the user text
		const position = document.positionAt(userText.length)

		// Create completion context for manual trigger
		const context: vscode.InlineCompletionContext = {
			triggerKind: vscode.InlineCompletionTriggerKind.Invoke,
			selectedCompletionInfo: undefined,
		}
		const tokenSource = new vscode.CancellationTokenSource()

		try {
			// Use the internal method to bypass auto-trigger check
			const completions = await this.inlineCompletionProvider.provideInlineCompletionItems_Internal(
				document,
				position,
				context,
				tokenSource.token,
			)

			// Extract the suggestion text
			if (completions && (Array.isArray(completions) ? completions.length > 0 : completions.items.length > 0)) {
				const items = Array.isArray(completions) ? completions : completions.items
				const firstCompletion = items[0]

				if (firstCompletion && firstCompletion.insertText) {
					const insertText =
						typeof firstCompletion.insertText === "string"
							? firstCompletion.insertText
							: firstCompletion.insertText.value

					return { suggestion: insertText }
				}
			}

			return { suggestion: "" }
		} finally {
			tokenSource.dispose()
		}
	}
}
