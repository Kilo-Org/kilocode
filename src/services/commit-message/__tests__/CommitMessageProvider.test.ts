import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import * as singleCompletionHandler from "../../../utils/single-completion-handler"

// Mock dependencies
vi.mock("vscode", () => ({
	ProgressLocation: {
		SourceControl: 1,
	},
	window: {
		withProgress: vi.fn(),
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(),
	},
	workspace: {
		workspaceFolders: [],
	},
	env: {
		language: "en",
	},
}))
vi.mock("../GitExtensionService")
vi.mock("../../../core/config/ContextProxy")
vi.mock("../../../core/config/ProviderSettingsManager")
vi.mock("../../../utils/single-completion-handler")
vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))
vi.mock("../../../core/prompts/sections/custom-instructions", () => ({
	addCustomInstructions: vi.fn().mockResolvedValue(""),
}))
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/test/workspace"),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

const mockGitService = vi.mocked(GitExtensionService)
const mockContextProxy = vi.mocked(ContextProxy)
const mockProviderSettingsManager = vi.mocked(ProviderSettingsManager)
const mockSingleCompletionHandler = vi.mocked(singleCompletionHandler.singleCompletionHandler)

describe("CommitMessageProvider", () => {
	let provider: CommitMessageProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockGitServiceInstance: any
	let mockProgress: vscode.Progress<{ increment?: number; message?: string }>

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			subscriptions: [],
			workspaceState: {
				get: vi.fn(),
			},
			globalState: {
				get: vi.fn(),
			},
		} as any

		mockOutputChannel = {
			appendLine: vi.fn(),
		} as any

		mockProgress = {
			report: vi.fn(),
		}

		mockGitServiceInstance = {
			configureRepositoryContext: vi.fn(),
			gatherChanges: vi.fn(),
			getCommitContext: vi.fn(),
			setCommitMessage: vi.fn(),
			dispose: vi.fn(),
		}

		mockGitService.mockImplementation(() => mockGitServiceInstance)

		mockProviderSettingsManager.mockImplementation(
			() =>
				({
					initialize: vi.fn(),
					getProfile: vi.fn(),
				}) as any,
		)

		Object.defineProperty(mockContextProxy, "instance", {
			value: {
				getProviderSettings: vi.fn().mockReturnValue({}),
				getValue: vi.fn().mockReturnValue(undefined),
			},
			writable: true,
		})

		provider = new CommitMessageProvider(mockContext, mockOutputChannel)
	})

	describe("generateCommitMessage", () => {
		const mockChanges: GitChange[] = [
			{ filePath: "/test/file1.ts", status: "Modified" },
			{ filePath: "/test/file2.ts", status: "Added" },
		]

		beforeEach(() => {
			mockGitServiceInstance.gatherChanges.mockResolvedValue(mockChanges)
			mockSingleCompletionHandler.mockResolvedValue("feat: add new feature")
		})

		it("should handle single context (no chunking)", async () => {
			const singleContext = "## Git Context\n### Full Diff\n```diff\n+added line\n```"
			mockGitServiceInstance.getCommitContext.mockResolvedValue(singleContext)

			// Mock vscode.window.withProgress
			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockGitServiceInstance.getCommitContext).toHaveBeenCalledWith(
				mockChanges,
				expect.objectContaining({
					staged: true,
					enableChunking: true,
				}),
			)
			expect(mockSingleCompletionHandler).toHaveBeenCalledTimes(1)
			expect(mockGitServiceInstance.setCommitMessage).toHaveBeenCalledWith("feat: add new feature")
		})

		it("should handle chunked context (map-reduce)", async () => {
			const chunkedContext = [
				"## Git Context\n### Chunk 1\n```diff\n+file1 changes\n```",
				"## Git Context\n### Chunk 2\n```diff\n+file2 changes\n```",
			]
			mockGitServiceInstance.getCommitContext.mockResolvedValue(chunkedContext)

			// Mock AI responses for chunks and final combination
			mockSingleCompletionHandler
				.mockResolvedValueOnce("feat(file1): update file1")
				.mockResolvedValueOnce("feat(file2): add file2")
				.mockResolvedValueOnce("feat: update files and add new functionality")

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockSingleCompletionHandler).toHaveBeenCalledTimes(3) // 2 chunks + 1 final
			expect(mockProgress.report).toHaveBeenCalledWith({ message: "kilocode:commitMessage.analyzingChunks" })
			expect(mockProgress.report).toHaveBeenCalledWith({ message: "kilocode:commitMessage.combining" })
			expect(mockGitServiceInstance.setCommitMessage).toHaveBeenCalledWith(
				"feat: update files and add new functionality",
			)
		})

		it("should handle unstaged changes when no staged changes exist", async () => {
			mockGitServiceInstance.gatherChanges
				.mockResolvedValueOnce([]) // No staged changes
				.mockResolvedValueOnce(mockChanges) // Unstaged changes

			const singleContext = "## Git Context\n### Full Diff\n```diff\n+added line\n```"
			mockGitServiceInstance.getCommitContext.mockResolvedValue(singleContext)

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockGitServiceInstance.gatherChanges).toHaveBeenCalledTimes(2)
			expect(mockGitServiceInstance.getCommitContext).toHaveBeenCalledWith(
				mockChanges,
				expect.objectContaining({
					staged: false,
					enableChunking: true,
				}),
			)
		})

		it("should show information message when generating from unstaged changes", async () => {
			mockGitServiceInstance.gatherChanges.mockResolvedValueOnce([]).mockResolvedValueOnce(mockChanges)

			const singleContext = "## Git Context\n### Full Diff\n```diff\n+added line\n```"
			mockGitServiceInstance.getCommitContext.mockResolvedValue(singleContext)

			const mockShowInformationMessage = vi.fn()
			vi.mocked(vscode.window).showInformationMessage = mockShowInformationMessage

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockShowInformationMessage).toHaveBeenCalledWith("kilocode:commitMessage.generatingFromUnstaged")
		})

		it("should show message when no changes exist", async () => {
			mockGitServiceInstance.gatherChanges.mockResolvedValueOnce([]).mockResolvedValueOnce([])

			const mockShowInformationMessage = vi.fn()
			vi.mocked(vscode.window).showInformationMessage = mockShowInformationMessage

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockShowInformationMessage).toHaveBeenCalledWith("kilocode:commitMessage.noChanges")
			expect(mockSingleCompletionHandler).not.toHaveBeenCalled()
		})

		it("should handle errors gracefully", async () => {
			mockGitServiceInstance.gatherChanges.mockRejectedValue(new Error("Git error"))

			const mockShowErrorMessage = vi.fn()
			vi.mocked(vscode.window).showErrorMessage = mockShowErrorMessage

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			expect(mockShowErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("kilocode:commitMessage.generationFailed"),
			)
		})

		it("should store context and message for future reference", async () => {
			const singleContext = "## Git Context\n### Full Diff\n```diff\n+added line\n```"
			mockGitServiceInstance.getCommitContext.mockResolvedValue(singleContext)

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			// Access private properties for testing
			const previousGitContext = (provider as any).previousGitContext
			const previousCommitMessage = (provider as any).previousCommitMessage

			expect(previousGitContext).toBe(singleContext)
			expect(previousCommitMessage).toBe("feat: add new feature")
		})

		it("should handle chunked context storage correctly", async () => {
			const chunkedContext = ["## Git Context\n### Chunk 1", "## Git Context\n### Chunk 2"]
			mockGitServiceInstance.getCommitContext.mockResolvedValue(chunkedContext)

			mockSingleCompletionHandler
				.mockResolvedValueOnce("feat(file1): update file1")
				.mockResolvedValueOnce("feat(file2): add file2")
				.mockResolvedValueOnce("feat: combined message")

			const mockWithProgress = vi.fn().mockImplementation(async (options, callback) => {
				return await callback(mockProgress)
			})
			vi.mocked(vscode.window).withProgress = mockWithProgress

			await provider.generateCommitMessage()

			const previousGitContext = (provider as any).previousGitContext
			expect(previousGitContext).toBe(chunkedContext.join("\n---\n"))
		})
	})

	describe("processChunkedContext", () => {
		it("should process multiple chunks and combine results", async () => {
			const chunks = [
				"## Git Context\n### Chunk 1\n```diff\n+file1 changes\n```",
				"## Git Context\n### Chunk 2\n```diff\n+file2 changes\n```",
			]

			mockSingleCompletionHandler
				.mockResolvedValueOnce("feat(auth): add login functionality")
				.mockResolvedValueOnce("feat(ui): update button styles")
				.mockResolvedValueOnce("feat: add login functionality and update UI")

			// Access private method for testing
			const processChunkedContext = (provider as any).processChunkedContext.bind(provider)
			const result = await processChunkedContext(chunks, mockProgress)

			expect(mockSingleCompletionHandler).toHaveBeenCalledTimes(3)
			expect(mockProgress.report).toHaveBeenCalledWith({ message: "kilocode:commitMessage.analyzingChunks" })
			expect(mockProgress.report).toHaveBeenCalledWith({ message: "kilocode:commitMessage.combining" })
			expect(result).toBe("feat: add login functionality and update UI")

			// Verify the combined context includes chunk summaries
			const combinedCall = mockSingleCompletionHandler.mock.calls[2][1]
			expect(combinedCall).toContain("## Combined Analysis from Multiple Chunks")
			expect(combinedCall).toContain("Chunk 1: feat(auth): add login functionality")
			expect(combinedCall).toContain("Chunk 2: feat(ui): update button styles")
		})
	})
})
