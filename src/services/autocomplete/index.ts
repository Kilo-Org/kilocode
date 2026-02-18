// kilocode_change - new file
import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { registerAutocompleteJetbrainsBridge } from "./AutocompleteJetbrainsBridge"

export const registerAutocompleteProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const autocompleteManager = new AutocompleteServiceManager(context, cline)
	context.subscriptions.push(autocompleteManager)

	// Register JetBrains Bridge if applicable
	registerAutocompleteJetbrainsBridge(context, cline, autocompleteManager)

	// Register AutocompleteServiceManager Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.reload", async () => {
			await autocompleteManager.load()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.codeActionQuickFix", async () => {
			return
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.generateSuggestions", async () => {
			autocompleteManager.codeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.showIncompatibilityExtensionPopup", async () => {
			await autocompleteManager.showIncompatibilityExtensionPopup()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.disable", async () => {
			await autocompleteManager.disable()
		}),
	)

	// Register AutocompleteServiceManager Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", autocompleteManager.codeActionProvider, {
			providedCodeActionKinds: Object.values(autocompleteManager.codeActionProvider.providedCodeActionKinds),
		}),
	)
}
