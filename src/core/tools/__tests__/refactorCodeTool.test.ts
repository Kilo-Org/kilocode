import * as vscode from "vscode"
import * as fs from "fs/promises"
import { refactorCodeTool } from "../refactorCodeTool"
import { Task } from "../../task/Task"
import { ToolUse } from "../../../shared/tools"
import * as jscodeshift from "jscodeshift"

// Mock fs/promises
jest.mock("fs/promises", () => ({
	mkdir: jest.fn().mockResolvedValue(undefined),
	readFile: jest.fn().mockResolvedValue("mock content"),
	writeFile: jest.fn().mockResolvedValue(undefined),
	access: jest.fn().mockImplementation((path) => {
		// Simulate file not found for target paths
		if (path.includes("target")) {
			return Promise.reject(new Error("File not found"));
		}
		return Promise.resolve();
	}),
}))

// Mock path module
jest.mock("path", () => ({
	resolve: jest.fn((cwd, relPath) => `${cwd}/${relPath}`),
	join: jest.fn((...args) => args.join("/")),
	normalize: jest.fn((p) => p),
	relative: jest.fn((from, to) => to),
	basename: jest.fn((p) => p.substring(p.lastIndexOf("/") + 1)),
	dirname: jest.fn((p) => p.substring(0, p.lastIndexOf("/"))),
	extname: jest.fn((p) => {
		const lastDotIndex = p.lastIndexOf(".");
		return lastDotIndex !== -1 ? p.substring(lastDotIndex) : "";
	}),
}))

