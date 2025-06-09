import * as vscode from "vscode"
import { ContextProxy } from "../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { GitExtensionService, GitChange } from "./GitExtensionService"
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
		this.outputChannel.appendLine("✨ Kilo Commit message generator activated")

		try {
			const initialized = await this.gitService.initialize()
			if (!initialized) {
				this.outputChannel.appendLine("⚠️ Git repository not found or git not available")
			}
		} catch (error) {
			this.outputChannel.appendLine(`⚠️ Git initialization error: ${error}`)
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
				title: "Kilo: Generating commit message...",
				cancellable: false,
			},
			async (progress) => {
				try {
					progress.report({ increment: 25, message: "Kilo: Analyzing staged changes..." })

					// Check if we can gather staged changes
					const changes = await this.gitService.gatherStagedChanges()
					if (changes === null) {
						vscode.window.showInformationMessage("Kilo: No staged changes found in git repository")
						return
					}

					if (changes.length === 0) {
						vscode.window.showInformationMessage("Kilo: No staged changes found to analyze")
						return
					}

					const gitContextString = this.gitService.getCommitContext(changes)
					progress.report({ increment: 50, message: "Kilo: Generating message with AI..." })

					const generatedMessage = await this.callAIForCommitMessage(gitContextString)
					this.gitService.setCommitMessage(generatedMessage)

					progress.report({ increment: 100, message: "Complete!" })
					vscode.window.showInformationMessage("✨ Kilo: Commit message generated!")
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

		const basePrompt = `# Conventional Commit Message Generator

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

		// Append rules if they exist
		const rulesSection = rules ? `\n\nAdditional Rules:${rules}` : ""

		return `${basePrompt}${rulesSection}\n\nReturn ONLY the commit message in the conventional format, nothing else.`
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
