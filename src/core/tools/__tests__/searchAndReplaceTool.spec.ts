import * as path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { searchAndReplaceTool } from "../SearchAndReplaceTool"

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

describe("searchAndReplaceTool", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = process.platform === "win32" ? "C:\\test\\file.txt" : "/test/file.txt"
	const testFileContent = "Line 1\nLine 2\nLine 3\nLine 4"

	// Mocked functions
	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedFsReadFile = fs.readFile as unknown as MockedFunction<
		(path: string, encoding: string) => Promise<string>
	>
	const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as MockedFunction<typeof isPathOutsideWorkspace>
	const mockedGetReadablePath = getReadablePath as MockedFunction<typeof getReadablePath>
	const mockedPathResolve = path.resolve as MockedFunction<typeof path.resolve>
	const mockedPathIsAbsolute = path.isAbsolute as MockedFunction<typeof path.isAbsolute>

	const mockTask: any = {}
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

		mockTask.cwd = "/"
		mockTask.consecutiveMistakeCount = 0
		mockTask.didEditFile = false
		mockTask.providerRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
					experiments: {},
				}),
			}),
		}
		mockTask.rooIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(true),
		}
		mockTask.rooProtectedController = {
			isWriteProtected: vi.fn().mockReturnValue(false),
		}
		mockTask.diffViewProvider = {
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
		mockTask.fileContextTracker = {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		}
		mockTask.say = vi.fn().mockResolvedValue(undefined)
		mockTask.ask = vi.fn().mockResolvedValue(undefined)
		mockTask.recordToolError = vi.fn()
		mockTask.recordToolUsage = vi.fn()
		mockTask.processQueuedMessages = vi.fn()
		mockTask.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)
		mockRemoveClosingTag = vi.fn((tag, content) => content)

		toolResult = undefined
	})

	/**
	 * Helper function to execute the search and replace tool with different parameters
	 */
	async function executeSearchAndReplaceTool(
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
		mockTask.rooIgnoreController.validateAccess.mockReturnValue(accessAllowed)

		const toolUse: ToolUse = {
			type: "tool_use",
			name: "search_and_replace",
			params: {
				path: testFilePath,
				operations: JSON.stringify([{ search: "Line 2", replace: "Modified Line 2" }]),
				...params,
			},
			partial: isPartial,
		}

		mockPushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})

		await searchAndReplaceTool.handle(mockTask, toolUse as ToolUse<"search_and_replace">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
			removeClosingTag: mockRemoveClosingTag,
			toolProtocol: "native",
		})

		return toolResult
	}

	describe("parameter validation", () => {
		it("returns error when path is missing", async () => {
			const result = await executeSearchAndReplaceTool({ path: undefined })

			expect(result).toBe("Missing param error")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("search_and_replace")
		})

		it("returns error when operations is missing", async () => {
			const result = await executeSearchAndReplaceTool({ operations: undefined })

			expect(result).toContain("Error:")
			expect(result).toContain("Missing or empty 'operations' parameter")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("returns error when operations is empty array", async () => {
			const result = await executeSearchAndReplaceTool({ operations: JSON.stringify([]) })

			expect(result).toContain("Error:")
			expect(result).toContain("Missing or empty 'operations' parameter")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})
	})

	describe("file access", () => {
		it("returns error when file does not exist", async () => {
			const result = await executeSearchAndReplaceTool({}, { fileExists: false })

			expect(result).toContain("Error:")
			expect(result).toContain("File not found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("returns error when access is denied", async () => {
			const result = await executeSearchAndReplaceTool({}, { accessAllowed: false })

			expect(result).toContain("Access denied")
		})
	})

	describe("search and replace logic", () => {
		it("returns error when no match is found", async () => {
			const result = await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: "NonExistent", replace: "New" }]) },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("No match found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("search_and_replace", "no_match")
		})

		it("returns error when multiple matches are found", async () => {
			const result = await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: "Line", replace: "Row" }]) },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("3 matches")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("successfully replaces single unique match", async () => {
			await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: "Line 2", replace: "Modified Line 2" }]) },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.editType).toBe("modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("CRLF normalization", () => {
		it("normalizes CRLF to LF when reading file", async () => {
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"

			await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: "Line 2", replace: "Modified Line 2" }]) },
				{ fileContent: contentWithCRLF },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("normalizes CRLF in search string to match LF-normalized file content", async () => {
			// File has CRLF line endings
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"
			// Search string also has CRLF (simulating what the model might send)
			const searchWithCRLF = "Line 1\r\nLine 2"

			await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: searchWithCRLF, replace: "Modified Lines" }]) },
				{ fileContent: contentWithCRLF },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("matches LF search string against CRLF file content after normalization", async () => {
			// File has CRLF line endings
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"
			// Search string has LF (typical model output)
			const searchWithLF = "Line 1\nLine 2"

			await executeSearchAndReplaceTool(
				{ operations: JSON.stringify([{ search: searchWithLF, replace: "Modified Lines" }]) },
				{ fileContent: contentWithCRLF },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("approval workflow", () => {
		it("saves changes when user approves", async () => {
			mockAskApproval.mockResolvedValue(true)

			await executeSearchAndReplaceTool()

			expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockTask.didEditFile).toBe(true)
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("search_and_replace")
		})

		it("reverts changes when user rejects", async () => {
			mockAskApproval.mockResolvedValue(false)

			const result = await executeSearchAndReplaceTool()

			expect(mockTask.diffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockTask.diffViewProvider.saveChanges).not.toHaveBeenCalled()
			expect(result).toContain("rejected")
		})
	})

	describe("partial block handling", () => {
		it("handles partial block without errors after path stabilizes", async () => {
			// Path stabilization requires two consecutive calls with the same path
			// First call sets lastSeenPartialPath, second call sees it has stabilized
			await executeSearchAndReplaceTool({}, { isPartial: true })
			await executeSearchAndReplaceTool({}, { isPartial: true })

			expect(mockTask.ask).toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("handles file read errors gracefully", async () => {
			mockedFsReadFile.mockRejectedValueOnce(new Error("Read failed"))

			const toolUse: ToolUse = {
				type: "tool_use",
				name: "search_and_replace",
				params: {
					path: testFilePath,
					operations: JSON.stringify([{ search: "Line 2", replace: "Modified" }]),
				},
				partial: false,
			}

			let capturedResult: ToolResponse | undefined
			const localPushToolResult = vi.fn((result: ToolResponse) => {
				capturedResult = result
			})

			await searchAndReplaceTool.handle(mockTask, toolUse as ToolUse<"search_and_replace">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: localPushToolResult,
				removeClosingTag: mockRemoveClosingTag,
				toolProtocol: "native",
			})

			expect(capturedResult).toContain("Error:")
			expect(capturedResult).toContain("Failed to read file")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("handles general errors and resets diff view", async () => {
			mockTask.diffViewProvider.open.mockRejectedValueOnce(new Error("General error"))

			await executeSearchAndReplaceTool()

			expect(mockHandleError).toHaveBeenCalledWith("search and replace", expect.any(Error))
			expect(mockTask.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("file tracking", () => {
		it("tracks file context after successful edit", async () => {
			await executeSearchAndReplaceTool()

			expect(mockTask.fileContextTracker.trackFileContext).toHaveBeenCalledWith(testFilePath, "roo_edited")
		})
	})
})
