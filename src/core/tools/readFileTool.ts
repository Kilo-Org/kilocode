import path from "path"
import { isBinaryFile } from "isbinaryfile"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { ToolUse, AskApproval, HandleError, PushToolResult, RemoveClosingTag } from "../../shared/tools"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { parseXml } from "../../utils/xml"
import { blockFileReadWhenTooLarge, getNativeReadFileToolDescription, parseNativeFiles } from "./kilocode"
import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
} from "./helpers/imageHelpers"

/**
 * Generates a formatted description for the file reading tool
 *
 * @param blockName - Name of the tool block (usually "read_file")
 * @param blockParams - Block parameters containing information about files to read
 * @returns A string describing the current read operation
 *
 * @example
 * ```typescript
 * const description = getReadFileToolDescription("read_file", {
 *   files: [{ path: "src/app.ts" }, { path: "src/utils.ts" }]
 * });
 * // Result: "[read_file for 'src/app.ts', 'src/utils.ts']"
 * ```
 */
export function getReadFileToolDescription(blockName: string, blockParams: any): string {
	// Handle both single path and multiple files via args
	// kilocode_change start
	if (blockParams.files && Array.isArray(blockParams.files)) {
		return getNativeReadFileToolDescription(blockName, parseNativeFiles(blockParams.files))
		// kilocode_change end
	} else if (blockParams.args) {
		try {
			const parsed = parseXml(blockParams.args) as any
			const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)
			const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]

			if (paths.length === 0) {
				return `[${blockName} with no valid paths]`
			} else if (paths.length === 1) {
				// Modified part for single file
				return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
			} else if (paths.length <= 3) {
				const pathList = paths.map((p) => `'${p}'`).join(", ")
				return `[${blockName} for ${pathList}]`
			} else {
				return `[${blockName} for ${paths.length} files]`
			}
		} catch (error) {
			console.error("Failed to parse read_file args XML for description:", error)
			return `[${blockName} with unparsable args]`
		}
	} else if (blockParams.path) {
		// Fallback for legacy single-path usage
		// Modified part for single file (legacy)
		return `[${blockName} for '${blockParams.path}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
	} else {
		return `[${blockName} with missing path/args]`
	}
}
// Types

/**
 * Interface representing a line range for selective file reading
 */
interface LineRange {
	/** Starting line number (inclusive) */
	start: number
	/** Ending line number (inclusive) */
	end: number
}

/**
 * Interface representing a file entry to be processed
 */
interface FileEntry {
	/** Relative path of the file to read */
	path?: string
	/** Array of line ranges to read (optional) */
	lineRanges?: LineRange[]
}

/**
 * Interface to track the processing status of a file
 */
interface FileResult {
	/** Path of the processed file */
	path: string
	/** Current processing status of the file */
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	/** Text content of the file (if applicable) */
	content?: string
	/** Error message (if processing failed) */
	error?: string
	/** Information or warning message */
	notice?: string
	/** Requested line ranges (if applicable) */
	lineRanges?: LineRange[]
	/** Final XML content for this file */
	xmlContent?: string
	/** Data URL for image files */
	imageDataUrl?: string
	/** User feedback text after approval/denial */
	feedbackText?: string
	/** User feedback images after approval/denial */
	feedbackImages?: any[]
}

/**
 * Main tool for reading files in KiloCode
 *
 * This function handles reading one or more files with support for:
 * - Simultaneous multiple file reading
 * - Specific line ranges
 * - Binary files (images, PDFs, etc.)
 * - User validation and approval
 * - YOLO mode to bypass approvals
 * - Size limits and memory management
 *
 * @param cline - Instance of the currently running task
 * @param block - Tool block containing read parameters
 * @param askApproval - Function to request user approval
 * @param handleError - Function to handle errors
 * @param pushToolResult - Function to push results
 * @param _removeClosingTag - Function to remove closing tags (unused)
 *
 * @returns Promise<void> - Results are pushed via pushToolResult
 *
 * @example
 * ```typescript
 * // Reading a single file
 * await readFileTool(task, {
 *   params: { files: [{ path: "src/app.ts" }] }
 * }, askApproval, handleError, pushToolResult, removeClosingTag);
 *
 * // Reading with line ranges
 * await readFileTool(task, {
 *   params: {
 *     files: [{
 *       path: "src/app.ts",
 *       lineRanges: [{ start: 10, end: 20 }]
 *     }]
 *   }
 * }, askApproval, handleError, pushToolResult, removeClosingTag);
 * ```
 */
export async function readFileTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	_removeClosingTag: RemoveClosingTag,
) {
	const argsXmlTag: string | undefined = block.params.args
	const legacyPath: string | undefined = block.params.path
	const legacyStartLineStr: string | undefined = block.params.start_line
	const legacyEndLineStr: string | undefined = block.params.end_line

	const nativeFiles: any[] | undefined = (block.params as any).files // kilocode_change: Native JSON format from OpenAI-style tool calls

	// Check if the current model supports images at the beginning
	const modelInfo = cline.api.getModel().info
	const supportsImages = modelInfo.supportsImages ?? false

	// Handle partial message first
	if (block.partial) {
		let filePath = ""
		// Prioritize args for partial, then legacy path
		if (argsXmlTag) {
			const match = argsXmlTag.match(/<file>.*?<path>([^<]+)<\/path>/s)
			if (match) filePath = match[1]
		}
		if (!filePath && legacyPath) {
			// If args didn't yield a path, try legacy
			filePath = legacyPath
		}

		const fullPath = filePath ? path.resolve(cline.cwd, filePath) : ""
		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(cline.cwd, filePath),
			isOutsideWorkspace: filePath ? isPathOutsideWorkspace(fullPath) : false,
		}
		const partialMessage = JSON.stringify({
			...sharedMessageProps,
			content: undefined,
		} satisfies ClineSayTool)
		await cline.ask("tool", partialMessage, block.partial).catch(() => {})
		return
	}

	const fileEntries: FileEntry[] = []

	// kilocode_change start
	// Handle native JSON format first (from OpenAI-style tool calls)
	if (nativeFiles && Array.isArray(nativeFiles)) {
		fileEntries.push(...parseNativeFiles(nativeFiles))
		// kilocode_change end
	} else if (argsXmlTag) {
		// Parse file entries from XML (new multi-file format)
		try {
			const parsed = parseXml(argsXmlTag) as any
			const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)

			for (const file of files) {
				if (!file.path) continue // Skip if no path in a file entry

				const fileEntry: FileEntry = {
					path: file.path,
					lineRanges: [],
				}

				if (file.line_range) {
					const ranges = Array.isArray(file.line_range) ? file.line_range : [file.line_range]
					for (const range of ranges) {
						const match = String(range).match(/(\d+)-(\d+)/) // Ensure range is treated as string
						if (match) {
							const [, start, end] = match.map(Number)
							if (!isNaN(start) && !isNaN(end)) {
								fileEntry.lineRanges?.push({ start, end })
							}
						}
					}
				}
				fileEntries.push(fileEntry)
			}
		} catch (error) {
			const errorMessage = `Failed to parse read_file XML args: ${error instanceof Error ? error.message : String(error)}`
			await handleError("parsing read_file args", new Error(errorMessage))
			pushToolResult(`<files><error>${errorMessage}</error></files>`)
			return
		}
	} else if (legacyPath) {
		// Handle legacy single file path as a fallback
		console.warn("[readFileTool] Received legacy 'path' parameter. Consider updating to use 'args' structure.")

		const fileEntry: FileEntry = {
			path: legacyPath,
			lineRanges: [],
		}

		if (legacyStartLineStr && legacyEndLineStr) {
			const start = parseInt(legacyStartLineStr, 10)
			const end = parseInt(legacyEndLineStr, 10)
			if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
				fileEntry.lineRanges?.push({ start, end })
			} else {
				console.warn(
					`[readFileTool] Invalid legacy line range for ${legacyPath}: start='${legacyStartLineStr}', end='${legacyEndLineStr}'`,
				)
			}
		}
		fileEntries.push(fileEntry)
	}

	// If, after trying both new and legacy, no valid file entries are found.
	if (fileEntries.length === 0) {
		cline.consecutiveMistakeCount++
		cline.recordToolError("read_file")
		const errorMsg = await cline.sayAndCreateMissingParamError("read_file", "args (containing valid file paths)")
		pushToolResult(`<files><error>${errorMsg}</error></files>`)
		return
	}

	// Create an array to track the state of each file
	const fileResults: FileResult[] = fileEntries.map((entry) => ({
		path: entry.path || "",
		status: "pending",
		lineRanges: entry.lineRanges,
	}))

	/**
	 * Updates the status of a file result in the results array
	 *
	 * @param path - Path of the file to update
	 * @param updates - Partial updates to apply to the result
	 */
	const updateFileResult = (path: string, updates: Partial<FileResult>) => {
		const index = fileResults.findIndex((result) => result.path === path)
		if (index !== -1) {
			fileResults[index] = { ...fileResults[index], ...updates }
		}
	}

	// kilocode_change start: yolo mode
	const state = await cline.providerRef.deref()?.getState()
	const isYoloMode = state?.yoloMode ?? false
	// kilocode_change end

	try {
		// First validate all files and prepare for batch approval
		const filesToApprove: FileResult[] = []

		for (let i = 0; i < fileResults.length; i++) {
			const fileResult = fileResults[i]
			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)

			// Validate line ranges first
			if (fileResult.lineRanges) {
				let hasRangeError = false
				for (const range of fileResult.lineRanges) {
					if (range.start > range.end) {
						const errorMsg = "Invalid line range: end line cannot be less than start line"
						updateFileResult(relPath, {
							status: "blocked",
							error: errorMsg,
							xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
						})
						await handleError(`reading file ${relPath}`, new Error(errorMsg))
						hasRangeError = true
						break
					}
					if (isNaN(range.start) || isNaN(range.end)) {
						const errorMsg = "Invalid line range values"
						updateFileResult(relPath, {
							status: "blocked",
							error: errorMsg,
							xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
						})
						await handleError(`reading file ${relPath}`, new Error(errorMsg))
						hasRangeError = true
						break
					}
				}
				if (hasRangeError) continue
			}

			// Then check RooIgnore validation
			if (fileResult.status === "pending") {
				const accessAllowed = cline.rooIgnoreController?.validateAccess(relPath)
				if (!accessAllowed) {
					await cline.say("rooignore_error", relPath)
					const errorMsg = formatResponse.rooIgnoreError(relPath)
					updateFileResult(relPath, {
						status: "blocked",
						error: errorMsg,
						xmlContent: `<file><path>${relPath}</path><error>${errorMsg}</error></file>`,
					})
					continue
				}

				// Add to files that need approval
				filesToApprove.push(fileResult)
			}
		}

		// Handle batch approval if there are multiple files to approve
		if (filesToApprove.length > 1) {
			const { maxReadFileLine = -1 } = (await cline.providerRef.deref()?.getState()) ?? {}

			// Prepare batch file data
			const batchFiles = filesToApprove.map((fileResult) => {
				const relPath = fileResult.path
				const fullPath = path.resolve(cline.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

				// Create line snippet for this file
				let lineSnippet = ""
				if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
					const ranges = fileResult.lineRanges.map((range) =>
						t("tools:readFile.linesRange", { start: range.start, end: range.end }),
					)
					lineSnippet = ranges.join(", ")
				} else if (maxReadFileLine === 0) {
					lineSnippet = t("tools:readFile.definitionsOnly")
				} else if (maxReadFileLine > 0) {
					lineSnippet = t("tools:readFile.maxLines", { max: maxReadFileLine })
				}

				const readablePath = getReadablePath(cline.cwd, relPath)
				const key = `${readablePath}${lineSnippet ? ` (${lineSnippet})` : ""}`

				return {
					path: readablePath,
					lineSnippet,
					isOutsideWorkspace,
					key,
					content: fullPath, // Include full path for content
				}
			})

			const completeMessage = JSON.stringify({
				tool: "readFile",
				batchFiles,
			} satisfies ClineSayTool)

			// kilocode_change start: yolo mode
			const { response, text, images } = isYoloMode
				? { response: "yesButtonClicked" }
				: await cline.ask("tool", completeMessage, false)
			// kilocode_change end

			// Process batch response
			if (response === "yesButtonClicked") {
				// Approve all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				filesToApprove.forEach((fileResult) => {
					updateFileResult(fileResult.path, {
						status: "approved",
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else if (response === "noButtonClicked") {
				// Deny all files
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				cline.didRejectTool = true
				filesToApprove.forEach((fileResult) => {
					updateFileResult(fileResult.path, {
						status: "denied",
						xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
						feedbackText: text,
						feedbackImages: images,
					})
				})
			} else {
				// Handle individual permissions from objectResponse
				// if (text) {
				// 	await cline.say("user_feedback", text, images)
				// }

				try {
					const individualPermissions = JSON.parse(text || "{}")
					let hasAnyDenial = false

					batchFiles.forEach((batchFile, index) => {
						const fileResult = filesToApprove[index]
						const approved = individualPermissions[batchFile.key] === true

						if (approved) {
							updateFileResult(fileResult.path, {
								status: "approved",
							})
						} else {
							hasAnyDenial = true
							updateFileResult(fileResult.path, {
								status: "denied",
								xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
							})
						}
					})

					if (hasAnyDenial) {
						cline.didRejectTool = true
					}
				} catch (error) {
					// Fallback: if JSON parsing fails, deny all files
					console.error("Failed to parse individual permissions:", error)
					cline.didRejectTool = true
					filesToApprove.forEach((fileResult) => {
						updateFileResult(fileResult.path, {
							status: "denied",
							xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
						})
					})
				}
			}
		} else if (filesToApprove.length === 1) {
			// Handle single file approval (existing logic)
			const fileResult = filesToApprove[0]
			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)
			const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
			const { maxReadFileLine = -1 } = (await cline.providerRef.deref()?.getState()) ?? {}

			// Create line snippet for approval message
			let lineSnippet = ""
			if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
				const ranges = fileResult.lineRanges.map((range) =>
					t("tools:readFile.linesRange", { start: range.start, end: range.end }),
				)
				lineSnippet = ranges.join(", ")
			} else if (maxReadFileLine === 0) {
				lineSnippet = t("tools:readFile.definitionsOnly")
			} else if (maxReadFileLine > 0) {
				lineSnippet = t("tools:readFile.maxLines", { max: maxReadFileLine })
			}

			const completeMessage = JSON.stringify({
				tool: "readFile",
				path: getReadablePath(cline.cwd, relPath),
				isOutsideWorkspace,
				content: fullPath,
				reason: lineSnippet,
			} satisfies ClineSayTool)

			// kilocode_change start: yolo mode
			const { response, text, images } = isYoloMode
				? { response: "yesButtonClicked" }
				: await cline.ask("tool", completeMessage, false)
			// kilocode_change end

			if (response !== "yesButtonClicked") {
				// Handle both messageResponse and noButtonClicked with text
				if (text) {
					await cline.say("user_feedback", text, images)
				}
				cline.didRejectTool = true

				updateFileResult(relPath, {
					status: "denied",
					xmlContent: `<file><path>${relPath}</path><status>Denied by user</status></file>`,
					feedbackText: text,
					feedbackImages: images,
				})
			} else {
				// Handle yesButtonClicked with text
				if (text) {
					await cline.say("user_feedback", text, images)
				}

				updateFileResult(relPath, {
					status: "approved",
					feedbackText: text,
					feedbackImages: images,
				})
			}
		}

		// Track total image memory usage across all files
		const imageMemoryTracker = new ImageMemoryTracker()
		const state = await cline.providerRef.deref()?.getState()
		const {
			maxReadFileLine = -1,
			maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
			maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
		} = state ?? {}

		// Then process only approved files
		for (const fileResult of fileResults) {
			// Skip files that weren't approved
			if (fileResult.status !== "approved") {
				continue
			}

			const relPath = fileResult.path
			const fullPath = path.resolve(cline.cwd, relPath)

			// Process approved files
			try {
				const [totalLines, isBinary] = await Promise.all([countFileLines(fullPath), isBinaryFile(fullPath)])

				// Handle binary files (but allow specific file types that extractTextFromFile can handle)
				if (isBinary) {
					const fileExtension = path.extname(relPath).toLowerCase()
					const supportedBinaryFormats = getSupportedBinaryFormats()

					// Check if it's a supported image format
					if (isSupportedImageFormat(fileExtension)) {
						try {
							// Validate image for processing
							const validationResult = await validateImageForProcessing(
								fullPath,
								supportsImages,
								maxImageFileSize,
								maxTotalImageSize,
								imageMemoryTracker.getTotalMemoryUsed(),
							)

							if (!validationResult.isValid) {
								// Track file read
								await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

								updateFileResult(relPath, {
									xmlContent: `<file><path>${relPath}</path>\n<notice>${validationResult.notice}</notice>\n</file>`,
								})
								continue
							}

							// Process the image
							const imageResult = await processImageFile(fullPath)

							// Track memory usage for this image
							imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)

							// Track file read
							await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

							// Store image data URL separately - NOT in XML
							updateFileResult(relPath, {
								xmlContent: `<file><path>${relPath}</path>\n<notice>${imageResult.notice}</notice>\n</file>`,
								imageDataUrl: imageResult.dataUrl,
							})
							continue
						} catch (error) {
							const errorMsg = error instanceof Error ? error.message : String(error)
							updateFileResult(relPath, {
								status: "error",
								error: `Error reading image file: ${errorMsg}`,
								xmlContent: `<file><path>${relPath}</path><error>Error reading image file: ${errorMsg}</error></file>`,
							})
							await handleError(
								`reading image file ${relPath}`,
								error instanceof Error ? error : new Error(errorMsg),
							)
							continue
						}
					}

					// Check if it's a supported binary format that can be processed
					if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
						// For supported binary formats (.pdf, .docx, .ipynb), continue to extractTextFromFile
						// Fall through to the normal extractTextFromFile processing below
					} else {
						// Handle unknown binary format
						const fileFormat = fileExtension.slice(1) || "bin" // Remove the dot, fallback to "bin"
						updateFileResult(relPath, {
							notice: `Binary file format: ${fileFormat}`,
							xmlContent: `<file><path>${relPath}</path>\n<binary_file format="${fileFormat}">Binary file - content not displayed</binary_file>\n</file>`,
						})
						continue
					}
				}

				// Handle range reads (bypass maxReadFileLine)
				if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
					const rangeResults: string[] = []
					for (const range of fileResult.lineRanges) {
						const content = addLineNumbers(
							await readLines(fullPath, range.end - 1, range.start - 1),
							range.start,
						)
						const lineRangeAttr = ` lines="${range.start}-${range.end}"`
						rangeResults.push(`<content${lineRangeAttr}>\n${content}</content>`)
					}
					updateFileResult(relPath, {
						xmlContent: `<file><path>${relPath}</path>\n${rangeResults.join("\n")}\n</file>`,
					})
					continue
				}

				// Handle definitions-only mode
				if (maxReadFileLine === 0) {
					try {
						const defResult = await parseSourceCodeDefinitionsForFile(fullPath, cline.rooIgnoreController)
						if (defResult) {
							let xmlInfo = `<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines. Use line_range if you need to read more lines</notice>\n`
							updateFileResult(relPath, {
								xmlContent: `<file><path>${relPath}</path>\n<list_code_definition_names>${defResult}</list_code_definition_names>\n${xmlInfo}</file>`,
							})
						}
					} catch (error) {
						if (error instanceof Error && error.message.startsWith("Unsupported language:")) {
							console.warn(`[read_file] Warning: ${error.message}`)
						} else {
							console.error(
								`[read_file] Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
							)
						}
					}
					continue
				}

				// Handle files exceeding line threshold
				if (maxReadFileLine > 0 && totalLines > maxReadFileLine) {
					const content = addLineNumbers(await readLines(fullPath, maxReadFileLine - 1, 0))
					const lineRangeAttr = ` lines="1-${maxReadFileLine}"`
					let xmlInfo = `<content${lineRangeAttr}>\n${content}</content>\n`

					try {
						const defResult = await parseSourceCodeDefinitionsForFile(fullPath, cline.rooIgnoreController)
						if (defResult) {
							xmlInfo += `<list_code_definition_names>${defResult}</list_code_definition_names>\n`
						}
						xmlInfo += `<notice>Showing only ${maxReadFileLine} of ${totalLines} total lines. Use line_range if you need to read more lines</notice>\n`
						updateFileResult(relPath, {
							xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
						})
					} catch (error) {
						if (error instanceof Error && error.message.startsWith("Unsupported language:")) {
							console.warn(`[read_file] Warning: ${error.message}`)
						} else {
							console.error(
								`[read_file] Unhandled error: ${error instanceof Error ? error.message : String(error)}`,
							)
						}
					}
					continue
				}

				// Handle normal file read
				const content = await extractTextFromFile(fullPath)

				// kilocode_change start: limit output size based on token count
				const blockResult = await blockFileReadWhenTooLarge(cline, relPath, content)
				if (blockResult) {
					updateFileResult(relPath, blockResult)
					continue
				}
				// kilocode_change end

				const lineRangeAttr = ` lines="1-${totalLines}"`
				let xmlInfo = totalLines > 0 ? `<content${lineRangeAttr}>\n${content}</content>\n` : `<content/>`

				if (totalLines === 0) {
					xmlInfo += `<notice>File is empty</notice>\n`
				}

				// Track file read
				await cline.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

				updateFileResult(relPath, {
					xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
				})
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error)
				updateFileResult(relPath, {
					status: "error",
					error: `Error reading file: ${errorMsg}`,
					xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
				})
				await handleError(`reading file ${relPath}`, error instanceof Error ? error : new Error(errorMsg))
			}
		}

		// Generate final XML result from all file results
		const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)
		const filesXml = `<files>\n${xmlResults.join("\n")}\n</files>`

		// Collect all image data URLs from file results
		const fileImageUrls = fileResults
			.filter((result) => result.imageDataUrl)
			.map((result) => result.imageDataUrl as string)

		// Process all feedback in a unified way without branching
		let statusMessage = ""
		let feedbackImages: any[] = []

		// Handle denial with feedback (highest priority)
		const deniedWithFeedback = fileResults.find((result) => result.status === "denied" && result.feedbackText)

		if (deniedWithFeedback && deniedWithFeedback.feedbackText) {
			statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
			feedbackImages = deniedWithFeedback.feedbackImages || []
		}
		// Handle generic denial
		else if (cline.didRejectTool) {
			statusMessage = formatResponse.toolDenied()
		}
		// Handle approval with feedback
		else {
			const approvedWithFeedback = fileResults.find(
				(result) => result.status === "approved" && result.feedbackText,
			)

			if (approvedWithFeedback && approvedWithFeedback.feedbackText) {
				statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
				feedbackImages = approvedWithFeedback.feedbackImages || []
			}
		}

		// Combine all images: feedback images first, then file images
		const allImages = [...feedbackImages, ...fileImageUrls]

		// Re-check if the model supports images before including them, in case it changed during execution.
		const finalModelSupportsImages = cline.api.getModel().info.supportsImages ?? false
		const imagesToInclude = finalModelSupportsImages ? allImages : []

		// Push the result with appropriate formatting
		if (statusMessage || imagesToInclude.length > 0) {
			// Always use formatResponse.toolResult when we have a status message or images
			const result = formatResponse.toolResult(
				statusMessage || filesXml,
				imagesToInclude.length > 0 ? imagesToInclude : undefined,
			)

			// Handle different return types from toolResult
			if (typeof result === "string") {
				if (statusMessage) {
					pushToolResult(`${result}\n${filesXml}`)
				} else {
					pushToolResult(result)
				}
			} else {
				// For block-based results, append the files XML as a text block if not already included
				if (statusMessage) {
					const textBlock = { type: "text" as const, text: filesXml }
					pushToolResult([...result, textBlock])
				} else {
					pushToolResult(result)
				}
			}
		} else {
			// No images or status message, just push the files XML
			pushToolResult(filesXml)
		}
	} catch (error) {
		// Handle all errors using per-file format for consistency
		const relPath = fileEntries[0]?.path || "unknown"
		const errorMsg = error instanceof Error ? error.message : String(error)

		// If we have file results, update the first one with the error
		if (fileResults.length > 0) {
			updateFileResult(relPath, {
				status: "error",
				error: `Error reading file: ${errorMsg}`,
				xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
			})
		}

		await handleError(`reading file ${relPath}`, error instanceof Error ? error : new Error(errorMsg))

		// Generate final XML result from all file results
		const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)

		pushToolResult(`<files>\n${xmlResults.join("\n")}\n</files>`)
	}
}
