import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"

export const registerGhost = (context: vscode.ExtensionContext) => {
	// Register GhostProvider Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilocode.ghost.codeActionQuickFix", async () => {
			return
		}),
	)

	// Register GhostProvider Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilocode.ghost.provideCodeSuggestions", async () => {
			vscode.window.showInformationMessage("kilocode.ghost.provideCodeSuggestions")
			//GhostProvider.provideCodeSuggestions(document, range)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.displaySuggestions", async () => {
			GhostProvider.displaySuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.cancelSuggestions", async () => {
			GhostProvider.cancelSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.applyAllSuggestions", async () => {
			GhostProvider.applyAllSuggestions()
		}),
	)

	// Register GhostProvider Key Bindings
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.keyTab", async () => {
			if (GhostProvider.isApplyAllSuggestionsEnabled()) {
				await GhostProvider.applyAllSuggestions()
			} else {
				vscode.commands.executeCommand("tab")
			}
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.keyEscape", async () => {
			if (GhostProvider.isCancelSuggestionsEnabled()) {
				await GhostProvider.cancelSuggestions()
			} else {
				vscode.commands.executeCommand("escape")
			}
		}),
	)

	// Register GhostProvider Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", new GhostCodeActionProvider(), {
			providedCodeActionKinds: Object.values(GhostCodeActionProvider.providedCodeActionKinds),
		}),
	)
}
