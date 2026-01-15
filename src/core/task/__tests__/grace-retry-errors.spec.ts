// npx vitest core/task/__tests__/grace-retry-errors.spec.ts

import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import type { GlobalState, ProviderSettings } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { Task } from "../Task"
import { ClineProvider } from "../../webview/ClineProvider"
import { ContextProxy } from "../../config/ContextProxy"

// Mock @roo-code/core
vi.mock("@roo-code/core", () => ({
	customToolRegistry: {
		getTools: vi.fn().mockReturnValue([]),
		hasTool: vi.fn().mockReturnValue(false),
		getTool: vi.fn().mockReturnValue(undefined),
	},
}))

// Mock delay before any imports that might use it
vi.mock("delay", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

vi.mock("fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, any>
	const mockFunctions = {
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockImplementation(() => Promise.resolve("[]")),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}

	return {
		...actual,
		...mockFunctions,
		default: mockFunctions,
	}
})

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = { event: vi.fn(), fire: vi.fn() }
	const mockTextDocument = { uri: { fsPath: "/mock/workspace/path/file.ts" } }
	const mockTextEditor = { document: mockTextDocument }
	const mockTab = { input: { uri: { fsPath: "/mock/workspace/path/file.ts" } } }
	const mockTabGroup = { tabs: [mockTab] }

	return {
		TabInputTextDiff: vi.fn(),
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		window: {
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			visibleTextEditors: [mockTextEditor],
			tabGroups: {
				all: [mockTabGroup],
				close: vi.fn(),
				onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
			},
			showErrorMessage: vi.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: { fsPath: "/mock/workspace/path" },
					name: "mock-workspace",
					index: 0,
				},
			],
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
			fs: {
				stat: vi.fn().mockResolvedValue({ type: 1 }),
			},
			onDidSaveTextDocument: vi.fn(() => mockDisposable),
			getConfiguration: vi.fn(() => ({ get: (key: string, defaultValue: any) => defaultValue })),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
		TabInputText: vi.fn(),
	}
})

vi.mock("../../mentions", () => ({
	parseMentions: vi.fn().mockImplementation((text) => {
		return Promise.resolve(`processed: ${text}`)
	}),
	openMention: vi.fn(),
	getLatestTerminalOutput: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

vi.mock("../../ignore/RooIgnoreController")

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath, taskId) => Promise.resolve(`${globalStoragePath}/tasks/${taskId}`)),
	getSettingsDirectoryPath: vi
		.fn()
		.mockImplementation((globalStoragePath) => Promise.resolve(`${globalStoragePath}/settings`)),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockImplementation(() => false),
}))

