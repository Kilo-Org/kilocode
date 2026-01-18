import * as path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { editFileTool } from "../EditFileTool"

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

describe("editFileTool", () => {
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
	 * Helper function to execute the edit_file tool with different parameters
	 */
	async function executeEditFileTool(
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
			name: "edit_file",
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

		await editFileTool.handle(mockTask, toolUse as ToolUse<"edit_file">, {
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
			const result = await executeEditFileTool({ file_path: undefined })

			expect(result).toBe("Missing param error")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit_file")
		})

		it("treats undefined new_string as empty string (deletion)", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: undefined },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("allows empty new_string for deletion", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("returns error when old_string equals new_string", async () => {
			const result = await executeEditFileTool({
				old_string: "same",
				new_string: "same",
			})

			expect(result).toContain("Error:")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})
	})

	describe("file access", () => {
		it("returns error when file does not exist and old_string is not empty", async () => {
			const result = await executeEditFileTool({}, { fileExists: false })

			expect(result).toContain("Error:")
			expect(result).toContain("File not found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("returns error when access is denied", async () => {
			const result = await executeEditFileTool({}, { accessAllowed: false })

			expect(result).toContain("Access denied")
		})
	})

	describe("edit_file logic", () => {
		it("returns error when no match is found", async () => {
			const result = await executeEditFileTool(
				{ old_string: "NonExistent" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("No match found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit_file", "no_match")
		})

		it("returns error when occurrence count does not match expected_replacements", async () => {
			const result = await executeEditFileTool(
				{ old_string: "Line", expected_replacements: "1" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("Expected 1 occurrence(s) but found 3")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit_file", "occurrence_mismatch")
		})

		it("succeeds when occurrence count matches expected_replacements", async () => {
			await executeEditFileTool(
				{ old_string: "Line", new_string: "Row", expected_replacements: "4" },
				{ fileContent: "Line 1\nLine 2\nLine 3\nLine 4" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.editType).toBe("modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("successfully replaces single unique match", async () => {
			await executeEditFileTool(
				{
					old_string: "Line 2",
					new_string: "Modified Line 2",
				},
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.editType).toBe("modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("defaults expected_replacements to 1", async () => {
			const result = await executeEditFileTool(
				{ old_string: "Line" },
				{ fileContent: "Line 1\nLine 2\nLine 3\nLine 4" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("Expected 1 occurrence(s) but found 4")
		})
	})

	describe("file creation", () => {
		it("creates new file when old_string is empty and file does not exist", async () => {
			await executeEditFileTool({ old_string: "", new_string: "New file content" }, { fileExists: false })

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.editType).toBe("create")
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("returns error when trying to create file that already exists", async () => {
			const result = await executeEditFileTool(
				{ old_string: "", new_string: "Content" },
				{ fileExists: true, fileContent: "Existing content" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("already exists")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})
	})

	describe("approval workflow", () => {
		it("saves changes when user approves", async () => {
			mockAskApproval.mockResolvedValue(true)

			await executeEditFileTool()

			expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockTask.didEditFile).toBe(true)
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("edit_file")
		})

		it("reverts changes when user rejects", async () => {
			mockAskApproval.mockResolvedValue(false)

			const result = await executeEditFileTool()

			expect(mockTask.diffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockTask.diffViewProvider.saveChanges).not.toHaveBeenCalled()
			expect(result).toContain("rejected")
		})
	})

	describe("partial block handling", () => {
		it("handles partial block without errors", async () => {
			await executeEditFileTool({}, { isPartial: true })

			expect(mockTask.ask).toHaveBeenCalled()
		})

		it("shows creating new file preview when old_string is empty", async () => {
			await executeEditFileTool({ old_string: "" }, { isPartial: true })

			expect(mockTask.ask).toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("handles file read errors gracefully", async () => {
			mockedFsReadFile.mockRejectedValueOnce(new Error("Read failed"))

			const toolUse: ToolUse = {
				type: "tool_use",
				name: "edit_file",
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

			await editFileTool.handle(mockTask, toolUse as ToolUse<"edit_file">, {
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

			await executeEditFileTool()

			expect(mockHandleError).toHaveBeenCalledWith("edit_file", expect.any(Error))
			expect(mockTask.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("file tracking", () => {
		it("tracks file context after successful edit", async () => {
			await executeEditFileTool()

			expect(mockTask.fileContextTracker.trackFileContext).toHaveBeenCalledWith(testFilePath, "roo_edited")
		})
	})

	describe("CRLF normalization", () => {
		it("normalizes CRLF to LF when reading file", async () => {
			const contentWithCRLF = "Line 1\r\nLine 2\r\nLine 3"

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified Line 2" },
				{ fileContent: contentWithCRLF },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("dollar sign handling", () => {
		it("handles $ in new_string correctly", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Cost: $100" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles multiple $ signs and special patterns like $$ correctly", async () => {
			await executeEditFileTool(
				{ old_string: "price", new_string: "$$ = $$100" },
				{ fileContent: "The price is here" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles $& replacement pattern correctly", async () => {
			await executeEditFileTool(
				{ old_string: "value", new_string: "$& matched $&" },
				{ fileContent: "The value is set" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("path handling", () => {
		it("handles absolute file paths correctly", async () => {
			const absolutePath = process.platform === "win32" ? "C:\\projects\\file.txt" : "/projects/file.txt"
			mockedPathIsAbsolute.mockReturnValue(true)

			await executeEditFileTool(
				{ file_path: absolutePath, old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			// Verify the edit succeeds with absolute path
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles relative file paths correctly", async () => {
			mockedPathIsAbsolute.mockReturnValue(false)

			await executeEditFileTool(
				{ file_path: "src/file.txt", old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			// Verify the edit succeeds with relative path
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("write-protected files", () => {
		it("passes isProtected flag to askApproval for write-protected files", async () => {
			mockTask.rooProtectedController.isWriteProtected.mockReturnValue(true)

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.rooProtectedController.isWriteProtected).toHaveBeenCalled()
			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.any(String),
				undefined,
				true, // isProtected flag
			)
		})

		it("passes isProtected=false for non-protected files", async () => {
			mockTask.rooProtectedController.isWriteProtected.mockReturnValue(false)

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockAskApproval).toHaveBeenCalledWith("tool", expect.any(String), undefined, false)
		})

		it("handles missing rooProtectedController gracefully", async () => {
			mockTask.rooProtectedController = undefined

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("prevent focus disruption experiment", () => {
		it("uses saveDirectly when prevent focus disruption is enabled", async () => {
			mockTask.providerRef.deref.mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 500,
					experiments: { preventFocusDisruption: true },
				}),
			})

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.diffViewProvider.saveDirectly).toHaveBeenCalled()
			expect(mockTask.diffViewProvider.open).not.toHaveBeenCalled()
		})

		it("uses normal diff view workflow when experiment is disabled", async () => {
			mockTask.providerRef.deref.mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
					experiments: {},
				}),
			})

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.diffViewProvider.open).toHaveBeenCalled()
			expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalled()
		})

		it("does not revert changes when rejection happens with experiment enabled", async () => {
			mockTask.providerRef.deref.mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 500,
					experiments: { preventFocusDisruption: true },
				}),
			})
			mockAskApproval.mockResolvedValue(false)

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			// revertChanges should not be called when experiment is enabled
			expect(mockTask.diffViewProvider.revertChanges).not.toHaveBeenCalled()
		})
	})

	describe("edge cases", () => {
		it("handles unicode characters in old_string and new_string", async () => {
			await executeEditFileTool(
				{ old_string: "Hello 世界", new_string: "你好 World 🌍" },
				{ fileContent: "Say Hello 世界 today" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles multiline old_string and new_string", async () => {
			const multilineOld = "function test() {\n  return true;\n}"
			const multilineNew = "function test() {\n  console.log('hello');\n  return false;\n}"

			await executeEditFileTool(
				{ old_string: multilineOld, new_string: multilineNew },
				{ fileContent: `// Comment\n${multilineOld}\n// End` },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles old_string at the beginning of file", async () => {
			await executeEditFileTool(
				{ old_string: "First", new_string: "Modified First" },
				{ fileContent: "First line\nSecond line" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
		})

		it("handles old_string at the end of file", async () => {
			await executeEditFileTool(
				{ old_string: "last line", new_string: "modified last" },
				{ fileContent: "First line\nlast line" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
		})

		it("handles special regex characters in old_string", async () => {
			await executeEditFileTool(
				{ old_string: "test.*pattern", new_string: "replaced" },
				{ fileContent: "This is test.*pattern here" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockAskApproval).toHaveBeenCalled()
		})

		it("handles empty lines in content", async () => {
			await executeEditFileTool(
				{ old_string: "middle", new_string: "replaced" },
				{ fileContent: "first\n\nmiddle\n\nlast" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
		})

		it("handles tabs and mixed whitespace", async () => {
			await executeEditFileTool(
				{ old_string: "\t\tindented", new_string: "    spaces" },
				{ fileContent: "line1\n\t\tindented\nline3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
		})

		it("handles very long strings", async () => {
			const longString = "x".repeat(10000)
			const newLongString = "y".repeat(10000)

			await executeEditFileTool(
				{ old_string: longString, new_string: newLongString },
				{ fileContent: `prefix${longString}suffix` },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
		})
	})

	describe("parseLegacy method", () => {
		it("parses file_path correctly", () => {
			const result = editFileTool.parseLegacy({ file_path: "test.txt" })
			expect(result.file_path).toBe("test.txt")
		})

		it("parses old_string correctly", () => {
			const result = editFileTool.parseLegacy({ old_string: "old content" })
			expect(result.old_string).toBe("old content")
		})

		it("parses new_string correctly", () => {
			const result = editFileTool.parseLegacy({ new_string: "new content" })
			expect(result.new_string).toBe("new content")
		})

		it("parses expected_replacements as integer", () => {
			const result = editFileTool.parseLegacy({ expected_replacements: "5" })
			expect(result.expected_replacements).toBe(5)
		})

		it("returns undefined for missing expected_replacements", () => {
			const result = editFileTool.parseLegacy({})
			expect(result.expected_replacements).toBeUndefined()
		})

		it("returns empty strings for missing required params", () => {
			const result = editFileTool.parseLegacy({})
			expect(result.file_path).toBe("")
			expect(result.old_string).toBe("")
			expect(result.new_string).toBe("")
		})
	})

	describe("multiple replacements", () => {
		it("appends replacement count info to result message when expected_replacements > 1", async () => {
			mockTask.diffViewProvider.pushToolWriteResult.mockResolvedValue("File modified")

			const result = await executeEditFileTool(
				{ old_string: "Line", new_string: "Row", expected_replacements: "4" },
				{ fileContent: "Line 1\nLine 2\nLine 3\nLine 4" },
			)

			expect(result).toContain("(4 replacements)")
		})

		it("does not append replacement info when expected_replacements is 1", async () => {
			mockTask.diffViewProvider.pushToolWriteResult.mockResolvedValue("File modified")

			const result = await executeEditFileTool(
				{ old_string: "unique text", new_string: "replaced", expected_replacements: "1" },
				{ fileContent: "This is unique text here" },
			)

			expect(result).not.toContain("replacements)")
		})
	})

	describe("queued messages processing", () => {
		it("calls processQueuedMessages after successful edit", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.processQueuedMessages).toHaveBeenCalled()
		})

		it("does not call processQueuedMessages when edit is rejected", async () => {
			mockAskApproval.mockResolvedValue(false)

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.processQueuedMessages).not.toHaveBeenCalled()
		})
	})

	describe("outside workspace handling", () => {
		it("includes isOutsideWorkspace flag in tool message", async () => {
			mockedIsPathOutsideWorkspace.mockReturnValue(true)

			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining('"isOutsideWorkspace":true'),
				undefined,
				expect.any(Boolean),
			)
		})
	})

	describe("partial block preview", () => {
		it("truncates long old_string in preview", async () => {
			const longOldString = "x".repeat(100)

			await executeEditFileTool({ old_string: longOldString, new_string: "short" }, { isPartial: true })

			expect(mockTask.ask).toHaveBeenCalled()
			const askCall = mockTask.ask.mock.calls[0]
			const messageContent = askCall[1]
			expect(messageContent).toContain("...")
		})
	})

	describe("diff view behavior", () => {
		it("sets originalContent on diffViewProvider", async () => {
			const content = "Line 1\nLine 2\nLine 3"

			await executeEditFileTool({ old_string: "Line 2", new_string: "Modified" }, { fileContent: content })

			expect(mockTask.diffViewProvider.originalContent).toBe(content)
		})

		it("scrolls to first diff after updating diff view", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.diffViewProvider.scrollToFirstDiff).toHaveBeenCalled()
		})

		it("resets diff view after successful save", async () => {
			await executeEditFileTool(
				{ old_string: "Line 2", new_string: "Modified" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("tool name property", () => {
		it("has correct tool name", () => {
			expect(editFileTool.name).toBe("edit_file")
		})
	})
})
