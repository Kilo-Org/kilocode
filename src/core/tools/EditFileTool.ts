import fs from "fs/promises"
import path from "path"

import { type ClineSayTool, DEFAULT_WRITE_DELAY_MS } from "@roo-code/types"

import { getReadablePath } from "../../utils/path"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { fileExistsAtPath } from "../../utils/fs"
import { EXPERIMENT_IDS, experiments } from "../../shared/experiments"
import { sanitizeUnifiedDiff, computeDiffStats } from "../diff/stats"
import type { ToolUse } from "../../shared/tools"
import { trackContribution } from "../../services/contribution-tracking/ContributionTrackingService" // kilocode_change

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface EditFileParams {
	file_path: string
	old_string: string
	new_string: string
	expected_replacements?: number
}

type LineEnding = "\r\n" | "\n"

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

function detectLineEnding(content: string): LineEnding {
	return content.includes("\r\n") ? "\r\n" : "\n"
}

function normalizeToLF(content: string): string {
	return content.replace(/\r\n/g, "\n")
}

function restoreLineEnding(contentLF: string, eol: LineEnding): string {
	if (eol === "\n") return contentLF
	return contentLF.replace(/\n/g, "\r\n")
}

function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildWhitespaceTolerantRegex(oldLF: string): RegExp {
	if (oldLF === "") {
		// Never match empty string
		return new RegExp("(?!)", "g")
	}

	const parts = oldLF.match(/(\s+|\S+)/g) ?? []
	const whitespacePatternForRun = (run: string): string => {
		// If the whitespace run includes a newline, allow matching any whitespace (including newlines)
		// to tolerate wrapping changes across lines.
		if (run.includes("\n")) {
			return "\\s+"
		}

		// Otherwise, limit matching to horizontal whitespace so we don't accidentally consume
		// line breaks that precede indentation.
		return "[\\t ]+"
	}

	const pattern = parts
		.map((part) => {
			if (/^\s+$/.test(part)) {
				return whitespacePatternForRun(part)
			}
			return escapeRegExp(part)
		})
		.join("")

	return new RegExp(pattern, "g")
}

function buildTokenRegex(oldLF: string): RegExp {
	const tokens = oldLF.split(/\s+/).filter(Boolean)
	if (tokens.length === 0) {
		return new RegExp("(?!)", "g")
	}

	const pattern = tokens.map(escapeRegExp).join("\\s+")
	return new RegExp(pattern, "g")
}

function countRegexMatches(content: string, regex: RegExp): number {
	const stable = new RegExp(regex.source, regex.flags)
	return Array.from(content.matchAll(stable)).length
}

export class EditFileTool extends BaseTool<"edit_file"> {
	readonly name = "edit_file" as const

	private didSendPartialToolAsk = false
	private partialToolAskRelPath: string | undefined

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
		// Coerce old_string/new_string to handle malformed native tool calls where they could be non-strings.
		// In native mode, malformed calls can pass numbers/objects; normalize those to "" to avoid later crashes.
		const file_path = params.file_path
		const old_string = typeof params.old_string === "string" ? params.old_string : ""
		const new_string = typeof params.new_string === "string" ? params.new_string : ""
		const expected_replacements = params.expected_replacements ?? 1
		const { askApproval, handleError, pushToolResult, toolProtocol } = callbacks
		let relPathForErrorHandling: string | undefined
		let operationPreviewForErrorHandling: string | undefined

