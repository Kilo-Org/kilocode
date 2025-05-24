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
	access: jest.fn(),
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
		fs: {
			writeFile: jest.fn(),
		},
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
		insert: jest.fn(),
		delete: jest.fn(),
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
			save: jest.fn().mockResolvedValue(true),
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
			"refactor.extract",
		)
		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully extracted function 'extractedFunction'"),
		)
	})

	it("should handle rename_symbol operation", async () => {
		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const oldName = 1" }),
			uri: vscode.Uri.file("/test/test.ts"),
			save: jest.fn().mockResolvedValue(true),
			lineCount: 10, // Add lineCount so line 5 is valid
			getText: jest.fn().mockReturnValue("line1\nline2\nline3\nline4\nconst oldName = 1\nline6"),
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
		expect(mockDocument.save).toHaveBeenCalled()
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

		// Since we now ask for approval before applying changes, there's no undo
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("undo")
		expect(mockPushToolResult).toHaveBeenCalledWith("Refactoring cancelled by user")
	})

	it("should handle move_to_file operation with code actions", async () => {
		const mockDocument = {
			getText: jest.fn((range?: any) => {
				if (range) {
					// Return text for the specified range (lines 1-3, 0-based)
					return "line2\nline3\nline4"
				}
				return "line1\nline2\nline3\nline4\nline5"
			}),
			lineAt: jest.fn((line: number) => ({
				text: `line${line + 1}`,
				range: new vscode.Range(line, 0, line, 10),
				isEmptyOrWhitespace: false,
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

		// Mock a code action with a workspace edit
		const mockWorkspaceEdit = new vscode.WorkspaceEdit()
		const mockMoveAction = {
			title: "Move to a new file",
			kind: vscode.CodeActionKind.RefactorMove,
			edit: mockWorkspaceEdit,
		}

		;(vscode.workspace.openTextDocument as jest.Mock)
			.mockResolvedValueOnce(mockDocument as any)
			.mockResolvedValueOnce(mockTargetDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([mockMoveAction]) // Return code action
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
		;(fs.access as jest.Mock).mockRejectedValue(new Error("File not found")) // Target file doesn't exist
		;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

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

		// Verify code action provider was called with correct filter
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"vscode.executeCodeActionProvider",
			mockDocument.uri,
			expect.any(Object), // Range
			"refactor.move",
		)

		// Verify workspace edit was applied
		expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(mockWorkspaceEdit)

		// Verify target file was created
		expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
			expect.objectContaining({ fsPath: "/test/target.ts" }),
			Buffer.from("", "utf-8"),
		)

		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully moved code from lines 2-4 to target.ts"),
		)
	})

	it("should handle move_to_file with manual fallback when no code actions available", async () => {
		const mockDocument = {
			getText: jest.fn((range?: any) => {
				if (range) {
					return "line2"
				}
				return "line1\nline2\nline3"
			}),
			lineAt: jest.fn((line: number) => ({
				text: `line${line + 1}`,
				range: new vscode.Range(line, 0, line, 10),
				isEmptyOrWhitespace: false,
			})),
			lineCount: 3,
			uri: vscode.Uri.file("/test/test.ts"),
		}
		const mockEditor = {
			selection: null,
		}

		const mockWorkspaceEdit = {
			delete: jest.fn(),
		}

		;(vscode.WorkspaceEdit as jest.Mock).mockImplementation(() => mockWorkspaceEdit)
		;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]) // No code actions
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
		;(fs.access as jest.Mock).mockRejectedValue(new Error("File not found"))
		;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

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

		// Should fall back to manual move
		expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(
			expect.objectContaining({ fsPath: "/test/target.ts" }),
			Buffer.from("line2", "utf-8"),
		)

		expect(mockWorkspaceEdit.delete).toHaveBeenCalledWith(mockDocument.uri, expect.any(vscode.Range))

		expect(mockPushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("Successfully moved code from lines 2-2 to target.ts (manual move)"),
		)
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
			save: jest.fn().mockResolvedValue(true),
		}
		const mockEditor = {
			selection: null,
		}

		const mockTargetDocument = {
			uri: vscode.Uri.file("/test/target.ts"),
		}

		const mockEdit = {
			delete: jest.fn(),
		}

		// Mock the code action with a WorkspaceEdit
		const mockMoveAction = {
			title: "Move to a new file",
			edit: mockEdit,
		}

		;(vscode.workspace.openTextDocument as jest.Mock)
			.mockResolvedValueOnce(mockDocument as any)
			.mockResolvedValueOnce(mockTargetDocument as any)
		;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
		;(vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([mockMoveAction])
		;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
		;(fs.mkdir as jest.Mock).mockResolvedValue(undefined)
		;(fs.access as jest.Mock).mockRejectedValue(new Error("File not found"))
		;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

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

	describe("batch operations", () => {
		it("should handle batch rename operations", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const oldVar1 = 1;\nconst oldVar2 = 2;"),
				lineAt: jest.fn((line: number) => ({
					text: line === 0 ? "const oldVar1 = 1;" : "const oldVar2 = 2;",
				})),
				lineCount: 2,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
				positionAt: jest.fn((offset: number) => {
					// Mock position calculation
					const lines = "const oldVar1 = 1;\nconst oldVar2 = 2;".split("\n")
					let currentOffset = 0
					for (let line = 0; line < lines.length; line++) {
						if (currentOffset + lines[line].length >= offset) {
							return new vscode.Position(line, offset - currentOffset)
						}
						currentOffset += lines[line].length + 1 // +1 for newline
					}
					return new vscode.Position(0, 0)
				}),
			}
			const mockEditor = {
				selection: null,
			}

			// Mock the rename provider to return a valid WorkspaceEdit
			const mockWorkspaceEdit = {
				size: 1,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			;(vscode.commands.executeCommand as jest.Mock)
				.mockResolvedValueOnce(mockWorkspaceEdit) // First rename
				.mockResolvedValueOnce(mockWorkspaceEdit) // Second rename
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify([
						{
							operation: "rename_symbol",
							start_line: 1,
							new_name: "newVar1",
						},
						{
							operation: "rename_symbol",
							start_line: 2,
							new_name: "newVar2",
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Batch refactoring (2 operations)"),
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Batch refactoring completed"))
		})

		it("should handle mixed batch operations", async () => {
			const saveMock = jest.fn().mockResolvedValue(true)
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const var1 = 1;\nconst x = 1;\nconst y = 2;\nconst z = x + y;"),
				lineAt: jest.fn((line: number) => ({
					text: ["const var1 = 1;", "const x = 1;", "const y = 2;", "const z = x + y;"][line],
					range: new vscode.Range(line, 0, line, 20),
				})),
				lineCount: 4,
				uri: vscode.Uri.file("/test/test.ts"),
				save: saveMock,
			}
			const mockEditor = {
				selection: null,
			}

			;(vscode.workspace.openTextDocument as jest.Mock)
				.mockResolvedValueOnce(mockDocument as any) // First operation
				.mockResolvedValueOnce(mockDocument as any) // Second operation (re-open after save)
			;(vscode.window.showTextDocument as jest.Mock)
				.mockResolvedValueOnce(mockEditor as any) // First operation
				.mockResolvedValueOnce(mockEditor as any) // Second operation

			// Mock rename operation
			;(vscode.commands.executeCommand as jest.Mock)
				.mockResolvedValueOnce({ size: 1 }) // First rename check (executeDocumentRenameProvider)
				.mockResolvedValueOnce({ size: 1 }) // First rename apply (executeDocumentRenameProvider)
				.mockResolvedValueOnce([
					{
						// extract function code actions
						title: "Extract function",
						command: {
							command: "typescript.extractFunction",
							arguments: ["arg1"],
						},
					},
				]) // executeCodeActionProvider for extract
				.mockResolvedValueOnce(undefined) // extract command
				.mockResolvedValueOnce({ size: 1 }) // rename after extract
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify([
						{
							operation: "rename_symbol",
							start_line: 1,
							new_name: "newVar",
						},
						{
							operation: "extract_function",
							start_line: 2,
							end_line: 4,
							new_name: "extractedFunc",
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Batch refactoring (2 operations)"),
			)

			// Verify save is called at least once (after all operations)
			expect(saveMock).toHaveBeenCalled()
			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Batch refactoring completed"))
		})

		it("should handle single operation in new format", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const oldVar = 'value'"),
				lineAt: jest.fn().mockReturnValue({
					text: "const oldVar = 'value'",
				}),
				lineCount: 1,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
			}
			const mockEditor = {
				selection: null,
			}

			// Mock the rename provider to return a valid WorkspaceEdit
			const mockWorkspaceEdit = {
				size: 1,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(mockWorkspaceEdit)
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify({
						operation: "rename_symbol",
						start_line: 1,
						new_name: "newVar",
					}),
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Rename symbol at line 1 to 'newVar'"),
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Successfully renamed symbol"))
		})

		it("should handle invalid JSON in operations", async () => {
			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: "invalid json",
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

			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Invalid operations format"))
		})

		it("should support legacy format", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const oldVar = 'value'"),
				lineAt: jest.fn().mockReturnValue({
					text: "const oldVar = 'value'",
				}),
				lineCount: 1,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
			}
			const mockEditor = {
				selection: null,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
				size: 1,
			})
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operation: "rename_symbol",
					start_line: "1",
					new_name: "newVar",
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Rename symbol at line 1 to 'newVar'"),
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("Successfully renamed symbol"))
		})

		it("should handle rename with old_name parameter", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const oldVariable = 'value';\nconst anotherVar = 'test';"),
				lineAt: jest.fn().mockReturnValue({
					text: "const oldVariable = 'value';",
				}),
				lineCount: 2,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
				positionAt: jest.fn((offset: number) => {
					// Mock position for "oldVariable" at offset 6
					if (offset === 6) {
						return new vscode.Position(0, 6)
					}
					return new vscode.Position(0, 0)
				}),
			}
			const mockEditor = {
				selection: null,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
				size: 1,
			})
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify({
						operation: "rename_symbol",
						old_name: "oldVariable",
						new_name: "newVariable",
					}),
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Rename 'oldVariable' to 'newVariable'"),
			)

			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Successfully renamed 'oldVariable' to 'newVariable'"),
			)
		})

		it("should handle rename with both old_name and start_line", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const data = 1;\nconst data = 2;"),
				lineAt: jest.fn((line: number) => ({
					text: line === 0 ? "const data = 1;" : "const data = 2;",
				})),
				lineCount: 2,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
			}
			const mockEditor = {
				selection: null,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
				size: 1,
			})
			;(vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify({
						operation: "rename_symbol",
						old_name: "data",
						start_line: 2, // Rename only the second occurrence
						new_name: "secondData",
					}),
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

			expect(mockAskApproval).toHaveBeenCalledWith(
				"tool",
				expect.stringContaining("Rename 'data' to 'secondData'"),
			)

			// Should use line 2 (index 1) position
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"vscode.executeDocumentRenameProvider",
				mockDocument.uri,
				expect.objectContaining({ line: 1 }), // 0-based index
				"secondData",
			)
		})

		it("should handle rename when old_name not found", async () => {
			const mockDocument = {
				getText: jest.fn().mockReturnValue("const someVar = 'value';"),
				lineAt: jest.fn().mockReturnValue({
					text: "const someVar = 'value';",
				}),
				lineCount: 1,
				uri: vscode.Uri.file("/test/test.ts"),
				save: jest.fn().mockResolvedValue(true),
				positionAt: jest.fn(() => new vscode.Position(0, 0)),
			}
			const mockEditor = {
				selection: null,
			}

			;(vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			// Mock that no position is renameable
			;(vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error("No rename"))

			const block: ToolUse = {
				type: "tool_use",
				name: "refactor_code",
				params: {
					path: "test.ts",
					operations: JSON.stringify({
						operation: "rename_symbol",
						old_name: "nonExistent",
						new_name: "newName",
					}),
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

			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot find renameable symbol 'nonExistent' in the file"),
			)
		})
	})
})
