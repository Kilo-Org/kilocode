import * as path from "path"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { listFiles } from "../../services/glob/list-files"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface ListFilesParams {
	path: string
	recursive?: boolean
}

export class ListFilesTool extends BaseTool<"list_files"> {
	readonly name = "list_files" as const

	parseLegacy(params: Partial<Record<string, string>>): ListFilesParams {
		const recursiveRaw: string | undefined = params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		return {
			path: params.path || "",
			recursive,
		}
	}

	async execute(params: ListFilesParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { path: relDirPath, recursive } = params
		const { askApproval, handleError, pushToolResult, removeClosingTag } = callbacks

		try {
			if (!relDirPath) {
				task.consecutiveMistakeCount++
				task.recordToolError("list_files")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("list_files", "path"))
				return
			}

			task.consecutiveMistakeCount = 0

			const absolutePath = path.resolve(task.cwd, relDirPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const [files, didHitLimit] = await listFiles(absolutePath, recursive || false, 200)
			const { showRooIgnoredFiles = false } = (await task.providerRef.deref()?.getState()) ?? {}

			const result = formatResponse.formatFilesList(
				absolutePath,
				files,
				didHitLimit,
				task.rooIgnoreController,
				showRooIgnoredFiles,
				task.rooProtectedController,
			)

			const sharedMessageProps: ClineSayTool = {
				tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
				path: getReadablePath(task.cwd, relDirPath),
				isOutsideWorkspace,
			}

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: result } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(result)
		} catch (error) {
			await handleError("listing files", error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"list_files">): Promise<void> {
		const relDirPath: string | undefined = block.params.path
		const recursiveRaw: string | undefined = block.params.recursive
		const recursive = recursiveRaw?.toLowerCase() === "true"

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

		const sharedMessageProps: ClineSayTool = {
			tool: !recursive ? "listFilesTopLevel" : "listFilesRecursive",
			path: getReadablePath(task.cwd, this.removeClosingTag("path", relDirPath, block.partial)),
			isOutsideWorkspace,
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const listFilesTool = new ListFilesTool()
