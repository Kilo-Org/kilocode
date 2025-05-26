import { refactorCodeTool } from "../refactorCodeTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"
import { VSCodeRefactoringAdapter } from "../../../services/code-transform/vscodeAdapter"

jest.mock("../../../services/code-transform/vscodeAdapter")

// Mock VSCode API as it's not available in the test environment
jest.mock("vscode", () => ({
	Uri: {
		file: jest.fn((path) => ({
			fsPath: path,
			toString: () => `file://${path}`,
		})),
	},
	workspace: {
		openTextDocument: jest.fn(),
		applyEdit: jest.fn(),
	},
	window: {
		showTextDocument: jest.fn(),
	},
	commands: {
		executeCommand: jest.fn(),
	},
	Position: jest.fn((line, char) => ({ line, character: char })),
	Range: jest.fn((start, end) => ({ start, end })),
}))

// Mock fileExistsAtPath since it would try to check the real file system
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(true),
}))

// Mock implementation for VSCodeRefactoringAdapter
const mockExecuteDslCommand = jest.fn()
;(VSCodeRefactoringAdapter as jest.Mock).mockImplementation(() => ({
	executeDslCommand: mockExecuteDslCommand,
}))

// Define mocks at the top level
let mockCline: Task
let mockAskApproval: jest.Mock
let mockHandleError: jest.Mock
let mockPushToolResult: jest.Mock
let mockRemoveClosingTag: jest.Mock

describe("refactorCodeTool", () => {
	beforeEach(() => {
		jest.clearAllMocks()

		mockCline = {
			cwd: "/test",
			consecutiveMistakeCount: 0,
			recordToolError: jest.fn(),
			sayAndCreateMissingParamError: jest.fn().mockResolvedValue("Missing parameter error"),
			say: jest.fn(),
			ask: jest.fn(),
			rooIgnoreController: {
				validateAccess: jest.fn().mockReturnValue(true),
			},
			fileContextTracker: {
				trackFileContext: jest.fn(),
			},
			didEditFile: false,
		} as any

		mockAskApproval = jest.fn().mockResolvedValue(true)
		mockHandleError = jest.fn()
		mockPushToolResult = jest.fn()
		mockRemoveClosingTag = jest.fn((tag, value) => value)
	})

	it("should validate required parameters", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				operations: JSON.stringify([
					{
						operation: "move_to_file", // Invalid operation name, should be "move"
						targetFilePath: "target.ts",
						selector: {
							type: "identifier",
							name: "testFunction",
							filePath: "test.ts",
						},
					},
				]),
			},
			partial: false,
		}

		await refactorCodeTool(
			mockCline,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Should record error for invalid operation
		expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code")
		// With the new more forgiving validation, we now get a different error message
		expect(mockPushToolResult).toHaveBeenCalled()
		// Verify that the error message mentions the batch operations validation failed
		expect(mockPushToolResult.mock.calls[0][0]).toContain("Invalid batch operations")
	})

	// This test verifies that the refactorCodeTool correctly forwards the request to the appropriate
	// service implementations. The actual refactoring logic should be tested in the service layer tests.
	it("should validate operations parameter", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				// operations parameter is missing
			},
			partial: false,
		}

		await refactorCodeTool(
			mockCline,
			block,
			mockAskApproval,
			mockHandleError,
			mockPushToolResult,
			mockRemoveClosingTag,
		)

		// Should record error for missing operations
		expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})
})

it("should execute move operation correctly", async () => {
	// Reset the mock implementation to return success for move operation
	mockExecuteDslCommand.mockResolvedValueOnce({
		success: true,
		modifiedSourceCode: "// Modified source code",
		modifiedTargetCode: "// Modified target code",
		movedNodes: 1,
		importsAdded: true,
		exportedNames: ["testFunction"],
		dependenciesImported: true,
		dependencies: ["helperFunction"],
		typeReferencesHandled: true,
		filesWritten: true,
	})

	const block: ToolUse = {
		type: "tool_use",
		name: "refactor_code",
		params: {
			operations: JSON.stringify([
				{
					operation: "move",
					targetFilePath: "target.ts",
					selector: {
						type: "identifier",
						name: "testFunction",
						filePath: "source.ts",
						kind: "function",
					},
				},
			]),
		},
		partial: false,
	}

	await refactorCodeTool(mockCline, block, mockAskApproval, mockHandleError, mockPushToolResult, mockRemoveClosingTag)

	// Verify adapter was called with correct parameters
	expect(VSCodeRefactoringAdapter).toHaveBeenCalledWith("/test")
	expect(mockExecuteDslCommand).toHaveBeenCalledWith(
		expect.objectContaining({
			operation: "move",
			selector: {
				type: "identifier",
				name: "testFunction",
				filePath: "source.ts",
			},
			operationDetails: {
				type: "move",
				targetFilePath: "target.ts",
			},
		}),
	)

	// Verify file tracking was called
	expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith("source.ts", "roo_edited")
	expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith("target.ts", "roo_edited")

	// Verify success message was pushed
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Batch refactoring completed successfully"))
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Moved testFunction to target.ts"))

	// Verify didEditFile was set to true
	expect(mockCline.didEditFile).toBe(true)
})

