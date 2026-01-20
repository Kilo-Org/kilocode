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
import { trackContribution } from "../../services/contribution-tracking/ContributionTrackingService" // kilocode_change

interface EditFileParams {
	file_path: string
	old_string: string
	new_string: string
	expected_replacements?: number
}

/**
 * Count occurrences of a substring in a string.
 * @param str The string to search in
 * @param substr The substring to count
 * @returns Number of non-overlapping occurrences
 */
function countOccurrences(str: string, substr: string): number {
	if (substr === "") return 0
	let count = 0
	let pos = str.indexOf(substr)
	while (pos !== -1) {
		count++
		pos = str.indexOf(substr, pos + substr.length)
	}
	return count
}

/**
 * Safely replace all occurrences of a literal string, handling $ escape sequences.
 * Standard String.replaceAll treats $ specially in the replacement string.
 * This function ensures literal replacement.
 *
 * @param str The original string
 * @param oldString The string to replace
 * @param newString The replacement string
 * @returns The string with all occurrences replaced
 */
function safeLiteralReplace(str: string, oldString: string, newString: string): string {
	if (oldString === "" || !str.includes(oldString)) {
		return str
	}

	// If newString doesn't contain $, we can use replaceAll directly
	if (!newString.includes("$")) {
		return str.replaceAll(oldString, newString)
	}

	// Escape $ to prevent ECMAScript GetSubstitution issues
	// $$ becomes a single $ in the output, so we double-escape
	const escapedNewString = newString.replaceAll("$", "$$$$")
	return str.replaceAll(oldString, escapedNewString)
}

/**
 * Apply a replacement operation.
 *
 * @param currentContent The current file content (null if file doesn't exist)
 * @param oldString The string to replace
 * @param newString The replacement string
 * @param isNewFile Whether this is creating a new file
 * @returns The resulting content
 */
function applyReplacement(
	currentContent: string | null,
	oldString: string,
	newString: string,
	isNewFile: boolean,
): string {
	if (isNewFile) {
		return newString
	}
	// If oldString is empty and it's not a new file, do not modify the content
	if (oldString === "" || currentContent === null) {
		return currentContent ?? ""
	}

	return safeLiteralReplace(currentContent, oldString, newString)
}

export class EditFileTool extends BaseTool<"edit_file"> {
	readonly name = "edit_file" as const

	parseLegacy(params: Partial<Record<string, string>>): EditFileParams {
		return {
			file_path: params.file_path || "",
			old_string: params.old_string || "",
			new_string: params.new_string || "",
			expected_replacements: params.expected_replacements
				? parseInt(params.expected_replacements, 10)
				: undefined,
		}
	}

