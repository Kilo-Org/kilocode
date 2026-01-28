// npx vitest core/webview/__tests__/webviewMessageHandler.searchFiles.spec.ts

import type { Mock } from "vitest"

// Mock dependencies - must come before imports
vi.mock("../../../services/search/file-search")
vi.mock("../../ignore/RooIgnoreController")
vi.mock("vscode")

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { searchWorkspaceFiles } from "../../../services/search/file-search"
import { RooIgnoreController } from "../../ignore/RooIgnoreController"

const mockSearchWorkspaceFiles = searchWorkspaceFiles as Mock<typeof searchWorkspaceFiles>

describe("webviewMessageHandler - searchFiles with RooIgnore filtering", () => {
	let mockClineProvider: ClineProvider
	let mockFilterPaths: Mock
	let mockDispose: Mock

	beforeEach(() => {
		vi.clearAllMocks()

		// Spy on the mock RooIgnoreController prototype methods
		mockFilterPaths = vi.fn()
		mockDispose = vi.fn()

		// Override the filterPaths method on the prototype
		;(RooIgnoreController.prototype as any).filterPaths = mockFilterPaths
		;(RooIgnoreController.prototype as any).initialize = vi.fn().mockResolvedValue(undefined)
		;(RooIgnoreController.prototype as any).dispose = mockDispose

		// Create mock ClineProvider
		mockClineProvider = {
			getState: vi.fn(),
			postMessageToWebview: vi.fn(),
			getCurrentTask: vi.fn(),
			cwd: "/mock/workspace",
		} as unknown as ClineProvider
	})

	it("should filter results using RooIgnoreController when showRooIgnoredFiles is false", async () => {
		// Setup mock results from file search
		const mockResults = [
			{ path: "src/index.ts", type: "file" as const, label: "index.ts" },
			{ path: "secrets/config.json", type: "file" as const, label: "config.json" },
			{ path: "src/utils.ts", type: "file" as const, label: "utils.ts" },
		]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state with showRooIgnoredFiles = false
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: false,
		})

		// Setup filter to exclude secrets folder
		mockFilterPaths.mockReturnValue(["src/index.ts", "src/utils.ts"])

		// No current task, so temporary controller will be created
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue(null)

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-123",
		})

		// Verify filterPaths was called with all result paths
		expect(mockFilterPaths).toHaveBeenCalledWith(["src/index.ts", "secrets/config.json", "src/utils.ts"])

		// Verify filtered results were sent to webview
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileSearchResults",
			results: [
				{ path: "src/index.ts", type: "file", label: "index.ts" },
				{ path: "src/utils.ts", type: "file", label: "utils.ts" },
			],
			requestId: "test-request-123",
		})
	})

	it("should not filter results when showRooIgnoredFiles is true", async () => {
		// Setup mock results from file search
		const mockResults = [
			{ path: "src/index.ts", type: "file" as const, label: "index.ts" },
			{ path: "secrets/config.json", type: "file" as const, label: "config.json" },
		]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state with showRooIgnoredFiles = true
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: true,
		})

		// No current task
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue(null)

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-456",
		})

		// Verify filterPaths was NOT called
		expect(mockFilterPaths).not.toHaveBeenCalled()

		// Verify all results were sent to webview (unfiltered)
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileSearchResults",
			results: mockResults,
			requestId: "test-request-456",
		})
	})

	it("should use existing RooIgnoreController from current task", async () => {
		// Setup mock results from file search
		const mockResults = [
			{ path: "src/index.ts", type: "file" as const, label: "index.ts" },
			{ path: "private/secret.ts", type: "file" as const, label: "secret.ts" },
		]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state with showRooIgnoredFiles = false
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: false,
		})

		// Create a mock task with its own RooIgnoreController
		const taskFilterPaths = vi.fn().mockReturnValue(["src/index.ts"])
		const taskRooIgnoreController = {
			filterPaths: taskFilterPaths,
			initialize: vi.fn(),
		}
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue({
			taskId: "test-task-id",
			rooIgnoreController: taskRooIgnoreController,
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-789",
		})

		// Verify the task's controller was used (not the prototype)
		expect(taskFilterPaths).toHaveBeenCalledWith(["src/index.ts", "private/secret.ts"])

		// Verify filtered results were sent to webview
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileSearchResults",
			results: [{ path: "src/index.ts", type: "file", label: "index.ts" }],
			requestId: "test-request-789",
		})
	})

	it("should handle error when no workspace path is available", async () => {
		// Create provider without cwd
		mockClineProvider = {
			...mockClineProvider,
			cwd: undefined,
			getCurrentTask: vi.fn().mockReturnValue(null),
		} as unknown as ClineProvider

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "test",
			requestId: "test-request-error",
		})

		// Verify error response was sent
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileSearchResults",
			results: [],
			requestId: "test-request-error",
			error: "No workspace path available",
		})
	})

	it("should handle errors from searchWorkspaceFiles", async () => {
		mockSearchWorkspaceFiles.mockRejectedValue(new Error("File search failed"))

		// Setup state
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: false,
		})
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue(null)

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "test",
			requestId: "test-request-fail",
		})

		// Verify error response was sent
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "fileSearchResults",
			results: [],
			error: "File search failed",
			requestId: "test-request-fail",
		})
	})

	it("should default showRooIgnoredFiles to false when state is null", async () => {
		// Setup mock results from file search
		const mockResults = [{ path: "src/index.ts", type: "file" as const, label: "index.ts" }]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state to return null
		;(mockClineProvider.getState as Mock).mockResolvedValue(null)

		// Setup filter to return all paths (no filtering)
		mockFilterPaths.mockReturnValue(["src/index.ts"])

		// No current task
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue(null)

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-default",
		})

		// Verify filterPaths was called (showRooIgnoredFiles defaults to false)
		expect(mockFilterPaths).toHaveBeenCalled()
	})

	it("should dispose temporary RooIgnoreController after use", async () => {
		// Setup mock results from file search
		const mockResults = [{ path: "src/index.ts", type: "file" as const, label: "index.ts" }]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: false,
		})

		// Setup filter
		mockFilterPaths.mockReturnValue(["src/index.ts"])

		// No current task, so temporary controller will be created and should be disposed
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue(null)

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-dispose",
		})

		// Verify dispose was called on the temporary controller
		expect(mockDispose).toHaveBeenCalled()
	})

	it("should not dispose controller from current task", async () => {
		// Setup mock results from file search
		const mockResults = [{ path: "src/index.ts", type: "file" as const, label: "index.ts" }]
		mockSearchWorkspaceFiles.mockResolvedValue(mockResults)

		// Setup state
		;(mockClineProvider.getState as Mock).mockResolvedValue({
			showRooIgnoredFiles: false,
		})

		// Create a mock task with its own RooIgnoreController
		const taskFilterPaths = vi.fn().mockReturnValue(["src/index.ts"])
		const taskDispose = vi.fn()
		const taskRooIgnoreController = {
			filterPaths: taskFilterPaths,
			initialize: vi.fn(),
			dispose: taskDispose,
		}
		;(mockClineProvider.getCurrentTask as Mock).mockReturnValue({
			taskId: "test-task-id",
			rooIgnoreController: taskRooIgnoreController,
		})

		await webviewMessageHandler(mockClineProvider, {
			type: "searchFiles",
			query: "index",
			requestId: "test-request-no-dispose",
		})

		// Verify dispose was NOT called on the task's controller
		expect(taskDispose).not.toHaveBeenCalled()
		// Verify the prototype dispose was also not called
		expect(mockDispose).not.toHaveBeenCalled()
	})
})
