import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"
import { GitUtils } from "../GitUtils"
import { loadRuleFiles } from "../../../core/prompts/sections/custom-instructions"

// Mock vscode module
jest.mock("vscode", () => {
	const registeredCommands = new Map<string, (...args: any[]) => any>()

	return {
		extensions: {
			getExtension: jest.fn(),
		},
		commands: {
			registerCommand: jest.fn((commandId: string, handler: (...args: any[]) => any) => {
				registeredCommands.set(commandId, handler)
				return { dispose: jest.fn() }
			}),
			executeCommand: jest.fn((commandId: string, ...args: any[]) => {
				const handler = registeredCommands.get(commandId)
				if (handler) {
					return handler(...args)
				}
				return Promise.resolve()
			}),
		},
		window: {
			withProgress: jest.fn(),
			showInformationMessage: jest.fn(),
			showErrorMessage: jest.fn(),
		},
		workspace: {
			workspaceFolders: [
				{
					uri: {
						fsPath: "/test/workspace",
					},
				},
			],
		},
		ProgressLocation: {
			SourceControl: 1,
			Window: 10,
			Notification: 15,
		},
	}
})

// Mock dependencies
jest.mock("../../../utils/single-completion-handler")
jest.mock("../../../core/config/ContextProxy")
jest.mock("../GitUtils")
jest.mock("../../../core/prompts/sections/custom-instructions")

const mockSingleCompletionHandler = singleCompletionHandler as jest.MockedFunction<typeof singleCompletionHandler>
const mockContextProxy = ContextProxy as jest.Mocked<typeof ContextProxy>
const MockGitUtils = GitUtils as jest.MockedClass<typeof GitUtils>
const mockLoadRuleFiles = loadRuleFiles as jest.MockedFunction<typeof loadRuleFiles>

