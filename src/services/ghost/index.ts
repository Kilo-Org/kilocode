// kilocode_change - new file
import * as vscode from "vscode"
import { GhostServiceManager } from "./GhostServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { registerGhostJetbrainsBridge } from "./GhostJetbrainsBridge"

export const registerGhostProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const ghost = new GhostServiceManager(context, cline)
	context.subscriptions.push(ghost)

	// Register JetBrains Bridge if applicable
	registerGhostJetbrainsBridge(context, cline, ghost)

	// Register GhostServiceManager Commands
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.reload", async () => {
			await ghost.load()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.codeActionQuickFix", async () => {
			return
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.generateSuggestions", async () => {
			ghost.codeSuggestion()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.showIncompatibilityExtensionPopup", async () => {
			await ghost.showIncompatibilityExtensionPopup()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.disable", async () => {
			await ghost.disable()
		}),
	)

	// Register GhostServiceManager Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", ghost.codeActionProvider, {
			providedCodeActionKinds: Object.values(ghost.codeActionProvider.providedCodeActionKinds),
		}),
	)
}
