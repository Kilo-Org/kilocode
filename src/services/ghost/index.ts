import * as vscode from "vscode"
import { GhostProvider } from "./GhostProvider"
import { GhostCodeActionProvider } from "./GhostCodeActionProvider"

export const registerGhost = (context: vscode.ExtensionContext) => {
	// DUMMY_COMMAND
	context.subscriptions.push(
		vscode.commands.registerCommand("DUMMY_COMMAND_ID", () => {}), //
	)

	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", new GhostCodeActionProvider(), {
			providedCodeActionKinds: Object.values(GhostCodeActionProvider.providedCodeActionKinds),
		}),
	)
}
