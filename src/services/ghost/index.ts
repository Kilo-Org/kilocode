// kilocode_change - new file
import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"
import { ClineProvider } from "../../core/webview/ClineProvider"

// Export platform-independent Ghost types for external use
export type {
	GhostPosition,
	GhostRange,
	GhostDocument,
	GhostEngineContext as PlatformIndependentGhostEngineContext,
	GhostLineInfo,
	GhostUri,
} from "./types/platform-independent"

// Export helper namespace (this is a value, not a type)
export { GhostTypes } from "./types/platform-independent"

// Export engine types and class for external use
export type { GhostEngineResult } from "./GhostEngine"
export { GhostEngine } from "./GhostEngine"
export type { GhostEngineContext } from "./types/platform-independent"

// Export other key Ghost types
export { GhostSuggestionsState } from "./GhostSuggestions"
export type { GhostSuggestionContext, GhostSuggestionEditOperation, UserAction } from "./types"
export { UserActionType } from "./types"

export const registerGhostProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const ghost = GhostProvider.initialize(context, cline)
	context.subscriptions.push(ghost)

	// Register GhostProvider Commands
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
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.showIncompatibilityExtensionPopup", async () => {
			await ghost.showIncompatibilityExtensionPopup()
		}),
	)
	context.subscriptions.push(
		vscode.commands.registerCommand("kilo-code.ghost.cancelRequest", async () => {
			await ghost.cancelRequest()
		}),
	)
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
	context.subscriptions.push(
		vscode.commands.registerCommand("kilocode.ghost.acceptInlineCompletion", async (...args) => {
			// Handle inline completion acceptance
			// This is triggered when user accepts an inline completion
			console.log("🚀 Inline completion accepted:", args)
			// TODO: Add logic to apply the accepted inline completion
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

	// Register GhostProvider Inline Completion
	context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider("*", ghost.inlineProvider))
}
