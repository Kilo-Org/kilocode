// kilocode_change - new file
import * as vscode from "vscode"
import { CommitMessageProvider } from "./CommitMessageProvider"
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

	outputChannel.appendLine(t("kilocode:commitMessage.providerRegistered"))
}
