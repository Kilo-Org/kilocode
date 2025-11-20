// Core Node.js imports
import path from "path"
import fs from "fs/promises"
import z from "zod/v4"

// Internal imports
import { Task } from "../../task/Task"
import { AskApproval, HandleError, PushToolResult, ToolUse } from "../../../shared/tools"
import { formatResponse } from "../../prompts/responses"
import { ClineSayTool } from "../../../shared/ExtensionMessage"
import { getReadablePath } from "../../../utils/path"
import { fileExistsAtPath } from "../../../utils/fs"
import { RecordSource } from "../../context-tracking/FileContextTrackerTypes"
import { DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"
import { EXPERIMENT_IDS, experiments } from "../../../shared/experiments"
import {
	SearchAndReplaceParameters,
	SearchAndReplaceParametersSchema,
} from "../../prompts/tools/native-tools/search_and_replace"

/**
 * Tool for performing search and replace operations on files
 * Supports regex and case-sensitive/insensitive matching
 */

/**
 * Validates required parameters for search and replace operation
 */
async function validateParams(
	cline: Task,
	block: ToolUse,
	pushToolResult: PushToolResult,
): Promise<SearchAndReplaceParameters | null> {
	const args = SearchAndReplaceParametersSchema.safeParse(block.params)
	if (!args.success) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("apply_diff", "schema_violation")
		pushToolResult(
			formatResponse.toolError("Tool arguments do not follow the schema:\n" + z.prettifyError(args.error)),
		)
		return null
	}
	if (args.data.old_str === args.data.new_str) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("apply_diff", "strings_identical")
		pushToolResult(formatResponse.toolError("old_str and new_str are identical"))
		return null
	}
	return args.data
}

/**
 * Performs search and replace operations on a file
 * @param cline - Cline instance
 * @param block - Tool use parameters
 * @param askApproval - Function to request user approval
 * @param handleError - Function to handle errors
 * @param pushToolResult - Function to push tool results
 * @param removeClosingTag - Function to remove closing tags
 */
export async function searchAndReplaceTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
): Promise<void> {
	try {
		if (block.partial) {
			return
		}

		// Validate required parameters
		const params = await validateParams(cline, block, pushToolResult)
		if (!params) {
			return
		}

		// At this point we know relPath, search and replace are defined
		const validRelPath = params.path

		const sharedMessageProps: ClineSayTool = {
			tool: "appliedDiff",
			path: getReadablePath(cline.cwd, validRelPath),
		}

		const accessAllowed = cline.rooIgnoreController?.validateAccess(validRelPath)

		if (!accessAllowed) {
			await cline.say("rooignore_error", validRelPath)
			pushToolResult(formatResponse.toolError(formatResponse.rooIgnoreError(validRelPath)))
			return
		}

		// Check if file is write-protected
		const isWriteProtected = cline.rooProtectedController?.isWriteProtected(validRelPath) || false

		const absolutePath = path.resolve(cline.cwd, validRelPath)
		const fileExists = await fileExistsAtPath(absolutePath)

		if (!fileExists) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("apply_diff", "file_does_not_exist")
			const formattedError = formatResponse.toolError(
				`File does not exist at path: ${absolutePath}\nThe specified file could not be found. Please verify the file path and try again.`,
			)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		// Reset consecutive mistakes since all validations passed
		cline.consecutiveMistakeCount = 0

		// Read and process file content
		let fileContent: string
		try {
			fileContent = await fs.readFile(absolutePath, "utf-8")
		} catch (error) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("apply_diff", "exception")
			const errorMessage = `Error reading file: ${absolutePath}\nFailed to read the file content: ${
				error instanceof Error ? error.message : String(error)
			}\nPlease verify file permissions and try again.`
			const formattedError = formatResponse.toolError(errorMessage)
			await cline.say("error", formattedError)
			pushToolResult(formattedError)
			return
		}

		const useCrLf = fileContent.includes("\r\n")
		const validSearch = params.old_str.replaceAll(/\r*\n/g, useCrLf ? "\r\n" : "\n")
		const validReplace = params.new_str.replaceAll(/\r*\n/g, useCrLf ? "\r\n" : "\n")

		// Create search pattern and perform replacement
		const searchPattern = new RegExp(escapeRegExp(validSearch), "g")

		const matchCount = fileContent.match(searchPattern)?.length ?? 0
		if (matchCount > 1) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("apply_diff", "multiple_matches")
			pushToolResult(
				formatResponse.toolError(
					`Found ${matchCount} matches for replacement text. Please provide more context to make a unique match.`,
				),
			)
		}

		const newContent = fileContent.replace(searchPattern, validReplace)

		// Initialize diff view
		cline.diffViewProvider.editType = "modify"
		cline.diffViewProvider.originalContent = fileContent

		// Generate and validate diff
		const diff = formatResponse.createPrettyPatch(validRelPath, fileContent, newContent)
		if (!diff) {
			cline.consecutiveMistakeCount++
			cline.recordToolError("apply_diff", "no_match")
			pushToolResult(
				formatResponse.toolError(
					`No match found for replacement in '${validRelPath}'. Please check your text and try again.`,
				),
			)
			await cline.diffViewProvider.reset()
			return
		}

		// Check if preventFocusDisruption experiment is enabled
		const provider = cline.providerRef.deref()
		const state = await provider?.getState()
		const diagnosticsEnabled = state?.diagnosticsEnabled ?? true
		const writeDelayMs = state?.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS
		const isPreventFocusDisruptionEnabled = experiments.isEnabled(
			state?.experiments ?? {},
			EXPERIMENT_IDS.PREVENT_FOCUS_DISRUPTION,
		)

		const completeMessage = JSON.stringify({
			...sharedMessageProps,
			diff,
			isProtected: isWriteProtected,
		} satisfies ClineSayTool)

		// Show diff view if focus disruption prevention is disabled
		if (!isPreventFocusDisruptionEnabled) {
			await cline.diffViewProvider.open(validRelPath)
			await cline.diffViewProvider.update(newContent, true)
			cline.diffViewProvider.scrollToFirstDiff()
		}

		const didApprove = await askApproval("tool", completeMessage, undefined, isWriteProtected)

		if (!didApprove) {
			// Revert changes if diff view was shown
			if (!isPreventFocusDisruptionEnabled) {
				await cline.diffViewProvider.revertChanges()
			}
			pushToolResult("Changes were rejected by the user.")
			await cline.diffViewProvider.reset()
			return
		}

		// Save the changes
		if (isPreventFocusDisruptionEnabled) {
			// Direct file write without diff view or opening the file
			await cline.diffViewProvider.saveDirectly(validRelPath, newContent, false, diagnosticsEnabled, writeDelayMs)
		} else {
			// Call saveChanges to update the DiffViewProvider properties
			await cline.diffViewProvider.saveChanges(diagnosticsEnabled, writeDelayMs)
		}

		// Track file edit operation
		if (validRelPath) {
			await cline.fileContextTracker.trackFileContext(validRelPath, "roo_edited" as RecordSource)
		}

		cline.didEditFile = true

		// Get the formatted response message
		const message = await cline.diffViewProvider.pushToolWriteResult(
			cline,
			cline.cwd,
			false, // Always false for search_and_replace
		)

		pushToolResult(message)

		// Record successful tool usage and cleanup
		cline.recordToolUsage("apply_diff")
		await cline.diffViewProvider.reset()

		// Process any queued messages after file edit completes
		cline.processQueuedMessages()
	} catch (error) {
		handleError("applying diff", error)
		await cline.diffViewProvider.reset()
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
