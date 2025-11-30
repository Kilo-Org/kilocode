import path from "path"
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ExtensionService } from "../extension.js"
import type { ExtensionMessage, WebviewMessage } from "../../types/messages.js"

// Mock the extension-paths module
vi.mock("../../utils/extension-paths.js", () => ({
	resolveExtensionPaths: () => ({
		extensionBundlePath: "/mock/extension/dist/extension.js",
		extensionRootPath: "/mock/extension",
	}),
}))

// Type definitions for mocks
interface MockExtensionModule {
	activate: ReturnType<typeof vi.fn>
	deactivate: ReturnType<typeof vi.fn>
}

interface MockVSCodeAPI {
	context: {
		subscriptions: unknown[]
		secrets: {
			get: ReturnType<typeof vi.fn>
			store: ReturnType<typeof vi.fn>
		}
		globalState: {
			get: ReturnType<typeof vi.fn>
			update: ReturnType<typeof vi.fn>
		}
		workspaceState: {
			get: ReturnType<typeof vi.fn>
			update: ReturnType<typeof vi.fn>
		}
		extensionPath: string
		extensionUri: { fsPath: string }
	}
	window: {
		registerWebviewViewProvider: ReturnType<typeof vi.fn>
		showInformationMessage: ReturnType<typeof vi.fn>
		showErrorMessage: ReturnType<typeof vi.fn>
		showWarningMessage: ReturnType<typeof vi.fn>
		createOutputChannel: ReturnType<typeof vi.fn>
	}
	workspace: {
		workspaceFolders: Array<{ uri: { fsPath: string } }>
		onDidChangeConfiguration: ReturnType<typeof vi.fn>
		getConfiguration: ReturnType<typeof vi.fn>
	}
	commands: {
		registerCommand: ReturnType<typeof vi.fn>
	}
	Uri: {
		file: ReturnType<typeof vi.fn>
		joinPath: ReturnType<typeof vi.fn>
	}
	EventEmitter: ReturnType<typeof vi.fn>
}

// Extend global type for test mocks
declare global {
	// eslint-disable-next-line no-var
	var __extensionHost:
		| {
				registerWebviewProvider: (
					name: string,
					provider: { handleCLIMessage: ReturnType<typeof vi.fn> },
				) => void
		  }
		| undefined
	// eslint-disable-next-line no-var
	var vscode: MockVSCodeAPI | undefined
}

