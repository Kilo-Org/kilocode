import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

import { ClineProvider } from "../ClineProvider"
import { Task } from "../../task/Task"
import { ContextProxy } from "../../config/ContextProxy"
import type { ProviderSettings } from "@roo-code/types"

// Mock dependencies
vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	return {
		workspace: {
			getConfiguration: vi.fn(() => ({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn().mockResolvedValue(undefined),
			})),
			workspaceFolders: [],
			onDidChangeConfiguration: vi.fn(() => mockDisposable),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
		},
		EventEmitter: vi.fn().mockImplementation(() => ({
			event: vi.fn(),
			fire: vi.fn(),
		})),
		Disposable: {
			from: vi.fn(),
		},
		window: {
			showErrorMessage: vi.fn(),
			createTextEditorDecorationType: vi.fn().mockReturnValue({
				dispose: vi.fn(),
			}),
			onDidChangeActiveTextEditor: vi.fn(() => mockDisposable),
		},
		Uri: {
			file: vi.fn().mockReturnValue({ toString: () => "file://test" }),
		},
		commands: {
			executeCommand: vi.fn(),
		},
	}
})

vi.mock("../../task/Task")
vi.mock("../../config/ContextProxy")
vi.mock("../../../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		getInstance: vi.fn().mockResolvedValue({
			registerClient: vi.fn(),
		}),
		unregisterProvider: vi.fn(),
	},
}))
vi.mock("../../../services/marketplace")
vi.mock("../../../integrations/workspace/WorkspaceTracker")
vi.mock("../../config/ProviderSettingsManager")
vi.mock("../../config/CustomModesManager")
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			setProvider: vi.fn(),
			captureTaskCreated: vi.fn(),
		},
	},
}))

// Mock CloudService
vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(false),
		instance: {
			isAuthenticated: vi.fn().mockReturnValue(false),
			off: vi.fn(),
		},
	},
	BridgeOrchestrator: {
		isEnabled: vi.fn().mockReturnValue(false),
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("https://api.roo-code.com"),
}))

vi.mock("../../../shared/embeddingModels", () => ({
	EMBEDDING_MODEL_PROFILES: [],
}))

vi.mock("../../../shared/kilocode/cli-sessions/core/SessionManager", () => ({
	SessionManager: {
		init: vi.fn().mockReturnValue({
			startTimer: vi.fn(),
			setPath: vi.fn(),
			setWorkspaceDirectory: vi.fn(),
			destroy: vi.fn().mockResolvedValue(undefined),
		}),
	},
}))