	async execute(params: EditFileParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { file_path, old_string, new_string, expected_replacements = 1 } = params
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks

		try {
			// Validate required parameters
			if (!file_path) {
				task.consecutiveMistakeCount++
				task.recordToolError("edit_file")
				pushToolResult(await task.sayAndCreateMissingParamError("edit_file", "file_path"))
				return
			}

			// Determine relative path - file_path can be absolute or relative
			let relPath: string
			if (path.isAbsolute(file_path)) {
				relPath = path.relative(task.cwd, file_path)
			} else {
				relPath = file_path
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

			let currentContent: string | null = null
			let isNewFile = false

			// Read file or determine if creating new
			if (fileExists) {
				try {
					currentContent = await fs.readFile(absolutePath, "utf8")
					// Normalize line endings to LF
					currentContent = currentContent.replace(/\r\n/g, "\n")
				} catch (error) {
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file")
					const errorMessage = `Failed to read file '${relPath}'. Please verify file permissions and try again.`
					await task.say("error", errorMessage)
					pushToolResult(formatResponse.toolError(errorMessage, toolProtocol))
					return
				}

				// Check if trying to create a file that already exists
				if (old_string === "") {
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file")
					const errorMessage = `File '${relPath}' already exists. Cannot create a new file with empty old_string when file exists.`
					await task.say("error", errorMessage)
					pushToolResult(formatResponse.toolError(errorMessage, toolProtocol))
					return
				}
			} else {
				// File doesn't exist
				if (old_string === "") {
					// Creating a new file
					isNewFile = true
				} else {
					// Trying to replace in non-existent file
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file")
					const errorMessage = `File not found: ${relPath}. Cannot perform replacement on a non-existent file. Use an empty old_string to create a new file.`
					await task.say("error", errorMessage)
					pushToolResult(formatResponse.toolError(errorMessage, toolProtocol))
					return
				}
			}

			// Validate replacement operation
			if (!isNewFile && currentContent !== null) {
				// Check occurrence count
				const occurrences = countOccurrences(currentContent, old_string)

				if (occurrences === 0) {
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file", "no_match")
					pushToolResult(
						formatResponse.toolError(
							`No match found for the specified 'old_string'. Please ensure it matches the file contents exactly, including all whitespace and indentation.`,
							toolProtocol,
						),
					)
					return
				}

				if (occurrences !== expected_replacements) {
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file", "occurrence_mismatch")
					pushToolResult(
						formatResponse.toolError(
							`Expected ${expected_replacements} occurrence(s) but found ${occurrences}. Please adjust your old_string to match exactly ${expected_replacements} occurrence(s), or set expected_replacements to ${occurrences}.`,
							toolProtocol,
						),
					)
					return
				}

				// Validate that old_string and new_string are different
				if (old_string === new_string) {
					task.consecutiveMistakeCount++
					task.recordToolError("edit_file")
					pushToolResult(
						formatResponse.toolError(
							"No changes to apply. The old_string and new_string are identical.",
							toolProtocol,
						),
					)
					return
				}
			}

			// Apply the replacement
			const newContent = applyReplacement(currentContent, old_string, new_string, isNewFile)

			// Check if any changes were made
			if (!isNewFile && newContent === currentContent) {
				pushToolResult(`No changes needed for '${relPath}'`)
				return
			}

			task.consecutiveMistakeCount = 0

			// Initialize diff view
			task.diffViewProvider.editType = isNewFile ? "create" : "modify"
			task.diffViewProvider.originalContent = currentContent || ""

			// Generate and validate diff
			const diff = formatResponse.createPrettyPatch(relPath, currentContent || "", newContent)
			if (!diff && !isNewFile) {
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

			const sanitizedDiff = sanitizeUnifiedDiff(diff || "")
			const diffStats = computeDiffStats(sanitizedDiff) || undefined
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: isNewFile ? "newFileCreated" : "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: sanitizedDiff,
				isOutsideWorkspace,
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

			// kilocode_change start
			// Track contribution (fire-and-forget)
			trackContribution({
				cwd: task.cwd,
				filePath: relPath,
				originalContent: currentContent || "",
				newContent: newContent,
				status: didApprove ? "accepted" : "rejected",
				taskId: task.taskId,
				organizationId: state?.apiConfiguration?.kilocodeOrganizationId,
				kilocodeToken: state?.apiConfiguration?.kilocodeToken || "",
			})
			// kilocode_change end

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
					newContent,
					isNewFile,
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
			const replacementInfo =
				!isNewFile && expected_replacements > 1 ? ` (${expected_replacements} replacements)` : ""
			const message = await task.diffViewProvider.pushToolWriteResult(task, task.cwd, isNewFile)

			pushToolResult(message + replacementInfo)

			// Record successful tool usage and cleanup
			task.recordToolUsage("edit_file")
			await task.diffViewProvider.reset()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			await handleError("edit_file", error as Error)
			await task.diffViewProvider.reset()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"edit_file">): Promise<void> {
		const filePath: string | undefined = block.params.file_path
		const oldString: string | undefined = block.params.old_string

		let operationPreview: string | undefined
		if (oldString !== undefined) {
			if (oldString === "") {
				operationPreview = "creating new file"
			} else {
				const preview = oldString.length > 50 ? oldString.substring(0, 50) + "..." : oldString
				operationPreview = `replacing: "${preview}"`
			}
		}

		// Determine relative path for display
		let relPath = filePath || ""
		if (filePath && path.isAbsolute(filePath)) {
			relPath = path.relative(task.cwd, filePath)
		}

		const absolutePath = relPath ? path.resolve(task.cwd, relPath) : ""
		const isOutsideWorkspace = absolutePath ? isPathOutsideWorkspace(absolutePath) : false

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(task.cwd, relPath),
			diff: operationPreview,
			isOutsideWorkspace,
		}

		await task.ask("tool", JSON.stringify(sharedMessageProps), block.partial).catch(() => {})
	}
}

export const editFileTool = new EditFileTool()
