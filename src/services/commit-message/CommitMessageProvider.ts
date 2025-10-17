// kilocode_change - new file
import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitChange, GitProgressOptions, GitRepository } from "./GitExtensionService"
import { supportPrompt } from "../../shared/support-prompt"
import { t } from "../../i18n"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { getWorkspacePath } from "../../utils/path"
import { TelemetryEventName, type ProviderSettings } from "@roo-code/types"
import delay from "delay"
import { TelemetryService } from "@roo-code/telemetry"

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
			await this.providerSettingsManager.initialize()
		} catch (error) {
			this.outputChannel.appendLine(t("kilocode:commitMessage.gitInitError", { error }))
		}

		// Register the command
		const disposable = vscode.commands.registerCommand(
			"kilo-code.generateCommitMessage",
			(commitContext?: GitRepository) => this.generateCommitMessage(commitContext),
		)
		this.context.subscriptions.push(disposable)
		this.context.subscriptions.push(this.gitService)
	}

	/**
	 * Generates an AI-powered commit message based on staged changes, or unstaged changes if no staged changes exist.
	 */
	public async generateCommitMessage(commitContext?: GitRepository): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.SourceControl,
				title: t("kilocode:commitMessage.generating"),
				cancellable: false,
			},
			async (progress) => {
				try {
					this.gitService.configureRepositoryContext(commitContext?.rootUri)

					let staged = true
					let changes = await this.gitService.gatherChanges({ staged })

					if (changes.length === 0) {
						staged = false
						changes = await this.gitService.gatherChanges({ staged })
						if (changes.length > 0) {
							vscode.window.showInformationMessage(t("kilocode:commitMessage.generatingFromUnstaged"))
						} else {
							vscode.window.showInformationMessage(t("kilocode:commitMessage.noChanges"))
							return
						}
					}

					// Report initial progress after gathering changes (10% of total)
					progress.report({ increment: 10, message: t("kilocode:commitMessage.generating") })

					// Track progress for diff collection (70% of total progress)
					let lastReportedProgress = 0
					const onDiffProgress = (percentage: number) => {
						const currentProgress = (percentage / 100) * 70
						const increment = currentProgress - lastReportedProgress
						if (increment > 0) {
							progress.report({ increment, message: t("kilocode:commitMessage.generating") })
							lastReportedProgress = currentProgress
						}
					}

					const gitContextString = await this.gitService.getCommitContext(changes, {
						staged,
						onProgress: onDiffProgress,
					})

					const generatedMessage = await this.callAIForCommitMessageWithProgress(gitContextString, progress)

					// Store the current context and message for future reference
					this.previousGitContext = gitContextString
					this.previousCommitMessage = generatedMessage
					this.gitService.setCommitMessage(generatedMessage)
					TelemetryService.instance.captureEvent(TelemetryEventName.COMMIT_MSG_GENERATED)
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
					vscode.window.showErrorMessage(t("kilocode:commitMessage.generationFailed", { errorMessage }))
					console.error("Error generating commit message:", error)
				}
			},
		)
	}

	private async callAIForCommitMessageWithProgress(
		gitContextString: string,
		progress: vscode.Progress<{ increment?: number; message?: string }>,
	): Promise<string> {
		let totalProgressUsed = 0
		const maxProgress = 20 // We have 20% reserved for AI processing
		const maxIncrement = 1.0 // Start with bigger increments
		const minIncrement = 0.05 // Minimum increment to keep progress moving

		// Start interval timer to update the progress while we wait for the reponse
		// Use exponential decay: start with larger increments, decrease as we approach the limit
		// Formula: increment = remainingProgress^2 * maxIncrement + minIncrement
		const progressInterval = setInterval(() => {
			const remainingProgress = (maxProgress - totalProgressUsed) / maxProgress // percentage (0 to 1)

			const incrementLimited = Math.max(
				remainingProgress * remainingProgress * maxIncrement + minIncrement,
				minIncrement,
			)
			const increment = Math.min(incrementLimited, maxProgress - totalProgressUsed)
			progress.report({ increment: increment, message: t("kilocode:commitMessage.generating") })
			totalProgressUsed += increment
		}, 100)

		try {
			const message = await this.callAIForCommitMessage(gitContextString)

			// Now, animate the bar to 100% to make it look nicer :)
			for (let i = 0; i < maxProgress - totalProgressUsed; i++) {
				progress.report({ increment: 1 })
				await delay(25)
			}
			return message
		} finally {
			clearInterval(progressInterval) // Always clear when done
		}
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

		const prompt = await this.buildCommitMessagePrompt(gitContextString, customSupportPrompts)

		const response = await singleCompletionHandler(configToUse, prompt)

		return this.extractCommitMessage(response)
	}

	/**
	 * Builds the AI prompt for commit message generation.
	 * Handles logic for generating different messages when requested for the same changes.
	 */
	private async buildCommitMessagePrompt(
		gitContextString: string,
		customSupportPrompts: Record<string, any>,
	): Promise<string> {
		// Load custom instructions including rules
		const workspacePath = getWorkspacePath()
		const customInstructions = workspacePath
			? await addCustomInstructions(
					"", // no mode-specific instructions for commit
					"", // no global custom instructions
					workspacePath,
					"commit", // mode for commit-specific rules
					{
						language: vscode.env.language,
						localRulesToggleState: this.context.workspaceState.get("localRulesToggles"),
						globalRulesToggleState: this.context.globalState.get("globalRulesToggles"),
					},
				)
			: ""

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
				{
					gitContext: gitContextString,
					customInstructions: customInstructions || "",
				},
				{
					...customSupportPrompts,
					COMMIT_MESSAGE: modifiedTemplate,
				},
			)
		} else {
			return supportPrompt.create(
				"COMMIT_MESSAGE",
				{
					gitContext: gitContextString,
					customInstructions: customInstructions || "",
				},
				customSupportPrompts,
			)
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

	public dispose() {
		this.gitService.dispose()
	}
}
