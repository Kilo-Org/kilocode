// kilocode_change start
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getWorkflow, getWorkflowNames } from "../../services/workflow/workflows"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
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

			// Get the workflow from the workflows service
			const workflow = await getWorkflow(task.cwd, commandName)

			if (!workflow) {
				// Get available workflows for error message
				const availableWorkflows = await getWorkflowNames(task.cwd)
				task.recordToolError("run_slash_command")
				task.didToolFailInCurrentTurn = true
				pushToolResult(
					formatResponse.toolError(
						`Workflow '${commandName}' not found. Available workflows: ${availableWorkflows.join(", ") || "(none)"}`,
					),
				)
				return
			}

			const toolMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: commandName,
				args: args,
				source: workflow.source,
				description: workflow.description,
			})

			// If auto-execute is disabled, ask for approval
			// If auto-execute is enabled, skip approval and execute immediately
			if (!isAutoExecuteEnabled) {
				const didApprove = await askApproval("tool", toolMessage)

				if (!didApprove) {
					return
				}
			}

			// Build the result message
			let result = `Workflow: /${commandName}`

			if (workflow.description) {
				result += `\nDescription: ${workflow.description}`
			}

			if (workflow.arguments) {
				result += `\nArguments: ${workflow.arguments}`
			}

			if (args) {
				result += `\nProvided arguments: ${args}`
			}

			result += `\nSource: ${workflow.source}`
			result += `\n\n--- Workflow Content ---\n\n${workflow.content}`

			// Return the workflow content as the tool result
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
