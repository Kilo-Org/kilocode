// kilocode_change - new file
import * as vscode from "vscode"
import { AutocompleteServiceManager } from "./AutocompleteServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { registerAutocompleteJetbrainsBridge } from "./AutocompleteJetbrainsBridge"

export const registerAutocompleteProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const autocomplete = new AutocompleteServiceManager(context, cline)
	context.subscriptions.push(autocomplete)

	// Register JetBrains Bridge if applicable
	registerAutocompleteJetbrainsBridge(context, cline, autocomplete)

	// Register AutocompleteServiceManager Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.reload", async () => {
			await autocomplete.load()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.codeActionQuickFix", async () => {
			return
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.generateSuggestions", async () => {
			autocomplete.codeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.showIncompatibilityExtensionPopup", async () => {
			await autocomplete.showIncompatibilityExtensionPopup()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.autocomplete.disable", async () => {
			await autocomplete.disable()
		}),
	)

	// Register AutocompleteServiceManager Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", autocomplete.codeActionProvider, {
			providedCodeActionKinds: Object.values(autocomplete.codeActionProvider.providedCodeActionKinds),
		}),
	)
}
