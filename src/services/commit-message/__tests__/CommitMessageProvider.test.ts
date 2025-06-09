import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"

// Mock dependencies
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
jest.mock("../../../core/config/ContextProxy")
jest.mock("../../../utils/single-completion-handler")
jest.mock("../GitExtensionService")
jest.mock("child_process")

describe("CommitMessageProvider", () => {
	let commitMessageProvider: CommitMessageProvider
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	let mockGitService: jest.Mocked<GitExtensionService>
	let mockExecSync: jest.Mock

	beforeEach(() => {
		// Setup mocks
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
		GitExtensionService.prototype.getCommitContext = jest.fn().mockImplementation(() => {
			return `## Input Context Commands

### Staged changes with context
\`\`\`diff
diff --git a/file1.ts b/file1.ts
index 123..456 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
-old line
+new line
\`\`\`

### Staged file names and status
\`\`\`
M file1.ts
A file2.ts
\`\`\`

### Summary of staged changes
\`\`\`
file1.ts | 2 +-
file2.ts | 10 ++++++++++
2 files changed, 11 insertions(+), 1 deletion(-)
\`\`\`

### Additional Context

#### Current branch
\`\`\`
feature/new-commit-message
\`\`\`

#### Recent commits for context
\`\`\`
abc123 Previous commit
def456 Another commit
\`\`\`

## Staged Changes Summary

### Modified files:
- /path/to/file1.ts

### Added files:
- /path/to/file2.ts
`
		})

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
			// Mock staged changes
			const mockChanges: GitChange[] = [
				{ filePath: "/path/to/file1.ts", status: "Modified" },
				{ filePath: "/path/to/file2.ts", status: "Added" },
			]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify commit context was requested
			expect(mockGitService.getCommitContext).toHaveBeenCalledWith(mockChanges)

			// Verify AI was called with the correct prompt
			expect(singleCompletionHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					apiProvider: "kilocode",
					kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
				}),
				expect.stringContaining("Conventional Commit Message Generator"),
			)

			// Verify commit message was set
			expect(mockGitService.setCommitMessage).toHaveBeenCalledWith(
				"feat(commit): implement conventional commit message generator",
			)
		})

		it("should handle multi-line commit messages with body and footer", async () => {
			// Mock staged changes
			const mockChanges: GitChange[] = [
				{ filePath: "/path/to/file1.ts", status: "Modified" },
				{ filePath: "/path/to/file2.ts", status: "Added" },
			]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// No need to mock git command outputs as we're mocking getCommitContext

			// Mock AI response with multi-line commit message
			;(singleCompletionHandler as jest.Mock).mockResolvedValue(`feat(auth): implement OAuth2 authentication

This change adds OAuth2 authentication support with the following features:
- Google and GitHub providers
- Token refresh mechanism
- User profile integration

Fixes #123
BREAKING CHANGE: Removes the old authentication system`)

			// withProgress is already mocked in the vscode mock

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify commit message was set with full multi-line message
			expect(mockGitService.setCommitMessage).toHaveBeenCalledWith(`feat(auth): implement OAuth2 authentication

This change adds OAuth2 authentication support with the following features:
- Google and GitHub providers
- Token refresh mechanism
- User profile integration

Fixes #123
BREAKING CHANGE: Removes the old authentication system`)
		})

		it("should handle code blocks in AI responses", async () => {
			// Mock staged changes
			const mockChanges: GitChange[] = [{ filePath: "/path/to/file1.ts", status: "Modified" }]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// No need to mock git command outputs as we're mocking getCommitContext

			// Mock AI response with code blocks
			;(singleCompletionHandler as jest.Mock).mockResolvedValue(`\`\`\`
feat(core): update authentication logic

Refactor the authentication system to use JWT tokens
and improve security measures.

Fixes #456
\`\`\``)

			// withProgress is already mocked in the vscode mock

			// Call the method
			await commitMessageProvider.generateCommitMessage()

			// Verify commit message was set with code blocks removed
			expect(mockGitService.setCommitMessage).toHaveBeenCalledWith(`feat(core): update authentication logic

Refactor the authentication system to use JWT tokens
and improve security measures.

Fixes #456`)
		})

		it("should generate a different message when called twice with the same context", async () => {
			// Mock staged changes
			const mockChanges: GitChange[] = [{ filePath: "/path/to/file1.ts", status: "Modified" }]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// First call to generate message
			await commitMessageProvider.generateCommitMessage()

			// Verify first call to AI
			expect(singleCompletionHandler).toHaveBeenCalledWith(
				expect.any(Object),
				expect.not.stringContaining("DIFFERENT from the previous message"),
			)

			// Reset mock to check second call
			;(singleCompletionHandler as jest.Mock).mockClear()

			// Second call with same context
			await commitMessageProvider.generateCommitMessage()

			// Verify second call includes instruction to make message different
			expect(singleCompletionHandler).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("DIFFERENT from the previous message"),
			)
		})

		it("should reset tracking when resetPreviousMessageTracking is called", async () => {
			// Mock staged changes
			const mockChanges: GitChange[] = [{ filePath: "/path/to/file1.ts", status: "Modified" }]
			mockGitService.gatherStagedChanges.mockResolvedValue(mockChanges)

			// First call to generate message
			await commitMessageProvider.generateCommitMessage()

			// Reset tracking
			;(commitMessageProvider as any).resetPreviousMessageTracking()

			// Reset mock to check next call
			;(singleCompletionHandler as jest.Mock).mockClear()

			// Call generate again
			await commitMessageProvider.generateCommitMessage()

			// Verify call doesn't include instruction to make message different
			expect(singleCompletionHandler).toHaveBeenCalledWith(
				expect.any(Object),
				expect.not.stringContaining("DIFFERENT from the previous message"),
			)
		})
	})
})
