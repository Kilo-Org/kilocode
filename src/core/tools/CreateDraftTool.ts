// kilocode_change - new file
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { getDraftFileSystem } from "../../services/planning"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface CreateDraftParams {
	title: string
	content: string
}

export class CreateDraftTool extends BaseTool<"create_draft"> {
	readonly name = "create_draft" as const

	parseLegacy(params: Partial<Record<string, string>>): CreateDraftParams {
		return {
			title: params.title || "",
			content: params.content || "",
		}
	}

	async execute(params: CreateDraftParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { title, content } = params
		const { handleError, pushToolResult } = callbacks

		console.log("📝 [CreateDraftTool] execute title=", title, "contentLength=", content.length)

		// Validate required parameters
		if (!title) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_draft")
			pushToolResult(await task.sayAndCreateMissingParamError("create_draft", "title"))
			return
		}

		if (content === undefined || content === null) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_draft")
			pushToolResult(await task.sayAndCreateMissingParamError("create_draft", "content"))
			return
		}

		// Validate title length
		if (title.length > 255) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_draft")
			pushToolResult(formatResponse.toolError("Title must be 255 characters or less"))
			return
		}

		// Validate content is not too large (prevent memory issues)
		if (content.length > 1000000) {
			task.consecutiveMistakeCount++
			task.recordToolError("create_draft")
			pushToolResult(formatResponse.toolError("Content must be 1MB or less"))
			return
		}

		task.consecutiveMistakeCount = 0

		try {
			const fs = getDraftFileSystem()
			console.log("📝 [CreateDraftTool] calling fs.createAndOpen")
			const draftPath = await fs.createAndOpen(title, content)
			console.log("📝 [CreateDraftTool] fs.createAndOpen returned draftPath=", draftPath)

			// Return success message with instructions
			const message = `Created draft document "${title}". The document has been opened in an editor tab.\n\nYou can now:\n- Read it using: read_file with path "${draftPath}"\n- Update it using: write_to_file with path "${draftPath}"\n\nThe document will be discarded when the editor session ends.`

			pushToolResult(formatResponse.toolResult(message))
			task.recordToolUsage("create_draft")
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			console.log("📝 [CreateDraftTool] error=", errorMessage)
			pushToolResult(formatResponse.toolError(`Failed to create draft document: ${errorMessage}`))
			await handleError("creating draft document", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"create_draft">): Promise<void> {
		// Show "Creating draft..." message during streaming
		const title = this.removeClosingTag("title", block.params.title, block.partial)
		const content = this.removeClosingTag("content", block.params.content, block.partial)

		if (title) {
			const partialMessage = JSON.stringify({
				tool: "createDraft",
				title: title,
				content: content,
			})

			await task.ask("tool", partialMessage, block.partial).catch(() => {})
		}
	}
}

export const createDraftTool = new CreateDraftTool()
