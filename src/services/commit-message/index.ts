import * as vscode from "vscode"
import { CommitMessageProvider } from "./CommitMessageProvider"

/**
 * Registers the commit message provider with the extension context.
 * This function should be called during extension activation.
 */
export function registerCommitMessageProvider(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): void {
	const commitProvider = new CommitMessageProvider(context, outputChannel)

	commitProvider.activate().catch((error) => {
		outputChannel.appendLine(`Failed to activate commit message provider: ${error.message}`)
		console.error("Commit message provider activation failed:", error)
	})

	outputChannel.appendLine("✨ Commit message provider registered")
}

// Keep the old function name for backward compatibility
export const registerGitCommitMessageProvider = registerCommitMessageProvider
