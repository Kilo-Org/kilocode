import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getCommand, getCommandNames } from "../../services/command/commands"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getModeBySlug } from "../../shared/modes"

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

		// Check if run slash command experiment is enabled
		const provider = task.providerRef.deref()
		const state = await provider?.getState()
		const isRunSlashCommandEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.RUN_SLASH_COMMAND,
		)

		if (!isRunSlashCommandEnabled) {
			pushToolResult(
				formatResponse.toolError(
					"Run slash command is an experimental feature that must be enabled in settings. Please enable 'Run Slash Command' in the Experimental Settings section.",
				),
			)
			return
		}

		try {
			if (!commandName) {
				task.consecutiveMistakeCount++
				task.recordToolError("run_slash_command")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("run_slash_command", "command"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Get the command from the commands service
			const command = await getCommand(task.cwd, commandName)

			if (!command) {
				// Get available commands for error message
				const availableCommands = await getCommandNames(task.cwd)
				task.recordToolError("run_slash_command")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Command '${commandName}' not found. Available commands: ${availableCommands.join(", ") || "(none)"}`,
					),
				)
				return
			}

			const toolMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: commandName,
				args: args,
				source: command.source,
				description: command.description,
				mode: command.mode,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Switch mode if specified in the command frontmatter
			if (command.mode) {
				const provider = task.providerRef.deref()
				const targetMode = getModeBySlug(command.mode, (await provider?.getState())?.customModes)
				if (targetMode) {
					await provider?.handleModeSwitch(command.mode)
				}
			}

			// Build the result message
			let result = `Command: /${commandName}`

			if (command.description) {
				result += `\nDescription: ${command.description}`
			}

			if (command.argumentHint) {
				result += `\nArgument hint: ${command.argumentHint}`
			}

			if (command.mode) {
				result += `\nMode: ${command.mode}`
			}

			if (args) {
				result += `\nProvided arguments: ${args}`
			}

			result += `\nSource: ${command.source}`
			result += `\n\n--- Command Content ---\n\n${command.content}`

			// Return the command content as the tool result
			pushToolResult(result)
		} catch (error) {
			await handleError("running slash command", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"run_slash_command">): Promise<void> {
		const commandName: string | undefined = block.params.command
		const args: string | undefined = block.params.args

		const partialMessage = JSON.stringify({
			tool: "runSlashCommand",
			command: this.removeClosingTag("command", commandName, block.partial),
			args: this.removeClosingTag("args", args, block.partial),
		})

		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const runSlashCommandTool = new RunSlashCommandTool()
