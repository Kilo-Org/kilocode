import path from "path"
import * as fs from "fs/promises"
import { isBinaryFile } from "isbinaryfile"
import type { FileEntry, LineRange } from "@roo-code/types"
import { isNativeProtocol, ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

import { Task } from "../task/Task"
import { ClineSayTool } from "../../shared/ExtensionMessage"
import { formatResponse } from "../prompts/responses"
import { getModelMaxOutputTokens } from "../../shared/api"
import { t } from "../../i18n"
import { RecordSource } from "../context-tracking/FileContextTrackerTypes"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { getReadablePath } from "../../utils/path"
import { countFileLines } from "../../integrations/misc/line-counter"
import { readLines } from "../../integrations/misc/read-lines"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../integrations/misc/extract-text"
import { parseSourceCodeDefinitionsForFile } from "../../services/tree-sitter"
import { parseXml } from "../../utils/xml"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import {
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
	isSupportedImageFormat,
	validateImageForProcessing,
	processImageFile,
	ImageMemoryTracker,
} from "./helpers/imageHelpers"
import { FILE_READ_BUDGET_PERCENT, readFileWithTokenBudget } from "./helpers/fileTokenBudget"
import { truncateDefinitionsToLineLimit } from "./helpers/truncateDefinitions"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

interface FileResult {
	path: string
	status: "approved" | "denied" | "blocked" | "error" | "pending"
	content?: string
	error?: string
	notice?: string
	lineRanges?: LineRange[]
	xmlContent?: string
	nativeContent?: string
	imageDataUrl?: string
	feedbackText?: string
	feedbackImages?: any[]
}

export class ReadFileTool extends BaseTool<"read_file"> {
	readonly name = "read_file" as const

	parseLegacy(params: Partial<Record<string, string>>): { files: FileEntry[] } {
		const argsXmlTag = params.args
		const legacyPath = params.path
		const legacyStartLineStr = params.start_line
		const legacyEndLineStr = params.end_line

		const fileEntries: FileEntry[] = []

		// XML args format
		if (argsXmlTag) {
			const parsed = parseXml(argsXmlTag) as any
			const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)

			for (const file of files) {
				if (!file.path) continue

				const fileEntry: FileEntry = {
					path: file.path,
					lineRanges: [],
				}

				if (file.line_range) {
					const ranges = Array.isArray(file.line_range) ? file.line_range : [file.line_range]
					for (const range of ranges) {
						const match = String(range).match(/(\d+)-(\d+)/)
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

			return { files: fileEntries }
		}

		// Legacy single file path
		if (legacyPath) {
			const fileEntry: FileEntry = {
				path: legacyPath,
				lineRanges: [],
			}

			if (legacyStartLineStr && legacyEndLineStr) {
				const start = parseInt(legacyStartLineStr, 10)
				const end = parseInt(legacyEndLineStr, 10)
				if (!isNaN(start) && !isNaN(end) && start > 0 && end > 0) {
					fileEntry.lineRanges?.push({ start, end })
				}
			}
			fileEntries.push(fileEntry)
		}

		return { files: fileEntries }
	}

	async execute(params: { files: FileEntry[] }, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult, toolProtocol } = callbacks
		const fileEntries = params.files
		const modelInfo = task.api.getModel().info
		// Use the task's locked protocol for consistent output formatting throughout the task
		const protocol = resolveToolProtocol(task.apiConfiguration, modelInfo, task.taskToolProtocol)
		const useNative = isNativeProtocol(protocol)

		if (!fileEntries || fileEntries.length === 0) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_file")
			const errorMsg = await task.sayAndCreateMissingParamError("read_file", "args (containing valid file paths)")
			const errorResult = useNative ? `Error: ${errorMsg}` : `<files><error>${errorMsg}</error></files>`
			pushToolResult(errorResult)
			return
		}

		// Enforce maxConcurrentFileReads limit
		const { maxConcurrentFileReads = 5 } = (await task.providerRef.deref()?.getState()) ?? {}
		if (fileEntries.length > maxConcurrentFileReads) {
			task.consecutiveMistakeCount++
			task.recordToolError("read_file")
			const errorMsg = `Too many files requested. You attempted to read ${fileEntries.length} files, but the concurrent file reads limit is ${maxConcurrentFileReads}. Please read files in batches of ${maxConcurrentFileReads} or fewer.`
			await task.say("error", errorMsg)
			const errorResult = useNative ? `Error: ${errorMsg}` : `<files><error>${errorMsg}</error></files>`
			pushToolResult(errorResult)
			return
		}

		const supportsImages = modelInfo.supportsImages ?? false

		const fileResults: FileResult[] = fileEntries.map((entry) => ({
			path: entry.path,
			status: "pending",
			lineRanges: entry.lineRanges,
		}))

		const updateFileResult = (filePath: string, updates: Partial<FileResult>) => {
			const index = fileResults.findIndex((result) => result.path === filePath)
			if (index !== -1) {
				fileResults[index] = { ...fileResults[index], ...updates }
			}
		}

		try {
			const filesToApprove: FileResult[] = []

			for (const fileResult of fileResults) {
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)

				if (fileResult.lineRanges) {
					let hasRangeError = false
					for (const range of fileResult.lineRanges) {
						if (range.start > range.end) {
							const errorMsg = "Invalid line range: end line cannot be less than start line"
							updateFileResult(relPath, {
								status: "blocked",
								error: errorMsg,
								xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
								nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
							})
							await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
							hasRangeError = true
							break
						}
						if (isNaN(range.start) || isNaN(range.end)) {
							const errorMsg = "Invalid line range values"
							updateFileResult(relPath, {
								status: "blocked",
								error: errorMsg,
								xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
								nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
							})
							await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
							hasRangeError = true
							break
						}
					}
					if (hasRangeError) continue
				}

				if (fileResult.status === "pending") {
					const accessAllowed = task.rooIgnoreController?.validateAccess(relPath)
					if (!accessAllowed) {
						await task.say("rooignore_error", relPath)
						const errorMsg = formatResponse.rooIgnoreError(relPath)
						updateFileResult(relPath, {
							status: "blocked",
							error: errorMsg,
							xmlContent: `<file><path>${relPath}</path><error>${errorMsg}</error></file>`,
							nativeContent: `File: ${relPath}\nError: ${errorMsg}`,
						})
						continue
					}

					filesToApprove.push(fileResult)
				}
			}

			if (filesToApprove.length > 1) {
				const { maxReadFileLine = -1 } = (await task.providerRef.deref()?.getState()) ?? {}

				const batchFiles = filesToApprove.map((fileResult) => {
					const relPath = fileResult.path
					const fullPath = path.resolve(task.cwd, relPath)
					const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)

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

					const readablePath = getReadablePath(task.cwd, relPath)
					const key = `${readablePath}${lineSnippet ? ` (${lineSnippet})` : ""}`

					return { path: readablePath, lineSnippet, isOutsideWorkspace, key, content: fullPath }
				})

				const completeMessage = JSON.stringify({ tool: "readFile", batchFiles } satisfies ClineSayTool)
				const { response, text, images } = await task.ask("tool", completeMessage, false)

				if (response === "yesButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					filesToApprove.forEach((fileResult) => {
						updateFileResult(fileResult.path, {
							status: "approved",
							feedbackText: text,
							feedbackImages: images,
						})
					})
				} else if (response === "noButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					task.didRejectTool = true
					filesToApprove.forEach((fileResult) => {
						updateFileResult(fileResult.path, {
							status: "denied",
							xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
							nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
							feedbackText: text,
							feedbackImages: images,
						})
					})
				} else {
					try {
						const individualPermissions = JSON.parse(text || "{}")
						let hasAnyDenial = false

						batchFiles.forEach((batchFile, index) => {
							const fileResult = filesToApprove[index]
							const approved = individualPermissions[batchFile.key] === true

							if (approved) {
								updateFileResult(fileResult.path, { status: "approved" })
							} else {
								hasAnyDenial = true
								updateFileResult(fileResult.path, {
									status: "denied",
									xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
									nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
								})
							}
						})

						if (hasAnyDenial) task.didRejectTool = true
					} catch (error) {
						console.error("Failed to parse individual permissions:", error)
						task.didRejectTool = true
						filesToApprove.forEach((fileResult) => {
							updateFileResult(fileResult.path, {
								status: "denied",
								xmlContent: `<file><path>${fileResult.path}</path><status>Denied by user</status></file>`,
								nativeContent: `File: ${fileResult.path}\nStatus: Denied by user`,
							})
						})
					}
				}
			} else if (filesToApprove.length === 1) {
				const fileResult = filesToApprove[0]
				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)
				const isOutsideWorkspace = isPathOutsideWorkspace(fullPath)
				const { maxReadFileLine = -1 } = (await task.providerRef.deref()?.getState()) ?? {}

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
					path: getReadablePath(task.cwd, relPath),
					isOutsideWorkspace,
					content: fullPath,
					reason: lineSnippet,
				} satisfies ClineSayTool)

				const { response, text, images } = await task.ask("tool", completeMessage, false)

				if (response !== "yesButtonClicked") {
					if (text) await task.say("user_feedback", text, images)
					task.didRejectTool = true
					updateFileResult(relPath, {
						status: "denied",
						xmlContent: `<file><path>${relPath}</path><status>Denied by user</status></file>`,
						nativeContent: `File: ${relPath}\nStatus: Denied by user`,
						feedbackText: text,
						feedbackImages: images,
					})
				} else {
					if (text) await task.say("user_feedback", text, images)
					updateFileResult(relPath, { status: "approved", feedbackText: text, feedbackImages: images })
				}
			}

			const imageMemoryTracker = new ImageMemoryTracker()
			const state = await task.providerRef.deref()?.getState()
			const {
				maxReadFileLine = -1,
				maxImageFileSize = DEFAULT_MAX_IMAGE_FILE_SIZE_MB,
				maxTotalImageSize = DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB,
			} = state ?? {}

			for (const fileResult of fileResults) {
				if (fileResult.status !== "approved") continue

				const relPath = fileResult.path
				const fullPath = path.resolve(task.cwd, relPath)

				try {
					// Check if the path is a directory before attempting to read it
					const stats = await fs.stat(fullPath)
					if (stats.isDirectory()) {
						const errorMsg = `Cannot read '${relPath}' because it is a directory. To view the contents of a directory, use the list_files tool instead.`
						updateFileResult(relPath, {
							status: "error",
							error: errorMsg,
							xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
							nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
						})
						await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
						continue
					}

					const [totalLines, isBinary] = await Promise.all([countFileLines(fullPath), isBinaryFile(fullPath)])

					if (isBinary) {
						const fileExtension = path.extname(relPath).toLowerCase()
						const supportedBinaryFormats = getSupportedBinaryFormats()

						if (isSupportedImageFormat(fileExtension)) {
							try {
								const validationResult = await validateImageForProcessing(
									fullPath,
									supportsImages,
									maxImageFileSize,
									maxTotalImageSize,
									imageMemoryTracker.getTotalMemoryUsed(),
								)

								if (!validationResult.isValid) {
									await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)
									updateFileResult(relPath, {
										xmlContent: `<file><path>${relPath}</path>\n<notice>${validationResult.notice}</notice>\n</file>`,
										nativeContent: `File: ${relPath}\nNote: ${validationResult.notice}`,
									})
									continue
								}

								const imageResult = await processImageFile(fullPath)
								imageMemoryTracker.addMemoryUsage(imageResult.sizeInMB)
								await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

								updateFileResult(relPath, {
									xmlContent: `<file><path>${relPath}</path>\n<notice>${imageResult.notice}</notice>\n</file>`,
									nativeContent: `File: ${relPath}\nNote: ${imageResult.notice}`,
									imageDataUrl: imageResult.dataUrl,
								})
								continue
							} catch (error) {
								const errorMsg = error instanceof Error ? error.message : String(error)
								updateFileResult(relPath, {
									status: "error",
									error: `Error reading image file: ${errorMsg}`,
									xmlContent: `<file><path>${relPath}</path><error>Error reading image file: ${errorMsg}</error></file>`,
									nativeContent: `File: ${relPath}\nError: Error reading image file: ${errorMsg}`,
								})
								await task.say("error", `Error reading image file ${relPath}: ${errorMsg}`)
								continue
							}
						}

						if (supportedBinaryFormats && supportedBinaryFormats.includes(fileExtension)) {
							// Use extractTextFromFile for supported binary formats (PDF, DOCX, etc.)
							try {
								const content = await extractTextFromFile(fullPath)
								const numberedContent = addLineNumbers(content)
								const lines = content.split("\n")
								const lineCount = lines.length
								const lineRangeAttr = lineCount > 0 ? ` lines="1-${lineCount}"` : ""

								await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

								updateFileResult(relPath, {
									xmlContent:
										lineCount > 0
											? `<file><path>${relPath}</path>\n<content${lineRangeAttr}>\n${numberedContent}</content>\n</file>`
											: `<file><path>${relPath}</path>\n<content/><notice>File is empty</notice>\n</file>`,
									nativeContent:
										lineCount > 0
											? `File: ${relPath}\nLines 1-${lineCount}:\n${numberedContent}`
											: `File: ${relPath}\nNote: File is empty`,
								})
								continue
							} catch (error) {
								const errorMsg = error instanceof Error ? error.message : String(error)
								updateFileResult(relPath, {
									status: "error",
									error: `Error extracting text: ${errorMsg}`,
									xmlContent: `<file><path>${relPath}</path><error>Error extracting text: ${errorMsg}</error></file>`,
									nativeContent: `File: ${relPath}\nError: Error extracting text: ${errorMsg}`,
								})
								await task.say("error", `Error extracting text from ${relPath}: ${errorMsg}`)
								continue
							}
						} else {
							const fileFormat = fileExtension.slice(1) || "bin"
							updateFileResult(relPath, {
								notice: `Binary file format: ${fileFormat}`,
								xmlContent: `<file><path>${relPath}</path>\n<binary_file format="${fileFormat}">Binary file - content not displayed</binary_file>\n</file>`,
								nativeContent: `File: ${relPath}\nBinary file (${fileFormat}) - content not displayed`,
							})
							continue
						}
					}

					if (fileResult.lineRanges && fileResult.lineRanges.length > 0) {
						const rangeResults: string[] = []
						const nativeRangeResults: string[] = []

						for (const range of fileResult.lineRanges) {
							const content = addLineNumbers(
								await readLines(fullPath, range.end - 1, range.start - 1),
								range.start,
							)
							const lineRangeAttr = ` lines="${range.start}-${range.end}"`
							rangeResults.push(`<content${lineRangeAttr}>\n${content}</content>`)
							nativeRangeResults.push(`Lines ${range.start}-${range.end}:\n${content}`)
						}

						updateFileResult(relPath, {
							xmlContent: `<file><path>${relPath}</path>\n${rangeResults.join("\n")}\n</file>`,
							nativeContent: `File: ${relPath}\n${nativeRangeResults.join("\n\n")}`,
						})
						continue
					}

					if (maxReadFileLine === 0) {
						try {
							const defResult = await parseSourceCodeDefinitionsForFile(
								fullPath,
								task.rooIgnoreController,
							)
							if (defResult) {
								const notice = `Showing only ${maxReadFileLine} of ${totalLines} total lines. Use line_range if you need to read more lines`
								updateFileResult(relPath, {
									xmlContent: `<file><path>${relPath}</path>\n<list_code_definition_names>${defResult}</list_code_definition_names>\n<notice>${notice}</notice>\n</file>`,
									nativeContent: `File: ${relPath}\nCode Definitions:\n${defResult}\n\nNote: ${notice}`,
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

					if (maxReadFileLine > 0 && totalLines > maxReadFileLine) {
						const content = addLineNumbers(await readLines(fullPath, maxReadFileLine - 1, 0))
						const lineRangeAttr = ` lines="1-${maxReadFileLine}"`
						let xmlInfo = `<content${lineRangeAttr}>\n${content}</content>\n`
						let nativeInfo = `Lines 1-${maxReadFileLine}:\n${content}\n`

						try {
							const defResult = await parseSourceCodeDefinitionsForFile(
								fullPath,
								task.rooIgnoreController,
							)
							if (defResult) {
								const truncatedDefs = truncateDefinitionsToLineLimit(defResult, maxReadFileLine)
								xmlInfo += `<list_code_definition_names>${truncatedDefs}</list_code_definition_names>\n`
								nativeInfo += `\nCode Definitions:\n${truncatedDefs}\n`
							}

							const notice = `Showing only ${maxReadFileLine} of ${totalLines} total lines. Use line_range if you need to read more lines`
							xmlInfo += `<notice>${notice}</notice>\n`
							nativeInfo += `\nNote: ${notice}`

							updateFileResult(relPath, {
								xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
								nativeContent: `File: ${relPath}\n${nativeInfo}`,
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

					const { id: modelId, info: modelInfo } = task.api.getModel()
					const { contextTokens } = task.getTokenUsage()
					const contextWindow = modelInfo.contextWindow

					const maxOutputTokens =
						getModelMaxOutputTokens({
							modelId,
							model: modelInfo,
							settings: task.apiConfiguration,
						}) ?? ANTHROPIC_DEFAULT_MAX_TOKENS

					// Calculate available token budget (60% of remaining context)
					const remainingTokens = contextWindow - maxOutputTokens - (contextTokens || 0)
					const safeReadBudget = Math.floor(remainingTokens * FILE_READ_BUDGET_PERCENT)

					let content: string
					let xmlInfo = ""
					let nativeInfo = ""

					if (safeReadBudget <= 0) {
						// No budget available
						content = ""
						const notice = "No available context budget for file reading"
						xmlInfo = `<content/>\n<notice>${notice}</notice>\n`
						nativeInfo = `Note: ${notice}`
					} else {
						// Read file with incremental token counting
						const result = await readFileWithTokenBudget(fullPath, {
							budgetTokens: safeReadBudget,
						})

						content = addLineNumbers(result.content)

						if (!result.complete) {
							// File was truncated
							const notice = `File truncated: showing ${result.lineCount} lines (${result.tokenCount} tokens) due to context budget. Use line_range to read specific sections.`
							const lineRangeAttr = result.lineCount > 0 ? ` lines="1-${result.lineCount}"` : ""
							xmlInfo =
								result.lineCount > 0
									? `<content${lineRangeAttr}>\n${content}</content>\n<notice>${notice}</notice>\n`
									: `<content/>\n<notice>${notice}</notice>\n`
							nativeInfo =
								result.lineCount > 0
									? `Lines 1-${result.lineCount}:\n${content}\n\nNote: ${notice}`
									: `Note: ${notice}`
						} else {
							// Full file read
							const lineRangeAttr = ` lines="1-${result.lineCount}"`
							xmlInfo =
								result.lineCount > 0
									? `<content${lineRangeAttr}>\n${content}</content>\n`
									: `<content/>`

							if (result.lineCount === 0) {
								xmlInfo += `<notice>File is empty</notice>\n`
								nativeInfo = "Note: File is empty"
							} else {
								nativeInfo = `Lines 1-${result.lineCount}:\n${content}`
							}
						}
					}

					await task.fileContextTracker.trackFileContext(relPath, "read_tool" as RecordSource)

					updateFileResult(relPath, {
						xmlContent: `<file><path>${relPath}</path>\n${xmlInfo}</file>`,
						nativeContent: `File: ${relPath}\n${nativeInfo}`,
					})
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error)
					updateFileResult(relPath, {
						status: "error",
						error: `Error reading file: ${errorMsg}`,
						xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
						nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
					})
					await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)
				}
			}

			// Check if any files had errors or were blocked and mark the turn as failed
			const hasErrors = fileResults.some((result) => result.status === "error" || result.status === "blocked")
			if (hasErrors) {
				task.didToolFailInCurrentTurn = true
			}

			// Build final result based on protocol
			let finalResult: string
			if (useNative) {
				const nativeResults = fileResults
					.filter((result) => result.nativeContent)
					.map((result) => result.nativeContent)
				finalResult = nativeResults.join("\n\n---\n\n")
			} else {
				const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)
				finalResult = `<files>\n${xmlResults.join("\n")}\n</files>`
			}

			const fileImageUrls = fileResults
				.filter((result) => result.imageDataUrl)
				.map((result) => result.imageDataUrl as string)

			let statusMessage = ""
			let feedbackImages: any[] = []

			const deniedWithFeedback = fileResults.find((result) => result.status === "denied" && result.feedbackText)

			if (deniedWithFeedback && deniedWithFeedback.feedbackText) {
				statusMessage = formatResponse.toolDeniedWithFeedback(deniedWithFeedback.feedbackText)
				feedbackImages = deniedWithFeedback.feedbackImages || []
			} else if (task.didRejectTool) {
				statusMessage = formatResponse.toolDenied()
			} else {
				const approvedWithFeedback = fileResults.find(
					(result) => result.status === "approved" && result.feedbackText,
				)

				if (approvedWithFeedback && approvedWithFeedback.feedbackText) {
					statusMessage = formatResponse.toolApprovedWithFeedback(approvedWithFeedback.feedbackText)
					feedbackImages = approvedWithFeedback.feedbackImages || []
				}
			}

			const allImages = [...feedbackImages, ...fileImageUrls]

			const finalModelSupportsImages = task.api.getModel().info.supportsImages ?? false
			const imagesToInclude = finalModelSupportsImages ? allImages : []

			if (statusMessage || imagesToInclude.length > 0) {
				const result = formatResponse.toolResult(
					statusMessage || finalResult,
					imagesToInclude.length > 0 ? imagesToInclude : undefined,
				)

				if (typeof result === "string") {
					if (statusMessage) {
						pushToolResult(`${result}\n${finalResult}`)
					} else {
						pushToolResult(result)
					}
				} else {
					if (statusMessage) {
						const textBlock = { type: "text" as const, text: finalResult }
						pushToolResult([...result, textBlock])
					} else {
						pushToolResult(result)
					}
				}
			} else {
				pushToolResult(finalResult)
			}
		} catch (error) {
			const relPath = fileEntries[0]?.path || "unknown"
			const errorMsg = error instanceof Error ? error.message : String(error)

			if (fileResults.length > 0) {
				updateFileResult(relPath, {
					status: "error",
					error: `Error reading file: ${errorMsg}`,
					xmlContent: `<file><path>${relPath}</path><error>Error reading file: ${errorMsg}</error></file>`,
					nativeContent: `File: ${relPath}\nError: Error reading file: ${errorMsg}`,
				})
			}

			await task.say("error", `Error reading file ${relPath}: ${errorMsg}`)

			// Mark that a tool failed in this turn
			task.didToolFailInCurrentTurn = true

			// Build final error result based on protocol
			let errorResult: string
			if (useNative) {
				const nativeResults = fileResults
					.filter((result) => result.nativeContent)
					.map((result) => result.nativeContent)
				errorResult = nativeResults.join("\n\n---\n\n")
			} else {
				const xmlResults = fileResults.filter((result) => result.xmlContent).map((result) => result.xmlContent)
				errorResult = `<files>\n${xmlResults.join("\n")}\n</files>`
			}

			pushToolResult(errorResult)
		}
	}

	getReadFileToolDescription(blockName: string, blockParams: any): string
	getReadFileToolDescription(blockName: string, nativeArgs: { files: FileEntry[] }): string
	getReadFileToolDescription(blockName: string, second: any): string {
		// If native typed args ({ files: FileEntry[] }) were provided
		if (second && typeof second === "object" && "files" in second && Array.isArray(second.files)) {
			const paths = (second.files as FileEntry[]).map((f) => f?.path).filter(Boolean) as string[]
			if (paths.length === 0) {
				return `[${blockName} with no valid paths]`
			} else if (paths.length === 1) {
				return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
			} else if (paths.length <= 3) {
				const pathList = paths.map((p) => `'${p}'`).join(", ")
				return `[${blockName} for ${pathList}]`
			} else {
				return `[${blockName} for ${paths.length} files]`
			}
		}

		// Fallback to legacy/XML or synthesized params
		const blockParams = second as any

		if (blockParams?.args) {
			try {
				const parsed = parseXml(blockParams.args) as any
				const files = Array.isArray(parsed.file) ? parsed.file : [parsed.file].filter(Boolean)
				const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]

				if (paths.length === 0) {
					return `[${blockName} with no valid paths]`
				} else if (paths.length === 1) {
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
		} else if (blockParams?.path) {
			return `[${blockName} for '${blockParams.path}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
		} else if (blockParams?.files) {
			// Back-compat: some paths may still synthesize params.files; try to parse if present
			try {
				const files = JSON.parse(blockParams.files)
				if (Array.isArray(files) && files.length > 0) {
					const paths = files.map((f: any) => f?.path).filter(Boolean) as string[]
					if (paths.length === 1) {
						return `[${blockName} for '${paths[0]}'. Reading multiple files at once is more efficient for the LLM. If other files are relevant to your current task, please read them simultaneously.]`
					} else if (paths.length <= 3) {
						const pathList = paths.map((p) => `'${p}'`).join(", ")
						return `[${blockName} for ${pathList}]`
					} else {
						return `[${blockName} for ${paths.length} files]`
					}
				}
			} catch (error) {
				console.error("Failed to parse native files JSON for description:", error)
				return `[${blockName} with unparsable files]`
			}
		}

		return `[${blockName} with missing path/args/files]`
	}

	override async handlePartial(task: Task, block: ToolUse<"read_file">): Promise<void> {
		const argsXmlTag = block.params.args
		const legacyPath = block.params.path

		let filePath = ""
		if (argsXmlTag) {
			const match = argsXmlTag.match(/<file>.*?<path>([^<]+)<\/path>/s)
			if (match) filePath = match[1]
		}
		if (!filePath && legacyPath) {
			filePath = legacyPath
		}

		if (!filePath && block.nativeArgs && "files" in block.nativeArgs && Array.isArray(block.nativeArgs.files)) {
			const files = block.nativeArgs.files
			if (files.length > 0 && files[0]?.path) {
				filePath = files[0].path
			}
		}

		const fullPath = filePath ? path.resolve(task.cwd, filePath) : ""
		const sharedMessageProps: ClineSayTool = {
			tool: "readFile",
			path: getReadablePath(task.cwd, filePath),
			isOutsideWorkspace: filePath ? isPathOutsideWorkspace(fullPath) : false,
		}
		const partialMessage = JSON.stringify({
			...sharedMessageProps,
			content: undefined,
		} satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(() => {})
	}
}

export const readFileTool = new ReadFileTool()