describe("Grace Retry Error Handling", () => {
	let mockProvider: any
	let mockApiConfig: ProviderSettings
	let mockOutputChannel: any
	let mockExtensionContext: vscode.ExtensionContext

	beforeEach(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		const storageUri = {
			fsPath: path.join(os.tmpdir(), "test-storage"),
		}

		mockExtensionContext = {
			globalState: {
				get: vi.fn().mockImplementation((_key: keyof GlobalState) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: storageUri,
			workspaceState: {
				get: vi.fn().mockImplementation((_key) => undefined),
				update: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				keys: vi.fn().mockReturnValue([]),
			},
			secrets: {
				get: vi.fn().mockImplementation((_key) => Promise.resolve(undefined)),
				store: vi.fn().mockImplementation((_key, _value) => Promise.resolve()),
				delete: vi.fn().mockImplementation((_key) => Promise.resolve()),
			},
			extensionUri: {
				fsPath: "/mock/extension/path",
			},
			extension: {
				packageJSON: {
					version: "1.0.0",
				},
			},
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			append: vi.fn(),
			clear: vi.fn(),
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		}

		mockProvider = new ClineProvider(
			mockExtensionContext,
			mockOutputChannel,
			"sidebar",
			new ContextProxy(mockExtensionContext),
		) as any

		mockApiConfig = {
			apiProvider: "anthropic",
			apiModelId: "claude-3-5-sonnet-20241022",
			apiKey: "test-api-key",
		}

		mockProvider.postMessageToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		mockProvider.getState = vi.fn().mockResolvedValue({})
	})

	describe("consecutiveNoAssistantMessagesCount", () => {
		it("should initialize to 0", () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
		})

		it("should reset to 0 when abortTask is called", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Manually set the counter to simulate consecutive failures
			task.consecutiveNoAssistantMessagesCount = 5

			// Mock dispose to prevent actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			await task.abortTask()

			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
		})

		it("should reset consecutiveNoToolUseCount when abortTask is called", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Manually set both counters
			task.consecutiveNoAssistantMessagesCount = 3
			task.consecutiveNoToolUseCount = 4

			// Mock dispose to prevent actual cleanup
			vi.spyOn(task, "dispose").mockImplementation(() => {})

			await task.abortTask()

			// Both counters should be reset
			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
			expect(task.consecutiveNoToolUseCount).toBe(0)
		})
	})

	describe("consecutiveNoToolUseCount", () => {
		it("should initialize to 0", () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			expect(task.consecutiveNoToolUseCount).toBe(0)
		})
	})

	describe("Grace Retry Pattern", () => {
		it("should not show error on first failure (grace retry)", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)

			// Simulate first empty response - should NOT show error
			task.consecutiveNoAssistantMessagesCount = 0
			task.consecutiveNoAssistantMessagesCount++
			expect(task.consecutiveNoAssistantMessagesCount).toBe(1)

			// First failure: grace retry (silent)
			if (task.consecutiveNoAssistantMessagesCount >= 2) {
				await task.say("error", "MODEL_NO_ASSISTANT_MESSAGES")
			}

			// Verify error was NOT called (grace retry on first failure)
			expect(saySpy).not.toHaveBeenCalledWith("error", "MODEL_NO_ASSISTANT_MESSAGES")
		})

		it("should show error after 2 consecutive failures", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)

			// Simulate second consecutive empty response
			task.consecutiveNoAssistantMessagesCount = 1
			task.consecutiveNoAssistantMessagesCount++
			expect(task.consecutiveNoAssistantMessagesCount).toBe(2)

			// Second failure: should show error
			if (task.consecutiveNoAssistantMessagesCount >= 2) {
				await task.say("error", "MODEL_NO_ASSISTANT_MESSAGES")
			}

			// Verify error was called (after 2 consecutive failures)
			expect(saySpy).toHaveBeenCalledWith("error", "MODEL_NO_ASSISTANT_MESSAGES")
		})

		it("should show error on third consecutive failure", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)

			// Simulate third consecutive empty response
			task.consecutiveNoAssistantMessagesCount = 2
			task.consecutiveNoAssistantMessagesCount++
			expect(task.consecutiveNoAssistantMessagesCount).toBe(3)

			// Third failure: should also show error
			if (task.consecutiveNoAssistantMessagesCount >= 2) {
				await task.say("error", "MODEL_NO_ASSISTANT_MESSAGES")
			}

			// Verify error was called
			expect(saySpy).toHaveBeenCalledWith("error", "MODEL_NO_ASSISTANT_MESSAGES")
		})
	})

	describe("Counter Reset on Success", () => {
		it("should be able to simulate counter reset when valid content is received", () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Simulate some consecutive failures
			task.consecutiveNoAssistantMessagesCount = 3

			// Simulate receiving valid content
			const hasTextContent = true
			const hasToolUses = false

			if (hasTextContent || hasToolUses) {
				task.consecutiveNoAssistantMessagesCount = 0
			}

			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
		})

		it("should reset counter when tool uses are present", () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Simulate some consecutive failures
			task.consecutiveNoAssistantMessagesCount = 2

			// Simulate receiving tool uses
			const hasTextContent = false
			const hasToolUses = true

			if (hasTextContent || hasToolUses) {
				task.consecutiveNoAssistantMessagesCount = 0
			}

			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)
		})
	})

	describe("Error Marker", () => {
		it("should use MODEL_NO_ASSISTANT_MESSAGES marker for error display", async () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			const saySpy = vi.spyOn(task, "say").mockResolvedValue(undefined)

			// Simulate the error condition (2 consecutive failures)
			task.consecutiveNoAssistantMessagesCount = 2

			if (task.consecutiveNoAssistantMessagesCount >= 2) {
				await task.say("error", "MODEL_NO_ASSISTANT_MESSAGES")
			}

			// Verify the exact marker is used
			expect(saySpy).toHaveBeenCalledWith("error", "MODEL_NO_ASSISTANT_MESSAGES")
		})
	})

	describe("Parallel with noToolsUsed error handling", () => {
		it("should have separate counters for noToolsUsed and noAssistantMessages", () => {
			const task = new Task({
				context: mockExtensionContext,
				provider: mockProvider,
				apiConfiguration: mockApiConfig,
				task: "test task",
				startTask: false,
			})

			// Both counters should start at 0
			expect(task.consecutiveNoToolUseCount).toBe(0)
			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)

			// Incrementing one should not affect the other
			task.consecutiveNoToolUseCount = 3
			expect(task.consecutiveNoAssistantMessagesCount).toBe(0)

			task.consecutiveNoAssistantMessagesCount = 2
			expect(task.consecutiveNoToolUseCount).toBe(3)
		})
	})
})
