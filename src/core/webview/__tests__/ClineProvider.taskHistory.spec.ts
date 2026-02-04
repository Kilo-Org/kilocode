// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.taskHistory.spec.ts

import * as vscode from "vscode"
import type { HistoryItem, ExtensionMessage } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { ContextProxy } from "../../config/ContextProxy"
import { ClineProvider } from "../ClineProvider"

// Mock setup
vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: {
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	},
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: {
		InvalidRequest: "InvalidRequest",
		MethodNotFound: "MethodNotFound",
		InternalError: "InternalError",
	},
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

vi.mock("../../../services/browser/BrowserSession", () => ({
	BrowserSession: vi.fn().mockImplementation(() => ({
		testConnection: vi.fn().mockResolvedValue({ success: false }),
	})),
}))

vi.mock("../../../services/browser/browserDiscovery", () => ({
	discoverChromeHostUrl: vi.fn().mockResolvedValue("http://localhost:9222"),
	tryChromeHostUrl: vi.fn().mockResolvedValue(false),
	testBrowserConnection: vi.fn(),
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
	})),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
	return {
		default: vi.fn().mockImplementation(() => ({
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		})),
	}
})

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options: any) => ({
		api: undefined,
		abortTask: vi.fn(),
		handleWebviewAskResponse: vi.fn(),
		clineMessages: [],
		apiConversationHistory: [],
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
		getTaskNumber: vi.fn().mockReturnValue(0),
		setTaskNumber: vi.fn(),
		setParentTask: vi.fn(),
		setRootTask: vi.fn(),
		taskId: options?.historyItem?.id || "test-task-id",
		emit: vi.fn(),
	})),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("file content"),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [{ slug: "code", name: "Code Mode", roleDefinition: "You are a code assistant", groups: ["read", "edit"] }],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit"],
	}),
	getGroupName: vi.fn().mockReturnValue("General Tools"),
	defaultModeSlug: "code",
}))

vi.mock("../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
				getAllowList: vi.fn().mockResolvedValue("*"),
				getUserInfo: vi.fn().mockReturnValue(null),
				canShareTask: vi.fn().mockResolvedValue(false),
				canSharePublicly: vi.fn().mockResolvedValue(false),
				getOrganizationSettings: vi.fn().mockReturnValue(null),
				getOrganizationMemberships: vi.fn().mockResolvedValue([]),
				getUserSettings: vi.fn().mockReturnValue(null),
				isTaskSyncEnabled: vi.fn().mockReturnValue(false),
			}
		},
	},
	BridgeOrchestrator: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

afterAll(() => {
	vi.restoreAllMocks()
})

