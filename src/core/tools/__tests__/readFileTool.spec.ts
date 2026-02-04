/**
 * Tests for ReadFileTool - Codex-inspired file reading with indentation mode support.
 *
 * These tests cover:
 * - Input validation (missing path parameter)
 * - RooIgnore blocking
 * - Directory read error handling
 * - Binary file handling (images, PDF, DOCX, unsupported)
 * - Image memory limits
 * - Approval flow (approve, deny, feedback)
 * - Text file processing (slice and indentation modes)
 * - Output structure formatting
 */

import path from "path"

import { isBinaryFile } from "isbinaryfile"

import { readFileTool, ReadFileTool } from "../ReadFileTool"
import { formatResponse } from "../../prompts/responses"
import {
	validateImageForProcessing,
	processImageFile,
	isSupportedImageFormat,
	ImageMemoryTracker,
} from "../helpers/imageHelpers"
import { extractTextFromFile, addLineNumbers, getSupportedBinaryFormats } from "../../../integrations/misc/extract-text"
import { readWithIndentation, readWithSlice } from "../../../integrations/misc/indentation-reader"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		default: originalPath,
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => args.join("/")),
	}
})

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	stat: vi.fn(),
}))

vi.mock("isbinaryfile")

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn(),
	addLineNumbers: vi.fn().mockImplementation((text: string, startLine = 1) => {
		if (!text) return ""
		const lines = text.split("\n")
		return lines.map((line, i) => `${startLine + i} | ${line}`).join("\n")
	}),
	getSupportedBinaryFormats: vi.fn(() => [".pdf", ".docx", ".ipynb"]),
}))

vi.mock("../../../integrations/misc/indentation-reader", () => ({
	readWithIndentation: vi.fn(),
	readWithSlice: vi.fn(),
}))

