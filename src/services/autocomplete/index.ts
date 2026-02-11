// kilocode_change - new file
import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { registerAutocompleteJetbrainsBridge } from "./AutocompleteJetbrainsBridge"

export const registerAutocompleteProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const autocompleteService = new AutocompleteServiceManager(context, cline)
	context.subscriptions.push(autocompleteService)

	// Register JetBrains Bridge if applicable
	registerAutocompleteJetbrainsBridge(context, cline, autocompleteService)

	// Register AutocompleteServiceManager Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.reload", async () => {
			await autocompleteService.load()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.codeActionQuickFix", async () => {
			return
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.generateSuggestions", async () => {
			autocompleteService.codeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.showIncompatibilityExtensionPopup", async () => {
			await autocompleteService.showIncompatibilityExtensionPopup()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.disable", async () => {
			await autocompleteService.disable()
		}),
	)

	// Register AutocompleteServiceManager Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", autocompleteService.codeActionProvider, {
			providedCodeActionKinds: Object.values(autocompleteService.codeActionProvider.providedCodeActionKinds),
		}),
	)
}
