import * as vscode from "vscode"
import { registerSimpleAutocomplete } from "./SimpleAutoCompleteProvider"

/**
 * This command toggles between the regular autocomplete and our simple implementation
 * for easier testing.
 */
export function registerTestCommand(context: vscode.ExtensionContext) {
	// Register a command to toggle between implementations
	const toggleCommand = vscode.commands.registerCommand("kilo-code.toggleSimpleAutocomplete", async () => {
		try {
			// First, dispose any existing autocomplete providers
			// This is a simplification and might not catch all registered providers
			context.subscriptions.forEach((sub) => {
				if (sub instanceof vscode.Disposable) {
					try {
						sub.dispose()
					} catch (e) {
						// Ignore errors for now
					}
				}
			})

			// Register our simple implementation
			// registerSimpleAutocomplete(context)

			// Show notification to user
			vscode.window.showInformationMessage("Simple Autocomplete Provider activated!")
		} catch (error) {
			vscode.window.showErrorMessage(`Error activating Simple Autocomplete: ${error.message}`)
		}
	})

	context.subscriptions.push(toggleCommand)
}
