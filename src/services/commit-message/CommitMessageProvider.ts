import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitRepository, GitChange } from "./GitExtensionService"
import { loadRuleFiles } from "../../core/prompts/sections/custom-instructions"

/**
 * Provides AI-powered commit message generation for source control management.
 * Integrates with Git repositories to analyze staged changes and generate
 * conventional commit messages using AI.
 */
export class CommitMessageProvider {
	private gitService: GitExtensionService

	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {
		this.gitService = new GitExtensionService()
	}

	/**
	 * Activates the commit message provider by setting up Git integration.
	 */
	public async activate(): Promise<void> {
		this.outputChannel.appendLine("✨ Commit message generator activated")

		try {
			await this.gitService.initializeGitExtension()
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
		// Check if we can gather staged changes to determine if a repository is available
		const changes = await this.gitService.gatherStagedChanges()
		if (changes === null) {
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

					// We already have the changes from the initial check
					if (changes.length === 0) {
						vscode.window.showInformationMessage("No staged changes found to analyze")
						return
					}

					const context = this.formatChangesForAI(changes)
					console.log("🚀 ~ CommitMessageProvider ~ context:", context)
					progress.report({ increment: 50, message: "Generating message with AI..." })

					const generatedMessage = await this.callAIForCommitMessage(context)
					this.gitService.setCommitMessage(generatedMessage)

					progress.report({ increment: 100, message: "Complete!" })
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

	/**
	 * Formats changes for AI consumption
	 */
	private formatChangesForAI(changes: GitChange[]): string {
		const changesByType = changes.reduce(
			(acc, change) => {
				if (!acc[change.status]) {
					acc[change.status] = []
				}
				acc[change.status].push(change.filePath)
				return acc
			},
			{} as Record<string, string[]>,
		)

		let context = "Staged changes:\n"
		for (const [status, files] of Object.entries(changesByType)) {
			context += `\n${status} files:\n`
			files.forEach((file) => {
				context += `- ${file}\n`
			})
		}

		return context
	}
}
