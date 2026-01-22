import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from "vitest"
import { ExtensionService, createExtensionService } from "../extension.js"
import type { WebviewMessage } from "../../types/messages.js"
import * as path from "path"

// Mock the extension-paths module
vi.mock("../../utils/extension-paths.js", () => ({
	resolveExtensionPaths: () => ({
		extensionBundlePath: "/mock/extension/dist/extension.js",
		extensionRootPath: "/mock/extension",
	}),
}))

describe("ExtensionService", () => {
	let service: ExtensionService
	let mockExtensionModule: unknown
	let originalRequire: unknown
	let mockVSCodeAPI: unknown

	beforeAll(() => {
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
									apiProvider: "kilocode",
									kilocodeToken: "test-token",
									kilocodeModel: "test-model",
									kilocodeOrganizationId: "",
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
				file: vi.fn((path) => ({ fsPath: path })),
				joinPath: vi.fn((uri, ...paths) => ({ fsPath: path.join(uri.fsPath, ...paths) })),
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
				// Register a mock webview provider immediately to prevent hanging
				// This simulates the extension registering its provider during activation
				const globalWithHost = global as {
					__extensionHost?: { registerWebviewProvider: (id: string, provider: unknown) => void }
				}
				if (globalWithHost.__extensionHost) {
					const mockProvider = {
						handleCLIMessage: vi.fn(async () => {}),
					}
					globalWithHost.__extensionHost.registerWebviewProvider("kilo-code.SidebarProvider", mockProvider)
				}

				// Return a mock API
				return {
					getState: vi.fn(() => ({
						version: "1.0.0",
						apiConfiguration: {
							apiProvider: "kilocode",
							kilocodeToken: "test-token",
							kilocodeModel: "test-model",
							kilocodeOrganizationId: "",
						},
						chatMessages: [],
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
		const Module = require("module")
		originalRequire = Module.prototype.require

		Module.prototype.require = function (this: unknown, id: string) {
			if (id === "/mock/extension/dist/extension.js") {
				return mockExtensionModule
			}
			if (id === "vscode" || id === "vscode-mock") {
				return mockVSCodeAPI
			}
			return (originalRequire as (id: string) => unknown).call(this, id)
		}

		// Set global vscode
		;(global as unknown as { vscode: unknown }).vscode = mockVSCodeAPI
	})

	afterAll(() => {
		// Restore original require
		if (originalRequire) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const Module = require("module")
			Module.prototype.require = originalRequire
		}
		// Clean up global vscode
		delete (global as unknown as { vscode?: unknown }).vscode
	})

	afterEach(async () => {
		if (service) {
			await service.dispose()
		}
	})

	describe("constructor", () => {
		it("should create an instance with default options", () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(service).toBeInstanceOf(ExtensionService)
			expect(service.isReady()).toBe(false)
		})

		it("should create an instance with custom options", () => {
			service = new ExtensionService({
				workspace: "/custom/workspace",
				mode: "architect",
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(service).toBeInstanceOf(ExtensionService)
		})

		it("should create an instance using factory function", () => {
			service = createExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(service).toBeInstanceOf(ExtensionService)
		})
	})

	describe("initialization", () => {
		it("should initialize successfully", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			const readyPromise = new Promise<void>((resolve) => {
				service.once("ready", () => resolve())
			})

			await service.initialize()
			await readyPromise

			expect(service.isReady()).toBe(true)
		})

		it("should not initialize twice", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()

			// Second initialization should not throw
			await service.initialize()
			expect(service.isReady()).toBe(true)
		})

		it("should throw error when initializing disposed service", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.dispose()

			await expect(service.initialize()).rejects.toThrow("Cannot initialize disposed ExtensionService")
		})
	})

	describe("event handling", () => {
		beforeEach(async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
		})

		it("should emit ready event on initialization", async () => {
			const readyHandler = vi.fn()
			service.on("ready", readyHandler)

			await service.initialize()

			expect(readyHandler).toHaveBeenCalledTimes(1)
			expect(readyHandler).toHaveBeenCalledWith(expect.any(Object))
		})

		it("should emit stateChange event when state changes", async () => {
			await service.initialize()

			// Mark webview as ready to allow messages to be processed
			service.getExtensionHost().markWebviewReady()

			const stateChangeHandler = vi.fn()
			service.on("stateChange", stateChangeHandler)

			// Trigger a state change by sending a message
			await service.sendWebviewMessage({
				type: "mode",
				text: "architect",
			})

			// Wait a bit for the state change to propagate
			await new Promise((resolve) => setTimeout(resolve, 100))

			// State change should have been emitted
			expect(stateChangeHandler).toHaveBeenCalled()
		})

		it("should emit message event for extension messages", async () => {
			await service.initialize()

			// Mark webview as ready to allow messages to be processed
			service.getExtensionHost().markWebviewReady()

			const messageHandler = vi.fn()
			service.on("message", messageHandler)

			// Send a message that will trigger a response
			await service.sendWebviewMessage({
				type: "webviewDidLaunch",
			})

			// Wait for message to be processed
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Should have received at least one message
			expect(messageHandler).toHaveBeenCalled()
		})

		it("should support once listener", async () => {
			const onceHandler = vi.fn()
			service.once("ready", onceHandler)

			await service.initialize()

			// Emit ready again (shouldn't happen in practice, but testing once behavior)
			service.emit("ready", service.getExtensionAPI()!)

			expect(onceHandler).toHaveBeenCalledTimes(1)
		})

		it("should support off to remove listeners", async () => {
			const handler = vi.fn()
			service.on("message", handler)
			service.off("message", handler)

			await service.initialize()

			// Send a message
			await service.sendWebviewMessage({
				type: "webviewDidLaunch",
			})

			await new Promise((resolve) => setTimeout(resolve, 100))

			// Handler should not have been called
			expect(handler).not.toHaveBeenCalled()
		})
	})

	describe("message sending", () => {
		beforeEach(async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
		})

		it("should send webview messages", async () => {
			const message: WebviewMessage = {
				type: "askResponse",
				text: "Hello",
			}

			await expect(service.sendWebviewMessage(message)).resolves.not.toThrow()
		})

		it("should throw error when sending message before initialization", async () => {
			const uninitializedService = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})

			await expect(uninitializedService.sendWebviewMessage({ type: "test" })).rejects.toThrow(
				"ExtensionService not initialized",
			)

			await uninitializedService.dispose()
		})

		it("should throw error when sending message after disposal", async () => {
			await service.dispose()

			// After disposal, isInitialized is false, so it throws "not initialized" error
			await expect(service.sendWebviewMessage({ type: "test" })).rejects.toThrow(
				"ExtensionService not initialized",
			)
		})
	})

	describe("state management", () => {
		beforeEach(async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
		})

		it("should return null state before initialization", () => {
			const uninitializedService = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(uninitializedService.getState()).toBeNull()
		})

		it("should return current state after initialization", () => {
			const state = service.getState()
			expect(state).not.toBeNull()
			expect(state).toHaveProperty("version")
			expect(state).toHaveProperty("apiConfiguration")
			expect(state).toHaveProperty("chatMessages")
		})
	})

	describe("API access", () => {
		beforeEach(async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
		})

		it("should provide access to message bridge", () => {
			const bridge = service.getMessageBridge()
			expect(bridge).toBeDefined()
			expect(bridge).toHaveProperty("getTUIChannel")
			expect(bridge).toHaveProperty("getExtensionChannel")
		})

		it("should provide access to extension host", () => {
			const host = service.getExtensionHost()
			expect(host).toBeDefined()
			expect(host).toHaveProperty("activate")
			expect(host).toHaveProperty("deactivate")
		})

		it("should provide access to extension API", () => {
			const api = service.getExtensionAPI()
			expect(api).not.toBeNull()
			expect(api).toHaveProperty("getState")
			expect(api).toHaveProperty("sendWebviewMessage")
			expect(api).toHaveProperty("injectConfiguration")
		})

		it("should return null API before initialization", () => {
			const uninitializedService = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(uninitializedService.getExtensionAPI()).toBeNull()
		})
	})

	describe("disposal", () => {
		beforeEach(async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
		})

		it("should dispose successfully", async () => {
			// Note: The disposed event is emitted after removeAllListeners() is called,
			// so we can't reliably test the event. Instead, we'll just test the state.
			await service.dispose()

			expect(service.isReady()).toBe(false)
			expect(service.getState()).toBeNull()
			expect(service.getExtensionAPI()).toBeNull()
		})

		it("should not dispose twice", async () => {
			await service.dispose()

			// Second disposal should not throw
			await expect(service.dispose()).resolves.not.toThrow()
		})

		it("should clean up all resources on disposal", async () => {
			await service.dispose()

			expect(service.isReady()).toBe(false)
			expect(service.getState()).toBeNull()
			expect(service.getExtensionAPI()).toBeNull()
		})
	})

	describe("isReady", () => {
		it("should return false before initialization", () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			expect(service.isReady()).toBe(false)
		})

		it("should return true after initialization", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
			expect(service.isReady()).toBe(true)
		})

		it("should return false after disposal", async () => {
			service = new ExtensionService({
				extensionBundlePath: "/mock/extension/dist/extension.js",
				extensionRootPath: "/mock/extension",
			})
			await service.initialize()
			await service.dispose()
			expect(service.isReady()).toBe(false)
		})
	})
})
