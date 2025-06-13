import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitChange } from "./GitExtensionService"
import { supportPrompt } from "../../shared/support-prompt"
import { t } from "../../i18n"
import type { ProviderSettings } from "@roo-code/types"

/**
 * Provides AI-powered commit message generation for source control management.
 * Integrates with Git repositories to analyze staged changes and generate
 * conventional commit messages using AI.
 */
export class CommitMessageProvider {
	private gitService: GitExtensionService
	private providerSettingsManager: ProviderSettingsManager
	private previousGitContext: string | null = null
	private previousCommitMessage: string | null = null

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		this.gitService = new GitExtensionService()
		this.providerSettingsManager = new ProviderSettingsManager(this.context)
	}

	/**
	 * Activates the commit message provider by setting up Git integration.
	 */
	public async activate(): Promise<void> {
		this.outputChannel.appendLine(t("kilocode:commitMessage.activated"))

		try {
			// Initialize provider settings manager
			await this.providerSettingsManager.initialize()

			const initialized = await this.gitService.initialize()
			if (!initialized) {
				this.outputChannel.appendLine(t("kilocode:commitMessage.gitNotFound"))
			}
		} catch (error) {
			this.outputChannel.appendLine(t("kilocode:commitMessage.gitInitError", { error }))
		}

		// Register the command
		const disposable = vscode.commands.registerCommand("kilo-code.generateCommitMessage", () =>
			this.generateCommitMessage(),
		)
		this.context.subscriptions.push(disposable)
	}

	/**
	 * Generates an AI-powered commit message based on staged changes.
	 */
	public async generateCommitMessage(): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.SourceControl,
				title: t("kilocode:commitMessage.generating"),
				cancellable: false,
			},
			async (progress) => {
				try {
					progress.report({ increment: 25, message: t("kilocode:commitMessage.analyzingChanges") })

					const changes = await this.gitService.gatherStagedChanges()
					if (changes === null) {
						vscode.window.showInformationMessage(t("kilocode:commitMessage.noStagedChangesRepo"))
						return
					}
					if (changes.length === 0) {
						vscode.window.showInformationMessage(t("kilocode:commitMessage.noStagedChanges"))
						return
					}

					const gitContextString = this.gitService.getCommitContext(changes)
					progress.report({ increment: 50, message: t("kilocode:commitMessage.generating") })

					const generatedMessage = await this.callAIForCommitMessage(gitContextString)
					this.gitService.setCommitMessage(generatedMessage)

					// Store the current context and message for future reference
					this.previousGitContext = gitContextString
					this.previousCommitMessage = generatedMessage

					progress.report({ increment: 100, message: "Complete!" })
					vscode.window.showInformationMessage(t("kilocode:commitMessage.generated"))
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
					vscode.window.showErrorMessage(t("kilocode:commitMessage.generationFailed", { errorMessage }))
					console.error("Error generating commit message:", error)
				}
			},
		)
	}

	/**
	 * Calls the provider to generate a commit message based on the git context.
	 */
	private async callAIForCommitMessage(gitContextString: string): Promise<string> {
		const contextProxy = ContextProxy.instance
		const apiConfiguration = contextProxy.getProviderSettings()
		const commitMessageApiConfigId = contextProxy.getValue("commitMessageApiConfigId")
		const listApiConfigMeta = contextProxy.getValue("listApiConfigMeta") || []
		const customSupportPrompts = contextProxy.getValue("customSupportPrompts") || {}

		// Try to get commit message config first, fall back to current config.
		let configToUse: ProviderSettings = apiConfiguration

		if (
			commitMessageApiConfigId &&
			listApiConfigMeta.find(({ id }: { id: string }) => id === commitMessageApiConfigId)
		) {
			try {
				const { name: _, ...providerSettings } = await this.providerSettingsManager.getProfile({
					id: commitMessageApiConfigId,
				})

				if (providerSettings.apiProvider) {
					configToUse = providerSettings
				}
			} catch (error) {
				// Fall back to default configuration if profile doesn't exist
				console.warn(`Failed to load commit message API config ${commitMessageApiConfigId}:`, error)
			}
		}

		const prompt = this.buildCommitMessagePrompt(gitContextString, customSupportPrompts)

		const response = await singleCompletionHandler(configToUse, prompt)

		return this.extractCommitMessage(response)
	}

	/**
	 * Builds the AI prompt for commit message generation.
	 * Handles logic for generating different messages when requested for the same changes.
	 */
	private buildCommitMessagePrompt(gitContextString: string, customSupportPrompts: Record<string, any>): string {
		// Check if we should generate a different message than the previous one
		const shouldGenerateDifferentMessage =
			this.previousGitContext === gitContextString && this.previousCommitMessage !== null

		// Create prompt with different message logic if needed
		if (shouldGenerateDifferentMessage) {
			const differentMessagePrefix = `# CRITICAL INSTRUCTION: GENERATE A COMPLETELY DIFFERENT COMMIT MESSAGE
The user has requested a new commit message for the same changes.
The previous message was: "${this.previousCommitMessage}"
YOU MUST create a message that is COMPLETELY DIFFERENT by:
- Using entirely different wording and phrasing
- Focusing on different aspects of the changes
- Using a different structure or format if appropriate
- Possibly using a different type or scope if justifiable
This is the MOST IMPORTANT requirement for this task.

`
			const baseTemplate = supportPrompt.get(customSupportPrompts, "COMMIT_MESSAGE")
			const modifiedTemplate =
				differentMessagePrefix +
				baseTemplate +
				`

FINAL REMINDER: Your message MUST be COMPLETELY DIFFERENT from the previous message: "${this.previousCommitMessage}". This is a critical requirement.`

			return supportPrompt.create(
				"COMMIT_MESSAGE",
				{ gitContext: gitContextString },
				{
					...customSupportPrompts,
					COMMIT_MESSAGE: modifiedTemplate,
				},
			)
		} else {
			return supportPrompt.create("COMMIT_MESSAGE", { gitContext: gitContextString }, customSupportPrompts)
		}
	}

	/**
	 * Extracts the commit message from the AI response.
	 */
	private extractCommitMessage(response: string): string {
		// Clean up the response by removing any extra whitespace or formatting
		const cleaned = response.trim()

		// Remove any code block markers
		const withoutCodeBlocks = cleaned.replace(/```[a-z]*\n|```/g, "")

		// Remove any quotes or backticks that might wrap the message
		const withoutQuotes = withoutCodeBlocks.replace(/^["'`]|["'`]$/g, "")

		return withoutQuotes.trim()
	}
}
