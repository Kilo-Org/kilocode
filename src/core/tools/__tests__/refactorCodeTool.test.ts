import * as vscode from "vscode"
import * as fs from "fs/promises"
import { refactorCodeTool } from "../refactorCodeTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"

// Mock fs/promises
jest.mock("fs/promises", () => ({
	mkdir: jest.fn(),
	readFile: jest.fn(),
	writeFile: jest.fn(),
}))

// Mock path module
jest.mock("path", () => ({
	resolve: jest.fn((cwd, relPath) => `${cwd}/${relPath}`),
	join: jest.fn((...args) => args.join("/")),
	normalize: jest.fn((p) => p),
	relative: jest.fn((from, to) => to),
	dirname: jest.fn((p) => p.substring(0, p.lastIndexOf("/"))),
	basename: jest.fn((p) => p.substring(p.lastIndexOf("/") + 1)),
}))

// Mock os module
jest.mock("os", () => ({
	homedir: jest.fn(() => "/home/user"),
}))

// Mock vscode
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
	Selection: jest.fn((start, end) => ({ start, end })),
	Range: jest.fn((start, end) => ({ start, end })),
	CodeActionKind: {
		RefactorExtract: { value: "refactor.extract" },
		RefactorMove: { value: "refactor.move" },
	},
	WorkspaceEdit: jest.fn(() => ({
		replace: jest.fn(),
	})),
}))

// Mock file system
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockResolvedValue(true),
}))

