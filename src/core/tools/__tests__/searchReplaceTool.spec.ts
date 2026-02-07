import * as path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { searchReplaceTool } from "../SearchReplaceTool"

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue(""),
	},
}))

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => {
			const separator = process.platform === "win32" ? "\\" : "/"
			return args.join(separator)
		}),
		isAbsolute: vi.fn().mockReturnValue(false),
		relative: vi.fn().mockImplementation((from, to) => to),
	}
})

vi.mock("delay", () => ({
	default: vi.fn(),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg) => `Error: ${msg}`),
		rooIgnoreError: vi.fn((path) => `Access denied: ${path}`),
		createPrettyPatch: vi.fn(() => "mock-diff"),
	},
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn().mockReturnValue("test/path.txt"),
}))

vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff) => diff),
	computeDiffStats: vi.fn(() => ({ additions: 1, deletions: 1 })),
}))

vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn().mockResolvedValue(undefined),
	},
	env: {
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
	},
}))

describe("searchReplaceTool", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = process.platform === "win32" ? "C:\\test\\file.txt" : "/test/file.txt"
	const testFileContent = "Line 1\nLine 2\nLine 3\nLine 4"
	const testOldString = "Line 2"
	const testNewString = "Modified Line 2"

	// Mocked functions
	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedFsReadFile = fs.readFile as unknown as MockedFunction<
		(path: string, encoding: string) => Promise<string>
	>
	const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as MockedFunction<typeof isPathOutsideWorkspace>
	const mockedGetReadablePath = getReadablePath as MockedFunction<typeof getReadablePath>
	const mockedPathResolve = path.resolve as MockedFunction<typeof path.resolve>
	const mockedPathIsAbsolute = path.isAbsolute as MockedFunction<typeof path.isAbsolute>

	const mockCline: any = {}
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockRemoveClosingTag: ReturnType<typeof vi.fn>
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedPathIsAbsolute.mockReturnValue(false)
		mockedFileExistsAtPath.mockResolvedValue(true)
		mockedFsReadFile.mockResolvedValue(testFileContent)
		mockedIsPathOutsideWorkspace.mockReturnValue(false)
		mockedGetReadablePath.mockReturnValue("test/path.txt")

		mockCline.cwd = "/"
		mockCline.consecutiveMistakeCount = 0
		mockCline.didEditFile = false
		mockCline.providerRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
					experiments: {},
				}),
			}),
		}
		mockCline.rooIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(true),
		}
		mockCline.rooProtectedController = {
			isWriteProtected: vi.fn().mockReturnValue(false),
		}
		mockCline.diffViewProvider = {
			editType: undefined,
			isEditing: false,
			originalContent: "",
			open: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn().mockResolvedValue(undefined),
			revertChanges: vi.fn().mockResolvedValue(undefined),
			saveChanges: vi.fn().mockResolvedValue({
				newProblemsMessage: "",
				userEdits: null,
				finalContent: "final content",
			}),
			saveDirectly: vi.fn().mockResolvedValue(undefined),
			scrollToFirstDiff: vi.fn(),
			pushToolWriteResult: vi.fn().mockResolvedValue("Tool result message"),
		}
		mockCline.fileContextTracker = {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		}
		mockCline.say = vi.fn().mockResolvedValue(undefined)
		mockCline.ask = vi.fn().mockResolvedValue(undefined)
		mockCline.recordToolError = vi.fn()
		mockCline.recordToolUsage = vi.fn()
		mockCline.processQueuedMessages = vi.fn()
		mockCline.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockRemoveClosingTag = vi.fn((tag, content) => content)

		toolResult = undefined
	})

	/**
	 * Helper function to execute the search replace tool with different parameters
	 */
	async function executeSearchReplaceTool(
		params: Partial<ToolUse["params"]> = {},
		options: {
			fileExists?: boolean
			fileContent?: string
			isPartial?: boolean
			accessAllowed?: boolean
		} = {},
	): Promise<ToolResponse | undefined> {
		const fileExists = options.fileExists ?? true
		const fileContent = options.fileContent ?? testFileContent
		const isPartial = options.isPartial ?? false
		const accessAllowed = options.accessAllowed ?? true

		mockedFileExistsAtPath.mockResolvedValue(fileExists)
		mockedFsReadFile.mockResolvedValue(fileContent)
		mockCline.rooIgnoreController.validateAccess.mockReturnValue(accessAllowed)

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "search_replace",
			params: {
				file_path: testFilePath,
				old_string: testOldString,
				new_string: testNewString,
				...params,
			},
			partial: isPartial,
		}

		mockPushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})

		await searchReplaceTool.handle(mockCline, toolUse as ToolUse<"search_replace">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})

		return toolResult
	}

	describe("parameter validation", () => {
		it("returns error when file_path is missing", async () => {
			const result = await executeSearchReplaceTool({ file_path: undefined })

			expect(result).toBe("Missing param error")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("search_replace")
		})

		it("returns error when old_string is missing", async () => {
			const result = await executeSearchReplaceTool({ old_string: undefined })

			expect(result).toBe("Missing param error")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
		})

		it("allows empty new_string for deletion", async () => {
			// Empty new_string is valid - it means delete the old_string
			await executeSearchReplaceTool(
				{ old_string: "Line 2", new_string: "" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			// Should proceed to approval (not error out)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("returns error when old_string equals new_string", async () => {
			const result = await executeSearchReplaceTool({
				old_string: "same",
				new_string: "same",
			})

			expect(result).toContain("Error:")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
		})
	})

	describe("file access", () => {
		it("returns error when file does not exist", async () => {
			const result = await executeSearchReplaceTool({}, { fileExists: false })

			expect(result).toContain("Error:")
			expect(result).toContain("File not found")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
		})

		it("returns error when access is denied", async () => {
			const result = await executeSearchReplaceTool({}, { accessAllowed: false })

			expect(result).toContain("Access denied")
		})
	})

	describe("search and replace logic", () => {
		it("returns error when no match is found", async () => {
			const result = await executeSearchReplaceTool(
				{ old_string: "NonExistent" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("No match found")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("search_replace", "no_match")
		})

		it("returns error when multiple matches are found", async () => {
			const result = await executeSearchReplaceTool(
				{ old_string: "Line" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("3 matches")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("search_replace", "multiple_matches")
		})

		it("successfully replaces single unique match", async () => {
			await executeSearchReplaceTool(
				{
					old_string: "Line 2",
					new_string: "Modified Line 2",
				},
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockCline.diffViewProvider.editType).toBe("modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("approval workflow", () => {
		it("saves changes when user approves", async () => {
			mockAskApproval.mockResolvedValue(true)

			await executeSearchReplaceTool()

			expect(mockCline.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockCline.didEditFile).toBe(true)
			expect(mockCline.recordToolUsage).toHaveBeenCalledWith("search_replace")
		})

		it("reverts changes when user rejects", async () => {
			mockAskApproval.mockResolvedValue(false)

			const result = await executeSearchReplaceTool()

			expect(mockCline.diffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockCline.diffViewProvider.saveChanges).not.toHaveBeenCalled()
			expect(result).toContain("rejected")
		})
	})

	describe("partial block handling", () => {
		it("handles partial block without errors after path stabilizes", async () => {
			// Path stabilization requires two consecutive calls with the same path
			// First call sets lastSeenPartialPath, second call sees it has stabilized
			await executeSearchReplaceTool({}, { isPartial: true })
			await executeSearchReplaceTool({}, { isPartial: true })

			expect(mockCline.ask).toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("handles file read errors gracefully", async () => {
			// Set up the rejection BEFORE executing
			mockedFsReadFile.mockRejectedValueOnce(new Error("Read failed"))

			const toolUse: ToolUse = {
				type: "tool_use",
				name: "search_replace",
				params: {
					file_path: testFilePath,
					old_string: testOldString,
					new_string: testNewString,
				},
				partial: false,
			}

			let capturedResult: ToolResponse | undefined
			const localPushToolResult = vi.fn((result: ToolResponse) => {
				capturedResult = result
			})

			await searchReplaceTool.handle(mockCline, toolUse as ToolUse<"search_replace">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: localPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "native",
			})

			expect(capturedResult).toContain("Error:")
			expect(capturedResult).toContain("Failed to read file")
			expect(mockCline.consecutiveMistakeCount).toBe(1)
		})

		it("handles general errors and resets diff view", async () => {
			mockCline.diffViewProvider.open.mockRejectedValueOnce(new Error("General error"))

			await executeSearchReplaceTool()

			expect(mockHandleError).toHaveBeenCalledWith("search and replace", expect.any(Error))
			expect(mockCline.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("file tracking", () => {
		it("tracks file context after successful edit", async () => {
			await executeSearchReplaceTool()

			expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith(testFilePath, "roo_edited")
		})
	})

	describe("CRLF normalization", () => {
		it("normalizes CRLF to LF when reading file", async () => {
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"

			await executeSearchReplaceTool(
				{ old_string: "Line 2", new_string: "Modified Line 2" },
				{ fileContent: contentWithCRLF },
			)

			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("normalizes CRLF in old_string to match LF-normalized file content", async () => {
			// File has CRLF line endings
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"
			// Search string also has CRLF (simulating what the model might send)
			const searchWithCRLF = "Line 1\r\nLine 2"

			await executeSearchReplaceTool(
				{ old_string: searchWithCRLF, new_string: "Modified Lines" },
				{ fileContent: contentWithCRLF },
			)

			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("matches LF old_string against CRLF file content after normalization", async () => {
			// File has CRLF line endings
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"
			// Search string has LF (typical model output)
			const searchWithLF = "Line 1\nLine 2"

			await executeSearchReplaceTool(
				{ old_string: searchWithLF, new_string: "Modified Lines" },
				{ fileContent: contentWithCRLF },
			)

			expect(mockCline.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})
})
