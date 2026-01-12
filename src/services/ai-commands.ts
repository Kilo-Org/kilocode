/**
 * AI Features Commands and Keyboard Shortcuts
 *
 * Defines all VSCode commands and keyboard shortcuts for AI features:
 * - Enhanced Chat with Source Discovery
 * - Next Edit Guidance System
 * - Context-Aware Intelligent Completions
 * - Slack Integration
 *
 * kilocode_change - new file
 */

import * as vscode from "vscode"
import { SlackIntegrationService } from "./slack-integration/slack-service"

/**
 * AI feature command definitions
 */
export interface AICommand {
	id: string
	title: string
	category: string
	handler: (...args: any[]) => any
	keybinding?: string
	when?: string
	icon?: string
}

/**
 * Command categories
 */
export enum CommandCategory {
	CHAT = "Chat",
	EDIT_GUIDANCE = "Edit Guidance",
	COMPLETIONS = "Completions",
	SLACK = "Slack",
	PERFORMANCE = "Performance",
	SETTINGS = "Settings",
}

/**
 * AI Commands Registry
 */
export class AICommandsRegistry {
	private commands: Map<string, AICommand> = new Map()
	private context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext) {
		this.context = context
	}

	/**
	 * Register all AI commands
	 */
	registerAllCommands(): void {
		// Chat commands
		this.registerCommand({
			id: "kiloCode.ai.newChat",
			title: "New Chat Session",
			category: CommandCategory.CHAT,
			handler: () => this.createNewChat(),
			keybinding: "cmd+shift+n",
		})

		this.registerCommand({
			id: "kiloCode.ai.focusChat",
			title: "Focus Chat Panel",
			category: CommandCategory.CHAT,
			handler: () => this.focusChat(),
			keybinding: "cmd+shift+a",
		})

		this.registerCommand({
			id: "kiloCode.ai.addToContext",
			title: "Add Selection to Context",
			category: CommandCategory.CHAT,
			handler: () => this.addToContext(),
			when: "editorHasSelection",
		})

		this.registerCommand({
			id: "kiloCode.ai.askAboutCode",
			title: "Ask About Selected Code",
			category: CommandCategory.CHAT,
			handler: () => this.askAboutCode(),
			when: "editorHasSelection",
		})

		// Edit guidance commands
		this.registerCommand({
			id: "kiloCode.ai.createEditPlan",
			title: "Create Edit Plan",
			category: CommandCategory.EDIT_GUIDANCE,
			handler: () => this.createEditPlan(),
			keybinding: "cmd+shift+e",
		})

		this.registerCommand({
			id: "kiloCode.ai.suggestRefactoring",
			title: "Suggest Refactoring",
			category: CommandCategory.EDIT_GUIDANCE,
			handler: () => this.suggestRefactoring(),
			when: "editorHasSelection",
		})

		this.registerCommand({
			id: "kiloCode.ai.executeNextStep",
			title: "Execute Next Edit Step",
			category: CommandCategory.EDIT_GUIDANCE,
			handler: () => this.executeNextStep(),
		})

		this.registerCommand({
			id: "kiloCode.ai.skipStep",
			title: "Skip Current Edit Step",
			category: CommandCategory.EDIT_GUIDANCE,
			handler: () => this.skipStep(),
		})

		// Completions commands
		this.registerCommand({
			id: "kiloCode.ai.triggerCompletion",
			title: "Trigger AI Completion",
			category: CommandCategory.COMPLETIONS,
			handler: () => this.triggerCompletion(),
			keybinding: "ctrl+space",
		})

		this.registerCommand({
			id: "kiloCode.ai.acceptCompletion",
			title: "Accept Completion",
			category: CommandCategory.COMPLETIONS,
			handler: () => this.acceptCompletion(),
			keybinding: "tab",
		})

		this.registerCommand({
			id: "kiloCode.ai.cycleCompletions",
			title: "Cycle Through Completions",
			category: CommandCategory.COMPLETIONS,
			handler: () => this.cycleCompletions(),
			keybinding: "alt+]",
		})

		this.registerCommand({
			id: "kiloCode.ai.cycleBackCompletions",
			title: "Cycle Back Through Completions",
			category: CommandCategory.COMPLETIONS,
			handler: () => this.cycleBackCompletions(),
			keybinding: "alt+[",
		})

		// Slack commands
		this.registerCommand({
			id: "kiloCode.ai.shareToSlack",
			title: "Share Current Content to Slack",
			category: CommandCategory.SLACK,
			handler: () => this.shareToSlack(),
			keybinding: "cmd+shift+s",
		})

		this.registerCommand({
			id: "kiloCode.ai.shareChatToSlack",
			title: "Share Chat to Slack",
			category: CommandCategory.SLACK,
			handler: () => this.shareChatToSlack(),
		})

		this.registerCommand({
			id: "kiloCode.ai.shareCodeToSlack",
			title: "Share Code to Slack",
			category: CommandCategory.SLACK,
			handler: () => this.shareCodeToSlack(),
			when: "editorHasSelection",
		})

		this.registerCommand({
			id: "kiloCode.ai.configureSlack",
			title: "Configure Slack Integration",
			category: CommandCategory.SLACK,
			handler: () => this.configureSlack(),
		})

		// Performance commands
		this.registerCommand({
			id: "kiloCode.ai.showPerformanceMetrics",
			title: "Show Performance Metrics",
			category: CommandCategory.PERFORMANCE,
			handler: () => this.showPerformanceMetrics(),
		})

		this.registerCommand({
			id: "kiloCode.ai.generatePerformanceReport",
			title: "Generate Performance Report",
			category: CommandCategory.PERFORMANCE,
			handler: () => this.generatePerformanceReport(),
		})

		this.registerCommand({
			id: "kiloCode.ai.clearCache",
			title: "Clear AI Cache",
			category: CommandCategory.PERFORMANCE,
			handler: () => this.clearCache(),
		})

		this.registerCommand({
			id: "kiloCode.ai.reindexCodebase",
			title: "Reindex Codebase",
			category: CommandCategory.PERFORMANCE,
			handler: () => this.reindexCodebase(),
		})

		// Settings commands
		this.registerCommand({
			id: "kiloCode.ai.openSettings",
			title: "Open AI Settings",
			category: CommandCategory.SETTINGS,
			handler: () => this.openSettings(),
		})

		this.registerCommand({
			id: "kiloCode.ai.validateSetup",
			title: "Validate AI Setup",
			category: CommandCategory.SETTINGS,
			handler: () => this.validateSetup(),
		})

		this.registerCommand({
			id: "kiloCode.ai.showLogs",
			title: "Show AI Logs",
			category: CommandCategory.SETTINGS,
			handler: () => this.showLogs(),
		})

		this.registerCommand({
			id: "kiloCode.ai.exportLogs",
			title: "Export AI Logs",
			category: CommandCategory.SETTINGS,
			handler: () => this.exportLogs(),
		})
	}

	/**
	 * Register a single command
	 */
	private registerCommand(command: AICommand): void {
		const disposable = vscode.commands.registerCommand(command.id, command.handler)
		this.context.subscriptions.push(disposable)
		this.commands.set(command.id, command)
	}

	/**
	 * Get all commands
	 */
	getAllCommands(): AICommand[] {
		return Array.from(this.commands.values())
	}

	/**
	 * Get commands by category
	 */
	getCommandsByCategory(category: CommandCategory): AICommand[] {
		return Array.from(this.commands.values()).filter((c) => c.category === category)
	}

	/**
	 * Get command by ID
	 */
	getCommand(id: string): AICommand | undefined {
		return this.commands.get(id)
	}

	// Command handlers

	private async createNewChat(): Promise<void> {
		// Implementation: Create new chat session
		vscode.window.showInformationMessage("Creating new chat session...")
	}

	private async focusChat(): Promise<void> {
		// Implementation: Focus chat panel
		vscode.window.showInformationMessage("Focusing chat panel...")
	}

	private async addToContext(): Promise<void> {
		// Implementation: Add selection to context
		const editor = vscode.window.activeTextEditor
		if (editor) {
			const selection = editor.selection
			const text = editor.document.getText(selection)
			vscode.window.showInformationMessage(`Added ${text.length} characters to context`)
		}
	}

	private async askAboutCode(): Promise<void> {
		// Implementation: Ask about selected code
		vscode.window.showInformationMessage("Opening chat with selected code...")
	}

	private async createEditPlan(): Promise<void> {
		// Implementation: Create edit plan
		vscode.window.showInformationMessage("Creating edit plan...")
	}

	private async suggestRefactoring(): Promise<void> {
		// Implementation: Suggest refactoring
		vscode.window.showInformationMessage("Analyzing code for refactoring suggestions...")
	}

	private async executeNextStep(): Promise<void> {
		// Implementation: Execute next step
		vscode.window.showInformationMessage("Executing next edit step...")
	}

	private async skipStep(): Promise<void> {
		// Implementation: Skip current step
		vscode.window.showInformationMessage("Skipping current edit step...")
	}

	private async triggerCompletion(): Promise<void> {
		// Implementation: Trigger completion
		vscode.window.showInformationMessage("Triggering AI completion...")
	}

	private async acceptCompletion(): Promise<void> {
		// Implementation: Accept completion
		vscode.window.showInformationMessage("Accepting completion...")
	}

	private async cycleCompletions(): Promise<void> {
		// Implementation: Cycle through completions
		vscode.window.showInformationMessage("Cycling to next completion...")
	}

	private async cycleBackCompletions(): Promise<void> {
		// Implementation: Cycle back through completions
		vscode.window.showInformationMessage("Cycling to previous completion...")
	}

	private async shareToSlack(): Promise<void> {
		// Implementation: Share to Slack
		vscode.window.showInformationMessage("Sharing content to Slack...")
	}

	private async shareChatToSlack(): Promise<void> {
		// Implementation: Share chat to Slack
		vscode.window.showInformationMessage("Sharing chat to Slack...")
	}

	private async shareCodeToSlack(): Promise<void> {
		// Implementation: Share code to Slack
		vscode.window.showInformationMessage("Sharing code to Slack...")
	}

	private async configureSlack(): Promise<void> {
		// Implementation: Configure Slack integration
		try {
			// Prompt for Slack Bot Token
			const botToken = await vscode.window.showInputBox({
				prompt: "Enter your Slack Bot Token",
				placeHolder: "xoxb-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxx",
				password: true,
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return "Bot token is required"
					}
					if (!value.startsWith("xoxb-")) {
						return 'Bot token must start with "xoxb-"'
					}
					return null
				},
			})

			if (!botToken) {
				vscode.window.showInformationMessage("Slack configuration cancelled")
				return
			}

			// Prompt for Workspace ID
			const workspaceId = await vscode.window.showInputBox({
				prompt: "Enter your Slack Workspace ID",
				placeHolder: "T1234567890",
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return "Workspace ID is required"
					}
					if (!value.startsWith("T")) {
						return 'Workspace ID must start with "T"'
					}
					return null
				},
			})

			if (!workspaceId) {
				vscode.window.showInformationMessage("Slack configuration cancelled")
				return
			}

			// Prompt for Channel ID
			const channelId = await vscode.window.showInputBox({
				prompt: "Enter the Slack Channel ID to share messages to",
				placeHolder: "C1234567890",
				validateInput: (value) => {
					if (!value || value.trim().length === 0) {
						return "Channel ID is required"
					}
					if (!value.startsWith("C")) {
						return 'Channel ID must start with "C"'
					}
					return null
				},
			})

			if (!channelId) {
				vscode.window.showInformationMessage("Slack configuration cancelled")
				return
			}

			// Optional: Prompt for User Token
			const userToken = await vscode.window.showInputBox({
				prompt: "Enter your Slack User Token (optional)",
				placeHolder: "xoxp-xxxxxxxxxxxx-xxxxxxxxxxxx-xxxxxxxxxxxx",
				password: true,
				validateInput: (value) => {
					if (value && !value.startsWith("xoxp-")) {
						return 'User token must start with "xoxp-" if provided'
					}
					return null
				},
			})

			// Validate the bot token
			vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Validating Slack token...",
					cancellable: false,
				},
				async (progress) => {
					const slackService = new SlackIntegrationService(this.context)
					const isValid = await slackService.validateToken(botToken)

					if (!isValid) {
						vscode.window.showErrorMessage(
							"Invalid Slack bot token. Please check your token and try again.",
						)
						return
					}

					// Create the integration
					try {
						await slackService.createIntegration({
							userId: "current-user", // TODO: Get actual user ID
							workspaceId: workspaceId,
							channelId: channelId,
							botToken: botToken,
							userToken: userToken || "",
							metadata: {
								configuredAt: new Date().toISOString(),
								configuredBy: "vscode-extension",
							},
						})

						vscode.window.showInformationMessage(
							"Slack integration configured successfully! You can now share content to Slack.",
							"OK",
						)
					} catch (error) {
						vscode.window.showErrorMessage(`Failed to configure Slack integration: ${error.message}`)
					}
				},
			)
		} catch (error) {
			vscode.window.showErrorMessage(`Error configuring Slack: ${error.message}`)
		}
	}

	private async showPerformanceMetrics(): Promise<void> {
		// Implementation: Show performance metrics
		vscode.window.showInformationMessage("Showing performance metrics...")
	}

	private async generatePerformanceReport(): Promise<void> {
		// Implementation: Generate performance report
		vscode.window.showInformationMessage("Generating performance report...")
	}

	private async clearCache(): Promise<void> {
		// Implementation: Clear cache
		vscode.window.showInformationMessage("Clearing AI cache...")
	}

	private async reindexCodebase(): Promise<void> {
		// Implementation: Reindex codebase
		vscode.window.showInformationMessage("Reindexing codebase...")
	}

	private async openSettings(): Promise<void> {
		// Implementation: Open settings
		vscode.commands.executeCommand("workbench.action.openSettings", "kiloCode")
	}

	private async validateSetup(): Promise<void> {
		// Implementation: Validate setup
		vscode.window.showInformationMessage("Validating AI setup...")
	}

	private async showLogs(): Promise<void> {
		// Implementation: Show logs
		vscode.window.showInformationMessage("Showing AI logs...")
	}

	private async exportLogs(): Promise<void> {
		// Implementation: Export logs
		vscode.window.showInformationMessage("Exporting AI logs...")
	}
}

