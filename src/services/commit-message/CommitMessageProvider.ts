import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitRepository } from "./GitExtensionService"
import { loadRuleFiles } from "../../core/prompts/sections/custom-instructions"

/**
 * Provides AI-powered commit message generation for source control management.
 * Integrates with Git repositories to analyze staged changes and generate
 * conventional commit messages using AI.
 */
export class CommitMessageProvider {
	private gitUtils: GitExtensionService

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		this.gitUtils = new GitExtensionService()
	}

	/**
	 * Activates the commit message provider by setting up Git integration.
	 */
	public async activate(): Promise<void> {
		this.outputChannel.appendLine("✨ Commit message generator activated")

		try {
			await this.gitUtils.initializeGitExtension()
		} catch (error) {
			throw new Error(`Failed to initialize Git extension: ${error}`)
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
		const repository = this.gitUtils.getActiveRepository()
		if (!repository) {
			vscode.window.showInformationMessage("No Git repository found")
			return
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.SourceControl,
				title: "Generating commit message...",
				cancellable: false,
			},
			async (progress) => {
				try {
					progress.report({ increment: 25, message: "Analyzing staged changes..." })

					const context = await this.gitUtils.gatherStagedChanges(repository)
					if (!context) {
						vscode.window.showInformationMessage("No staged changes found to analyze")
						return
					}

					progress.report({ increment: 50, message: "Generating message with AI..." })

					const generatedMessage = await this.callAIForCommitMessage(context)

					progress.report({ increment: 100, message: "Complete!" })

					this.gitUtils.setCommitMessage(repository, generatedMessage)
					vscode.window.showInformationMessage("✨ Commit message generated!")
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
					vscode.window.showErrorMessage(`Failed to generate commit message: ${errorMessage}`)
					console.error("Error generating commit message:", error)
				}
			},
		)
	}

	/**
	 * Calls the AI service to generate a commit message based on the provided context.
	 */
	private async callAIForCommitMessage(context: string): Promise<string> {
		const apiConfiguration = ContextProxy.instance.getProviderSettings()

		const { kilocodeToken } = apiConfiguration
		if (!kilocodeToken) {
			throw new Error("Kilo Code token is required for AI commit message generation")
		}

		const prompt = await this.buildCommitMessagePrompt(context)
		const response = await singleCompletionHandler(
			{
				apiProvider: "kilocode",
				kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
				kilocodeToken,
			},
			prompt,
		)

		return this.extractCommitMessage(response)
	}

	/**
	 * Builds the AI prompt for commit message generation.
	 */
	private async buildCommitMessagePrompt(context: string): Promise<string> {
		// Load rules from the workspace
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		const rules = workspaceRoot ? await loadRuleFiles(workspaceRoot) : ""

		const basePrompt = `You are an expert software developer tasked with writing a concise, informative commit message.

${context}

Please generate a single commit message that follows conventional commit format:
- Use type(scope): description format
- Types: feat, fix, docs, style, refactor, test, chore
- Keep the description under 50 characters
- Use imperative mood (e.g., "add" not "added")
- Be specific about what changed

Examples:
- feat(auth): add user login validation
- fix(api): resolve null pointer exception
- docs(readme): update installation steps
- refactor(utils): extract common helper functions`

		// Append rules if they exist
		const rulesSection = rules ? `\n\nAdditional Rules:${rules}` : ""

		return `${basePrompt}${rulesSection}\n\nReturn ONLY the commit message, nothing else.`
	}

	/**
	 * Extracts the commit message from the AI response.
	 */
	private extractCommitMessage(response: string): string {
		// Clean up the response by removing any extra whitespace or formatting
		const cleaned = response.trim()

		// If the response contains multiple lines, take the first line
		const firstLine = cleaned.split("\n")[0].trim()

		// Remove any quotes or backticks that might wrap the message
		return firstLine.replace(/^["'`]|["'`]$/g, "")
	}
}
