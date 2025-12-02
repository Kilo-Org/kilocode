import path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { regexSearchFiles } from "../../services/ripgrep"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string | null
}

export class SearchFilesTool extends BaseTool<"search_files"> {
	readonly name = "search_files" as const

	parseLegacy(params: Partial<Record<string, string>>): SearchFilesParams {
		return {
			path: params.path || "",
			regex: params.regex || "",
			file_pattern: params.file_pattern || undefined,
		}
	}

	async execute(params: SearchFilesParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		const relDirPath = params.path
		const regex = params.regex
		const filePattern = params.file_pattern || undefined

		if (!relDirPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("search_files")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("search_files", "path"))
			return
		}

		if (!regex) {
			task.consecutiveMistakeCount++
			task.recordToolError("search_files")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("search_files", "regex"))
			return
		}

		task.consecutiveMistakeCount = 0

		const absolutePath = path.resolve(task.cwd, relDirPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, relDirPath),
			regex: regex,
			filePattern: filePattern,
			isOutsideWorkspace,
		}

		try {
			const results = await regexSearchFiles(task.cwd, absolutePath, regex, filePattern, task.rooIgnoreController)

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: results } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(results)
		} catch (error) {
			await handleError("searching files", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"search_files">): Promise<void> {
		const relDirPath = block.params.path
		const regex = block.params.regex
		const filePattern = block.params.file_pattern

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, this.removeClosingTag("path", relDirPath, block.partial)),
			regex: this.removeClosingTag("regex", regex, block.partial),
			filePattern: this.removeClosingTag("file_pattern", filePattern, block.partial),
			isOutsideWorkspace,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const searchFilesTool = new SearchFilesTool()