describe("CommitMessageProvider", () => {
	let provider: CommitMessageProvider
	let mockContext: vscode.ExtensionContext
	let mockGitUtils: jest.Mocked<GitUtils>
	let mockRepo: any

	beforeEach(() => {
		// Mock extension context
		mockContext = {
			subscriptions: [],
		} as any

		// Mock repository
		mockRepo = {
			inputBox: { value: "" },
		}

		// Mock GitUtils
		mockGitUtils = new MockGitUtils() as jest.Mocked<GitUtils>
		MockGitUtils.mockImplementation(() => mockGitUtils)

		// Mock ContextProxy
		Object.defineProperty(mockContextProxy, "instance", {
			value: {
				getProviderSettings: jest.fn().mockReturnValue({
					apiProvider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
				}),
			},
			writable: true,
		})

		// Mock single completion handler
		mockSingleCompletionHandler.mockResolvedValue("feat: add new feature")

		// Mock loadRuleFiles
		mockLoadRuleFiles.mockResolvedValue("")

		provider = new CommitMessageProvider(mockContext, {
			appendLine: jest.fn(),
		} as any)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	describe("activate", () => {
		it("should activate successfully", async () => {
			mockGitUtils.initializeGitExtension.mockResolvedValue({} as any)

			await provider.activate()

			expect(mockGitUtils.initializeGitExtension).toHaveBeenCalled()
			expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
				"kilo-code.generateCommitMessage",
				expect.any(Function),
			)
		})

		it("should handle Git extension initialization failure", async () => {
			mockGitUtils.initializeGitExtension.mockRejectedValue(new Error("Git extension not found"))

			await expect(provider.activate()).rejects.toThrow("Failed to initialize Git extension")
		})
	})

	describe("generateCommitMessage", () => {
		beforeEach(async () => {
			mockGitUtils.initializeGitExtension.mockResolvedValue({} as any)
			await provider.activate()
		})

		it("should generate commit message for staged changes", async () => {
			mockGitUtils.getActiveRepository.mockReturnValue(mockRepo)
			mockGitUtils.gatherStagedChanges.mockResolvedValue("Staged changes:\n\nModified files:\n- src/test.ts")
			mockGitUtils.setCommitMessage.mockImplementation(() => {})

			// Mock vscode.window.withProgress to call the callback immediately
			;(vscode.window.withProgress as jest.Mock).mockImplementation(async (options, callback) => {
				const mockProgress = {
					report: jest.fn(),
				}
				return callback(mockProgress as any, {} as any)
			})
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)

			// Execute the command
			await vscode.commands.executeCommand("kilo-code.generateCommitMessage")

			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(
				{
					apiProvider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
				},
				expect.stringContaining("Staged changes:"),
			)

			expect(mockGitUtils.setCommitMessage).toHaveBeenCalledWith(mockRepo, "feat: add new feature")
			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("✨ Commit message generated!")
		})

		it("should handle no staged changes", async () => {
			mockGitUtils.getActiveRepository.mockReturnValue(mockRepo)
			mockGitUtils.gatherStagedChanges.mockResolvedValue(null)
			;(vscode.window.withProgress as jest.Mock).mockImplementation(async (options, callback) => {
				const mockProgress = {
					report: jest.fn(),
				}
				return callback(mockProgress as any, {} as any)
			})
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)

			await vscode.commands.executeCommand("kilo-code.generateCommitMessage")

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No staged changes found to analyze")
			expect(mockSingleCompletionHandler).not.toHaveBeenCalled()
		})

		it("should handle no repository", async () => {
			mockGitUtils.getActiveRepository.mockReturnValue(null)
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)

			await vscode.commands.executeCommand("kilo-code.generateCommitMessage")

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith("No Git repository found")
			expect(mockSingleCompletionHandler).not.toHaveBeenCalled()
		})

		it("should handle missing Kilo Code token", async () => {
			mockGitUtils.getActiveRepository.mockReturnValue(mockRepo)
			mockGitUtils.gatherStagedChanges.mockResolvedValue("Staged changes:\n\nModified files:\n- src/test.ts")

			// Mock missing token
			Object.defineProperty(mockContextProxy, "instance", {
				value: {
					getProviderSettings: jest.fn().mockReturnValue({
						apiProvider: "kilocode",
						kilocodeToken: null,
						kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
					}),
				},
				writable: true,
			})
			;(vscode.window.withProgress as jest.Mock).mockImplementation(async (options, callback) => {
				const mockProgress = {
					report: jest.fn(),
				}
				return callback(mockProgress as any, {} as any)
			})
			;(vscode.window.showErrorMessage as jest.Mock).mockResolvedValue(undefined)

			await vscode.commands.executeCommand("kilo-code.generateCommitMessage")

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Failed to generate commit message: Kilo Code token is required for AI commit message generation",
			)
		})

		it("should include rules in the prompt when rules are available", async () => {
			mockGitUtils.getActiveRepository.mockReturnValue(mockRepo)
			mockGitUtils.gatherStagedChanges.mockResolvedValue("Staged changes:\n\nModified files:\n- src/test.ts")
			mockGitUtils.setCommitMessage.mockImplementation(() => {})

			// Mock rules content
			const mockRules =
				"\n\n# Rules from .kilocode/rules/commit.md:\nAlways include ticket numbers in format [TICKET-123]"
			mockLoadRuleFiles.mockResolvedValue(mockRules)

			// Mock vscode.window.withProgress to call the callback immediately
			;(vscode.window.withProgress as jest.Mock).mockImplementation(async (options, callback) => {
				const mockProgress = {
					report: jest.fn(),
				}
				return callback(mockProgress as any, {} as any)
			})
			;(vscode.window.showInformationMessage as jest.Mock).mockResolvedValue(undefined)

			// Execute the command
			await vscode.commands.executeCommand("kilo-code.generateCommitMessage")

			expect(mockLoadRuleFiles).toHaveBeenCalledWith("/test/workspace")
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(
				{
					apiProvider: "kilocode",
					kilocodeToken: "test-token",
					kilocodeModel: "google/gemini-2.5-flash-preview-05-20",
				},
				expect.stringContaining("Additional Rules:"),
			)
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("Always include ticket numbers in format [TICKET-123]"),
			)
		})
	})
})
