import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitChange } from "./GitExtensionService"
import { loadRuleFiles } from "../../core/prompts/sections/custom-instructions"
import { t } from "../../i18n"

/**
 * Provides AI-powered commit message generation for source control management.
 * Integrates with Git repositories to analyze staged changes and generate
 * conventional commit messages using AI.
 */
export class CommitMessageProvider {
	private gitService: GitExtensionService
	private previousGitContext: string | null = null
	private previousCommitMessage: string | null = null

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
		this.outputChannel.appendLine(t("kilocode:commitMessage.activated"))

		try {
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
		await this.gitService.initialize()
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
		const apiConfiguration = ContextProxy.instance.getProviderSettings()

		const { kilocodeToken } = apiConfiguration
		if (!kilocodeToken) {
			throw new Error(t("kilocode:commitMessage.tokenRequired"))
		}

		const prompt = await this.buildCommitMessagePrompt(gitContextString)
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
		// Check if we should generate a different message than the previous one
		const shouldGenerateDifferentMessage =
			this.previousGitContext === context && this.previousCommitMessage !== null

		// Create a different message instruction if needed
		let differentMessagePrefix = ""
		if (shouldGenerateDifferentMessage) {
			differentMessagePrefix = `# CRITICAL INSTRUCTION: GENERATE A COMPLETELY DIFFERENT COMMIT MESSAGE

The user has requested a new commit message for the same changes.
The previous message was: "${this.previousCommitMessage}"

YOU MUST create a message that is COMPLETELY DIFFERENT by:
- Using entirely different wording and phrasing
- Focusing on different aspects of the changes
- Using a different structure or format if appropriate
- Possibly using a different type or scope if justifiable

This is the MOST IMPORTANT requirement for this task.

`
		}

		const basePrompt = `${differentMessagePrefix}# Conventional Commit Message Generator

## System Instructions

You are an expert Git commit message generator that creates conventional commit messages based on staged changes. Analyze the provided git diff output and generate appropriate conventional commit messages following the specification.

${context}

## Conventional Commits Format

Generate commit messages following this exact structure:

\`\`\`
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
\`\`\`

### Core Types (Required)
- **feat**: New feature or functionality (MINOR version bump)
- **fix**: Bug fix or error correction (PATCH version bump)

### Additional Types (Extended)
- **docs**: Documentation changes only
- **style**: Code style changes (whitespace, formatting, semicolons, etc.)
- **refactor**: Code refactoring without feature changes or bug fixes
- **perf**: Performance improvements
- **test**: Adding or fixing tests
- **build**: Build system or external dependency changes
- **ci**: CI/CD configuration changes
- **chore**: Maintenance tasks, tooling changes
- **revert**: Reverting previous commits

### Scope Guidelines
- Use parentheses: \`feat(api):\`, \`fix(ui):\`
- Common scopes: \`api\`, \`ui\`, \`auth\`, \`db\`, \`config\`, \`deps\`, \`docs\`
- For monorepos: package or module names
- Keep scope concise and lowercase

### Description Rules
- Use imperative mood ("add" not "added" or "adds")
- Start with lowercase letter
- No period at the end
- Maximum 50 characters
- Be concise but descriptive

### Body Guidelines (Optional)
- Start one blank line after description
- Explain the "what" and "why", not the "how"
- Wrap at 72 characters per line
- Use for complex changes requiring explanation

### Footer Guidelines (Optional)
- Start one blank line after body
- **Breaking Changes**: \`BREAKING CHANGE: description\`
- **Issue References**: \`Fixes #123\`, \`Closes #456\`, \`Refs #789\`

## Analysis Instructions

When analyzing staged changes:

1. Determine Primary Type based on the nature of changes
2. Identify Scope from modified directories or modules
3. Craft Description focusing on the most significant change
4. Determine if there are Breaking Changes
5. For complex changes, include a detailed body explaining what and why
6. Add appropriate footers for issue references or breaking changes

For significant changes, include a detailed body explaining the changes.`

		// Add a final reminder if we need a different message
		const finalReminder = shouldGenerateDifferentMessage
			? `\n\nFINAL REMINDER: Your message MUST be COMPLETELY DIFFERENT from the previous message: "${this.previousCommitMessage}". This is a critical requirement.`
			: ""

		return `${basePrompt}${finalReminder}\n\nReturn ONLY the commit message in the conventional format, nothing else.`
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