it("should execute rename operation correctly", async () => {
	// Reset the mock implementation to return success for rename operation
	mockExecuteDslCommand.mockResolvedValueOnce({
		success: true,
		modifiedFiles: ["source.ts", "related.ts"],
		modifiedCode: {
			"source.ts": "// Modified source code",
			"related.ts": "// Modified related code",
		},
		affectedReferences: 5,
	})

	const block: ToolUse = {
		type: "tool_use",
		name: "refactor_code",
		params: {
			operations: JSON.stringify([
				{
					operation: "rename",
					newName: "newFunctionName",
					selector: {
						type: "identifier",
						name: "oldFunctionName",
						filePath: "source.ts",
					},
				},
			]),
		},
		partial: false,
	}

	await refactorCodeTool(mockCline, block, mockAskApproval, mockHandleError, mockPushToolResult, mockRemoveClosingTag)

	// Verify adapter was called with correct parameters
	expect(VSCodeRefactoringAdapter).toHaveBeenCalledWith("/test")
	expect(mockExecuteDslCommand).toHaveBeenCalledWith(
		expect.objectContaining({
			operation: "rename",
			selector: {
				type: "identifier",
				name: "oldFunctionName",
				filePath: "source.ts",
			},
			operationDetails: {
				type: "rename",
				newName: "newFunctionName",
			},
		}),
	)

	// Verify file tracking was called for both files
	expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith("source.ts", "roo_edited")
	expect(mockCline.fileContextTracker.trackFileContext).toHaveBeenCalledWith("related.ts", "roo_edited")

	// Verify success message was pushed
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Batch refactoring completed successfully"))
	expect(mockPushToolResult).toHaveBeenCalledWith(
		expect.stringContaining("Renamed oldFunctionName to newFunctionName"),
	)

	// Verify didEditFile was set to true
	expect(mockCline.didEditFile).toBe(true)
})

it("should handle move operation failure", async () => {
	// Reset the mock implementation to return failure for move operation
	mockExecuteDslCommand.mockResolvedValueOnce({
		success: false,
		error: "Could not find identifier 'nonExistentFunction' in file source.ts",
	})

	const block: ToolUse = {
		type: "tool_use",
		name: "refactor_code",
		params: {
			operations: JSON.stringify([
				{
					operation: "move",
					targetFilePath: "target.ts",
					selector: {
						type: "identifier",
						name: "nonExistentFunction",
						filePath: "source.ts",
					},
				},
			]),
		},
		partial: false,
	}

	await refactorCodeTool(mockCline, block, mockAskApproval, mockHandleError, mockPushToolResult, mockRemoveClosingTag)

	// Verify adapter was called with correct parameters
	expect(VSCodeRefactoringAdapter).toHaveBeenCalledWith("/test")
	expect(mockExecuteDslCommand).toHaveBeenCalledWith(
		expect.objectContaining({
			operation: "move",
			selector: {
				type: "identifier",
				name: "nonExistentFunction",
				filePath: "source.ts",
			},
		}),
	)

	// Verify error was recorded
	expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code", expect.any(String))
	expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Batch refactoring failed"))
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Could not find identifier"))

	// Verify consecutiveMistakeCount was incremented
	expect(mockCline.consecutiveMistakeCount).toBe(1)
})

it("should handle rename operation failure", async () => {
	// Reset the mock implementation to return failure for rename operation
	mockExecuteDslCommand.mockResolvedValueOnce({
		success: false,
		error: "Error renaming symbol: File does not exist at path: source.ts",
	})

	const block: ToolUse = {
		type: "tool_use",
		name: "refactor_code",
		params: {
			operations: JSON.stringify([
				{
					operation: "rename",
					newName: "newName",
					selector: {
						type: "identifier",
						name: "oldName",
						filePath: "source.ts",
					},
				},
			]),
		},
		partial: false,
	}

	await refactorCodeTool(mockCline, block, mockAskApproval, mockHandleError, mockPushToolResult, mockRemoveClosingTag)

	// Verify adapter was called with correct parameters
	expect(VSCodeRefactoringAdapter).toHaveBeenCalledWith("/test")
	expect(mockExecuteDslCommand).toHaveBeenCalledWith(
		expect.objectContaining({
			operation: "rename",
			selector: {
				type: "identifier",
				name: "oldName",
				filePath: "source.ts",
			},
		}),
	)

	// Verify error was recorded
	expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code", expect.any(String))
	expect(mockCline.say).toHaveBeenCalledWith("error", expect.stringContaining("Batch refactoring failed"))
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Error renaming symbol"))

	// Verify consecutiveMistakeCount was incremented
	// Note: It's 2 because the mock is shared across tests and incremented in previous tests
	expect(mockCline.consecutiveMistakeCount).toBe(2)
})

it("should handle preview mode correctly", async () => {
	// Reset mocks before this test
	jest.clearAllMocks()
	mockCline.consecutiveMistakeCount = 0
	const block: ToolUse = {
		type: "tool_use",
		name: "refactor_code",
		params: {
			operations: JSON.stringify([
				{
					operation: "move",
					targetFilePath: "target.ts",
					selector: {
						type: "identifier",
						name: "testFunction",
						filePath: "source.ts",
					},
				},
			]),
		} as any, // Cast to any to allow adding preview
		partial: false,
	}

	// Add preview parameter
	;(block.params as any).preview = "true"

	await refactorCodeTool(mockCline, block, mockAskApproval, mockHandleError, mockPushToolResult, mockRemoveClosingTag)

	// Verify adapter was NOT called since we're in preview mode
	expect(mockExecuteDslCommand).not.toHaveBeenCalled()

	// Verify preview message was pushed
	expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Preview of batch refactoring operations"))
	expect(mockPushToolResult).toHaveBeenCalledWith(
		expect.stringContaining("Move symbol 'testFunction' in source.ts to target.ts"),
	)
})
