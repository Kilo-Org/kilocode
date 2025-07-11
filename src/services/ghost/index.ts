import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"

export const registerGhostProvider = (context: vscode.ExtensionContext) => {
	const ghost = GhostProvider.getInstance()

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
			//ghost.provideCodeSuggestions(document, range)
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.displaySuggestions", async () => {
			ghost.displaySuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.cancelSuggestions", async () => {
			ghost.cancelSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.applyAllSuggestions", async () => {
			ghost.applyAllSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.promptCodeSuggestion", async () => {
			await ghost.promptCodeSuggestion()
		}),
	)

	// Register GhostProvider Key Bindings
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.keyTab", async () => {
			if (ghost.isApplyAllSuggestionsEnabled()) {
				await ghost.applyAllSuggestions()
			} else {
				vscode.commands.executeCommand("tab")
			}
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.keyEscape", async () => {
			if (ghost.isCancelSuggestionsEnabled()) {
				await ghost.cancelSuggestions()
			} else {
				vscode.commands.executeCommand("escape")
			}
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghostWriter.keyCmdI", async () => {
			await ghost.promptCodeSuggestion()
		}),
	)

	// Register GhostProvider Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", new GhostCodeActionProvider(), {
			providedCodeActionKinds: Object.values(GhostCodeActionProvider.providedCodeActionKinds),
		}),
	)
}
