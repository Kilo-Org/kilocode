import fs from "fs/promises"
import path from "path"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { normalizeLineEndings_kilocode } from "./kilocode/normalizeLineEndings"

interface SearchReplaceOperation {
	search: string
	replace: string
}

interface SearchAndReplaceParams {
	path: string
	operations: SearchReplaceOperation[]
}

export class SearchAndReplaceTool extends BaseTool<"search_and_replace"> {
	readonly name = "search_and_replace" as const

	parseLegacy(params: Partial<Record<string, string>>): SearchAndReplaceParams {
		// Parse operations from JSON string if provided
		let operations: SearchReplaceOperation[] = []
		if (params.operations) {
			try {
				operations = JSON.parse(params.operations)
			} catch {
				operations = []
			}
		}

		return {
			path: params.path || "",
			operations,
		}
	}

	async execute(params: SearchAndReplaceParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { path: relPath, operations } = params
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		try {
			// Validate required parameters
			if (!relPath) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_and_replace")
				pushToolResult(await task.sayAndCreateMissingParamError("search_and_replace", "path"))
				return
			}

			if (!operations || !Array.isArray(operations) || operations.length === 0) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_and_replace")
				pushToolResult(
					formatResponse.toolError(
						"Missing or empty 'operations' parameter. At least one search/replace operation is required.",
					),
				)
				return
			}

			// Validate each operation has search and replace fields
			for (let i = 0; i < operations.length; i++) {
				const op = operations[i]
				if (!op.search) {
					task.consecutiveMistakeCount++
					task.recordToolError("search_and_replace")
					pushToolResult(formatResponse.toolError(`Operation ${i + 1} is missing the 'search' field.`))
					return
				}
				if (op.replace === undefined) {
					task.consecutiveMistakeCount++
					task.recordToolError("search_and_replace")
					pushToolResult(formatResponse.toolError(`Operation ${i + 1} is missing the 'replace' field.`))
					return
				}
			}

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol))
				return
			}

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const absolutePath = path.resolve(task.cwd, relPath)

			const fileExists = await fileExistsAtPath(absolutePath)
			if (!fileExists) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_and_replace")
				const errorMessage = `File not found: ${relPath}. Cannot perform search and replace on a non-existent file.`
				await task.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			let fileContent: string
			try {
				fileContent = await fs.readFile(absolutePath, "utf8")
			} catch (error) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_and_replace")
				const errorMessage = `Failed to read file '${relPath}'. Please verify file permissions and try again.`
				await task.say("error", errorMessage)
				pushToolResult(formatResponse.toolError(errorMessage))
				return
			}

			const useCrLf_kilocode = fileContent.includes("\r\n")

			// Apply all operations sequentially
			let newContent = fileContent
			const errors: string[] = []

			for (let i = 0; i < operations.length; i++) {
				const { search, replace } = operations[i]
				const searchPattern = new RegExp(
					escapeRegExp(normalizeLineEndings_kilocode(search, useCrLf_kilocode)),
					"g",
				)

				const matchCount = newContent.match(searchPattern)?.length ?? 0
				if (matchCount === 0) {
					errors.push(`Operation ${i + 1}: No match found for search text.`)
					continue
				}

				if (matchCount > 1) {
					errors.push(
						`Operation ${i + 1}: Found ${matchCount} matches. Please provide more context to make a unique match.`,
					)
					continue
				}

				// Apply the replacement
				newContent = newContent.replace(searchPattern, normalizeLineEndings_kilocode(replace, useCrLf_kilocode))
			}

			// If all operations failed, return error
			if (errors.length === operations.length) {
				task.consecutiveMistakeCount++
				task.recordToolError("search_and_replace", "no_match")
				pushToolResult(formatResponse.toolError(`All operations failed:\n${errors.join("\n")}`))
				return
			}

			// Check if any changes were made
			if (newContent === fileContent) {
				pushToolResult(`No changes needed for '${relPath}'`)
				return
			}

			task.consecutiveMistakeCount = 0

			// Initialize diff view
			task.diffViewProvider.editType = "modify"
			task.diffViewProvider.originalContent = fileContent

			// Generate and validate diff
			const diff = formatResponse.createPrettyPatch(relPath, fileContent, newContent)
			if (!diff) {
				pushToolResult(`No changes needed for '${relPath}'`)
				await task.diffViewProvider.reset()
				return
			}

			// Check if preventFocusDisruption experiment is enabled
			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
			const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
			const isPreventFocusDisruptionEnabled = experiments.isEnabled(
				state?.experiments ?? {},
				EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
			)

			const sanitizedDiff = sanitizeUnifiedDiff(diff)
			const diffStats = computeDiffStats(sanitizedDiff) || undefined
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: sanitizedDiff,
				isOutsideWorkspace,
			}

			// Include any partial errors in the message
			let resultMessage = ""
			if (errors.length > 0) {
				resultMessage = `Some operations failed:\n${errors.join("\n")}\n\n`
			}

			const completeMessage = JSON.stringify({
				...sharedMessageProps,
				content: sanitizedDiff,
				isProtected: isWriteProtected,
				diffStats,
			} satisfies ClineSayTool)

			// Show diff view if focus disruption prevention is disabled
			if (!isPreventFocusDisruptionEnabled) {
				await task.diffViewProvider.open(relPath)
				await task.diffViewProvider.update(newContent, true)
				task.diffViewProvider.scrollToFirstDiff()
			}

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
				await task.diffViewProvider.saveDirectly(relPath, newContent, false, diagnosticsEnabled, writeDelayMs)
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
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, false)

			// Add error info if some operations failed
			if (errors.length > 0) {
				pushToolResult(`${resultMessage}${message}`)
			} else {
				pushToolResult(message)
			}

			// Record successful tool usage and cleanup
			task.recordToolUsage("search_and_replace")
			await task.diffViewProvider.reset()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			await handleError("search and replace", error as Error)
			await task.diffViewProvider.reset()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"search_and_replace">): Promise<void> {
		const relPath: string | undefined = block.params.path
		const operationsStr: string | undefined = block.params.operations

		let operationsPreview: string | undefined
		if (operationsStr) {
			try {
				const ops = JSON.parse(operationsStr)
				if (Array.isArray(ops) && ops.length > 0) {
					operationsPreview = `${ops.length} operation(s)`
				}
			} catch {
				operationsPreview = "parsing..."
			}
		}

		const absolutePath = relPath ? path.resolve(task.cwd, relPath) : ""
		const isOutsideWorkspace = absolutePath ? isPathOutsideWorkspace(absolutePath) : false

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath || ""),
			diff: operationsPreview,
			isOutsideWorkspace,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

/**
 * Escapes special regex characters in a string
 * @param input String to escape regex characters in
 * @returns Escaped string safe for regex pattern matching
 */
function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const searchAndReplaceTool = new SearchAndReplaceTool()
