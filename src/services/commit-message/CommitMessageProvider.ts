// kilocode_change - new file
import * as vscode from "vscode"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { t } from "../../i18n"

import { CommitMessageRequest, CommitMessageResult } from "./types/core"
import { CommitMessageGenerator } from "./CommitMessageGenerator"
import { VSCodeCommitMessageAdapter } from "./adapters/VSCodeCommitMessageAdapter"
import { JetBrainsCommitMessageAdapter } from "./adapters/JetBrainsCommitMessageAdapter"
import { VscGenerationRequest } from "./types"
import { JetbrainsGenerationRequest } from "./types/jetbrains"

/**
 * Orchestrates commit message generation by routing requests to appropriate adapters.
 * This class handles command registration and coordinates between VSCode and JetBrains adapters.
 */
export class CommitMessageProvider implements vscode.Disposable {
	private generator: CommitMessageGenerator
	private vscodeAdapter: VSCodeCommitMessageAdapter
	private jetbrainsAdapter: JetBrainsCommitMessageAdapter

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		const providerSettingsManager = new ProviderSettingsManager(this.context)

		this.generator = new CommitMessageGenerator(providerSettingsManager)
		this.vscodeAdapter = new VSCodeCommitMessageAdapter(this.generator)
		this.jetbrainsAdapter = new JetBrainsCommitMessageAdapter(this.generator)
	}

	/**
	 * Activate the commit message service by registering commands.
	 */
	public async activate(): Promise<void> {
		this.outputChannel.appendLine(t("kilocode:commitMessage.activated"))

		const disposables = [
			vscode.commands.registerCommand("kilo-code.vsc.generateCommitMessage", (vsRequest?: VscGenerationRequest) =>
				this.handleVSCodeCommand(vsRequest),
			),
			vscode.commands.registerCommand(
				"kilo-code.jetbrains.generateCommitMessage",
				(...args: JetbrainsGenerationRequest): Promise<CommitMessageResult> => {
					return this.handleJetBrainsCommand(...args)
				},
			),
		]
		this.context.subscriptions.push(...disposables)
	}

	/**
	 * Handle VSCode-specific command by converting VSCode inputs to generic request.
	 */
	private async handleVSCodeCommand(vsRequest?: VscGenerationRequest): Promise<void> {
		const request: CommitMessageRequest = {
			workspacePath: this.determineWorkspacePath(vsRequest?.rootUri),
		}

		await this.vscodeAdapter.generateCommitMessage(request)
	}

	/**
	 * Handle JetBrains-specific command by creating request from provided args.
	 */
	private async handleJetBrainsCommand(...args: JetbrainsGenerationRequest): Promise<CommitMessageResult> {
		// JetBrains sends args as a nested array: [[workspacePath, selectedFiles]]
		const [workspacePath, selectedFiles] = args[0]
		const request = { workspacePath, selectedFiles }

		return this.jetbrainsAdapter.generateCommitMessage(request)
	}

	/**
	 * Determine the workspace path from the provided URI or current workspace.
	 */
	private determineWorkspacePath(resourceUri?: vscode.Uri): string {
		if (resourceUri) {
			return resourceUri.fsPath
		}

		// Fallback to current workspace
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders && workspaceFolders.length > 0) {
			return workspaceFolders[0].uri.fsPath
		}

		throw new Error("Could not determine workspace path")
	}

	/**
	 * Dispose resources and cleanup.
	 */
	public dispose(): void {
		this.vscodeAdapter?.dispose()
		this.jetbrainsAdapter?.dispose()
	}
}
