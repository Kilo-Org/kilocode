import path from "path"
import fs from "fs/promises"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"

/**
 * Implements the delete_file tool.
 */

export async function deleteFileTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const relPath: string | undefined = block.params.path

	try {
		if (relPath && relPath.trim() != "") {
			const partialMessage = JSON.stringify({
				tool: "deleteFile",
				path: getReadablePath(cline.cwd, relPath),
			} satisfies ClineSayTool)
			await cline.ask("tool", partialMessage, true).catch(() => {})
		}

		// Wait for the final path
		if (block.partial) {
			return
		}

		if (!relPath) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			pushToolResult(await cline.sayAndCreateMissingParamError("delete_file", "path"))
			return
		}

		// Resolve paths
		const absolutePath = path.resolve(cline.cwd, relPath)
		const relativePath = path.relative(cline.cwd, absolutePath)

		// Validate access
		const accessAllowed = cline.rooIgnoreController?.validateAccess(relativePath)

		if (!accessAllowed) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			const errorMsg = formatResponse.rooIgnoreError(relativePath)
			await cline.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		// Check if file is write-protected
		const isWriteProtected = cline.rooProtectedController?.isWriteProtected(relativePath) || false

		if (isWriteProtected) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			const errorMsg = `Cannot delete write-protected file: ${relativePath}`
			await cline.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		// Check workspace boundary
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)
		if (isOutsideWorkspace) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			const errorMsg = `Cannot delete files outside workspace. Path: ${relativePath}`
			await cline.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		let stats
		try {
			stats = await fs.stat(absolutePath)
		} catch (error) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			const errorMsg = `File or directory does not exist: ${relativePath}`
			await cline.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		// Don't allow directory deletion yet
		if (stats.isDirectory()) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			const errorMsg = `Cannot delete a directory`
			await cline.say("error", errorMsg)
			pushToolResult(formatResponse.toolError(errorMsg))
			return
		}

		cline.consecutiveMistakeCount = 0

		const approvalMessage = JSON.stringify({
			tool: "deleteFile",
			path: getReadablePath(cline.cwd, relativePath),
			isOutsideWorkspace: isOutsideWorkspace,
		} satisfies ClineSayTool)

		const didApprove = await askApproval("tool", approvalMessage)
		if (!didApprove) {
			return
		}

		await fs.unlink(absolutePath)

		const successMsg = `Deleted file: ${relativePath}`
		pushToolResult(formatResponse.toolResult(successMsg))
	} catch (error) {
		await handleError("deleting file", error)
	}
}
