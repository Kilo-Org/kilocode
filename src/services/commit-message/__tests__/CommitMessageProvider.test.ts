import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"

// Mock dependencies
jest.mock("../../../core/config/ContextProxy")
jest.mock("../../../utils/single-completion-handler")
jest.mock("../GitExtensionService")
jest.mock("child_process")
jest.mock("vscode", () => ({
	window: {
		showInformationMessage: jest.fn(),
		showErrorMessage: jest.fn(),
		withProgress: jest.fn().mockImplementation((_, callback) => callback({ report: jest.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
	commands: {
		registerCommand: jest.fn(),
	},
	ExtensionContext: jest.fn(),
	OutputChannel: jest.fn(),
	ProgressLocation: {
		SourceControl: 1,
		Window: 2,
		Notification: 3,
	},
}))

describe("CommitMessageProvider", () => {
	let commitMessageProvider: CommitMessageProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockGitService: jest.Mocked<GitExtensionService>
	let mockExecSync: jest.Mock

	beforeEach(() => {
		mockContext = {} as vscode.ExtensionContext
		mockOutputChannel = {
			appendLine: jest.fn(),
		} as unknown as vscode.OutputChannel

		// Mock child_process.execSync
		mockExecSync = jest.fn()
		jest.requireMock("child_process").execSync = mockExecSync

		// Setup GitExtensionService mock
		mockGitService = new GitExtensionService() as jest.Mocked<GitExtensionService>
		GitExtensionService.prototype.initialize = jest.fn().mockResolvedValue(true)
		GitExtensionService.prototype.gatherStagedChanges = jest.fn()
		GitExtensionService.prototype.setCommitMessage = jest.fn()
		GitExtensionService.prototype.executeGitCommand = jest.fn().mockReturnValue("")
		GitExtensionService.prototype.getCommitContext = jest.fn().mockReturnValue("Modified file1.ts, Added file2.ts")

		// Setup ContextProxy mock
		const mockContextProxy = {
			getProviderSettings: jest.fn().mockReturnValue({
				kilocodeToken: "mock-token",
			}),
			getValue: jest.fn().mockImplementation((key: string) => {
				switch (key) {
					case "commitMessageApiConfigId":
						return undefined
					case "listApiConfigMeta":
						return []
					case "customSupportPrompts":
						return {}
					default:
						return undefined
				}
			}),
		}
		;(ContextProxy as any).instance = mockContextProxy

		// Setup singleCompletionHandler mock
		;(singleCompletionHandler as jest.Mock).mockResolvedValue(
			"feat(commit): implement conventional commit message generator",
		)

		// Create CommitMessageProvider instance
		commitMessageProvider = new CommitMessageProvider(mockContext, mockOutputChannel)
		;(commitMessageProvider as any).gitService = mockGitService
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe("generateCommitMessage", () => {
		it("should generate a commit message based on staged changes", async () => {
			const mockChanges: GitChange[] = [
				{ filePath: "file1.ts", status: "Modified" },
				{ filePath: "file2.ts", status: "Added" },
			]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify basic flow
			expect(mockGitService.getCommitContext).toHaveBeenCalledWith(mockChanges)
			expect(singleCompletionHandler).toHaveBeenCalled()
			expect(mockGitService.setCommitMessage).toHaveBeenCalled()
		})

		it("should handle code blocks and formatting in AI responses", async () => {
			mockGitService.gatherStagedChanges.mockResolvedValue([{ filePath: "file.ts", status: "Modified" }])

			// Mock AI response with code blocks
			;(singleCompletionHandler as jest.Mock).mockResolvedValue("```\nfeat(core): add feature\n```")

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify code blocks are removed
			expect(mockGitService.setCommitMessage).toHaveBeenCalledWith("feat(core): add feature")
		})

		it("should show error message when generation fails", async () => {
			mockGitService.gatherStagedChanges.mockResolvedValue([{ filePath: "file.ts", status: "Modified" }])
			;(singleCompletionHandler as jest.Mock).mockRejectedValue(new Error("API error"))

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify error handling
			expect(vscode.window.showErrorMessage).toHaveBeenCalled()
		})

		it("should show information message when there are no staged changes", async () => {
			// Mock no staged changes
			mockGitService.gatherStagedChanges.mockResolvedValue(null)

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify that it shows the appropriate message and doesn't proceed
			expect(vscode.window.showInformationMessage).toHaveBeenCalled()
			expect(mockGitService.getCommitContext).not.toHaveBeenCalled()
			expect(singleCompletionHandler).not.toHaveBeenCalled()
			expect(mockGitService.setCommitMessage).not.toHaveBeenCalled()
		})

		it("should show information message when staged changes array is empty", async () => {
			// Mock empty staged changes array
			mockGitService.gatherStagedChanges.mockResolvedValue([])

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify that it shows the appropriate message and doesn't proceed
			expect(vscode.window.showInformationMessage).toHaveBeenCalled()
			expect(mockGitService.getCommitContext).not.toHaveBeenCalled()
			expect(singleCompletionHandler).not.toHaveBeenCalled()
			expect(mockGitService.setCommitMessage).not.toHaveBeenCalled()
		})

		it("should use custom API config when commitMessageApiConfigId is set", async () => {
			const mockChanges: GitChange[] = [{ filePath: "file.ts", status: "Modified" }]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// Mock custom API config
			const customApiConfig = { apiProvider: "openai", apiKey: "custom-key" }
			const mockProviderSettingsManager = {
				getProfile: jest.fn().mockResolvedValue({ name: "Custom Config", ...customApiConfig }),
			}
			;(commitMessageProvider as any).providerSettingsManager = mockProviderSettingsManager

			// Setup ContextProxy to return custom config ID
			const mockContextProxy = (ContextProxy as any).instance
			mockContextProxy.getValue.mockImplementation((key: string) => {
				switch (key) {
					case "commitMessageApiConfigId":
						return "custom-config-id"
					case "listApiConfigMeta":
						return [{ id: "custom-config-id", name: "Custom Config" }]
					case "customSupportPrompts":
						return {}
					default:
						return undefined
				}
			})

			await commitMessageProvider.generateCommitMessage()

			// Verify custom config was used
			expect(mockProviderSettingsManager.getProfile).toHaveBeenCalledWith({ id: "custom-config-id" })
			expect(singleCompletionHandler).toHaveBeenCalledWith(customApiConfig, expect.any(String))
		})

		it("should fall back to default config when custom API config fails to load", async () => {
			const mockChanges: GitChange[] = [{ filePath: "file.ts", status: "Modified" }]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// Mock provider settings manager to throw error
			const mockProviderSettingsManager = {
				getProfile: jest.fn().mockRejectedValue(new Error("Config not found")),
			}
			;(commitMessageProvider as any).providerSettingsManager = mockProviderSettingsManager

			// Setup ContextProxy to return custom config ID
			const mockContextProxy = (ContextProxy as any).instance
			mockContextProxy.getValue.mockImplementation((key: string) => {
				switch (key) {
					case "commitMessageApiConfigId":
						return "invalid-config-id"
					case "listApiConfigMeta":
						return [{ id: "custom-config-id", name: "Custom Config" }]
					case "customSupportPrompts":
						return {}
					default:
						return undefined
				}
			})

			const defaultConfig = { kilocodeToken: "mock-token" }
			mockContextProxy.getProviderSettings.mockReturnValue(defaultConfig)

			await commitMessageProvider.generateCommitMessage()

			// Verify fallback to default config
			expect(singleCompletionHandler).toHaveBeenCalledWith(defaultConfig, expect.any(String))
		})
	})
})
