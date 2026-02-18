// npx vitest run core/webview/__tests__/ClineProvider.sticky-profile.spec.ts

import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"
import type { HistoryItem } from "@roo-code/types"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	UIKind: {
		Desktop: 1,
		Web: 2,
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
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })), // kilocode_change
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
		uiKind: 1,
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

// Create a counter for unique task IDs.
let taskIdCounter = 0

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options) => ({
		taskId: options.taskId || `test-task-id-${++taskIdCounter}`,
		saveClineMessages: vi.fn(),
		clineMessages: [],
		apiConversationHistory: [],
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
		abortTask: vi.fn(),
		handleWebviewAskResponse: vi.fn(),
		getTaskNumber: vi.fn().mockReturnValue(0),
		setTaskNumber: vi.fn(),
		setParentTask: vi.fn(),
		setRootTask: vi.fn(),
		emit: vi.fn(),
		parentTask: options.parentTask,
		updateApiConfiguration: vi.fn(),
		setTaskApiConfigName: vi.fn(),
		_taskApiConfigName: options.historyItem?.apiConfigName,
		taskApiConfigName: options.historyItem?.apiConfigName,
		getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
	})),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/safeWriteJson")

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(() => ({
		initializeFilePaths: vi.fn(),
		dispose: vi.fn(),
	})),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getToolDescription: () => "test",
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
			}
		},
	},
	BridgeOrchestrator: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
}))

vi.mock("../../../shared/modes", () => ({
	modes: [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit", "browser"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
	],
	getModeBySlug: vi.fn().mockReturnValue({
		slug: "code",
		name: "Code Mode",
		roleDefinition: "You are a code assistant",
		groups: ["read", "edit", "browser"],
	}),
	defaultModeSlug: "code",
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				setProvider: vi.fn(),
				updateIdentity: vi.fn().mockResolvedValue(undefined), // kilocode_change
				captureModeSwitch: vi.fn(),
				captureException: vi.fn(), // kilocode_change
			}
		},
	},
}))

