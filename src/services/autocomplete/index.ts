// kilocode_change - new file
import * as vscode from "vscode"
import { AutocompleteProvider } from "./AutocompleteProvider"
import { ClineProvider } from "../../core/webview/ClineProvider"

export const registerAutocompleteProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const ghost = new AutocompleteProvider(context, cline)
	context.subscriptions.push(ghost)

	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.enable", async () => {
			await ghost.enable()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.disable", async () => {
			await ghost.disable()
		}),
	)

	// Register GhostProvider Inline Completion Provider
	// context.subscriptions.push(
	//     vscode.languages.registerInlineCompletionItemProvider("*", ghost.inlineCompletionProvider),
	// )
}
