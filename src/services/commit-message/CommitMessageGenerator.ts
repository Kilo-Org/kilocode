import { ContextProxy } from "../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../core/config/ProviderSettingsManager"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { supportPrompt } from "../../shared/support-prompt"
import { addCustomInstructions } from "../../core/prompts/sections/custom-instructions"
import { TelemetryService } from "@roo-code/telemetry"
import { TelemetryEventName, type ProviderSettings } from "@roo-code/types"

import { GenerateMessageParams, PromptOptions, ProgressUpdate } from "./types/core"

/**
 * Pure commit message generation logic without IDE-specific dependencies.
 * Handles AI integration, prompt building, and response processing.
 */
export class CommitMessageGenerator {
	private readonly providerSettingsManager: ProviderSettingsManager
	private previousGitContext: string | null = null
	private previousCommitMessage: string | null = null

	constructor(providerSettingsManager: ProviderSettingsManager) {
		this.providerSettingsManager = providerSettingsManager
	}

	async generateMessage(params: GenerateMessageParams): Promise<string> {
		const { gitContext, onProgress } = params

		try {
			// Report progress: starting AI generation
			onProgress?.({
				stage: "ai-generation",
				message: "Generating commit message...",
				percentage: 75,
			})

			const generatedMessage = await this.callAIForCommitMessage(gitContext, onProgress)

			// Store context for potential regeneration requests
			this.previousGitContext = gitContext
			this.previousCommitMessage = generatedMessage

			// Report telemetry
			TelemetryService.instance.captureEvent(TelemetryEventName.COMMIT_MSG_GENERATED)

			// Report progress: completion
			onProgress?.({
				stage: "completion",
				message: "Commit message generated successfully",
				percentage: 100,
			})

			return generatedMessage
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
			throw new Error(`Failed to generate commit message: ${errorMessage}`)
		}
	}

	async buildPrompt(gitContext: string, options: PromptOptions): Promise<string> {
		const { customSupportPrompts = {}, previousContext, previousMessage } = options

		// Load custom instructions including rules
		// Note: For pure generator, we pass empty workspace path since we don't have IDE context
		// This should be enhanced by the adapter to provide workspace-specific context
		const customInstructions = await addCustomInstructions(
			"", // no mode-specific instructions for commit
			"", // no global custom instructions
			"", // workspacePath - to be provided by adapter
			"commit", // mode for commit-specific rules
			{
				language: "en", // default language, should be configurable by adapter
				localRulesToggleState: undefined, // to be provided by adapter
				globalRulesToggleState: undefined, // to be provided by adapter
			},
		)

		// Check if we should generate a different message than the previous one
		const shouldGenerateDifferentMessage =
			(previousContext === gitContext || this.previousGitContext === gitContext) &&
			(previousMessage !== null || this.previousCommitMessage !== null)

		const targetPreviousMessage = previousMessage || this.previousCommitMessage

		// Create prompt with different message logic if needed
		if (shouldGenerateDifferentMessage && targetPreviousMessage) {
			const differentMessagePrefix = `# CRITICAL INSTRUCTION: GENERATE A COMPLETELY DIFFERENT COMMIT MESSAGE
The user has requested a new commit message for the same changes.
The previous message was: "${targetPreviousMessage}"
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

FINAL REMINDER: Your message MUST be COMPLETELY DIFFERENT from the previous message: "${targetPreviousMessage}". This is a critical requirement.`

			return supportPrompt.create(
				"COMMIT_MESSAGE",
				{
					gitContext,
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
					gitContext,
					customInstructions: customInstructions || "",
				},
				customSupportPrompts,
			)
		}
	}

	private async callAIForCommitMessage(
		gitContextString: string,
		onProgress?: (progress: ProgressUpdate) => void,
	): Promise<string> {
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

		// Build prompt with current context - filter out undefined values
		const filteredPrompts = Object.fromEntries(
			Object.entries(customSupportPrompts).filter(([_, value]) => value !== undefined),
		) as Record<string, string>

		console.log("🔧 CommitMessageGenerator.callAIForCommitMessage: Building prompt...")
		const prompt = await this.buildPrompt(gitContextString, { customSupportPrompts: filteredPrompts })
		console.log("🔧 CommitMessageGenerator.callAIForCommitMessage: Prompt built, length:", prompt.length)

		// Report progress before AI call
		onProgress?.({
			stage: "ai-generation",
			message: "Calling AI service...",
			increment: 10,
		})

		const response = await singleCompletionHandler(configToUse, prompt)

		// Report progress after AI call
		onProgress?.({
			stage: "ai-generation",
			message: "Processing AI response...",
			increment: 10,
		})

		const result = this.extractCommitMessage(response)

		return result
	}

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