		const finalizePartialToolAskIfNeeded = async (relPath: string): Promise<void> => {
			if (!this.didSendPartialToolAsk) {
				return
			}

			if (this.partialToolAskRelPath && this.partialToolAskRelPath !== relPath) {
				return
			}

			const absolutePath = path.resolve(task.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

			const sharedMessageProps: ClineSayTool = {
				tool: "appliedDiff",
				path: getReadablePath(task.cwd, relPath),
				diff: operationPreviewForErrorHandling,
				isOutsideWorkspace,
			}

			// Finalize the existing partial tool ask row so the UI doesn't get stuck in a spinner state.
			await task.ask("tool", JSON.stringify(sharedMessageProps), false).catch(() => {})
		}

		const recordFailureForPathAndMaybeEscalate = async (relPath: string, formattedError: string): Promise<void> => {
			const currentCount = (task.consecutiveMistakeCountForEditFile.get(relPath) || 0) + 1
			task.consecutiveMistakeCountForEditFile.set(relPath, currentCount)

			if (currentCount >= 2) {
				await task.say("diff_error", formattedError)
			}
		}

		try {
			// Validate required parameters
			if (!file_path) {
				task.consecutiveMistakeCount++
				task.recordToolError("edit_file")
				task.didToolFailInCurrentTurn = true
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
			relPathForErrorHandling = relPath

			operationPreviewForErrorHandling =
				old_string === ""
					? "creating new file"
					: (() => {
							const preview = old_string.length > 50 ? old_string.substring(0, 50) + "..." : old_string
							return `replacing: "${preview}"`
						})()

			const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)

			if (!accessAllowed) {
				// Finalize the partial tool preview before emitting any say() messages.
				await finalizePartialToolAskIfNeeded(relPath)
				task.didToolFailInCurrentTurn = true
				await task.say("rooignore_error", relPath)
				pushToolResult(formatResponse.rooIgnoreError(relPath, toolProtocol))
				return
			}

			// Check if file is write-protected
			const isWriteProtected = task.rooProtectedController?.isWriteProtected(relPath) || false

			const absolutePath = path.resolve(task.cwd, relPath)
			const fileExists = await fileExistsAtPath(absolutePath)

			let currentContent: string | null = null
			let currentContentLF: string | null = null
			let originalEol: LineEnding = "\n"
			let isNewFile = false

			// Read file or determine if creating new
			if (fileExists) {
				try {
					currentContent = await fs.readFile(absolutePath, "utf8")
					originalEol = detectLineEnding(currentContent)
					// Normalize line endings to LF for matching
					currentContentLF = normalizeToLF(currentContent)
				} catch (error) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const errorDetails = error instanceof Error ? error.message : String(error)
					const formattedError = `Failed to read file: ${absolutePath}\n\n<error_details>\nRead error: ${errorDetails}\n\nRecovery suggestions:\n1. Verify the file exists and is readable\n2. Check file permissions\n3. If the file may have changed, use read_file to confirm its current contents\n</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}

				// Check if trying to create a file that already exists
				if (old_string === "") {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const formattedError = `File already exists: ${absolutePath}\n\n<error_details>\nYou provided an empty old_string, which indicates file creation, but the target file already exists.\n\nRecovery suggestions:\n1. To modify an existing file, provide a non-empty old_string that matches the current file contents\n2. Use read_file to confirm the exact text to match\n3. If you intended to overwrite the entire file, use write_to_file instead\n</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
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
					task.didToolFailInCurrentTurn = true
					const formattedError = `File does not exist at path: ${absolutePath}\n\n<error_details>\nThe specified file could not be found, so the replacement could not be performed.\n\nRecovery suggestions:\n1. Verify the file path is correct\n2. If you intended to create a new file, set old_string to an empty string\n3. Use list_files or read_file to confirm the correct path\n</error_details>`
					// Match apply_diff behavior: surface missing file via the generic error channel.
					await finalizePartialToolAskIfNeeded(relPath)
					await task.say("error", formattedError)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}
			}

			const oldLF = normalizeToLF(old_string)
			const newLF = normalizeToLF(new_string)
			const expectedReplacements = Math.max(1, expected_replacements)

			// Validate replacement operation
			if (!isNewFile && currentContentLF !== null) {
				// Validate that old_string and new_string are different (normalized for EOL)
				if (oldLF === newLF) {
					task.consecutiveMistakeCount++
					task.didToolFailInCurrentTurn = true
					const formattedError = `No changes to apply for file: ${absolutePath}\n\n<error_details>\nThe provided old_string and new_string are identical (after normalizing line endings), so there is nothing to change.\n\nRecovery suggestions:\n1. Update new_string to the intended replacement text\n2. If you intended to verify file state only, use read_file instead\n</error_details>`
					await finalizePartialToolAskIfNeeded(relPath)
					await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
					task.recordToolError("edit_file", formattedError)
					pushToolResult(formattedError)
					return
				}

				const wsRegex = buildWhitespaceTolerantRegex(oldLF)
				const tokenRegex = buildTokenRegex(oldLF)

				// Strategy 1: exact literal match
				const exactOccurrences = countOccurrences(currentContentLF, oldLF)
				if (exactOccurrences === expectedReplacements) {
					// Apply literal replacement on LF-normalized content
					currentContentLF = safeLiteralReplace(currentContentLF, oldLF, newLF)
				} else {
					// Strategy 2: whitespace-tolerant regex
					const wsOccurrences = countRegexMatches(currentContentLF, wsRegex)
					if (wsOccurrences === expectedReplacements) {
						currentContentLF = currentContentLF.replace(wsRegex, () => newLF)
					} else {
						// Strategy 3: token-based regex
						const tokenOccurrences = countRegexMatches(currentContentLF, tokenRegex)
						if (tokenOccurrences === expectedReplacements) {
							currentContentLF = currentContentLF.replace(tokenRegex, () => newLF)
						} else {
							// Error reporting
							const anyMatches = exactOccurrences > 0 || wsOccurrences > 0 || tokenOccurrences > 0
							if (!anyMatches) {
								task.consecutiveMistakeCount++
								task.didToolFailInCurrentTurn = true
								const formattedError = `No match found in file: ${absolutePath}\n\n<error_details>\nThe provided old_string could not be found using exact, whitespace-tolerant, or token-based matching.\n\nRecovery suggestions:\n1. Use read_file to confirm the file's current contents\n2. Ensure old_string matches exactly (including whitespace/indentation and line endings)\n3. Provide more surrounding context in old_string to make the match unique\n4. If the file has changed since you constructed old_string, re-read and retry\n</error_details>`
								await finalizePartialToolAskIfNeeded(relPath)
								await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
								task.recordToolError("edit_file", formattedError)
								pushToolResult(formattedError)
								return
							}

							// If exact matching finds occurrences but doesn't match expected, keep the existing message
							if (exactOccurrences > 0) {
								task.consecutiveMistakeCount++
								task.didToolFailInCurrentTurn = true
								const formattedError = `Occurrence count mismatch in file: ${absolutePath}\n\n<error_details>\nExpected ${expectedReplacements} occurrence(s) but found ${exactOccurrences} exact match(es).\n\nRecovery suggestions:\n1. Provide a more specific old_string so it matches exactly once\n2. If you intend to replace all occurrences, set expected_replacements to ${exactOccurrences}\n3. Use read_file to confirm the exact text and counts\n</error_details>`
								await finalizePartialToolAskIfNeeded(relPath)
								await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
								task.recordToolError("edit_file", formattedError)
								pushToolResult(formattedError)
								return
							}

							task.consecutiveMistakeCount++
							task.didToolFailInCurrentTurn = true
							const formattedError = `Occurrence count mismatch in file: ${absolutePath}\n\n<error_details>\nExpected ${expectedReplacements} occurrence(s), but matching found ${wsOccurrences} (whitespace-tolerant) and ${tokenOccurrences} (token-based).\n\nRecovery suggestions:\n1. Provide more surrounding context in old_string to make the match unique\n2. If multiple replacements are intended, adjust expected_replacements to the intended count\n3. Use read_file to confirm the current file contents and refine the match\n</error_details>`
							await finalizePartialToolAskIfNeeded(relPath)
							await recordFailureForPathAndMaybeEscalate(relPath, formattedError)
							task.recordToolError("edit_file", formattedError)
							pushToolResult(formattedError)
							return
						}
					}
				}
			}

			// Apply the replacement
			const newContent = isNewFile
				? new_string
				: restoreLineEnding(currentContentLF ?? currentContent ?? "", originalEol)

			// Check if any changes were made
			if (!isNewFile && newContent === currentContent) {
				if (relPathForErrorHandling) {
					task.consecutiveMistakeCount = 0
					task.consecutiveMistakeCountForEditFile.delete(relPathForErrorHandling)
				}
				await finalizePartialToolAskIfNeeded(relPath)
				pushToolResult(`No changes needed for '${relPath}'`)
				return
			}

			task.consecutiveMistakeCount = 0
			task.consecutiveMistakeCountForEditFile.delete(relPath)

			// Initialize diff view
			task.diffViewProvider.editType = isNewFile ? "create" : "modify"
			task.diffViewProvider.originalContent = currentContent || ""

			// Generate and validate diff
			const diff = formatResponse.createPrettyPatch(relPath, currentContent || "", newContent)
			if (!diff && !isNewFile) {
				task.consecutiveMistakeCount = 0
				task.consecutiveMistakeCountForEditFile.delete(relPath)
				await finalizePartialToolAskIfNeeded(relPath)
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
			this.resetPartialState()

			// Process any queued messages after file edit completes
			task.processQueuedMessages()
		} catch (error) {
			if (relPathForErrorHandling) {
				await finalizePartialToolAskIfNeeded(relPathForErrorHandling)
			}
			await handleError("edit_file", error as Error)
			await task.diffViewProvider.reset()
			task.didToolFailInCurrentTurn = true
		} finally {
			this.didSendPartialToolAsk = false
			this.partialToolAskRelPath = undefined
			this.resetPartialState()
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"edit_file">): Promise<void> {
		const filePath: string | undefined = block.params.file_path
		const oldString: string | undefined = block.params.old_string

		// Wait for path to stabilize before showing UI (prevents truncated paths)
		if (!this.hasPathStabilized(filePath)) {
			return
		}

		let operationPreview: string | undefined
		if (oldString !== undefined) {
			if (oldString === "") {
				operationPreview = "creating new file"
			} else {
				const preview = oldString.length > 50 ? oldString.substring(0, 50) + "..." : oldString
				operationPreview = `replacing: "${preview}"`
			}
		}

		// Determine relative path for display (filePath is guaranteed non-null after hasPathStabilized)
		let relPath = filePath!
		if (path.isAbsolute(relPath)) {
			relPath = path.relative(task.cwd, relPath)
		}
		this.didSendPartialToolAsk = true
		this.partialToolAskRelPath = relPath

		const absolutePath = path.resolve(task.cwd, relPath)
		const isOutsideWorkspace = isPathOutsideWorkspace(absolutePath)

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