describe("ClineProvider external extension error handling", () => {
	let provider: ClineProvider
	let mockContext: any
	let mockOutputChannel: any
	let mockTask: any

	const mockApiConfig: ProviderSettings = {
		apiProvider: "anthropic",
		apiKey: "test-key",
	} as ProviderSettings

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock extension context
		mockContext = {
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			globalStorageUri: { fsPath: "/test/storage" },
			secrets: {
				get: vi.fn().mockResolvedValue(undefined),
				store: vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined),
			},
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
				keys: vi.fn().mockReturnValue([]),
			},
			extensionUri: { fsPath: "/test/extension" },
		}

		// Setup mock output channel
		mockOutputChannel = {
			appendLine: vi.fn(),
			dispose: vi.fn(),
		}

		// Setup mock context proxy
		const mockContextProxy = {
			getValues: vi.fn().mockReturnValue({}),
			getValue: vi.fn().mockReturnValue(undefined),
			setValue: vi.fn().mockResolvedValue(undefined),
			getProviderSettings: vi.fn().mockReturnValue(mockApiConfig),
			extensionUri: mockContext.extensionUri,
			globalStorageUri: mockContext.globalStorageUri,
		}

		// Create provider instance
		provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", mockContextProxy as any)

		// Mock provider methods
		provider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: mockApiConfig,
			mode: "code",
		})

		provider.postStateToWebview = vi.fn().mockResolvedValue(undefined)
		;(provider as any).updateGlobalState = vi.fn().mockResolvedValue(undefined)
		provider.activateProviderProfile = vi.fn().mockResolvedValue(undefined)
		provider.performPreparationTasks = vi.fn().mockResolvedValue(undefined)

		// Setup mock task
		mockTask = {
			taskId: "task-1",
			instanceId: "instance-1",
			emit: vi.fn(),
			abortTask: vi.fn().mockResolvedValue(undefined),
			abandoned: false,
			dispose: vi.fn(),
			on: vi.fn(),
			off: vi.fn(),
		}
	})

	it("getInstance should handle executeCommand throwing SyntaxError gracefully", async () => {
		// Mock executeCommand to throw a SyntaxError (like TODO Tree extension does)
		const syntaxError = new SyntaxError("Unexpected token in extension")
		vi.mocked(vscode.commands.executeCommand).mockRejectedValue(syntaxError)

		// Mock getVisibleInstance to return undefined
		vi.spyOn(ClineProvider, "getVisibleInstance").mockReturnValue(undefined)

		// Spy on console.error to verify error was logged
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: Call getInstance - should not throw
		const result = await ClineProvider.getInstance()

		// Assert: Should handle the error gracefully
		expect(result).toBeUndefined()
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error focusing sidebar:", syntaxError)

		consoleErrorSpy.mockRestore()
	})

	it("getInstance should handle executeCommand throwing TypeError gracefully", async () => {
		// Mock executeCommand to throw a TypeError
		const typeError = new TypeError("Extension returned invalid type")
		vi.mocked(vscode.commands.executeCommand).mockRejectedValue(typeError)

		// Mock getVisibleInstance to return undefined
		vi.spyOn(ClineProvider, "getVisibleInstance").mockReturnValue(undefined)

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: Call getInstance
		const result = await ClineProvider.getInstance()

		// Assert: Should handle the error gracefully
		expect(result).toBeUndefined()
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error focusing sidebar:", typeError)

		consoleErrorSpy.mockRestore()
	})

	it("removeClineFromStack should handle cleanup functions throwing errors", async () => {
		// Setup: Add task to stack
		;(provider as any).clineStack = [mockTask]

		// Create cleanup functions, one of which throws an error (like TODO Tree extension)
		const cleanupFn1 = vi.fn()
		const cleanupFn2 = vi.fn(() => {
			throw new SyntaxError("Extension error during cleanup")
		})
		const cleanupFn3 = vi.fn()

		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask, [cleanupFn1, cleanupFn2, cleanupFn3])

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: removeClineFromStack should not throw
		await expect(provider.removeClineFromStack()).resolves.not.toThrow()

		// Assert: Should log error but continue cleanup
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Error running cleanup functions"),
			expect.any(Error),
		)

		// Verify all cleanup functions were called
		expect(cleanupFn1).toHaveBeenCalled()
		expect(cleanupFn2).toHaveBeenCalled()
		// cleanupFn3 won't be called because cleanupFn2 throws, but the error should be caught

		// Verify taskEventListeners was cleaned up despite error
		expect((provider as any).taskEventListeners.has(mockTask)).toBe(false)

		consoleErrorSpy.mockRestore()
	})

	it("removeClineFromStack should still clean up even if all cleanup functions throw", async () => {
		// Setup: Add task to stack
		;(provider as any).clineStack = [mockTask]

		// Create cleanup functions that all throw
		const cleanupFn1 = vi.fn(() => {
			throw new Error("Cleanup error 1")
		})
		const cleanupFn2 = vi.fn(() => {
			throw new Error("Cleanup error 2")
		})

		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).taskEventListeners.set(mockTask, [cleanupFn1, cleanupFn2])

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: removeClineFromStack should not throw
		await expect(provider.removeClineFromStack()).resolves.not.toThrow()

		// Assert: Should still delete the map entry to prevent memory leaks
		expect((provider as any).taskEventListeners.has(mockTask)).toBe(false)

		consoleErrorSpy.mockRestore()
	})

	it("dispose should complete all cleanup steps even if individual steps throw", async () => {
		// Setup: Add task to stack
		;(provider as any).clineStack = [mockTask]
		;(provider as any).taskEventListeners = new WeakMap()

		// Setup disposables
		const mockDisposable1 = { dispose: vi.fn() }
		const mockDisposable2 = {
			dispose: vi.fn(() => {
				throw new Error("Disposable error")
			}),
		}
		const mockDisposable3 = { dispose: vi.fn() }
		;(provider as any).disposables = [mockDisposable1, mockDisposable2, mockDisposable3]

		// Mock clearAllPendingEditOperations (private method)
		;(provider as any).clearAllPendingEditOperations = vi.fn()

		// Mock clearWebviewResources (private method)
		;(provider as any).clearWebviewResources = vi.fn()

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: dispose should not throw
		await expect(provider.dispose()).resolves.not.toThrow()

		// Assert: All disposables should have been disposed
		expect(mockDisposable1.dispose).toHaveBeenCalled()
		expect(mockDisposable2.dispose).toHaveBeenCalled()
		expect(mockDisposable3.dispose).toHaveBeenCalled()

		// Verify error was logged but disposal continued
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error disposing individual disposable:", expect.any(Error))

		consoleErrorSpy.mockRestore()
	})

	it("dispose should continue even if task removal throws", async () => {
		// Setup: Add task to stack
		;(provider as any).clineStack = [mockTask]
		;(provider as any).taskEventListeners = new WeakMap()

		// Mock abortTask to throw
		mockTask.abortTask.mockRejectedValue(new Error("Abort error"))

		// Mock clearAllPendingEditOperations (private method)
		;(provider as any).clearAllPendingEditOperations = vi.fn()

		// Mock clearWebviewResources (private method)
		;(provider as any).clearWebviewResources = vi.fn()

		// Setup a disposable that won't throw
		const mockDisposable = { dispose: vi.fn() }
		;(provider as any).disposables = [mockDisposable]

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: dispose should not throw
		await expect(provider.dispose()).resolves.not.toThrow()

		// Assert: Error should be logged, but other cleanup should continue
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error clearing task stack:", expect.any(Error))

		// Verify disposable was still disposed
		expect(mockDisposable.dispose).toHaveBeenCalled()

		consoleErrorSpy.mockRestore()
	})

	it("dispose should handle webview disposal errors gracefully", async () => {
		// Setup: Create a mock view that throws on dispose
		const mockView = {
			dispose: vi.fn(() => {
				throw new Error("Webview disposal error")
			}),
		}
		;(provider as any).view = mockView

		// Setup empty stack for simplicity
		;(provider as any).clineStack = []
		;(provider as any).taskEventListeners = new WeakMap()
		;(provider as any).disposables = []

		// Mock other methods (private methods)
		;(provider as any).clearAllPendingEditOperations = vi.fn()
		;(provider as any).clearWebviewResources = vi.fn()

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: dispose should not throw
		await expect(provider.dispose()).resolves.not.toThrow()

		// Assert: Error should be logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error disposing webview:", expect.any(Error))

		consoleErrorSpy.mockRestore()
	})

	it("getInstance should return visible provider if already visible", async () => {
		// Setup: Mock getVisibleInstance to return a provider
		const mockVisibleProvider = {} as ClineProvider
		vi.spyOn(ClineProvider, "getVisibleInstance").mockReturnValue(mockVisibleProvider)

		// Act: Call getInstance
		const result = await ClineProvider.getInstance()

		// Assert: Should return the visible provider without calling executeCommand
		expect(result).toBe(mockVisibleProvider)
		expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
	})

	it("getInstance should recover after executeCommand error and check for visible provider again", async () => {
		// Setup: First call returns undefined, after error should return the created provider
		const mockVisibleProvider = {} as ClineProvider

		const getVisibleInstanceSpy = vi.spyOn(ClineProvider, "getVisibleInstance")
		getVisibleInstanceSpy
			.mockReturnValueOnce(undefined) // First call
			.mockReturnValueOnce(mockVisibleProvider) // After executeCommand

		// Mock executeCommand to throw
		vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error("Command failed"))

		// Spy on console.error
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		// Act: Call getInstance
		const result = await ClineProvider.getInstance()

		// Assert: Should still return the visible provider found after the error
		expect(result).toBe(mockVisibleProvider)
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error focusing sidebar:", expect.any(Error))

		consoleErrorSpy.mockRestore()
	})
})