vi.mock("../helpers/imageHelpers", () => ({
	DEFAULT_MAX_IMAGE_FILE_SIZE_MB: 5,
	DEFAULT_MAX_TOTAL_IMAGE_SIZE_MB: 20,
	isSupportedImageFormat: vi.fn(),
	validateImageForProcessing: vi.fn(),
	processImageFile: vi.fn(),
	ImageMemoryTracker: vi.fn().mockImplementation(() => ({
		getTotalMemoryUsed: vi.fn().mockReturnValue(0),
		addMemoryUsage: vi.fn(),
	})),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolDenied: vi.fn(() => "The user denied this operation."),
		toolDeniedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user denied this operation and responded with the message:\n<user_message>\n${feedback}\n</user_message>`,
		),
		toolApprovedWithFeedback: vi.fn(
			(feedback?: string) =>
				`The user approved this operation and responded with the message:\n<user_message>\n${feedback}\n</user_message>`,
		),
		rooIgnoreError: vi.fn(
			(filePath: string) =>
				`Access to ${filePath} is blocked by the .rooignore file settings. You must try to continue in the task without using this file, or ask the user to update the .rooignore file.`,
		),
		toolResult: vi.fn((text: string, images?: string[]) => {
			if (images && images.length > 0) {
				return [
					{ type: "text", text },
					...images.map((img) => {
						const [header, data] = img.split(",")
						const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
						return { type: "image", source: { type: "base64", media_type, data } }
					}),
				]
			}
			return text
		}),
		imageBlocks: vi.fn((images?: string[]) => {
			return images
				? images.map((img) => {
						const [header, data] = img.split(",")
						const media_type = header.match(/:(.*?);/)?.[1] || "image/png"
						return { type: "image", source: { type: "base64", media_type, data } }
					})
				: []
		}),
	},
}))

// Mock fs/promises
const fsPromises = await import("fs/promises")
const mockedFsReadFile = vi.mocked(fsPromises.readFile)
const mockedFsStat = vi.mocked(fsPromises.stat)

const mockedIsBinaryFile = vi.mocked(isBinaryFile)
const mockedExtractTextFromFile = vi.mocked(extractTextFromFile)
const mockedReadWithSlice = vi.mocked(readWithSlice)
const mockedReadWithIndentation = vi.mocked(readWithIndentation)
const mockedIsSupportedImageFormat = vi.mocked(isSupportedImageFormat)
const mockedValidateImageForProcessing = vi.mocked(validateImageForProcessing)
const mockedProcessImageFile = vi.mocked(processImageFile)

// ─── Test Helpers ─────────────────────────────────────────────────────────────

interface MockTaskOptions {
	supportsImages?: boolean
	rooIgnoreAllowed?: boolean
	maxImageFileSize?: number
	maxTotalImageSize?: number
}

function createMockTask(options: MockTaskOptions = {}) {
	const { supportsImages = false, rooIgnoreAllowed = true, maxImageFileSize = 5, maxTotalImageSize = 20 } = options

	return {
		cwd: "/test/workspace",
		api: {
			getModel: vi.fn().mockReturnValue({
				info: { supportsImages },
			}),
		},
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		didRejectTool: false,
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: undefined, images: undefined }),
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("Missing required parameter: path"),
		recordToolError: vi.fn(),
		rooIgnoreController: {
			validateAccess: vi.fn().mockReturnValue(rooIgnoreAllowed),
		},
		fileContextTracker: {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		},
		providerRef: {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					maxImageFileSize,
					maxTotalImageSize,
				}),
			}),
			countTokens: vi.fn().mockResolvedValue(100), // Mock countTokens to return a small number
		},
	}
}

function createMockCallbacks() {
	return {
		pushToolResult: vi.fn(),
		askApproval: vi.fn(),
		handleError: vi.fn(),
	}
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ReadFileTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()

		// Default mock implementations
		mockedFsStat.mockResolvedValue({ isDirectory: () => false } as any)
		mockedIsBinaryFile.mockResolvedValue(false)
		mockedFsReadFile.mockResolvedValue(Buffer.from("test content"))
		mockedReadWithSlice.mockReturnValue({
			content: "1 | test content",
			returnedLines: 1,
			totalLines: 1,
			wasTruncated: false,
			includedRanges: [[1, 1]],
		})
	})

	describe("input validation", () => {
		it("should return error when path is missing", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute({ path: "" } as any, mockTask as any, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("read_file")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("read_file", "path")
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error:"))
		})

		it("should return error when path is undefined", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute({} as any, mockTask as any, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error:"))
		})

		it("should return error when offset is 0 or negative", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute({ path: "test.txt", offset: 0 }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("offset must be a 1-indexed line number"),
			)
		})

		it("should return error when offset is negative", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute({ path: "test.txt", offset: -5 }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("offset must be a 1-indexed line number"),
			)
		})

		it("should return error when anchor_line is 0 or negative", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute(
				{
					path: "test.txt",
					mode: "indentation",
					indentation: { anchor_line: 0 },
				},
				mockTask as any,
				callbacks,
			)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("anchor_line must be a 1-indexed line number"),
			)
		})

		it("should return error when anchor_line is negative", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			await readFileTool.execute(
				{
					path: "test.txt",
					mode: "indentation",
					indentation: { anchor_line: -10 },
				},
				mockTask as any,
				callbacks,
			)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("anchor_line must be a 1-indexed line number"),
			)
		})
	})

	describe("RooIgnore handling", () => {
		it("should block access to rooignore-protected files", async () => {
			const mockTask = createMockTask({ rooIgnoreAllowed: false })
			const callbacks = createMockCallbacks()

			await readFileTool.execute({ path: "secret.env" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("rooignore_error", "secret.env")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith("secret.env")
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("blocked by the .rooignore"))
		})
	})

	describe("directory handling", () => {
		it("should return error when trying to read a directory", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsStat.mockResolvedValue({ isDirectory: () => true } as any)

			await readFileTool.execute({ path: "src/utils" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith(
				"error",
				expect.stringContaining("Cannot read 'src/utils' because it is a directory"),
			)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("it is a directory"))
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		})
	})

	describe("image handling", () => {
		beforeEach(() => {
			mockedIsBinaryFile.mockResolvedValue(true)
			mockedIsSupportedImageFormat.mockReturnValue(true)
		})

		it("should process image file when model supports images", async () => {
			const mockTask = createMockTask({ supportsImages: true })
			const callbacks = createMockCallbacks()

			mockedValidateImageForProcessing.mockResolvedValue({
				isValid: true,
				sizeInMB: 0.5,
			})
			mockedProcessImageFile.mockResolvedValue({
				dataUrl: "data:image/png;base64,abc123",
				buffer: Buffer.from("test"),
				sizeInKB: 512,
				sizeInMB: 0.5,
				notice: "Image processed successfully",
			})

			await readFileTool.execute({ path: "image.png" }, mockTask as any, callbacks)

			expect(mockedValidateImageForProcessing).toHaveBeenCalled()
			expect(mockedProcessImageFile).toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalled()
		})

		it("should skip image when model does not support images", async () => {
			const mockTask = createMockTask({ supportsImages: false })
			const callbacks = createMockCallbacks()

			mockedValidateImageForProcessing.mockResolvedValue({
				isValid: false,
				reason: "unsupported_model",
				notice: "Model does not support image processing",
			})

			await readFileTool.execute({ path: "image.png" }, mockTask as any, callbacks)

			expect(mockedValidateImageForProcessing).toHaveBeenCalled()
			expect(mockedProcessImageFile).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Model does not support image processing"),
			)
		})

		it("should skip image when file exceeds size limit", async () => {
			const mockTask = createMockTask({ supportsImages: true, maxImageFileSize: 1 })
			const callbacks = createMockCallbacks()

			mockedValidateImageForProcessing.mockResolvedValue({
				isValid: false,
				reason: "size_limit",
				notice: "Image file size (10 MB) exceeds the maximum allowed size (1 MB)",
			})

			await readFileTool.execute({ path: "large-image.png" }, mockTask as any, callbacks)

			expect(mockedProcessImageFile).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("exceeds the maximum allowed"),
			)
		})

		it("should skip image when total memory limit exceeded", async () => {
			const mockTask = createMockTask({ supportsImages: true, maxTotalImageSize: 5 })
			const callbacks = createMockCallbacks()

			mockedValidateImageForProcessing.mockResolvedValue({
				isValid: false,
				reason: "memory_limit",
				notice: "Skipping image: would exceed total memory limit",
			})

			await readFileTool.execute({ path: "another-image.png" }, mockTask as any, callbacks)

			expect(mockedProcessImageFile).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("would exceed total memory"))
		})

		it("should handle image read errors gracefully", async () => {
			const mockTask = createMockTask({ supportsImages: true })
			const callbacks = createMockCallbacks()

			mockedValidateImageForProcessing.mockResolvedValue({
				isValid: true,
				sizeInMB: 0.5,
			})
			mockedProcessImageFile.mockRejectedValue(new Error("Failed to read image"))

			await readFileTool.execute({ path: "corrupt.png" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Error reading image file"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error"))
		})
	})

	describe("binary file handling", () => {
		beforeEach(() => {
			mockedIsBinaryFile.mockResolvedValue(true)
			mockedIsSupportedImageFormat.mockReturnValue(false)
		})

		it("should extract text from PDF files", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedExtractTextFromFile.mockResolvedValue("PDF content here")

			await readFileTool.execute({ path: "document.pdf" }, mockTask as any, callbacks)

			expect(mockedExtractTextFromFile).toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("PDF content here"))
		})

		it("should extract text from DOCX files", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedExtractTextFromFile.mockResolvedValue("DOCX content here")

			await readFileTool.execute({ path: "document.docx" }, mockTask as any, callbacks)

			expect(mockedExtractTextFromFile).toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("DOCX content here"))
		})

		it("should handle unsupported binary formats", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			// Return empty array to indicate .exe is not supported
			vi.mocked(getSupportedBinaryFormats).mockReturnValue([".pdf", ".docx"])

			await readFileTool.execute({ path: "program.exe" }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Binary file"))
		})

		it("should handle extraction errors gracefully", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedExtractTextFromFile.mockRejectedValue(new Error("Extraction failed"))

			await readFileTool.execute({ path: "corrupt.pdf" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Error extracting text"))
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		})
	})

	describe("text file processing", () => {
		beforeEach(() => {
			mockedIsBinaryFile.mockResolvedValue(false)
		})

		it("should read text file with slice mode (default)", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			const content = "line 1\nline 2\nline 3"
			mockedFsReadFile.mockResolvedValue(Buffer.from(content))
			mockedReadWithSlice.mockReturnValue({
				content: "1 | line 1\n2 | line 2\n3 | line 3",
				returnedLines: 3,
				totalLines: 3,
				wasTruncated: false,
				includedRanges: [[1, 3]],
			})

			await readFileTool.execute({ path: "test.ts" }, mockTask as any, callbacks)

			expect(mockedReadWithSlice).toHaveBeenCalled()
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("line 1"))
		})

		it("should read text file with offset and limit", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockResolvedValue(Buffer.from("line 1\nline 2\nline 3\nline 4\nline 5"))
			mockedReadWithSlice.mockReturnValue({
				content: "2 | line 2\n3 | line 3",
				returnedLines: 2,
				totalLines: 5,
				wasTruncated: true,
				includedRanges: [[2, 3]],
			})

			await readFileTool.execute(
				{ path: "test.ts", mode: "slice", offset: 2, limit: 2 },
				mockTask as any,
				callbacks,
			)

			expect(mockedReadWithSlice).toHaveBeenCalledWith(expect.any(String), 1, 2) // offset converted to 0-based
		})

		it("should read text file with indentation mode", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			const content = "class Foo {\n  method() {\n    return 42\n  }\n}"
			mockedFsReadFile.mockResolvedValue(Buffer.from(content))
			mockedReadWithIndentation.mockReturnValue({
				content: "1 | class Foo {\n2 |   method() {\n3 |     return 42\n4 |   }\n5 | }",
				returnedLines: 5,
				totalLines: 5,
				wasTruncated: false,
				includedRanges: [[1, 5]],
			})

			await readFileTool.execute(
				{
					path: "test.ts",
					mode: "indentation",
					indentation: { anchor_line: 3 },
				},
				mockTask as any,
				callbacks,
			)

			expect(mockedReadWithIndentation).toHaveBeenCalledWith(
				content,
				expect.objectContaining({
					anchorLine: 3,
				}),
			)
		})

		it("should show truncation notice when content is truncated", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockResolvedValue(Buffer.from("lots of content..."))
			mockedReadWithSlice.mockReturnValue({
				content: "1 | truncated content",
				returnedLines: 100,
				totalLines: 5000,
				wasTruncated: true,
				includedRanges: [[1, 100]],
			})

			await readFileTool.execute({ path: "large.ts" }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("truncated"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("To read more"))
		})

		it("should handle empty files", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockResolvedValue(Buffer.from(""))
			mockedReadWithSlice.mockReturnValue({
				content: "",
				returnedLines: 0,
				totalLines: 0,
				wasTruncated: false,
				includedRanges: [],
			})

			await readFileTool.execute({ path: "empty.ts" }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("empty"))
		})
	})

	describe("approval flow", () => {
		it("should approve file read when user clicks yes", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockTask.ask.mockResolvedValue({ response: "yesButtonClicked", text: undefined, images: undefined })

			await readFileTool.execute({ path: "test.ts" }, mockTask as any, callbacks)

			expect(mockTask.ask).toHaveBeenCalledWith("tool", expect.any(String), false)
			expect(mockTask.didRejectTool).toBe(false)
		})

		it("should deny file read when user clicks no", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockTask.ask.mockResolvedValue({ response: "noButtonClicked", text: undefined, images: undefined })

			await readFileTool.execute({ path: "test.ts" }, mockTask as any, callbacks)

			expect(mockTask.didRejectTool).toBe(true)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Denied by user"))
		})

		it("should include user feedback when provided with approval", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockTask.ask.mockResolvedValue({
				response: "yesButtonClicked",
				text: "Please be careful with this file",
				images: undefined,
			})
			mockedFsReadFile.mockResolvedValue(Buffer.from("content"))
			mockedReadWithSlice.mockReturnValue({
				content: "1 | content",
				returnedLines: 1,
				totalLines: 1,
				wasTruncated: false,
				includedRanges: [[1, 1]],
			})

			await readFileTool.execute({ path: "test.ts" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("user_feedback", "Please be careful with this file", undefined)
			expect(formatResponse.toolApprovedWithFeedback).toHaveBeenCalledWith("Please be careful with this file")
		})

		it("should include user feedback when provided with denial", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockTask.ask.mockResolvedValue({
				response: "noButtonClicked",
				text: "This file contains secrets",
				images: undefined,
			})

			await readFileTool.execute({ path: "secrets.env" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("user_feedback", "This file contains secrets", undefined)
			expect(formatResponse.toolDeniedWithFeedback).toHaveBeenCalledWith("This file contains secrets")
		})
	})

	describe("output structure", () => {
		it("should include file path in output", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockResolvedValue(Buffer.from("content"))
			mockedReadWithSlice.mockReturnValue({
				content: "1 | content",
				returnedLines: 1,
				totalLines: 1,
				wasTruncated: false,
				includedRanges: [[1, 1]],
			})

			await readFileTool.execute({ path: "src/app.ts" }, mockTask as any, callbacks)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("File: src/app.ts"))
		})

		it("should track file context after successful read", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockResolvedValue(Buffer.from("content"))
			mockedReadWithSlice.mockReturnValue({
				content: "1 | content",
				returnedLines: 1,
				totalLines: 1,
				wasTruncated: false,
				includedRanges: [[1, 1]],
			})

			await readFileTool.execute({ path: "test.ts" }, mockTask as any, callbacks)

			expect(mockTask.fileContextTracker.trackFileContext).toHaveBeenCalledWith("test.ts", "read_tool")
		})
	})

	describe("error handling", () => {
		it("should handle file read errors gracefully", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsReadFile.mockRejectedValue(new Error("ENOENT: no such file or directory"))

			await readFileTool.execute({ path: "nonexistent.ts" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Error reading file"))
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		})

		it("should handle stat errors gracefully", async () => {
			const mockTask = createMockTask()
			const callbacks = createMockCallbacks()

			mockedFsStat.mockRejectedValue(new Error("Permission denied"))

			await readFileTool.execute({ path: "protected.ts" }, mockTask as any, callbacks)

			expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("Error reading file"))
			expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		})
	})

	describe("getReadFileToolDescription", () => {
		it("should return description with path when nativeArgs provided", () => {
			const description = readFileTool.getReadFileToolDescription("read_file", { path: "src/app.ts" })

			expect(description).toBe("[read_file for 'src/app.ts']")
		})

		it("should return description with path when params provided", () => {
			const description = readFileTool.getReadFileToolDescription("read_file", { path: "src/app.ts" })

			expect(description).toBe("[read_file for 'src/app.ts']")
		})

		it("should return description indicating missing path", () => {
			const description = readFileTool.getReadFileToolDescription("read_file", {})

			expect(description).toBe("[read_file with missing path]")
		})
	})
})