describe("ClineProvider Task History Synchronization", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: ReturnType<typeof vi.fn>
	let taskHistoryState: HistoryItem[]

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		// Initialize task history state
		taskHistoryState = []

		const globalState: Record<string, any> = {
			mode: "code",
			currentApiConfigName: "current-config",
			taskHistory: taskHistoryState,
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: any) => {
					globalState[key] = value
					if (key === "taskHistory") {
						taskHistoryState = value
					}
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			subscriptions: [],
			extension: {
				packageJSON: { version: "1.0.0" },
			},
			globalStorageUri: {
				fsPath: "/test/storage/path",
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		mockPostMessage = vi.fn()

		mockWebviewView = {
			webview: {
				postMessage: mockPostMessage,
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation((callback) => {
				callback()
				return { dispose: vi.fn() }
			}),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

		// Mock the custom modes manager
		;(provider as any).customModesManager = {
			updateCustomMode: vi.fn().mockResolvedValue(undefined),
			getCustomModes: vi.fn().mockResolvedValue([]),
			dispose: vi.fn(),
		}

		// Mock getMcpHub
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	// Helper to create valid HistoryItem with required fields
	const createHistoryItem = (overrides: Partial<HistoryItem> & { id: string; task: string }): HistoryItem => ({
		number: 1,
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
		...overrides,
	})

	// Helper to find calls by message type
	const findCallsByType = (calls: any[][], type: string) => {
		return calls.filter((call) => call[0]?.type === type)
	}

	describe("updateTaskHistory", () => {
		it("broadcasts task history update by default", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-1",
				task: "Test task",
			})

			await provider.updateTaskHistory(historyItem)

			// Should have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBeGreaterThanOrEqual(1)

			const lastCall = taskHistoryItemUpdatedCalls[taskHistoryItemUpdatedCalls.length - 1]
			expect(lastCall[0].type).toBe("taskHistoryItemUpdated")
			expect(lastCall[0].taskHistoryItem).toBeDefined()
			expect(lastCall[0].taskHistoryItem.id).toBe("task-1")
		})

		it("does not broadcast when broadcast option is false", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Clear previous calls
			mockPostMessage.mockClear()

			const historyItem = createHistoryItem({
				id: "task-2",
				task: "Test task 2",
			})

			await provider.updateTaskHistory(historyItem, { broadcast: false })

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("does not broadcast when view is not launched", async () => {
			// Do not resolve webview and keep isViewLaunched false
			provider.isViewLaunched = false

			const historyItem = createHistoryItem({
				id: "task-3",
				task: "Test task 3",
			})

			await provider.updateTaskHistory(historyItem)

			// Should NOT have called postMessage with taskHistoryItemUpdated
			const taskHistoryItemUpdatedCalls = findCallsByType(mockPostMessage.mock.calls, "taskHistoryItemUpdated")

			expect(taskHistoryItemUpdatedCalls.length).toBe(0)
		})

		it("updates existing task in history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-update",
				task: "Original task",
			})

			await provider.updateTaskHistory(historyItem)

			// Update the same task
			const updatedItem: HistoryItem = {
				...historyItem,
				task: "Updated task",
				tokensIn: 200,
			}

			await provider.updateTaskHistory(updatedItem)

			// Verify the update was persisted
			expect(mockContext.globalState.update).toHaveBeenCalledWith(
				"taskHistory",
				expect.arrayContaining([expect.objectContaining({ id: "task-update", task: "Updated task" })]),
			)

			// Should not have duplicates
			const allCalls = (mockContext.globalState.update as ReturnType<typeof vi.fn>).mock.calls
			const lastUpdateCall = allCalls.find((call: any[]) => call[0] === "taskHistory")
			const historyArray = lastUpdateCall?.[1] as HistoryItem[]
			const matchingItems = historyArray?.filter((item: HistoryItem) => item.id === "task-update")
			expect(matchingItems?.length).toBe(1)
		})

		it("returns the updated task history array", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const historyItem = createHistoryItem({
				id: "task-return",
				task: "Return test task",
			})

			const result = await provider.updateTaskHistory(historyItem)

			expect(Array.isArray(result)).toBe(true)
			expect(result.some((item) => item.id === "task-return")).toBe(true)
		})
	})

	describe("broadcastTaskHistoryUpdate", () => {
		it("sends taskHistoryUpdated message with sorted history", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "old", ts: now - 10000, task: "Old task" }),
				createHistoryItem({ id: "new", ts: now, task: "New task", number: 2 }),
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			expect(mockPostMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "taskHistoryUpdated",
					taskHistory: expect.any(Array),
				}),
			)

			// Verify the history is sorted (newest first)
			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]
			expect(sentHistory[0].id).toBe("new") // Newest should be first
			expect(sentHistory[1].id).toBe("old") // Oldest should be second
		})

		it("filters out invalid history items", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			const now = Date.now()
			const items: HistoryItem[] = [
				createHistoryItem({ id: "valid", ts: now, task: "Valid task" }),
				createHistoryItem({ id: "no-ts", ts: 0, task: "No timestamp", number: 2 }), // Invalid: ts is 0/falsy
				createHistoryItem({ id: "no-task", ts: now, task: "", number: 3 }), // Invalid: empty task
			]

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate(items)

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			// Only valid item should be included
			expect(sentHistory.length).toBe(1)
			expect(sentHistory[0].id).toBe("valid")
		})

		it("reads from global state when no history is provided", async () => {
			await provider.resolveWebviewView(mockWebviewView)
			provider.isViewLaunched = true

			// Set up task history in global state
			const now = Date.now()
			const stateHistory: HistoryItem[] = [createHistoryItem({ id: "from-state", ts: now, task: "State task" })]

			// Update the mock to return our history
			;(mockContext.globalState.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
				if (key === "taskHistory") return stateHistory
				return undefined
			})

			// Clear previous calls
			mockPostMessage.mockClear()

			await provider.broadcastTaskHistoryUpdate()

			const calls = mockPostMessage.mock.calls as any[][]
			const call = calls.find((c) => c[0]?.type === "taskHistoryUpdated")
			const sentHistory = call?.[0]?.taskHistory as HistoryItem[]

			expect(sentHistory.length).toBe(1)
			expect(sentHistory[0].id).toBe("from-state")
		})
	})

	describe("task history includes all workspaces", () => {
		it("getStateToPostToWebview returns tasks from all workspaces", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const now = Date.now()
			const multiWorkspaceHistory: HistoryItem[] = [
				createHistoryItem({
					id: "ws1-task",
					ts: now,
					task: "Workspace 1 task",
					workspace: "/path/to/workspace1",
				}),
				createHistoryItem({
					id: "ws2-task",
					ts: now - 1000,
					task: "Workspace 2 task",
					workspace: "/path/to/workspace2",
					number: 2,
				}),
				createHistoryItem({
					id: "ws3-task",
					ts: now - 2000,
					task: "Workspace 3 task",
					workspace: "/different/workspace",
					number: 3,
				}),
			]

			// Update the mock to return multi-workspace history
			;(mockContext.globalState.get as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
				if (key === "taskHistory") return multiWorkspaceHistory
				return undefined
			})

			const state = await provider.getStateToPostToWebview()

			// All tasks from all workspaces should be included
			expect(state.taskHistory.length).toBe(3)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace1")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/path/to/workspace2")).toBe(true)
			expect(state.taskHistory.some((item: HistoryItem) => item.workspace === "/different/workspace")).toBe(true)
		})
	})
})
