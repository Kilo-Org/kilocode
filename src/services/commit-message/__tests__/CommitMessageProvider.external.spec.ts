import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { GitExtensionService } from "../GitExtensionService"

// Mock dependencies
vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
	workspace: {
		workspaceFolders: [],
	},
	window: {
		withProgress: vi.fn(),
	},
	ProgressLocation: {
		SourceControl: 1,
	},
	commands: {
		registerCommand: vi.fn(),
	},
}))

vi.mock("../GitExtensionService")
vi.mock("../../utils/single-completion-handler")

vi.mock("../../core/config/ProviderSettingsManager", () => ({
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

describe("CommitMessageProvider - External Command", () => {
	let provider: CommitMessageProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockGitService: GitExtensionService

	beforeEach(() => {
		// Setup mocks
		mockContext = {
			subscriptions: [],
			workspaceState: { get: vi.fn() },
			globalState: { get: vi.fn() },
		} as any

		mockOutputChannel = {
			appendLine: vi.fn(),
		} as any

		mockGitService = {
			configureRepositoryContext: vi.fn(),
			gatherChanges: vi.fn(),
			getCommitContext: vi.fn(),
			dispose: vi.fn(),
		} as any

		provider = new CommitMessageProvider(mockContext, mockOutputChannel)
		// Replace the git service with our mock
		;(provider as any).gitService = mockGitService
	})

	describe("generateCommitMessageForExternal", () => {
		it("should return error when no changes are found", async () => {
			// Arrange
			const params = { workspacePath: "/test/repo", staged: true }
			vi.mocked(mockGitService.gatherChanges).mockResolvedValue([])

			// Act
			const result = await provider.generateCommitMessageForExternal(params)

			// Assert
			expect(result).toEqual({
				message: "",
				error: "No staged changes found in the repository",
			})
			expect(mockGitService.configureRepositoryContext).toHaveBeenCalledWith(
				expect.objectContaining({ fsPath: "/test/repo" }),
			)
		})

		it("should return error for unstaged changes when none found", async () => {
			// Arrange
			const params = { workspacePath: "/test/repo", staged: false }
			vi.mocked(mockGitService.gatherChanges).mockResolvedValue([])

			// Act
			const result = await provider.generateCommitMessageForExternal(params)

			// Assert
			expect(result).toEqual({
				message: "",
				error: "No changes found in the repository",
			})
		})

		it("should generate commit message successfully", async () => {
			// Arrange
			const params = { workspacePath: "/test/repo", staged: true }
			const mockChanges = [{ path: "test.js", status: "modified" }]
			const mockGitContext = "diff --git a/test.js b/test.js\n+console.log('test')"
			const mockCommitMessage = "feat: add test logging"

			vi.mocked(mockGitService.gatherChanges).mockResolvedValue(mockChanges as any)
			vi.mocked(mockGitService.getCommitContext).mockResolvedValue(mockGitContext)

			// Mock the private callAIForCommitMessage method
			const callAIForCommitMessageSpy = vi.spyOn(provider as any, "callAIForCommitMessage")
			callAIForCommitMessageSpy.mockResolvedValue(mockCommitMessage)

			// Act
			const result = await provider.generateCommitMessageForExternal(params)

			// Assert
			expect(result).toEqual({
				message: mockCommitMessage,
			})
			expect(mockGitService.configureRepositoryContext).toHaveBeenCalledWith(
				expect.objectContaining({ fsPath: "/test/repo" }),
			)
			expect(mockGitService.gatherChanges).toHaveBeenCalledWith({ staged: true })
			expect(mockGitService.getCommitContext).toHaveBeenCalledWith(mockChanges, { staged: true })
		})

		it("should handle errors gracefully", async () => {
			// Arrange
			const params = { workspacePath: "/test/repo", staged: true }
			const errorMessage = "Git repository not found"
			vi.mocked(mockGitService.gatherChanges).mockRejectedValue(new Error(errorMessage))

			// Act
			const result = await provider.generateCommitMessageForExternal(params)

			// Assert
			expect(result).toEqual({
				message: "",
				error: errorMessage,
			})
		})

		it("should default staged parameter to true when not provided", async () => {
			// Arrange
			const params = { workspacePath: "/test/repo" }
			vi.mocked(mockGitService.gatherChanges).mockResolvedValue([])

			// Act
			await provider.generateCommitMessageForExternal(params)

			// Assert
			expect(mockGitService.gatherChanges).toHaveBeenCalledWith({ staged: true })
		})
	})
})