describe("ClineProvider - Sticky Provider Profile", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockWebviewView: vscode.WebviewView
	let mockPostMessage: any

	beforeEach(() => {
		vi.clearAllMocks()
		taskIdCounter = 0

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const globalState: Record<string, string | undefined> = {
			mode: "code",
			currentApiConfigName: "default-profile",
		}

		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					globalState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					secrets[key] = value
					return Promise.resolve()
				}),
				delete: vi.fn().mockImplementation((key: string) => {
					delete secrets[key]
					return Promise.resolve()
				}),
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

		// Mock getMcpHub method
		provider.getMcpHub = vi.fn().mockReturnValue({
			listTools: vi.fn().mockResolvedValue([]),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
			listResources: vi.fn().mockResolvedValue([]),
			readResource: vi.fn().mockResolvedValue({ contents: [] }),
			getAllServers: vi.fn().mockReturnValue([]),
		})
	})

	describe("activateProviderProfile", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("should save provider profile to task metadata when switching profiles", async () => {
			// Create a mock task
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock getGlobalState to return task history
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([
				{
					id: mockTask.taskId,
					ts: Date.now(),
					task: "Test task",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
				},
			])

			// Mock updateTaskHistory to track calls
			const updateTaskHistorySpy = vi
				.spyOn(provider, "updateTaskHistory")
				.mockImplementation(() => Promise.resolve([]))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Switch provider profile
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify task history was updated with new provider profile
			expect(updateTaskHistorySpy).toHaveBeenCalledWith(
				expect.objectContaining({
					id: mockTask.taskId,
					apiConfigName: "new-profile",
				}),
			)

			// Verify task's setTaskApiConfigName was called
			expect(mockTask.setTaskApiConfigName).toHaveBeenCalledWith("new-profile")
		})

		it("should update task's taskApiConfigName property when switching profiles", async () => {
			// Create a mock task with initial profile
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock getGlobalState to return task history
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([
				{
					id: mockTask.taskId,
					ts: Date.now(),
					task: "Test task",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
				},
			])

			// Mock updateTaskHistory
			vi.spyOn(provider, "updateTaskHistory").mockImplementation(() => Promise.resolve([]))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "openrouter",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "openrouter" },
			])

			// Switch provider profile
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify task's _taskApiConfigName property was updated
			expect(mockTask._taskApiConfigName).toBe("new-profile")
		})

		it("should update in-memory task profile even if task history item does not exist yet", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			await provider.addClineToStack(mockTask as any)

			// No history item exists yet
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([])

			const updateTaskHistorySpy = vi
				.spyOn(provider, "updateTaskHistory")
				.mockImplementation(() => Promise.resolve([]))

			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "openrouter",
			})

			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "openrouter" },
			])

			await provider.activateProviderProfile({ name: "new-profile" })

			// In-memory should still update, even without a history item.
			expect(mockTask._taskApiConfigName).toBe("new-profile")
			// No history item => no updateTaskHistory call.
			expect(updateTaskHistorySpy).not.toHaveBeenCalled()
		})
	})

	describe("createTaskWithHistoryItem", () => {
		it("should restore provider profile from history item when reopening task", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				mode: "code",
				apiConfigName: "saved-profile", // Saved provider profile
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "saved-profile", id: "saved-profile-id", apiProvider: "anthropic" },
			])

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify provider profile was restored via activateProviderProfile (restore-only: don't persist mode config)
			expect(activateProviderProfileSpy).toHaveBeenCalledWith(
				{ name: "saved-profile" },
				{ persistModeConfig: false, persistTaskHistory: false },
			)
		})

		it("should use current profile if history item has no saved apiConfigName", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item without saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				// No apiConfigName field
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify activateProviderProfile was NOT called for apiConfigName restoration
			// (it might be called for mode-based config, but not for direct apiConfigName)
			const callsForApiConfigName = activateProviderProfileSpy.mock.calls.filter(
				(call) => call[0] && "name" in call[0] && call[0].name === historyItem.apiConfigName,
			)
			expect(callsForApiConfigName.length).toBe(0)
		})

		it("should override mode-based config with task's apiConfigName", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with both mode and apiConfigName
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				mode: "architect", // Mode has a different preferred profile
				apiConfigName: "task-specific-profile", // Task's actual profile
			}

			// Track all activateProviderProfile calls
			const activateCalls: string[] = []
			vi.spyOn(provider, "activateProviderProfile").mockImplementation(async (args) => {
				if ("name" in args) {
					activateCalls.push(args.name)
				}
			})

			// Mock providerSettingsManager methods
			vi.spyOn(provider.providerSettingsManager, "getModeConfigId").mockResolvedValue("mode-config-id")
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "mode-preferred-profile", id: "mode-config-id", apiProvider: "anthropic" },
				{ name: "task-specific-profile", id: "task-profile-id", apiProvider: "openai" },
			])

			// Initialize task with history item
			await provider.createTaskWithHistoryItem(historyItem)

			// Verify task's apiConfigName was activated LAST (overriding mode-based config)
			expect(activateCalls[activateCalls.length - 1]).toBe("task-specific-profile")
		})

		it("should handle missing provider profile gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with a provider profile that no longer exists
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: "deleted-profile", // Profile that doesn't exist
			}

			// Mock providerSettingsManager.listConfig to return empty (profile doesn't exist)
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([])

			// Mock log to verify warning is logged
			const logSpy = vi.spyOn(provider, "log")

			// Initialize task with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify a warning was logged
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Provider profile 'deleted-profile' from history no longer exists"),
			)
		})
	})

	describe("Task metadata persistence", () => {
		it("should include apiConfigName in task metadata when saving", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a mock task with provider profile
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "test-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Mock getGlobalState to return task history with our task
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([
				{
					id: mockTask.taskId,
					ts: Date.now(),
					task: "Test task",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
				},
			])

			// Mock updateTaskHistory to capture the updated history item
			let updatedHistoryItem: any
			vi.spyOn(provider, "updateTaskHistory").mockImplementation((item) => {
				updatedHistoryItem = item
				return Promise.resolve([item])
			})

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Trigger a profile switch
			await provider.activateProviderProfile({ name: "new-profile" })

			// Verify apiConfigName was included in the updated history item
			expect(updatedHistoryItem).toBeDefined()
			expect(updatedHistoryItem.apiConfigName).toBe("new-profile")
		})
	})

	describe("Multiple workspaces isolation", () => {
		it("should preserve task profile when switching profiles in another workspace", async () => {
			// This test verifies that each task retains its designated provider profile
			// so that switching profiles in one workspace doesn't alter other tasks

			await provider.resolveWebviewView(mockWebviewView)

			// Create task 1 with profile A
			const task1 = {
				taskId: "task-1",
				_taskApiConfigName: "profile-a",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Create task 2 with profile B
			const task2 = {
				taskId: "task-2",
				_taskApiConfigName: "profile-b",
				setTaskApiConfigName: vi.fn().mockImplementation(function (this: any, name: string) {
					this._taskApiConfigName = name
				}),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Add task 1 to stack
			await provider.addClineToStack(task1 as any)

			// Mock getGlobalState to return task history for both tasks
			const taskHistory = [
				{
					id: "task-1",
					ts: Date.now(),
					task: "Task 1",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
					apiConfigName: "profile-a",
				},
				{
					id: "task-2",
					ts: Date.now(),
					task: "Task 2",
					number: 2,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
					apiConfigName: "profile-b",
				},
			]

			vi.spyOn(provider as any, "getGlobalState").mockReturnValue(taskHistory)

			// Mock updateTaskHistory
			vi.spyOn(provider, "updateTaskHistory").mockImplementation((item) => {
				const index = taskHistory.findIndex((h) => h.id === item.id)
				if (index >= 0) {
					taskHistory[index] = { ...taskHistory[index], ...item }
				}
				return Promise.resolve(taskHistory)
			})

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "profile-c",
				id: "profile-c-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "profile-a", id: "profile-a-id", apiProvider: "anthropic" },
				{ name: "profile-b", id: "profile-b-id", apiProvider: "openai" },
				{ name: "profile-c", id: "profile-c-id", apiProvider: "anthropic" },
			])

			// Switch task 1's profile to profile C
			await provider.activateProviderProfile({ name: "profile-c" })

			// Verify task 1's profile was updated
			expect(task1._taskApiConfigName).toBe("profile-c")
			expect(taskHistory[0].apiConfigName).toBe("profile-c")

			// Verify task 2's profile remains unchanged
			expect(taskHistory[1].apiConfigName).toBe("profile-b")
		})
	})

	describe("Error handling", () => {
		it("should handle errors gracefully when saving profile fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a mock task
			const mockTask = {
				taskId: "test-task-id",
				_taskApiConfigName: "default-profile",
				setTaskApiConfigName: vi.fn(),
				emit: vi.fn(),
				saveClineMessages: vi.fn(),
				clineMessages: [],
				apiConversationHistory: [],
				updateApiConfiguration: vi.fn(),
				getCumulativeTotalCost: vi.fn().mockReturnValue(0), // kilocode_change
			}

			// Add task to provider stack
			await provider.addClineToStack(mockTask as any)

			// Mock getGlobalState
			vi.spyOn(provider as any, "getGlobalState").mockReturnValue([
				{
					id: mockTask.taskId,
					ts: Date.now(),
					task: "Test task",
					number: 1,
					tokensIn: 0,
					tokensOut: 0,
					cacheWrites: 0,
					cacheReads: 0,
					totalCost: 0,
				},
			])

			// Mock updateTaskHistory to throw error
			vi.spyOn(provider, "updateTaskHistory").mockRejectedValue(new Error("Save failed"))

			// Mock providerSettingsManager.activateProfile
			vi.spyOn(provider.providerSettingsManager, "activateProfile").mockResolvedValue({
				name: "new-profile",
				id: "new-profile-id",
				apiProvider: "anthropic",
			})

			// Mock providerSettingsManager.listConfig
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "new-profile", id: "new-profile-id", apiProvider: "anthropic" },
			])

			// Mock log to verify error is logged
			const logSpy = vi.spyOn(provider, "log")

			// Switch provider profile - should not throw
			await expect(provider.activateProviderProfile({ name: "new-profile" })).resolves.not.toThrow()

			// Verify error was logged
			expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to persist provider profile switch"))
		})

		it("should handle null/undefined apiConfigName gracefully", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with null apiConfigName
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: null as any, // Invalid apiConfigName
			}

			// Mock activateProviderProfile to track calls
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			// Initialize task with history item - should not throw
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify activateProviderProfile was not called with null
			expect(activateProviderProfileSpy).not.toHaveBeenCalledWith({ name: null })
		})
	})

	describe("Profile restoration with activateProfile failure", () => {
		it("should continue task restoration even if activateProviderProfile fails", async () => {
			await provider.resolveWebviewView(mockWebviewView)

			// Create a history item with saved provider profile
			const historyItem: HistoryItem = {
				id: "test-task-id",
				number: 1,
				ts: Date.now(),
				task: "Test task",
				tokensIn: 100,
				tokensOut: 200,
				cacheWrites: 0,
				cacheReads: 0,
				totalCost: 0.001,
				apiConfigName: "failing-profile",
			}

			// Mock providerSettingsManager.listConfig to return the profile
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "failing-profile", id: "failing-profile-id", apiProvider: "anthropic" },
			])

			// Mock activateProviderProfile to throw error
			vi.spyOn(provider, "activateProviderProfile").mockRejectedValue(new Error("Activation failed"))

			// Mock log to verify error is logged
			const logSpy = vi.spyOn(provider, "log")

			// Initialize task with history item - should not throw even though activation fails
			await expect(provider.createTaskWithHistoryItem(historyItem)).resolves.not.toThrow()

			// Verify error was logged
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining("Failed to restore API configuration 'failing-profile' for task"),
			)
		})
	})
})
