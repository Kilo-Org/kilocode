// kilocode_change - new file
import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { BaseTool, ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"

interface SubagentParams {
	description: string
	prompt: string
	subagent_type: "explore" | "general"
}

export class SubagentTool extends BaseTool<"subagent"> {
	readonly name = "subagent" as const

	parseLegacy(params: Partial<Record<string, string>>): SubagentParams {
		return {
			description: params.description || "",
			prompt: params.prompt || "",
			subagent_type: (params.subagent_type as "explore" | "general") || "general",
		}
	}

	async execute(params: SubagentParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { description, prompt, subagent_type } = params
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		try {
			// Validate required parameters
			if (!description) {
				task.consecutiveMistakeCount++
				task.recordToolError("subagent")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("subagent", "description"))
				return
			}

			if (!prompt) {
				task.consecutiveMistakeCount++
				task.recordToolError("subagent")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("subagent", "prompt"))
				return
			}

			// Validate subagent_type
			if (subagent_type !== "explore" && subagent_type !== "general") {
				task.consecutiveMistakeCount++
				task.recordToolError("subagent")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError("subagent_type must be 'explore' or 'general'"))
				return
			}

			task.consecutiveMistakeCount = 0

			// Ask user approval
			const toolMessage = JSON.stringify({
				tool: "subagent",
				description,
				prompt,
				subagent_type,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Show launch message
			await task.say("text", `Launch Subagent: ${description}`)

			// Get provider and spawn subagent
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			// Spawn subagent task
			// Explore mode uses read-only settings, general mode uses current mode
			const spawnResult = await (provider as any).spawnSubagent({
				description,
				prompt,
				subagent_type,
				parentTaskId: task.taskId,
			})

			// Push result with subagent ID
			pushToolResult(
				`Subagent spawned with ID: ${spawnResult.subagentTaskId}. It is now running in the background. When complete, the result will be returned here.`,
			)
		} catch (error) {
			await handleError("spawning subagent", error)
			return
		}
	}
}

export const subagentTool = new SubagentTool()
