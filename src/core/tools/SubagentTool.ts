import {
	SUBAGENT_CANCELLED_MODEL_MESSAGE,
	SUBAGENT_RESULT_CODE_CANCELLED,
	SUBAGENT_STATUS_STARTING,
	SUBAGENT_TOOL_NAMES,
	type RunSubagentInBackgroundParams,
	type SubagentCompletedPayload,
	type SubagentRunningPayload,
	type SubagentStructuredResult,
	isSubagentRunner,
} from "../../shared/subagent"
import type { ToolUse } from "../../shared/tools"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"

interface SubagentParams {
	description: string
	prompt: string
	subagent_type: "general" | "explore"
}

export class SubagentTool extends BaseTool<"subagent"> {
	readonly name = "subagent" as const

	parseLegacy(params: Partial<Record<string, string>>): SubagentParams {
		return {
			description: params.description ?? "",
			prompt: params.prompt ?? "",
			subagent_type: (params.subagent_type === "general" || params.subagent_type === "explore"
				? params.subagent_type
				: "general") as "general" | "explore",
		}
	}

	async execute(params: SubagentParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { description, prompt, subagent_type } = params
		const { handleError, pushToolResult } = callbacks

		const provider = task.providerRef.deref()
		if (!provider || !isSubagentRunner(provider)) {
			pushToolResult(formatResponse.toolError("Provider reference lost"))
			return
		}

		if (!description?.trim()) {
			task.consecutiveMistakeCount++
			task.recordToolError("subagent")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("subagent", "description"))
			return
		}
		if (!prompt?.trim()) {
			task.consecutiveMistakeCount++
			task.recordToolError("subagent")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("subagent", "prompt"))
			return
		}

		task.consecutiveMistakeCount = 0

		const runningPayload: SubagentRunningPayload = {
			tool: SUBAGENT_TOOL_NAMES.running,
			description,
			currentTask: SUBAGENT_STATUS_STARTING,
		}
		const runningText = JSON.stringify(runningPayload)
		const progressStatus = { icon: "sync~spin" }

		await task.say("tool", runningText, undefined, true, undefined, progressStatus, {
			isNonInteractive: true,
		})

		try {
			const runParams: RunSubagentInBackgroundParams = {
				parentTaskId: task.taskId,
				prompt,
				subagentType: subagent_type,
				onProgress: (currentTask) => task.reportSubagentProgress(currentTask),
			}
			const result = await provider.runSubagentInBackground(runParams)

			const isStructured = (r: string | SubagentStructuredResult): r is SubagentStructuredResult =>
				typeof r === "object" && r !== null && "code" in r && "messageKey" in r

			let completedPayload: SubagentCompletedPayload
			let toolResult: string
			if (isStructured(result)) {
				completedPayload = {
					tool: SUBAGENT_TOOL_NAMES.completed,
					description,
					result: SUBAGENT_CANCELLED_MODEL_MESSAGE,
					resultCode: result.code,
					messageKey: result.messageKey,
				}
				toolResult = SUBAGENT_CANCELLED_MODEL_MESSAGE
			} else {
				completedPayload = {
					tool: SUBAGENT_TOOL_NAMES.completed,
					description,
					result,
				}
				toolResult = result
			}
			const completedText = JSON.stringify(completedPayload)
			await task.say("tool", completedText, undefined, false, undefined, undefined, {
				isNonInteractive: true,
			})
			pushToolResult(formatResponse.toolResult(toolResult))
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error)
			const errorPayload: SubagentCompletedPayload = {
				tool: SUBAGENT_TOOL_NAMES.completed,
				description,
				error: errMessage,
			}
			const errorPayloadStr = JSON.stringify(errorPayload)
			await task.say("tool", errorPayloadStr, undefined, false, undefined, undefined, {
				isNonInteractive: true,
			})
			await handleError("running subagent", error instanceof Error ? error : new Error(errMessage))
			pushToolResult(formatResponse.toolError(errMessage))
		}
	}
}

export const subagentTool = new SubagentTool()
