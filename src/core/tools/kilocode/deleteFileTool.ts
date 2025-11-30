import path from "path"
import fs from "fs/promises"

import { Task } from "../../task/Task"
import { ClineSayTool } from "../../../shared/ExtensionMessage"
import { formatResponse } from "../../prompts/responses"
import { getReadablePath } from "../../../utils/path"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../../shared/tools"

interface DirectoryStats {
	totalFiles: number
	totalDirs: number
	totalSize: number
}

class DirectoryDeletionBlockedError extends Error {
	constructor(
		public reason: string,
		public blockingFile: string,
	) {
		super(reason)
		this.name = "DirectoryDeletionBlockedError"
	}
}

/**
 * Scans a directory recursively to gather statistics and check for protected files
 * Throws DirectoryDeletionBlockedError immediately when a blocking issue is found
 */
async function scanDirectoryForDeletion(absolutePath: string, cline: Task): Promise<DirectoryStats> {
	const stats: DirectoryStats = {
		totalFiles: 0,
		totalDirs: 0,
		totalSize: 0,
	}

	async function scanRecursive(dirPath: string): Promise<void> {
		const entries = await fs.readdir(dirPath, { withFileTypes: true })

		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name)
			const relativePath = path.relative(cline.cwd, fullPath)

			if (entry.isDirectory() && !entry.isSymbolicLink()) {
				stats.totalDirs++
				await scanRecursive(fullPath)
			} else if (entry.isFile() && !entry.isSymbolicLink()) {
				stats.totalFiles++

				// Check protection - FAIL FAST
				if (cline.rooProtectedController?.isWriteProtected(relativePath)) {
					throw new DirectoryDeletionBlockedError(
						`Cannot delete directory - contains protected file: ${relativePath}`,
						relativePath,
					)
				}

				// Check ignore rules - FAIL FAST
				if (!cline.rooIgnoreController?.validateAccess(relativePath)) {
					throw new DirectoryDeletionBlockedError(
						`Cannot delete directory - contains file blocked by .kilocodeignore: ${relativePath}`,
						relativePath,
					)
				}

				// Accumulate size
				try {
					const fileStats = await fs.stat(fullPath)
					stats.totalSize += fileStats.size
				} catch {
					throw new DirectoryDeletionBlockedError(
						`Cannot access file for deletion: ${relativePath}`,
						relativePath,
					)
				}
			}
		}
	}

	await scanRecursive(absolutePath)
	return stats
}

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
	// Wait for the final path
	if (block.partial) {
		return
	}

	const relPath: string | undefined = block.params.path

	try {
		if (!relPath) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("delete_file")
			pushToolResult(await cline.sayAndCreateMissingParamError("delete_file", "path"))
			return
		}

		// Resolve paths
		const absolutePath = path.resolve(cline.cwd, relPath)
		const relativePath = path.relative(cline.cwd, absolutePath)

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

		const partialMessage = JSON.stringify({
			tool: "deleteFile",
			stats: stats.isDirectory()
				? {
						files: 0,
						directories: 0,
						size: 0,
						isComplete: false,
					}
				: undefined,
			path: getReadablePath(cline.cwd, relPath),
		} satisfies ClineSayTool)
		await cline.ask("tool", partialMessage, true).catch(() => {})

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

		// Directory deletion
		if (stats.isDirectory()) {
			try {
				// Scan directory - will throw if any blocking issues found
				const dirStats = await scanDirectoryForDeletion(absolutePath, cline)

				cline.consecutiveMistakeCount = 0

				// Create approval message with directory stats
				const approvalMessage = JSON.stringify({
					tool: "deleteFile",
					path: getReadablePath(cline.cwd, relPath),
					stats: {
						files: dirStats.totalFiles,
						directories: dirStats.totalDirs,
						size: dirStats.totalSize,
						isComplete: true,
					},
					isOutsideWorkspace: isOutsideWorkspace,
				})

				const didApprove = await askApproval("tool", approvalMessage)
				if (!didApprove) {
					return
				}

				// Delete directory recursively
				await fs.rm(absolutePath, { recursive: true, force: false })

				const successMsg = `Deleted directory: ${relativePath} (${dirStats.totalFiles} files, ${dirStats.totalDirs} subdirectories)`

				pushToolResult(formatResponse.toolResult(successMsg))
				return
			} catch (error) {
				// Handle our custom blocking error
				if (error instanceof DirectoryDeletionBlockedError) {
					cline.consecutiveMistakeCount++
					cline.recordToolError("delete_file")
					await cline.say("error", error.reason)
					pushToolResult(formatResponse.toolError(error.reason))
					return
				}
				// Re-throw other errors to be handled by outer catch
				throw error
			}
		} else {
			// File deletion
			cline.consecutiveMistakeCount = 0

			const approvalMessage = JSON.stringify({
				tool: "deleteFile",
				path: getReadablePath(cline.cwd, relPath),
				isOutsideWorkspace: isOutsideWorkspace,
			} satisfies ClineSayTool)

			const didApprove = await askApproval("tool", approvalMessage)
			if (!didApprove) {
				return
			}

			await fs.unlink(absolutePath)

			const successMsg = `Deleted file: ${relativePath}`
			pushToolResult(formatResponse.toolResult(successMsg))
		}
	} catch (error) {
		await handleError("deleting file", error)
	}
}
