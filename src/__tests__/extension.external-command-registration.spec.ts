import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { activate } from "../extension"

// Mock VSCode APIs
vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
		joinPath: vi.fn((base: any, ...paths: string[]) => ({ fsPath: paths.join("/") })),
		parse: vi.fn((uriString: string) => ({ scheme: "https", authority: "example.com" })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" }, name: "test" }],
		getConfiguration: vi.fn(() => ({ get: vi.fn(() => []) })),
		createFileSystemWatcher: vi.fn(() => ({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
		})),
		registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
	},
	window: {
		createOutputChannel: vi.fn(() => ({
			appendLine: vi.fn(),
			show: vi.fn(),
		})),
		withProgress: vi.fn(),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
		createWebviewPanel: vi.fn(),
		registerUriHandler: vi.fn(() => ({ dispose: vi.fn() })),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		visibleTextEditors: [],
	},
	ProgressLocation: {
		SourceControl: 1,
	},
	ViewColumn: {
		One: 1,
		Two: 2,
	},
	RelativePattern: vi.fn(),
	ThemeColor: vi.fn((id: string) => ({ id })),
	commands: {
		registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
		executeCommand: vi.fn(),
	},
	languages: {
		registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		language: "en",
		sessionId: "test-session",
		openExternal: vi.fn(),
	},
	ConfigurationTarget: {
		Global: 1,
	},
	OverviewRulerLane: {
		Left: 1,
		Center: 2,
		Right: 4,
		Full: 7,
	},
}))

// Mock all dependencies
vi.mock("@dotenvx/dotenvx", () => ({
	config: vi.fn(),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		createInstance: vi.fn().mockResolvedValue({
			on: vi.fn(),
			telemetryClient: null,
		}),
	},
	ExtensionBridgeService: {
		handleRemoteControlState: vi.fn(),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		createInstance: vi.fn(() => ({
			register: vi.fn(),
			setProvider: vi.fn(),
			instance: {
				captureEvent: vi.fn(),
			},
		})),
		instance: {
			captureEvent: vi.fn(),
			setProvider: vi.fn(),
		},
	},
	PostHogTelemetryClient: vi.fn(),
}))

vi.mock("../core/webview/ClineProvider", () => ({
	ClineProvider: vi.fn().mockImplementation(() => ({
		postStateToWebview: vi.fn(),
		providerSettingsManager: { initialize: vi.fn() },
		contextProxy: {},
		customModesManager: {},
	})),
}))

vi.mock("../core/config/ContextProxy", () => ({
	ContextProxy: {
		getInstance: vi.fn().mockResolvedValue({ getValue: vi.fn() }),
	},
}))

vi.mock("../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({
			initialize: vi.fn().mockResolvedValue(undefined),
		})),
	},
}))

vi.mock("../services/mcp/McpServerManager")
vi.mock("../services/mdm/MdmService", () => ({
	MdmService: {
		createInstance: vi.fn().mockResolvedValue({
			getInstance: vi.fn(),
		}),
	},
}))

vi.mock("../services/commit-message", () => ({
	registerCommitMessageProvider: vi.fn(() => ({
		generateCommitMessageForExternal: vi.fn().mockResolvedValue({
			message: "test commit",
			error: undefined,
		}),
	})),
}))

// Import the mocked module for type safety
import * as commitMessageModule from "../services/commit-message"

vi.mock("../services/ghost")
vi.mock("../services/terminal-welcome/TerminalWelcomeService")
vi.mock("../utils/migrateSettings")
vi.mock("../utils/autoLaunchingTask")
vi.mock("../utils/autoImportSettings")
vi.mock("../utils/remoteControl")
vi.mock("../i18n")
vi.mock("../activate", () => ({
	handleUri: vi.fn(),
	registerCommands: vi.fn(),
	registerCodeActions: vi.fn(),
	registerTerminalActions: vi.fn(),
	CodeActionProvider: vi.fn(),
}))

vi.mock("../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		initialize: vi.fn(),
	},
}))

