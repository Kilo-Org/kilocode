// kilocode_change start
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getWorkflow, getWorkflowNames } from "../../services/workflow/workflows"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { getModeBySlug } from "../../shared/modes"
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

			// kilocode_change: Fix workflow display bug - send complete workflow data BEFORE approval flow
			// This ensures the webview transitions from partial to complete state correctly
			const toolMessage = JSON.stringify({
				tool: "runSlashCommand",
				command: commandName,
				args: args,
				source: workflow.source,
				description: workflow.description,
				mode: workflow.mode,
			})

			// Send complete tool message to webview BEFORE approval flow
			// This fixes the display bug where SlashCommandItem was stuck on partial=true
			await task.ask("tool", toolMessage, false).catch(() => {})

			// If auto-execute is disabled, wait for approval
			if (!isAutoExecuteEnabled) {
				const didApprove = await askApproval("tool", toolMessage)
				if (!didApprove) {
					return
				}
			}
			// kilocode_change end

			// Switch mode if specified in the workflow frontmatter
			if (workflow.mode) {
				const provider = task.providerRef.deref()
				const targetMode = getModeBySlug(workflow.mode, (await provider?.getState())?.customModes)
				if (targetMode) {
					await provider?.handleModeSwitch(workflow.mode)
				}
			}

			// kilocode_change: Update message text with complete tool result content
			// Build the result message with complete workflow data
			let result = `Workflow: /${commandName}`

			if (workflow.description) {
				result += `\nDescription: ${workflow.description}`
			}

			if (workflow.arguments) {
				result += `\nArguments: ${workflow.arguments}`
			}

			if (workflow.mode) {
				result += `\nMode: ${workflow.mode}`
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

		// kilocode_change: Send partial workflow data during streaming
		const partialMessage = JSON.stringify({
			tool: "runSlashCommand",
			command: this.removeClosingTag("command", commandName, block.partial),
			args: this.removeClosingTag("args", args, block.partial),
		})
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
		// kilocode_change end
	}
}

export const runSlashCommandTool = new RunSlashCommandTool()
