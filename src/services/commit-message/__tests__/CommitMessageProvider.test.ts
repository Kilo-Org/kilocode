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
	})
})
