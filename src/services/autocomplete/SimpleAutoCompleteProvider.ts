import * as vscode from "vscode"

/**
 * Ultra simple autocomplete provider focusing specifically on the space issue
 */
export function registerSimpleAutocomplete(context: vscode.ExtensionContext) {
	try {
		setupSimpleAutocomplete(context)
		console.log("Kilo Code simple autocomplete provider registered")
	} catch (error) {
		console.error("Failed to register simple autocomplete provider:", error)
	}
}

function setupSimpleAutocomplete(context: vscode.ExtensionContext) {
	// Just one test completion for simplicity
	const testCompletion = "function myFunction() {\n\t\n}"

	const inlineCompletionProvider: vscode.InlineCompletionItemProvider = {
		async provideInlineCompletionItems(document, position, _context, _token) {
			// Get exactly what's been typed
			const linePrefix = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position))
			console.log("🚀 ~ provideInlineCompletionItems ~ linePrefix:", linePrefix)

			// Debug logging
			console.log(`[DEBUG] Line prefix: "${linePrefix}"`)
			console.log(`[DEBUG] Line prefix length: ${linePrefix.length}`)
			console.log(`[DEBUG] Last char: "${linePrefix.slice(-1)}"`)

			// If nothing typed, don't show completion
			if (linePrefix.length === 0) {
				return null
			}

			// Direct check - does our test completion start with what's been typed?
			if (!testCompletion.startsWith(linePrefix)) {
				console.log(`[DEBUG] No match: "${linePrefix}" is not a prefix of "${testCompletion}"`)
				return null
			}

			// Calculate the remaining text
			const remainingText = testCompletion.substring(linePrefix.length)
			console.log(`[DEBUG] Remaining text: "${remainingText}"`)

			// Nothing left to complete?
			if (remainingText.length === 0) {
				return null
			}

			// Create completion item with the remaining text
			const range = new vscode.Range(position, position)
			const item = new vscode.InlineCompletionItem(remainingText, range)

			// Set the filterText to the WHOLE completion
			// This is what VSCode uses to determine if completion should stay visible
			item.filterText = testCompletion

			console.log(`[DEBUG] Completion item created:`)
			console.log(`[DEBUG] - Text: "${remainingText}"`)
			console.log(`[DEBUG] - FilterText: "${testCompletion}"`)

			return [item]
		},
	}

	// Register provider
	const providerDisposable = vscode.languages.registerInlineCompletionItemProvider(
		{ pattern: "**" },
		inlineCompletionProvider,
	)

	// Status bar indicator
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.text = "$(sparkle) Space Test Autocomplete"
	statusBar.tooltip = "Kilo Code Simple Autocomplete Space Test"
	statusBar.show()

	// Register disposables
	context.subscriptions.push(providerDisposable, statusBar)
}