describe("refactorCodeTool", () => {
	let mockCline: Task
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockRemoveClosingTag: any

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
		mockRemoveClosingTag = jest.fn((tag, content) => content || "")
	})

	it("should handle missing path parameter", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {},
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

		expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should handle missing operation parameter", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: { path: "test.ts" },
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

		expect(mockCline.recordToolError).toHaveBeenCalledWith("refactor_code")
		expect(mockPushToolResult).toHaveBeenCalledWith("Missing parameter error")
	})

	it("should handle extract_function operation", async () => {
		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const x = 1" }),
			getText: jest.fn().mockReturnValue("const x = 1\nconst y = 2"),
			uri: vscode.Uri.file("/test/test.ts"),
		}
		const mockEditor = {
			selection: null,
		}

		const mockExtractAction = {
			title: "Extract function",
			command: {
				command: "typescript.refactor.extract.function",
				arguments: ["extractFunction"],
			},
		}

		const mockRenameEdit = {
			size: 1,
			entries: jest.fn().mockReturnValue([]),
		}

		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock)
			.mockResolvedValueOnce([mockExtractAction]) // vscode.executeCodeActionProvider
			.mockResolvedValueOnce(undefined) // extract function command
			.mockResolvedValueOnce(mockRenameEdit) // vscode.executeDocumentRenameProvider
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "extract_function",
				start_line: "5",
				end_line: "10",
				new_name: "extractedFunction",
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

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.executeCodeActionProvider",
			mockDocument.uri,
			expect.any(Object),
			{ kind: "refactor.extract" },
		)
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully extracted function 'extractedFunction'"),
		)
	})

	it("should handle rename_symbol operation", async () => {
		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const oldName = 1" }),
			uri: vscode.Uri.file("/test/test.ts"),
		}
		const mockEditor = {
			selection: null,
		}

		const mockRenameEdit = {
			size: 3,
			entries: jest.fn().mockReturnValue([]),
		}

		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(mockRenameEdit)
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "rename_symbol",
				start_line: "5",
				new_name: "newName",
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

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.executeDocumentRenameProvider",
			mockDocument.uri,
			expect.any(Object),
			"newName",
		)
		expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockRenameEdit)
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully renamed symbol to 'newName' at line 5 (updated 3 files)"),
		)
	})

	it("should handle unknown operation", async () => {
		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "unknown_operation",
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

		expect(mockCline.recordToolError).toHaveBeenCalledWith(
			"refactor_code",
			expect.stringContaining("Unknown refactoring operation"),
		)
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Unknown refactoring operation"))
	})

	it("should handle user rejection", async () => {
		mockAskApproval.mockResolvedValue(false)

		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const x = 1" }),
		}
		const mockEditor = {
			selection: null,
		}

		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "rename_symbol",
				start_line: "5",
				new_name: "newName",
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

		expect(vscode.commands.executeCommand).toHaveBeenCalledWith("undo")
		expect(mockPushToolResult).toHaveBeenCalledWith("Refactoring cancelled by user")
	})

	it("should handle move_to_file operation with VS Code refactoring API", async () => {
		const mockDocument = {
			getText: jest.fn().mockReturnValue("line1\nline2\nline3\nline4\nline5"),
			lineAt: jest.fn((line: number) => ({
				text: `line${line + 1}`,
				range: new vscode.Range(line, 0, line, 10),
			})),
			lineCount: 5,
			uri: vscode.Uri.file("/test/test.ts"),
			save: jest.fn().mockResolvedValue(true),
		}
		const mockEditor = {
			selection: null,
		}

		const mockTargetDocument = {
			uri: vscode.Uri.file("/test/target.ts"),
		}

		// Mock the code action for move refactoring
		const mockMoveAction = {
			title: "Move to a new file",
			command: {
				command: "typescript.moveToFile",
				arguments: ["moveToFile"],
			},
		}

		;(vscode.workspace.openTextDocument as jest.Mock)
			.mockResolvedValueOnce(mockDocument as any)
			.mockResolvedValueOnce(mockTargetDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock)
			.mockResolvedValueOnce([mockMoveAction]) // vscode.executeCodeActionProvider
			.mockResolvedValueOnce(undefined) // typescript.moveToFile
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "move_to_file",
				start_line: "2",
				end_line: "4",
				target_path: "target.ts",
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

		// Verify VS Code refactoring API was used
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.executeCodeActionProvider",
			mockDocument.uri,
			expect.any(Object), // Range
			{ kind: "refactor.move" },
		)

		// Verify the move command was executed with target URI
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"typescript.moveToFile",
			"moveToFile",
			expect.objectContaining({
				toString: expect.any(Function),
			}),
		)

		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully moved code from lines 2-4 to target.ts"),
		)
	})

	it("should handle move_to_file when no refactor actions are available", async () => {
		const mockDocument = {
			getText: jest.fn().mockReturnValue("line1\nline2\nline3"),
			lineAt: jest.fn((line: number) => ({
				text: `line${line + 1}`,
				range: new vscode.Range(line, 0, line, 10),
			})),
			lineCount: 3,
			uri: vscode.Uri.file("/test/test.ts"),
		}
		const mockEditor = {
			selection: null,
		}

		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]) // No code actions
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "move_to_file",
				start_line: "2",
				end_line: "2",
				target_path: "target.ts",
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

		expect(mockCline.recordToolError).toHaveBeenCalledWith(
			"refactor_code",
			expect.stringContaining("No Move refactor available"),
		)
		expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("No Move refactor available"))
	})

	it("should handle move_to_file with WorkspaceEdit", async () => {
		const mockDocument = {
			getText: jest.fn().mockReturnValue("export function test() {}"),
			lineAt: jest.fn(() => ({
				text: "export function test() {}",
				range: new vscode.Range(0, 0, 0, 25),
			})),
			lineCount: 1,
			uri: vscode.Uri.file("/test/test.ts"),
		}
		const mockEditor = {
			selection: null,
		}

		const mockEdit = {
			replace: jest.fn(),
			insert: jest.fn(),
			delete: jest.fn(),
		}

		// Mock the code action with a WorkspaceEdit
		const mockMoveAction = {
			title: "Move to a new file",
			edit: mockEdit,
		}

		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([mockMoveAction])
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)

		const block: ToolUse = {
			type: "tool_use",
			name: "refactor_code",
			params: {
				path: "test.ts",
				operation: "move_to_file",
				start_line: "1",
				end_line: "1",
				target_path: "target.ts",
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

		expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockEdit)
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully moved code from lines 1-1 to target.ts"),
		)
	})
})