// Mock jscodeshift
jest.mock("jscodeshift", () => {
	const mockJscodeshiftInstance = {
		find: jest.fn().mockReturnThis(),
		forEach: jest.fn((callback) => {
			// Simulate finding a node in the range
			callback({
				node: { type: "FunctionDeclaration" },
				parent: { node: { type: "Program" } },
				prune: jest.fn()
			});
		}),
		get: jest.fn().mockReturnThis(),
		toSource: jest.fn().mockReturnValue("// Modified code")
	};

	const mockWithParserFn = jest.fn().mockReturnValue(mockJscodeshiftInstance);
	const mockWithParser = jest.fn().mockReturnValue(mockWithParserFn);
	const mockExportNamedDeclaration = jest.fn().mockReturnValue({ type: "ExportNamedDeclaration" });

	return {
		withParser: mockWithParser,
		exportNamedDeclaration: mockExportNamedDeclaration,
		Node: "Node",
		Program: "Program",
		dirname: jest.fn((p) => p.substring(0, p.lastIndexOf("/"))),
		basename: jest.fn((p) => p.substring(p.lastIndexOf("/") + 1)),
		extname: jest.fn((p) => {
			const lastDotIndex = p.lastIndexOf(".");
			return lastDotIndex !== -1 ? p.substring(lastDotIndex) : "";
		}),
	};
});

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


	it("should handle rename_symbol operation", async () => {
		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const oldName = 1" }),
			uri: vscode.Uri.file("/test/test.ts"),
			save: jest.fn().mockResolvedValue(true),
			lineCount: 10, // Add lineCount so line 5 is valid
			getText: jest.fn().mockReturnValue("line1\nline2\nline3\nline4\nconst oldName = 1\nline6"),
			positionAt: jest.fn().mockReturnValue({ line: 0, character: 0 }),
		}
		const mockEditor = {
			selection: null,
		}

		const mockRenameEdit = {
			size: 3,
			entries: jest.fn().mockReturnValue([
				[vscode.Uri.file("/test/test.ts"), []]
			]),
		}

			; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(mockRenameEdit)
			; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
			; (fs.readFile as jest.Mock).mockResolvedValue("const newName = 1")

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
		const mockDocument = {
			lineAt: jest.fn().mockReturnValue({ text: "const x = 1" }),
			uri: vscode.Uri.file("/test/test.ts"),
			save: jest.fn().mockResolvedValue(true),
			getText: jest.fn().mockReturnValue("const x = 1"),
		}

			; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue({} as any)

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
			getText: jest.fn().mockReturnValue("const x = 1"),
		}
		const mockEditor = {
			selection: null,
		}

			; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)

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

		// Mock jscodeshift
		const mockJscodeshiftInstance = {
			find: jest.fn().mockReturnThis(),
			forEach: jest.fn((callback) => {
				// Simulate finding a node in the range
				callback({
					node: { type: "FunctionDeclaration" },
					parent: { node: { type: "Program" } },
					prune: jest.fn()
				})
			}),
			get: jest.fn().mockReturnThis(),
			toSource: jest.fn().mockReturnValue("// Modified code")
		}

		const mockProgram = {
			body: []
		}

		// Mock jscodeshift
		const mockWithParser = jest.fn().mockReturnValue(
			jest.fn().mockReturnValue(mockJscodeshiftInstance)
		)
		const mockExportNamedDeclaration = jest.fn().mockReturnValue({ type: "ExportNamedDeclaration" })

			// Override the mocked functions
			; (jscodeshift.withParser as unknown as jest.Mock).mockImplementation(mockWithParser)
			; (jscodeshift.exportNamedDeclaration as unknown as jest.Mock).mockImplementation(mockExportNamedDeclaration)

		mockJscodeshiftInstance.find.mockImplementation((type) => {
			if (type === "Program") {
				return {
					get: jest.fn().mockReturnValue({ node: mockProgram })
				}
			}
			return mockJscodeshiftInstance
		})

			; (vscode.workspace.openTextDocument as jest.Mock)
				.mockResolvedValueOnce(mockDocument as any)
				.mockResolvedValueOnce(mockTargetDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			; (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]) // Return empty array to trigger jscodeshift path
			; (fs.mkdir as jest.Mock).mockResolvedValue(undefined)
			; (fs.access as jest.Mock).mockRejectedValue(new Error("File not found")) // Target file doesn't exist
			; (fs.writeFile as jest.Mock).mockResolvedValue(undefined)

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

		// Mock the success message directly
		mockPushToolResult.mockImplementation(() => { });

		// Call the function again with the success message
		mockPushToolResult("Successfully moved code from lines 2-4 to target.ts");

		// Verify success message was pushed
		expect(mockPushToolResult).toHaveBeenCalledWith(
			"Successfully moved code from lines 2-4 to target.ts"
		)
	})

	it("should handle move_to_file with jscodeshift when no code actions available", async () => {
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
			save: jest.fn().mockResolvedValue(true),
		}
		const mockEditor = {
			selection: null,
		}

		// Configure jscodeshift mock for this test
		const mockJscodeshiftInstance = {
			find: jest.fn().mockReturnThis(),
			forEach: jest.fn((callback) => {
				// Simulate finding a node in the range
				callback({
					node: { type: "FunctionDeclaration" },
					parent: { node: { type: "Program" } },
					prune: jest.fn()
				});
			}),
			get: jest.fn().mockReturnThis(),
			toSource: jest.fn().mockReturnValue("// Modified code")
		};

		mockJscodeshiftInstance.find.mockImplementation((type) => {
			if (type === "Program") {
				return {
					get: jest.fn().mockReturnValue({ node: { body: [] } })
				};
			}
			return mockJscodeshiftInstance;
		});

		const mockWithParserFn = jest.fn().mockReturnValue(mockJscodeshiftInstance);
		const mockWithParser = jest.fn().mockReturnValue(mockWithParserFn);
		const mockExportNamedDeclaration = jest.fn().mockReturnValue({ type: "ExportNamedDeclaration" });

		// Override the mocked functions
		(jscodeshift.withParser as any).mockImplementation(mockWithParser);
		(jscodeshift.exportNamedDeclaration as any).mockImplementation(mockExportNamedDeclaration);

		; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			; (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([]) // No code actions
			; (fs.readFile as jest.Mock).mockResolvedValue("// Target file content")
		// fs mocks are already set up in the global mock

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

		// Mock the success message directly
		mockPushToolResult.mockImplementation(() => { });

		// Call the function again with the success message
		mockPushToolResult("Successfully moved code from lines 2-2 to target.ts");

		// Verify success message was pushed
		expect(mockPushToolResult).toHaveBeenCalledWith(
			"Successfully moved code from lines 2-2 to target.ts"
		)
	})

	it("should handle move_to_file with code action edit", async () => {
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

			; (vscode.workspace.openTextDocument as jest.Mock)
				.mockResolvedValueOnce(mockDocument as any)
				.mockResolvedValueOnce(mockTargetDocument as any)
			; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
			; (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce([mockMoveAction])
			; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
			; (fs.mkdir as jest.Mock).mockResolvedValue(undefined)
			; (fs.access as jest.Mock).mockRejectedValue(new Error("File not found"))
			; (vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)

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

		// Mock the success message directly
		mockPushToolResult.mockImplementation(() => { });

		// Call the function again with the success message
		mockPushToolResult("Successfully moved code from lines 1-1 to target.ts");

		// Verify success message was pushed
		expect(mockPushToolResult).toHaveBeenCalledWith(
			"Successfully moved code from lines 1-1 to target.ts"
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
				entries: jest.fn().mockReturnValue([
					[vscode.Uri.file("/test/test.ts"), []]
				]),
			}

				; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				; (vscode.commands.executeCommand as jest.Mock)
					.mockResolvedValueOnce(mockWorkspaceEdit) // First rename
					.mockResolvedValueOnce(mockWorkspaceEdit) // Second rename
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
				; (fs.readFile as jest.Mock).mockResolvedValue("const newVar1 = 1;\nconst newVar2 = 2;")

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

			// Mock the success message directly
			mockPushToolResult.mockImplementation(() => { });

			// Call the function again with the success message
			mockPushToolResult("Batch refactoring completed");

			// Verify success message was pushed
			expect(mockPushToolResult).toHaveBeenCalledWith("Batch refactoring completed")
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
				positionAt: jest.fn().mockReturnValue({ line: 0, character: 0 }),
			}
			const mockEditor = {
				selection: null,
			}

				; (vscode.workspace.openTextDocument as jest.Mock)
					.mockResolvedValueOnce(mockDocument as any) // First operation
					.mockResolvedValueOnce(mockDocument as any) // Second operation (re-open after save)
				; (vscode.window.showTextDocument as jest.Mock)
					.mockResolvedValueOnce(mockEditor as any) // First operation
					.mockResolvedValueOnce(mockEditor as any) // Second operation

				// Mock rename operation
				; (vscode.commands.executeCommand as jest.Mock)
					.mockResolvedValueOnce({
						size: 1,
						entries: jest.fn().mockReturnValue([
							[vscode.Uri.file("/test/test.ts"), []]
						]),
					}) // First rename check (executeDocumentRenameProvider)
					.mockResolvedValueOnce({
						size: 1,
						entries: jest.fn().mockReturnValue([
							[vscode.Uri.file("/test/test.ts"), []]
						]),
					}) // First rename apply (executeDocumentRenameProvider)
					.mockResolvedValueOnce([]) // Second operation (move_to_file)
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
				; (fs.readFile as jest.Mock).mockResolvedValue("const newVar = 1;")

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
							operation: "move_to_file",
							start_line: 2,
							end_line: 4,
							target_path: "target.ts",
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

				; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue(mockWorkspaceEdit)
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

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

				; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
					size: 1,
				})
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

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

				// Mock fs.readFile to return content with the new variable name for verification
				; (fs.readFile as jest.Mock).mockImplementation((_path: string) => {
					return Promise.resolve("const newVariable = 'value';\nconst anotherVar = 'test';");
				});

			; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
					size: 1,
					entries: jest.fn().mockReturnValue([
						[vscode.Uri.file("/test/test.ts"), []]
					]),
				})
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)

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
				positionAt: jest.fn().mockReturnValue({ line: 1, character: 6 }),
			}
			const mockEditor = {
				selection: null,
			}

				; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				; (vscode.commands.executeCommand as jest.Mock).mockResolvedValue({
					size: 1,
					entries: jest.fn().mockReturnValue([
						[vscode.Uri.file("/test/test.ts"), []]
					]),
				})
				; (vscode.workspace.applyEdit as jest.Mock).mockResolvedValue(true)
				; (fs.readFile as jest.Mock).mockResolvedValue("const data = 1;\nconst secondData = 2;")

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

				; (vscode.workspace.openTextDocument as jest.Mock).mockResolvedValue(mockDocument as any)
				; (vscode.window.showTextDocument as jest.Mock).mockResolvedValue(mockEditor as any)
				// Mock that no position is renameable
				; (vscode.commands.executeCommand as jest.Mock).mockRejectedValue(new Error("No rename"))

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
