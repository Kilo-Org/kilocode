import fs from "fs/promises"
import path from "path"

import { getReadablePath } from "../../utils/path"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { insertGroups } from "../diff/insert-groups"
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { convertNewFileToUnifiedDiff, computeDiffStats, sanitizeUnifiedDiff } from "../diff/stats"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface InsertContentParams {
	path: string
	line: number
	content: string
}

export class InsertContentTool extends BaseTool<"insert_content"> {
	readonly name = "insert_content" as const

	parseLegacy(params: Partial<Record<string, string>>): InsertContentParams {
		const relPath = params.path || ""
		const lineStr = params.line || ""
		const content = params.content || ""

		const lineNumber = parseInt(lineStr, 10)

		return {
			path: relPath,
			line: lineNumber,
			content: content,
		}
	}

	async execute(params: InsertContentParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { path: relPath, line: lineNumber, content } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// Validate required parameters
			if (!relPath) {
				task.consecutiveMistakeCount++
				task.recordToolError("insert_content")
				pushToolResult(await task.sayAndCreateMissingParamError("insert_content", "path"))
				return
			}

			if (isNaN(lineNumber) || lineNumber < 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("insert_content")
				pushToolResult(formatResponse.toolError("Invalid line number. Must be a non-negative integer."))
				return
			}

			if (content === undefined) {
				task.consecutiveMistakeCount++
				task.recordToolError("insert_content")
				pushToolResult(await task.sayAndCreateMissingParamError("insert_content", "content"))
				return
			}

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(relPath)))
				return
			}

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const absolutePath = path.resolve(task.cwd, relPath)

			const fileExists = await fileExistsAtPath(absolutePath)
			let fileContent: string = ""
			if (!fileExists) {
				if (lineNumber > 1) {
					task.consecutiveMistakeCount++
					task.recordToolError("insert_content")
					const formattedError = `Cannot insert content at line ${lineNumber} into a non-existent file. For new files, 'line' must be 0 (to append) or 1 (to insert at the beginning).`
					await task.say("error", formattedError)
					pushToolResult(formattedError)
					return
				}
			} else {
				fileContent = await fs.readFile(absolutePath, "utf8")
			}

			task.consecutiveMistakeCount = 0

			task.diffViewProvider.editType = fileExists ? "modify" : "create"
			task.diffViewProvider.originalContent = fileContent
			const lines = fileExists ? fileContent.split("\n") : []

			let updatedContent = insertGroups(lines, [
				{
					index: lineNumber - 1,
					elements: content.split("\n"),
				},
			]).join("\n")

			// Check if preventFocusDisruption experiment is enabled
			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)

			// Build unified diff for display (normalize EOLs only for diff generation)
			let unified: string
			if (fileExists) {
				const oldForDiff = fileContent.replace(/\r\n/g, "\n")
				const newForDiff = updatedContent.replace(/\r\n/g, "\n")
				unified = formatResponse.createPrettyPatch(relPath, oldForDiff, newForDiff)
				if (!unified) {
					pushToolResult(`No changes needed for '${relPath}'`)
					return
				}
			} else {
				const newForDiff = updatedContent.replace(/\r\n/g, "\n")
				unified = convertNewFileToUnifiedDiff(newForDiff, relPath)
			}
			unified = sanitizeUnifiedDiff(unified)
			const diffStats = computeDiffStats(unified) || undefined

			// Prepare the approval message (same for both flows)
			const sharedMessageProps: ClineSayTool = {
				tool: "insertContent",
				path: getReadablePath(task.cwd, relPath),
				diff: content,
				lineNumber: lineNumber,
			}

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				// Send unified diff as content for render-only webview
				content: unified,
				lineNumber: lineNumber,
				isProtected: isWriteProtected,
				diffStats,
			} satisfies ClineSayTool)

			// Show diff view if focus disruption prevention is disabled
			if (!isPreventFocusDisruptionEnabled) {
				await task.diffViewProvider.open(relPath)
				await task.diffViewProvider.update(updatedContent, true)
				task.diffViewProvider.scrollToFirstDiff()
			}

			// Ask for approval (same for both flows)
			const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

			if (!didApprove) {
				// Revert changes if diff view was shown
				if (!isPreventFocusDisruptionEnabled) {
					await task.diffViewProvider.revertChanges()
				}
				pushToolResult("Changes were rejected by the user.")
				await task.diffViewProvider.reset()
				return
			}

			// Save the changes
			if (isPreventFocusDisruptionEnabled) {
				// Direct file write without diff view or opening the file
				await task.diffViewProvider.saveDirectly(
					relPath,
					updatedContent,
					false,
					diagnosticsEnabled,
					writeDelayMs,
				)
			} else {
				// Call saveChanges to update the DiffViewProvider properties
				await task.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
			}

			// Track file edit operation
			if (relPath) {
				await task.fileContextTracker.trackFileContext(relPath, "roo_edited" as RecordSource)
			}

			task.didEditFile = true

			// Get the formatted response message
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, !fileExists)

			pushToolResult(message)

			await task.diffViewProvider.reset()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			await handleError("insert content", error as Error)
			await task.diffViewProvider.reset()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"insert_content">): Promise<void> {
		const relPath: string | undefined = block.params.path
		const line: string | undefined = block.params.line
		const content: string | undefined = block.params.content

		const sharedMessageProps: ClineSayTool = {
			tool: "insertContent",
			path: getReadablePath(task.cwd, relPath || ""),
			diff: content,
			lineNumber: line ? parseInt(line, 10) : undefined,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const insertContentTool = new InsertContentTool()
