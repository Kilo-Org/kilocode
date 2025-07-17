import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"
import { t } from "../../i18n"

export const registerGhostProvider = (context: vscode.ExtensionContext) => {
	const ghost = GhostProvider.getInstance(context)

	// Register Windows Events
	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor((editor) => {
			ghost.onDidChangeActiveTextEditor(editor)
		}),
	)

	// Register GhostProvider Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.codeActionQuickFix", async () => {
			return
		}),
	)

	// Register GhostProvider Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.generateSuggestions", async () => {
			ghost.codeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.cancelSuggestions", async () => {
			ghost.cancelSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.applyAllSuggestions", async () => {
			ghost.applyAllSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.applyCurrentSuggestions", async () => {
			ghost.applySelectedSuggestions()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.promptCodeSuggestion", async () => {
			await ghost.promptCodeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.goToNextSuggestion", async () => {
			await ghost.selectNextSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.goToPreviousSuggestion", async () => {
			await ghost.selectPreviousSuggestion()
		}),
	)

	// Register GhostProvider Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", ghost.codeActionProvider, {
			providedCodeActionKinds: Object.values(ghost.codeActionProvider.providedCodeActionKinds),
		}),
	)

	// Register GhostProvider Code Lens
	context.subscriptions.push(vscode.languages.registerCodeLensProvider("*", ghost.codeLensProvider))
}