describe("ExtensionService - requestSingleCompletion", () => {
	let service: ExtensionService
	let mockExtensionModule: MockExtensionModule
	let originalRequire: NodeJS.Require
	let mockVSCodeAPI: MockVSCodeAPI

	beforeEach(() => {
		// Create a mock VSCode API
		mockVSCodeAPI = {
			context: {
				subscriptions: [],
				secrets: {
					get: vi.fn(async () =>
						JSON.stringify({
							currentApiConfigName: "default",
							apiConfigs: {
								default: {
									id: "test-id",
									apiProvider: "anthropic",
									apiKey: "test-api-key",
									apiModelId: "claude-3-5-sonnet-20241022",
								},
							},
							modeApiConfigs: {},
							migrations: {
								rateLimitSecondsMigrated: true,
								diffSettingsMigrated: true,
								openAiHeadersMigrated: true,
								consecutiveMistakeLimitMigrated: true,
								todoListEnabledMigrated: true,
								morphApiKeyMigrated: true,
							},
						}),
					),
					store: vi.fn(async () => {}),
				},
				globalState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				workspaceState: {
					get: vi.fn(),
					update: vi.fn(),
				},
				extensionPath: "/mock/extension",
				extensionUri: { fsPath: "/mock/extension" },
			},
			window: {
				registerWebviewViewProvider: vi.fn(),
				showInformationMessage: vi.fn(),
				showErrorMessage: vi.fn(),
				showWarningMessage: vi.fn(),
				createOutputChannel: vi.fn(() => ({
					appendLine: vi.fn(),
					append: vi.fn(),
					clear: vi.fn(),
					dispose: vi.fn(),
				})),
			},
			workspace: {
				workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
				onDidChangeConfiguration: vi.fn(),
				getConfiguration: vi.fn(() => ({
					get: vi.fn(),
					update: vi.fn(),
				})),
			},
			commands: {
				registerCommand: vi.fn(),
			},
			Uri: {
				file: vi.fn((filePath: string) => ({ fsPath: filePath })),
				joinPath: vi.fn((uri: { fsPath: string }, ...paths: string[]) => ({
					fsPath: path.join(uri.fsPath, ...paths),
				})),
			},
			EventEmitter: vi.fn(() => ({
				event: vi.fn(),
				fire: vi.fn(),
				dispose: vi.fn(),
			})),
		}

		// Create a mock extension module
		mockExtensionModule = {
			activate: vi.fn(async (_context) => {
				// Register a mock webview provider
				if (global.__extensionHost) {
					const mockProvider = {
						handleCLIMessage: vi.fn(async () => {}),
					}
					global.__extensionHost.registerWebviewProvider("kilo-code.SidebarProvider", mockProvider)
				}

				return {
					getState: vi.fn(() => ({
						version: "1.0.0",
						apiConfiguration: {
							apiProvider: "anthropic",
							apiKey: "test-api-key",
							apiModelId: "claude-3-5-sonnet-20241022",
						},
						clineMessages: [],
						mode: "code",
						customModes: [],
						taskHistoryFullLength: 0,
						taskHistoryVersion: 0,
						renderContext: "cli",
						telemetrySetting: "disabled",
						cwd: "/mock/workspace",
						mcpServers: [],
						listApiConfigMeta: [],
						currentApiConfigName: "default",
					})),
					sendMessage: vi.fn(),
					updateState: vi.fn(),
					startNewTask: vi.fn(),
					cancelTask: vi.fn(),
					condense: vi.fn(),
					condenseTaskContext: vi.fn(),
					handleTerminalOperation: vi.fn(),
				}
			}),
			deactivate: vi.fn(async () => {}),
		}

		// Mock the module loading system
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const Module = require("module") as { prototype: { require: NodeJS.Require } }
		originalRequire = Module.prototype.require

		Module.prototype.require = function (this: NodeJS.Module, id: string) {
			if (id === "/mock/extension/dist/extension.js") {
				return mockExtensionModule
			}
			if (id === "vscode" || id === "vscode-mock") {
				return mockVSCodeAPI
			}
			return originalRequire.call(this, id)
		} as NodeJS.Require

		// Set global vscode
		global.vscode = mockVSCodeAPI
	})

	afterEach(async () => {
		if (service) {
			await service.dispose()
		}

		// Restore original require
		if (originalRequire) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const Module = require("module") as { prototype: { require: typeof require } }
			Module.prototype.require = originalRequire
		}

		// Clean up global vscode
		delete global.vscode
	})

	describe("Error Handling", () => {
		it("should throw error when service is not ready", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			// Don't initialize - service not ready
			await expect(service.requestSingleCompletion("test")).rejects.toThrow("ExtensionService not ready")
		})

		it("should handle message send failures", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			// Mock sendWebviewMessage to fail
			vi.spyOn(service, "sendWebviewMessage").mockRejectedValue(new Error("Send failed"))

			await expect(service.requestSingleCompletion("test")).rejects.toThrow("Send failed")
		})
	})

	describe("Timeout Handling", () => {
		it("should timeout if no response received within default timeout", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			// Use a very short timeout for testing
			const completionPromise = service.requestSingleCompletion("test", 100)

			// Don't send any response - let it timeout
			await expect(completionPromise).rejects.toThrow("Single completion request timed out")
		}, 10000)

		it("should use custom timeout value", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			const customTimeout = 200
			const completionPromise = service.requestSingleCompletion("test", customTimeout)

			await expect(completionPromise).rejects.toThrow("Single completion request timed out")
		}, 10000)

		it("should cleanup event listeners on timeout", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			const initialListenerCount = service.listenerCount("message")

			try {
				await service.requestSingleCompletion("test", 100)
			} catch (_error) {
				// Expected to timeout
			}

			// Wait a bit for cleanup
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Listener count should be back to initial
			expect(service.listenerCount("message")).toBe(initialListenerCount)
		}, 10000)
	})

	describe("Request Correlation", () => {
		it("should not mix up responses for different request IDs", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			// Capture request IDs
			const requestIds: string[] = []
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					requestIds.push(msg.completionRequestId as string)
				}
				return originalSend(msg)
			})

			const promise1 = service.requestSingleCompletion("prompt 1")
			const promise2 = service.requestSingleCompletion("prompt 2")

			await new Promise((resolve) => setTimeout(resolve, 100))

			const requestId1 = requestIds[0]
			const requestId2 = requestIds[1]

			// Send response for request 2 first
			service.emit("message", {
				type: "singleCompletionResult",
				completionRequestId: requestId2,
				completionText: "result 2",
				success: true,
			} as ExtensionMessage)

			// Send response for request 1
			service.emit("message", {
				type: "singleCompletionResult",
				completionRequestId: requestId1,
				completionText: "result 1",
				success: true,
			} as ExtensionMessage)

			const result1 = await promise1
			const result2 = await promise2

			expect(result1).toBe("result 1")
			expect(result2).toBe("result 2")
		})
	})

	describe("Edge Cases", () => {
		it("should handle very long prompts", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			const longPrompt = "a".repeat(10000)
			const result = await service.requestSingleCompletion(longPrompt)
			expect(result).toBe("result")
		})

		it("should handle special characters in prompt", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			const specialPrompt = "Test with\nnewlines\tand\ttabs and 'quotes'"
			const result = await service.requestSingleCompletion(specialPrompt)
			expect(result).toBe("result")
		})

		it("should cleanup listeners on successful completion", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await service.initialize()
			service.getExtensionHost().markWebviewReady()

			const initialListenerCount = service.listenerCount("message")

			let capturedRequestId: string | undefined
			const originalSend = service.sendWebviewMessage.bind(service)
			vi.spyOn(service, "sendWebviewMessage").mockImplementation(async (msg: WebviewMessage) => {
				if (msg.type === "singleCompletion" && "completionRequestId" in msg) {
					capturedRequestId = msg.completionRequestId as string
					setTimeout(() => {
						service.emit("message", {
							type: "singleCompletionResult",
							completionRequestId: capturedRequestId,
							completionText: "result",
							success: true,
						} as ExtensionMessage)
					}, 10)
				}
				return originalSend(msg)
			})

			await service.requestSingleCompletion("test")

			// Listener count should be back to initial
			expect(service.listenerCount("message")).toBe(initialListenerCount)
		})
	})
})
