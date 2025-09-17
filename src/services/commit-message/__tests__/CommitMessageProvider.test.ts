// kilocode_change - updated for new API
import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { GitExtensionService, GitChange } from "../GitExtensionService"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"
import type { Mock } from "vitest"

// Create mock instances
const mockGitService = {
	gatherChanges: vi.fn(),
	getCommitContext: vi.fn(),
	spawnGitWithArgs: vi.fn(),
	dispose: vi.fn(),
}

// Mock dependencies
vi.mock("../../../core/config/ContextProxy", () => {
	const mockContextProxy = {
		getProviderSettings: vi.fn().mockReturnValue({
			kilocodeToken: "mock-token",
		}),
		getValue: vi.fn().mockImplementation((key: string) => {
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

	return {
		ContextProxy: {
			get instance() {
				return mockContextProxy
			},
		},
	}
})

vi.mock("../../../utils/single-completion-handler")
vi.mock("../GitExtensionService", () => ({
	GitExtensionService: vi.fn().mockImplementation(() => mockGitService),
}))
vi.mock("child_process")
vi.mock("../../../core/prompts/sections/custom-instructions", () => ({
	addCustomInstructions: vi.fn().mockResolvedValue(""),
}))
vi.mock("../../../utils/path", () => ({
	getWorkspacePath: vi.fn().mockReturnValue("/mock/workspace"),
}))
vi.mock("../../../shared/support-prompt", () => ({
	supportPrompt: {
		get: vi.fn().mockReturnValue("Mock commit message template with ${gitContext} and ${customInstructions}"),
		create: vi.fn().mockReturnValue("Mock generated prompt"),
	},
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		withProgress: vi.fn().mockImplementation((_, callback) => callback({ report: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
	commands: {
		registerCommand: vi.fn(),
	},
	env: {
		language: "en",
		clipboard: {
			writeText: vi.fn(),
		},
	},
	extensions: {
		getExtension: vi.fn().mockReturnValue({
			isActive: true,
			exports: {
				getAPI: vi.fn().mockReturnValue({
					repositories: [
						{
							rootUri: { fsPath: "/mock/workspace" },
							inputBox: { value: "" },
						},
					],
				}),
			},
		}),
	},
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
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

	beforeEach(async () => {
		mockContext = {
			workspaceState: { get: vi.fn().mockReturnValue(undefined) },
			globalState: { get: vi.fn().mockReturnValue(undefined) },
			subscriptions: [],
		} as unknown as vscode.ExtensionContext
		mockOutputChannel = {
			appendLine: vi.fn(),
		} as unknown as vscode.OutputChannel

		// Setup singleCompletionHandler mock
		vi.mocked(singleCompletionHandler).mockResolvedValue(
			"feat(commit): implement conventional commit message generator",
		)

		// Setup GitExtensionService mock defaults
		vi.mocked(mockGitService.gatherChanges).mockResolvedValue([{ filePath: "file1.ts", status: "Modified" }])
		vi.mocked(mockGitService.getCommitContext).mockResolvedValue("Modified file1.ts, Added file2.ts")

		// Create CommitMessageProvider instance
		commitMessageProvider = new CommitMessageProvider(mockContext, mockOutputChannel)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("generateCommitMessageForExternal", () => {
		it("should return success result with generated message", async () => {
			const mockChanges: GitChange[] = [{ filePath: "file1.ts", status: "Modified" }]

			vi.mocked(mockGitService.gatherChanges).mockImplementation(async (options) => {
				return options?.staged ? [] : mockChanges
			})
			vi.mocked(mockGitService.getCommitContext).mockResolvedValue("Modified file1.ts")
			vi.mocked(singleCompletionHandler).mockResolvedValue("feat: add new feature")

			const result = await commitMessageProvider.generateCommitMessageForExternal("/test/workspace")

			expect(result).toEqual({
				message: "feat: add new feature",
			})
		})

		it("should return error when no changes found", async () => {
			vi.mocked(mockGitService.gatherChanges).mockResolvedValue([])

			const result = await commitMessageProvider.generateCommitMessageForExternal("/test/workspace")

			expect(result).toEqual({
				error: "No changes found to generate commit message",
				message: "",
			})
		})

		it("should handle git errors gracefully", async () => {
			vi.mocked(mockGitService.gatherChanges).mockRejectedValue(new Error("Git error"))

			const result = await commitMessageProvider.generateCommitMessageForExternal("/test/workspace")

			expect(result).toEqual({
				error: "Git error",
				message: "",
			})
		})

		it("should handle AI generation errors", async () => {
			const mockChanges: GitChange[] = [{ filePath: "file1.ts", status: "Modified" }]

			vi.mocked(mockGitService.gatherChanges).mockImplementation(async (options) => {
				return options?.staged ? [] : mockChanges
			})
			vi.mocked(mockGitService.getCommitContext).mockResolvedValue("Modified file1.ts")
			vi.mocked(singleCompletionHandler).mockRejectedValue(new Error("AI API error"))

			const result = await commitMessageProvider.generateCommitMessageForExternal("/test/workspace")

			expect(result).toEqual({
				error: "AI API error",
				message: "",
			})
		})
	})

	describe("setCommitMessage", () => {
		it("should set commit message in VSCode git repository", () => {
			const mockRepo = {
				rootUri: { fsPath: "/mock/workspace" },
				inputBox: { value: "" },
			}

			// Set the target repository manually for testing
			;(commitMessageProvider as any).targetRepository = mockRepo

			commitMessageProvider.setCommitMessage("feat: test message")

			expect(mockRepo.inputBox.value).toBe("feat: test message")
		})

		it("should fallback to clipboard when no git extension available", () => {
			// Clear the target repository to trigger clipboard fallback
			;(commitMessageProvider as any).targetRepository = null

			commitMessageProvider.setCommitMessage("feat: test message")

			expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith("feat: test message")
			expect(vscode.window.showInformationMessage).toHaveBeenCalled()
		})
	})

	describe("activate", () => {
		it("should register commands during activation", async () => {
			await commitMessageProvider.activate()

			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilo-code.generateCommitMessage",
				expect.any(Function),
			)
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilo-code.generateCommitMessageForExternal",
				expect.any(Function),
			)
		})
	})

	describe("dispose", () => {
		it("should dispose git service properly", () => {
			// Setup git service
			const mockDispose = vi.fn()
			;(commitMessageProvider as any).gitService = {
				dispose: mockDispose,
			}

			commitMessageProvider.dispose()

			expect(mockDispose).toHaveBeenCalled()
			expect((commitMessageProvider as any).gitService).toBeNull()
		})

		it("should handle null git service gracefully", () => {
			;(commitMessageProvider as any).gitService = null

			expect(() => commitMessageProvider.dispose()).not.toThrow()
		})
	})
})
