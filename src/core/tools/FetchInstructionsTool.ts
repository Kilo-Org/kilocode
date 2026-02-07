import { type ClineSayTool } from "@roo-code/types"

import { Task } from "../task/Task"
import { fetchInstructions } from "../prompts/instructions/instructions"
import { formatResponse } from "../prompts/responses"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface FetchInstructionsParams {
	task: string
}

export class FetchInstructionsTool extends BaseTool<"fetch_instructions"> {
	readonly name = "fetch_instructions" as const

	parseLegacy(params: Partial<Record<string, string>>): FetchInstructionsParams {
		return {
			task: params.task || "",
		}
	}

	async execute(params: FetchInstructionsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult, askApproval, toolProtocol } = callbacks
		const { task: taskParam } = params

		try {
			if (!taskParam) {
				task.consecutiveMistakeCount++
				task.recordToolError("fetch_instructions")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("fetch_instructions", "task"))
				return
			}

			task.consecutiveMistakeCount = 0

			const completeMessage = JSON.stringify({
				tool: "fetchInstructions",
				content: taskParam,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			// Now fetch the content and provide it to the agent.
			const provider = task.providerRef.deref()
			const mcpHub = provider?.getMcpHub()

			if (!mcpHub) {
				throw new Error("MCP hub not available")
			}

			const diffStrategy = task.diffStrategy
			const context = provider?.context
			const content = await fetchInstructions(taskParam, { mcpHub, diffStrategy, context })

			if (!content) {
				pushToolResult(formatResponse.toolError(`Invalid instructions request: ${taskParam}`))
				return
			}

			pushToolResult(content)
		} catch (error) {
			await handleError("fetch instructions", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"fetch_instructions">): Promise<void> {
		const taskParam: string | undefined = block.params.task
		const sharedMessageProps: ClineSayTool = { tool: "fetchInstructions", content: taskParam }

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: undefined } satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const fetchInstructionsTool = new FetchInstructionsTool()