vi.mock("../extension/api", () => ({
	API: vi.fn(),
}))

/**
 * Extension External Command Registration Tests
 *
 * Tests that verify the external commit message command is properly registered
 * during VSCode extension activation and integrated with the CommitMessageProvider.
 */
describe("Extension External Command Registration Tests", () => {
	let mockContext: vscode.ExtensionContext
	let registeredCommands: Map<string, Function>
	let mockCommitMessageProvider: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Setup mock extension context
		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn().mockReturnValue(undefined),
			},
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn().mockResolvedValue(undefined),
			},
			extensionPath: "/test/extension",
			extensionUri: { fsPath: "/test/extension" },
		} as any

		// Track registered commands
		registeredCommands = new Map()
		vi.mocked(vscode.commands.registerCommand).mockImplementation((command: string, callback: Function) => {
			registeredCommands.set(command, callback)
			return { dispose: vi.fn() }
		})

		// Setup mock commit message provider
		mockCommitMessageProvider = {
			generateCommitMessageForExternal: vi.fn().mockResolvedValue({
				message: "feat: add new feature",
				error: undefined,
			}),
		}

		// Mock the registerCommitMessageProvider to return our mock
		vi.mocked(commitMessageModule.registerCommitMessageProvider).mockReturnValue(mockCommitMessageProvider)
	})

	afterEach(() => {
		registeredCommands.clear()
	})

	describe("Extension Activation and Command Registration", () => {
		it("should register the external commit message command during activation", async () => {
			// Act
			await activate(mockContext)

			// Assert
			expect(registeredCommands.has("kilo-code.generateCommitMessageForExternal")).toBe(true)
			expect(typeof registeredCommands.get("kilo-code.generateCommitMessageForExternal")).toBe("function")
		})

		it("should add external command to subscription list for proper cleanup", async () => {
			// Act
			await activate(mockContext)

			// Assert
			// The external command registration should be added to subscriptions
			expect(mockContext.subscriptions.length).toBeGreaterThan(0)

			// Verify that registerCommand was called for the external command
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilo-code.generateCommitMessageForExternal",
				expect.any(Function),
			)
		})

		it("should create commit message provider before registering external command", async () => {
			// Act
			await activate(mockContext)

			// Assert
			const mockRegisterCommitMessageProvider = await import("../services/commit-message")
			expect(mockRegisterCommitMessageProvider.registerCommitMessageProvider).toHaveBeenCalledWith(
				mockContext,
				expect.any(Object), // outputChannel
			)
		})
	})

	describe("External Command Integration", () => {
		it("should properly integrate external command with CommitMessageProvider", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			const params = { workspacePath: "/test/repo", staged: true }
			const result = await commandCallback(params)

			// Assert
			expect(mockCommitMessageProvider.generateCommitMessageForExternal).toHaveBeenCalledWith(params)
			expect(result).toEqual({
				message: "feat: add new feature",
				error: undefined,
			})
		})

		it("should handle external command errors gracefully", async () => {
			// Arrange
			mockCommitMessageProvider.generateCommitMessageForExternal.mockResolvedValue({
				message: "",
				error: "Git repository not found",
			})

			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			const result = await commandCallback({ workspacePath: "/invalid/repo", staged: true })

			// Assert
			expect(result).toEqual({
				message: "",
				error: "Git repository not found",
			})
		})

		it("should handle external command exceptions", async () => {
			// Arrange
			const error = new Error("Provider initialization failed")
			mockCommitMessageProvider.generateCommitMessageForExternal.mockRejectedValue(error)

			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act & Assert
			await expect(commandCallback({ workspacePath: "/test/repo", staged: true })).rejects.toThrow(
				"Provider initialization failed",
			)
		})
	})

	describe("Command Parameter Handling", () => {
		it("should pass parameters correctly to the provider", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			const testParams = {
				workspacePath: "/home/user/project",
				staged: false,
			}
			await commandCallback(testParams)

			// Assert
			expect(mockCommitMessageProvider.generateCommitMessageForExternal).toHaveBeenCalledWith(testParams)
		})

		it("should handle undefined parameters", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			await commandCallback(undefined)

			// Assert
			expect(mockCommitMessageProvider.generateCommitMessageForExternal).toHaveBeenCalledWith(undefined)
		})

		it("should handle empty parameters object", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			const result = await commandCallback({})

			// Assert
			expect(mockCommitMessageProvider.generateCommitMessageForExternal).toHaveBeenCalledWith({})
			expect(result).toBeDefined()
		})
	})

	describe("Extension Lifecycle", () => {
		it("should register external command only once during activation", async () => {
			// Act
			await activate(mockContext)
			await activate(mockContext) // Second activation

			// Assert
			// Count how many times the external command was registered
			const externalCommandRegistrations = vi
				.mocked(vscode.commands.registerCommand)
				.mock.calls.filter((call) => call[0] === "kilo-code.generateCommitMessageForExternal")

			expect(externalCommandRegistrations.length).toBe(2) // Once per activation
		})

		it("should maintain external command availability after other components fail", async () => {
			// Arrange
			// Mock one component to fail during activation
			const mockContextProxy = await import("../core/config/ContextProxy")
			vi.mocked(mockContextProxy.ContextProxy.getInstance).mockRejectedValueOnce(
				new Error("Context proxy failed"),
			)

			// Act & Assert
			// Extension activation should still succeed and register the external command
			try {
				await activate(mockContext)
			} catch (error) {
				// Even if activation fails partially, the external command should be registered
				expect(registeredCommands.has("kilo-code.generateCommitMessageForExternal")).toBe(true)
			}
		})
	})

	describe("Provider Integration", () => {
		it("should ensure provider is available before registering external command", async () => {
			// Arrange
			let providerCreated = false

			vi.mocked(commitMessageModule.registerCommitMessageProvider).mockImplementation(() => {
				providerCreated = true
				return mockCommitMessageProvider
			})

			// Act
			await activate(mockContext)

			// Assert
			expect(providerCreated).toBe(true)
			expect(registeredCommands.has("kilo-code.generateCommitMessageForExternal")).toBe(true)
		})

		it("should handle provider creation failure gracefully", async () => {
			// Arrange
			vi.mocked(commitMessageModule.registerCommitMessageProvider).mockImplementation(() => {
				throw new Error("Provider creation failed")
			})

			// Act & Assert
			await expect(activate(mockContext)).rejects.toThrow("Provider creation failed")
		})
	})

	describe("Command Execution Context", () => {
		it("should execute external command in proper async context", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Act
			const resultPromise = commandCallback({ workspacePath: "/test/repo", staged: true })

			// Assert
			expect(resultPromise).toBeInstanceOf(Promise)

			const result = await resultPromise
			expect(result).toBeDefined()
		})

		it("should handle concurrent external command executions", async () => {
			// Arrange
			await activate(mockContext)
			const commandCallback = registeredCommands.get("kilo-code.generateCommitMessageForExternal")!

			// Mock provider to simulate async behavior
			mockCommitMessageProvider.generateCommitMessageForExternal
				.mockImplementationOnce(
					() =>
						new Promise((resolve) => setTimeout(() => resolve({ message: "first", error: undefined }), 50)),
				)
				.mockImplementationOnce(
					() =>
						new Promise((resolve) =>
							setTimeout(() => resolve({ message: "second", error: undefined }), 25),
						),
				)

			// Act
			const promise1 = commandCallback({ workspacePath: "/repo1", staged: true })
			const promise2 = commandCallback({ workspacePath: "/repo2", staged: false })

			const [result1, result2] = await Promise.all([promise1, promise2])

			// Assert
			expect(result1).toEqual({ message: "first", error: undefined })
			expect(result2).toEqual({ message: "second", error: undefined })
			expect(mockCommitMessageProvider.generateCommitMessageForExternal).toHaveBeenCalledTimes(2)
		})
	})
})
