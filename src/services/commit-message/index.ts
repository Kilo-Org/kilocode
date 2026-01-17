// kilocode_change - new file
import * as vscode from "vscode"
import { CommitMessageProvider } from "./CommitMessageProvider"
import { GitCommitInlineCompletionProvider } from "./GitCommitInlineCompletionProvider"
import { t } from "../../i18n"

/**
 * Registers the commit message provider with the extension context.
 * This function should be called during extension activation.
 */
export function registerCommitMessageProvider(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): void {
	const commitProvider = new CommitMessageProvider(context, outputChannel)
	context.subscriptions.push(commitProvider)

	commitProvider.activate().catch((error) => {
		outputChannel.appendLine(t("kilocode:commitMessage.activationFailed", { error: error.message }))
		console.error("Commit message provider activation failed:", error)
	})

	// Register the inline completion provider for git commit messages
	const inlineCompletionProvider = new GitCommitInlineCompletionProvider(context, outputChannel)
	context.subscriptions.push(inlineCompletionProvider)

	// Register for the SCM input box scheme
	const inlineCompletionDisposable = vscode.languages.registerInlineCompletionItemProvider(
		{ scheme: "vscode-scm" },
		inlineCompletionProvider,
	)
	context.subscriptions.push(inlineCompletionDisposable)

	outputChannel.appendLine(t("kilocode:commitMessage.providerRegistered"))
	outputChannel.appendLine("[GitCommitInlineCompletionProvider] Registered for vscode-scm scheme")
}
