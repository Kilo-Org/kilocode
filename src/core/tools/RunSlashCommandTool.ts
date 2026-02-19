// kilocode_change start
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getCommand, getCommandNames } from "../../services/command/commands"
import { getWorkflow, getWorkflowNames } from "../../services/workflow/workflows"
import type { Command } from "../../services/command/commands"
import type { Workflow } from "../../services/workflow/workflows"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getModeBySlug } from "../../shared/modes"

// Unified type for slash commands (commands + workflows)
type SlashCommand = Command | Workflow

/**
 * Get a slash command or workflow by name
 * Priority: commands > workflows
 */
async function getSlashCommand(cwd: string, name: string): Promise<SlashCommand | undefined> {
	// Try commands first (more specific intent)
	const command = await getCommand(cwd, name)
	if (command) return command

	// Fall back to workflows
	return await getWorkflow(cwd, name)
}

/**
 * Get all slash command names (commands + workflows)
 */
async function getSlashCommandNames(cwd: string): Promise<string[]> {
	const [commands, workflows] = await Promise.all([getCommandNames(cwd), getWorkflowNames(cwd)])

	// Merge and dedupe (commands take priority in naming)
	return [...new Set([...commands, ...workflows])]
}
// kilocode_change end

interface RunSlashCommandParams {
	command: string
	args?: string
}

export class RunSlashCommandTool extends BaseTool<"run_slash_command"> {
	readonly name = "run_slash_command" as const

	parseLegacy(params: Partial<Record<string, string>>): RunSlashCommandParams {
		return {
			command: params.command || "",
			args: params.args,
		}
	}

	async execute(params: RunSlashCommandParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { command: commandName, args } = params
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		// Check if auto-execute workflow experiment is enabled
		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isAutoExecuteEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.AUTO_EXECUTE_WORKFLOW,
		)

		try {
			if (!commandName) {
				task.consecutiveMistakeCount++
				task.recordToolError("run_slash_command")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("run_slash_command", "command"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Get the slash command (command or workflow) using unified lookup
			const slashCommand = await getSlashCommand(task.cwd, commandName)

			if (!slashCommand) {
				// Get available slash commands for error message
				const availableCommands = await getSlashCommandNames(task.cwd)
				task.recordToolError("run_slash_command")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Slash command '${commandName}' not found. Available slash commands: ${availableCommands.join(", ") || "(none)"}`,
					),
				)
				return
			}

			const toolMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: commandName,
				args: args,
				source: slashCommand.source,
				description: slashCommand.description,
				mode: slashCommand.mode,
			})

			// kilocode_change: Fix workflow display bug - always send tool message to webview even when auto-execute is enabled
			// This ensures that user can see what workflow is being executed
			// If auto-execute is disabled, wait for approval
			// If auto-execute is enabled, still send message but don't wait for approval
			if (!isAutoExecuteEnabled) {
				const didApprove = await askApproval("tool", toolMessage)
				if (!didApprove) {
					return
				}
			} else {
				// kilocode_change: When auto-execute is enabled, send message to webview without waiting for approval
				// This ensures that workflow tool UI is displayed even when auto-executing
				await task.ask("tool", toolMessage, false).catch(() => {})
			}
			// kilocode_change end

			// Switch mode if specified in the slash command frontmatter
			if (slashCommand.mode) {
				const provider = task.providerRef.deref()
				const targetMode = getModeBySlug(slashCommand.mode, (await provider?.getState())?.customModes)
				if (targetMode) {
					await provider?.handleModeSwitch(slashCommand.mode)
				}
			}

			// kilocode_change: Update message text with complete tool result content
			// Build the result message with complete slash command data
			let result = `Slash command: /${commandName}`

			if (slashCommand.description) {
				result += `\nDescription: ${slashCommand.description}`
			}

			// Handle both argumentHint (commands) and arguments (workflows)
			if (slashCommand.argumentHint) {
				result += `\nArguments: ${slashCommand.argumentHint}`
			} else if (slashCommand.arguments) {
				result += `\nArguments: ${slashCommand.arguments}`
			}

			if (slashCommand.mode) {
				result += `\nMode: ${slashCommand.mode}`
			}

			if (args) {
				result += `\nProvided arguments: ${args}`
			}

			result += `\nSource: ${slashCommand.source}`
			result += `\n\n--- Content ---\n\n${slashCommand.content}`

			// Return the slash command content as the tool result
			pushToolResult(result)
		} catch (error) {
			await handleError("running slash command", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"run_slash_command">): Promise<void> {
		const commandName: string | undefined = block.params.command
		const args: string | undefined = block.params.args

		// kilocode_change: Fix slash command display bug - include complete command/workflow data when transitioning to complete
		// When transitioning from partial to complete (block.partial === false), we need to include
		// the complete command/workflow data (source, description) in the message text.
		// Without this, the tool object parsed from message.text still contains the old partial
		// tool message data, which causes SlashCommandItem to render it incorrectly
		// (e.g., showing partial=true when the command is actually complete).
		if (!block.partial) {
			// Transitioning to complete - fetch and include complete slash command data
			const slashCommand = await getSlashCommand(task.cwd, commandName || "")
			const completeMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: commandName,
				args: args,
				source: slashCommand?.source,
				description: slashCommand?.description,
			})
			// kilocode_change: Add diagnostic logging for slash command tool display issue
			console.log(`[RunSlashCommandTool.handlePartial] Sending COMPLETE message to webview:`, completeMessage)
			await task.ask("tool", completeMessage, false).catch(() => {})
			console.log(`[RunSlashCommandTool.handlePartial] COMPLETE message sent successfully`)
			// kilocode_change end
		} else {
			// Partial message - use minimal data structure
			const partialMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: this.removeClosingTag("command", commandName, block.partial),
				args: this.removeClosingTag("args", args, block.partial),
			})
			// kilocode_change: Add diagnostic logging for slash command tool display issue
			console.log(`[RunSlashCommandTool.handlePartial] Sending PARTIAL message to webview:`, partialMessage)
			await task.ask("tool", partialMessage, block.partial).catch(() => {})
			console.log(`[RunSlashCommandTool.handlePartial] PARTIAL message sent successfully`)
			// kilocode_change end
		}
		// kilocode_change end
	}
}

export const runSlashCommandTool = new RunSlashCommandTool()
