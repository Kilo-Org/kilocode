import * as vscode from "vscode"
import { Anthropic } from "@anthropic-ai/sdk"
import {
	downloadTask,
	downloadTaskFamily,
	buildTaskFamily,
	formatContentBlockToMarkdown,
	findToolName,
	TaskFamilyData,
} from "../export-markdown"
import { HistoryItem } from "../../../shared/HistoryItem"

// Mock vscode module
jest.mock("vscode", () => ({
	window: {
		showSaveDialog: jest.fn(),
		showOpenDialog: jest.fn(),
		showTextDocument: jest.fn(),
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
	},
	workspace: {
		fs: {
			writeFile: jest.fn(),
			createDirectory: jest.fn(),
		},
	},
	Uri: {
		file: jest.fn((path: string) => ({ fsPath: path })),
		joinPath: jest.fn((base: any, ...segments: string[]) => ({
			fsPath: `${base.fsPath}/${segments.join("/")}`,
		})),
	},
	commands: {
		executeCommand: jest.fn(),
	},
}))

// Mock os module
jest.mock("os", () => ({
	homedir: jest.fn(() => "/home/user"),
}))

describe("export-markdown", () => {
	const mockConversationHistory: Anthropic.MessageParam[] = [
		{
			role: "user",
			content: "Hello, can you help me with a task?",
		},
		{
			role: "assistant",
			content: "Of course! I'd be happy to help you with your task.",
		},
	]

	const mockHistoryItem: HistoryItem = {
		id: "task-1",
		ts: 1640995200000, // 2022-01-01 00:00:00
		task: "Test task",
		tokensIn: 100,
		tokensOut: 150,
		totalCost: 0.05,
		mode: "code",
		number: 1,
		parentTaskId: undefined,
		rootTaskId: "task-1",
	}

	beforeEach(() => {
		jest.clearAllMocks()
	})

	describe("downloadTask", () => {
		it("should prompt user for save location and write markdown file", async () => {
			const mockSaveUri = { fsPath: "/home/user/Downloads/test.md" }
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(mockSaveUri)
			;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)
			;(vscode.window.showTextDocument as jest.Mock).mockResolvedValue(undefined)

			await downloadTask(mockHistoryItem.ts, mockConversationHistory)

			expect(vscode.window.showSaveDialog).toHaveBeenCalledWith({
				filters: { Markdown: ["md"] },
				defaultUri: expect.objectContaining({
					fsPath: expect.stringContaining("kilo_code_task_jan-1-2022_1-00-00-am.md"),
				}),
			})
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(mockSaveUri, expect.any(Buffer))
			expect(vscode.window.showTextDocument).toHaveBeenCalledWith(mockSaveUri, { preview: true })
		})

		it("should not write file if user cancels save dialog", async () => {
			;(vscode.window.showSaveDialog as jest.Mock).mockResolvedValue(undefined)

			await downloadTask(mockHistoryItem.ts, mockConversationHistory)

			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
			expect(vscode.window.showTextDocument).not.toHaveBeenCalled()
		})
	})

	describe("downloadTaskFamily", () => {
		const mockTaskFamily: TaskFamilyData = {
			rootTask: mockHistoryItem,
			tasks: [mockHistoryItem],
			hierarchy: [
				{
					task: mockHistoryItem,
					children: [],
				},
			],
		}

		const mockGetTaskWithId = jest.fn().mockResolvedValue({
			historyItem: mockHistoryItem,
			apiConversationHistory: mockConversationHistory,
		})

		it("should prompt user for folder location and create task family export", async () => {
			const mockSelectedFolders = [{ fsPath: "/home/user/Downloads" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)
			;(vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined)
			;(vscode.workspace.fs.writeFile as jest.Mock).mockResolvedValue(undefined)
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)
			;(vscode.commands.executeCommand as jest.Mock).mockResolvedValue(undefined)

			await downloadTaskFamily(mockTaskFamily, mockGetTaskWithId)

			expect(vscode.window.showOpenDialog).toHaveBeenCalledWith({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				openLabel: "Select Export Location",
				defaultUri: expect.objectContaining({
					fsPath: "/home/user",
				}),
			})
			expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled()
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(2) // Task file + README
			expect(vscode.window.showInformationMessage).toHaveBeenCalled()
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith("vscode.openFolder", expect.any(Object), {
				forceNewWindow: true,
			})
		})

		it("should not create export if user cancels folder selection", async () => {
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(undefined)

			await downloadTaskFamily(mockTaskFamily, mockGetTaskWithId)

			expect(vscode.workspace.fs.createDirectory).not.toHaveBeenCalled()
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled()
		})

		it("should show error message if export fails", async () => {
			const mockSelectedFolders = [{ fsPath: "/home/user/Downloads" }]
			;(vscode.window.showOpenDialog as jest.Mock).mockResolvedValue(mockSelectedFolders)
			;(vscode.workspace.fs.createDirectory as jest.Mock).mockRejectedValue(new Error("Permission denied"))
			;(vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined)

			await downloadTaskFamily(mockTaskFamily, mockGetTaskWithId)

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("Failed to export task family"),
			)
		})
	})

	describe("buildTaskFamily", () => {
		const allTasks: HistoryItem[] = [
			{
				...mockHistoryItem,
				id: "task-1",
				rootTaskId: "task-1",
				parentTaskId: undefined,
				ts: 1640995200000,
			},
			{
				...mockHistoryItem,
				id: "task-2",
				rootTaskId: "task-1",
				parentTaskId: "task-1",
				ts: 1640995300000,
				number: 2,
			},
			{
				...mockHistoryItem,
				id: "task-3",
				rootTaskId: "task-1",
				parentTaskId: "task-2",
				ts: 1640995400000,
				number: 3,
			},
		]

		it("should build task family with correct hierarchy", () => {
			const result = buildTaskFamily(allTasks, "task-1")

			expect(result.rootTask.id).toBe("task-1")
			expect(result.tasks).toHaveLength(3)
			expect(result.tasks[0].ts).toBeLessThanOrEqual(result.tasks[1].ts)
			expect(result.hierarchy).toHaveLength(1)
			expect(result.hierarchy[0].task.id).toBe("task-1")
			expect(result.hierarchy[0].children).toHaveLength(1)
			expect(result.hierarchy[0].children[0].task.id).toBe("task-2")
			expect(result.hierarchy[0].children[0].children).toHaveLength(1)
			expect(result.hierarchy[0].children[0].children[0].task.id).toBe("task-3")
		})

		it("should throw error if root task not found", () => {
			expect(() => buildTaskFamily(allTasks, "nonexistent")).toThrow("Root task nonexistent not found")
		})
	})

	describe("formatContentBlockToMarkdown", () => {
		it("should format text content block", () => {
			const block: Anthropic.Messages.ContentBlockParam = {
				type: "text",
				text: "Hello world",
			}

			const result = formatContentBlockToMarkdown(block)
			expect(result).toBe("Hello world")
		})

		it("should format image content block", () => {
			const block: Anthropic.Messages.ContentBlockParam = {
				type: "image",
				source: {
					type: "base64",
					media_type: "image/png",
					data: "base64data",
				},
			}

			const result = formatContentBlockToMarkdown(block)
			expect(result).toBe("[Image]")
		})

		it("should format tool_use content block", () => {
			const block: Anthropic.Messages.ContentBlockParam = {
				type: "tool_use",
				id: "tool-1",
				name: "read_file",
				input: {
					path: "test.txt",
					content: "file content",
				},
			}

			const result = formatContentBlockToMarkdown(block)
			expect(result).toContain("[Tool Use: read_file]")
			expect(result).toContain("Path: test.txt")
			expect(result).toContain("Content: file content")
		})

		it("should format tool_result content block", () => {
			const block: Anthropic.Messages.ContentBlockParam = {
				type: "tool_result",
				tool_use_id: "tool-1",
				content: "Tool execution result",
			}

			const result = formatContentBlockToMarkdown(block)
			expect(result).toContain("[Tool]")
			expect(result).toContain("Tool execution result")
		})

		it("should format tool_result error content block", () => {
			const block: Anthropic.Messages.ContentBlockParam = {
				type: "tool_result",
				tool_use_id: "tool-1",
				content: "Error occurred",
				is_error: true,
			}

			const result = formatContentBlockToMarkdown(block)
			expect(result).toContain("[Tool (Error)]")
			expect(result).toContain("Error occurred")
		})
	})

	describe("findToolName", () => {
		const messages: Anthropic.MessageParam[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool-123",
						name: "read_file",
						input: { path: "test.txt" },
					},
				],
			},
		]

		it("should find tool name by tool call id", () => {
			const result = findToolName("tool-123", messages)
			expect(result).toBe("read_file")
		})

		it("should return Unknown Tool for non-existent tool call id", () => {
			const result = findToolName("nonexistent", messages)
			expect(result).toBe("Unknown Tool")
		})
	})
})
