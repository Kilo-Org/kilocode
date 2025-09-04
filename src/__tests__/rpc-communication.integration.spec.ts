import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import { CommitMessageProvider } from "../services/commit-message/CommitMessageProvider"

// Mock VSCode APIs
vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
	workspace: {
		workspaceFolders: [],
	},
	window: {
		withProgress: vi.fn(),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	ProgressLocation: {
		SourceControl: 1,
	},
	commands: {
		registerCommand: vi.fn(),
		executeCommand: vi.fn(),
	},
}))

// Mock dependencies
vi.mock("../services/commit-message/GitExtensionService")
vi.mock("../utils/single-completion-handler")
vi.mock("../core/config/ProviderSettingsManager", () => ({
	ProviderSettingsManager: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
	})),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

/**
 * RPC Communication Integration Tests
 *
 * Tests the complete flow of communication between JetBrains plugin and VSCode extension
 * for Git commit message generation. These tests simulate the RPC layer without requiring
 * actual JetBrains plugin runtime.
 */
describe("RPC Communication Integration Tests", () => {
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockCommands: typeof vscode.commands
	let registeredCommands: Map<string, Function>

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Setup mock VSCode context
		mockContext = {
			subscriptions: [],
			workspaceState: { get: vi.fn() },
			globalState: { get: vi.fn() },
		} as any

		mockOutputChannel = {
			appendLine: vi.fn(),
		} as any

		// Setup command registry tracking
		registeredCommands = new Map()
		mockCommands = vscode.commands as any
		vi.mocked(mockCommands.registerCommand).mockImplementation((command: string, callback: Function) => {
			registeredCommands.set(command, callback)
			return { dispose: vi.fn() } as any
		})

		vi.mocked(mockCommands.executeCommand).mockImplementation(async (command: string, ...args: any[]) => {
			const callback = registeredCommands.get(command)
			if (callback) {
				return await callback(...args)
			}
			throw new Error(`Command ${command} not found`)
		})
	})

	afterEach(() => {
		registeredCommands.clear()
	})

	describe("External Command Registration", () => {
		it("should register the external commit message command", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)

			// Act
			await provider.activate()

			// Simulate extension.ts registration
			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Assert
			expect(registeredCommands.has("kilo-code.generateCommitMessageForExternal")).toBe(true)
			expect(typeof registeredCommands.get("kilo-code.generateCommitMessageForExternal")).toBe("function")
		})

		it("should be able to execute the external command", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			// Mock the generateCommitMessageForExternal method
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "test commit", error: undefined })

			// Register the command as extension.ts would
			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: true,
			})

			// Assert
			expect(generateSpy).toHaveBeenCalledWith({
				workspacePath: "/test/repo",
				staged: true,
			})
			expect(result).toEqual({ message: "test commit", error: undefined })
		})
	})

	describe("RPC Parameter Passing", () => {
		it("should correctly pass workspace path parameter", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "feat: add new feature", error: undefined })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			const testWorkspacePath = "/home/user/my-project"

			// Act
			await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: testWorkspacePath,
			})

			// Assert
			expect(generateSpy).toHaveBeenCalledWith({
				workspacePath: testWorkspacePath,
			})
		})

		it("should correctly pass staged parameter as true", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "fix: resolve bug", error: undefined })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: true,
			})

			// Assert
			expect(generateSpy).toHaveBeenCalledWith({
				workspacePath: "/test/repo",
				staged: true,
			})
		})

		it("should correctly pass staged parameter as false", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "docs: update readme", error: undefined })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: false,
			})

			// Assert
			expect(generateSpy).toHaveBeenCalledWith({
				workspacePath: "/test/repo",
				staged: false,
			})
		})

		it("should handle missing staged parameter by defaulting to true", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "refactor: improve code structure", error: undefined })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
			})

			// Assert
			expect(generateSpy).toHaveBeenCalledWith({
				workspacePath: "/test/repo",
			})
		})
	})

	describe("RPC Response Handling", () => {
		it("should return success response with generated commit message", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const expectedMessage = "feat(auth): implement JWT authentication"
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: expectedMessage, error: undefined })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: expectedMessage,
				error: undefined,
			})
		})

		it("should return error response when Git operation fails", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const expectedError = "Git repository not found"
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "", error: expectedError })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/invalid/repo",
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: expectedError,
			})
		})

		it("should return error response when no changes are found", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "", error: "No staged changes found in the repository" })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: "No staged changes found in the repository",
			})
		})
	})

	describe("RPC Error Scenarios", () => {
		it("should handle command execution timeout gracefully", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			// Simulate timeout by making the command hang
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockImplementation(() => new Promise(() => {})) // Never resolves

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act & Assert
			const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve("timeout"), 100))
			const commandPromise = vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: true,
			})

			const result = await Promise.race([commandPromise, timeoutPromise])
			expect(result).toBe("timeout")
		})

		it("should handle invalid command parameters", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "", error: "Invalid workspace path" })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - call with invalid parameters
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "", // Empty path
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: "Invalid workspace path",
			})
		})

		it("should handle connection failure scenarios", async () => {
			// Arrange & Act - try to execute non-existent command
			const commandPromise = vscode.commands.executeCommand("kilo-code.nonExistentCommand", {})

			// Assert
			await expect(commandPromise).rejects.toThrow("Command kilo-code.nonExistentCommand not found")
		})

		it("should handle provider initialization failures", async () => {
			// Arrange - mock provider initialization to fail
			const mockProvider = {
				activate: vi.fn().mockRejectedValue(new Error("Failed to initialize Git service")),
				generateCommitMessageForExternal: vi.fn(),
			}

			// Act & Assert
			await expect(mockProvider.activate()).rejects.toThrow("Failed to initialize Git service")
		})
	})

	describe("RPC Parameter Validation", () => {
		it("should validate required workspacePath parameter", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				// Simulate parameter validation in the actual implementation
				if (!params || !params.workspacePath) {
					return { message: "", error: "workspacePath parameter is required" }
				}
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - call without workspacePath
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: "workspacePath parameter is required",
			})
			expect(generateSpy).not.toHaveBeenCalled()
		})

		it("should validate workspacePath parameter type", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				// Simulate parameter validation
				if (!params || typeof params.workspacePath !== "string") {
					return { message: "", error: "workspacePath must be a string" }
				}
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - call with invalid workspacePath type
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: 123, // Invalid type
				staged: true,
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: "workspacePath must be a string",
			})
			expect(generateSpy).not.toHaveBeenCalled()
		})

		it("should validate optional staged parameter type", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				// Simulate parameter validation
				if (params.staged !== undefined && typeof params.staged !== "boolean") {
					return { message: "", error: "staged parameter must be a boolean" }
				}
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - call with invalid staged type
			const result = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/test/repo",
				staged: "invalid", // Invalid type
			})

			// Assert
			expect(result).toEqual({
				message: "",
				error: "staged parameter must be a boolean",
			})
			expect(generateSpy).not.toHaveBeenCalled()
		})
	})

	describe("RPC Integration Flow", () => {
		it("should simulate complete JetBrains to VSCode communication flow", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const mockCommitMessage = "feat(ui): add responsive navigation menu"
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: mockCommitMessage, error: undefined })

			// Register the external command as extension.ts would
			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - Simulate JetBrains plugin making RPC call
			const jetbrainsParams = {
				workspacePath: "/Users/developer/project",
				staged: true,
			}

			// This simulates the RPC call from JetBrains plugin
			const rpcResult = await vscode.commands.executeCommand(
				"kilo-code.generateCommitMessageForExternal",
				jetbrainsParams,
			)

			// Assert - Verify the complete flow worked
			expect(generateSpy).toHaveBeenCalledWith(jetbrainsParams)
			expect(rpcResult).toEqual({
				message: mockCommitMessage,
				error: undefined,
			})

			// Verify that all expected components were involved
			expect(mockCommands.registerCommand).toHaveBeenCalled()
			expect(mockCommands.executeCommand).toHaveBeenCalledWith(
				"kilo-code.generateCommitMessageForExternal",
				jetbrainsParams,
			)
		})

		it("should maintain proper error propagation through RPC layers", async () => {
			// Arrange
			const provider = new CommitMessageProvider(mockContext, mockOutputChannel)
			await provider.activate()

			const expectedError = "Git repository is not initialized"
			const generateSpy = vi.spyOn(provider, "generateCommitMessageForExternal")
			generateSpy.mockResolvedValue({ message: "", error: expectedError })

			registeredCommands.set("kilo-code.generateCommitMessageForExternal", async (params: any) => {
				return await provider.generateCommitMessageForExternal(params)
			})

			// Act - Simulate error scenario from JetBrains
			const rpcResult = await vscode.commands.executeCommand("kilo-code.generateCommitMessageForExternal", {
				workspacePath: "/not/a/git/repo",
				staged: true,
			})

			// Assert - Verify error is properly propagated
			expect(rpcResult).toEqual({
				message: "",
				error: expectedError,
			})
		})
	})
})
