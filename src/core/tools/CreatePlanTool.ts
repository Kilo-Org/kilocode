// kilocode_change - new file
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getPlanFileSystem } from "../../services/planning"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface CreatePlanParams {
	title: string
	content: string
}

export class CreatePlanTool extends BaseTool<"create_plan"> {
	readonly name = "create_plan" as const

	parseLegacy(params: Partial<Record<string, string>>): CreatePlanParams {
		return {
			title: params.title || "",
			content: params.content || "",
		}
	}

	async execute(params: CreatePlanParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { title, content } = params
		const { handleError, pushToolResult } = callbacks

		// Validate required parameters
		if (!title) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_plan")
			pushToolResult(await task.sayAndCreateMissingParamError("create_plan", "title"))
			return
		}

		if (content === undefined || content === null) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_plan")
			pushToolResult(await task.sayAndCreateMissingParamError("create_plan", "content"))
			return
		}

		// Validate title length
		if (title.length > 255) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_plan")
			pushToolResult(formatResponse.toolError("Title must be 255 characters or less"))
			return
		}

		// Validate content is not too large (prevent memory issues)
		if (content.length > 1000000) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_plan")
			pushToolResult(formatResponse.toolError("Content must be 1MB or less"))
			return
		}

		task.consecutiveMistakeCount = 0

		try {
			const fs = getPlanFileSystem()
			const planPath = await fs.createAndOpen(title, content)

			// Return success message with instructions
			const message = `Created plan document "${title}". The document has been opened in an editor tab.\n\nYou can now:\n- Read it using: read_file with path "${planPath}"\n- Update it using: write_to_file with path "${planPath}"\n\nThe document will be discarded when the editor session ends.`

			pushToolResult(formatResponse.toolResult(message))
			task.recordToolUsage("create_plan")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			pushToolResult(formatResponse.toolError(`Failed to create plan document: ${errorMessage}`))
			await handleError("creating plan document", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"create_plan">): Promise<void> {
		// Show "Creating plan..." message during streaming
		const title = this.removeClosingTag("title", block.params.title, block.partial)
		const content = this.removeClosingTag("content", block.params.content, block.partial)

		if (title) {
			const partialMessage = JSON.stringify({
				tool: "createPlan",
				title: title,
				content: content,
			})

			await task.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}
}

export const createPlanTool = new CreatePlanTool()