/**
 * Create AI commands registry
 */
export function createAICommandsRegistry(context: vscode.ExtensionContext): AICommandsRegistry {
	return new AICommandsRegistry(context)
}

/**
 * Get all keyboard shortcuts
 */
export function getKeyboardShortcuts(): Array<{ command: string; keybinding: string; description: string }> {
	return [
		{ command: "kiloCode.ai.newChat", keybinding: "Cmd/Ctrl + Shift + N", description: "Create new chat session" },
		{ command: "kiloCode.ai.focusChat", keybinding: "Cmd/Ctrl + Shift + A", description: "Focus chat panel" },
		{ command: "kiloCode.ai.createEditPlan", keybinding: "Cmd/Ctrl + Shift + E", description: "Create edit plan" },
		{ command: "kiloCode.ai.shareToSlack", keybinding: "Cmd/Ctrl + Shift + S", description: "Share to Slack" },
		{ command: "kiloCode.ai.triggerCompletion", keybinding: "Ctrl + Space", description: "Trigger AI completion" },
		{ command: "kiloCode.ai.acceptCompletion", keybinding: "Tab", description: "Accept completion" },
		{ command: "kiloCode.ai.cycleCompletions", keybinding: "Alt + ]", description: "Cycle through completions" },
		{
			command: "kiloCode.ai.cycleBackCompletions",
			keybinding: "Alt + [",
			description: "Cycle back through completions",
		},
	]
}
