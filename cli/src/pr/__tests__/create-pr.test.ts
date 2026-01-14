import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { agentPrInstruction, buildPrInstruction, prCreationTimeout, finishWithPrCreation } from "../create-pr.js"
import type { CLI } from "../../cli.js"

// Mock simple-git
vi.mock("simple-git", () => ({
	simpleGit: vi.fn(() => ({
		revparse: vi.fn(),
		status: vi.fn(),
	})),
}))

// Mock child_process exec
vi.mock("child_process", () => ({
	exec: vi.fn(),
}))

// Mock util promisify
vi.mock("util", () => ({
	promisify: vi.fn(() => vi.fn().mockRejectedValue(new Error("No PR exists"))),
}))

// Mock logs
vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

// Mock telemetry
vi.mock("../../services/telemetry/index.js", () => ({
	getTelemetryService: vi.fn(() => ({
		trackFeatureUsed: vi.fn(),
		trackError: vi.fn(),
	})),
}))

/**
 * Tests for the --create-pr flag behavior.
 *
 * The --create-pr flag prompts the agent to create a pull request when the task completes.
 */
describe("CLI --create-pr flag", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.useRealTimers()
	})

	describe("PR Instruction Content", () => {
		it("should include instructions to check for uncommitted changes", () => {
			expect(agentPrInstruction).toContain("uncommitted changes")
			expect(agentPrInstruction).toContain("git add -A")
		})

		it("should include instructions to push the branch", () => {
			expect(agentPrInstruction).toContain("Push the branch")
			expect(agentPrInstruction).toContain("git push -u origin")
		})

		it("should include instructions to create a PR using gh CLI", () => {
			expect(agentPrInstruction).toContain("gh pr create")
			expect(agentPrInstruction).toContain("GH_TOKEN")
		})

		it("should include instructions to return the PR URL", () => {
			expect(agentPrInstruction).toContain("Return the PR URL")
		})

		it("should include branch protection logic for main/master", () => {
			expect(agentPrInstruction).toContain("Do NOT create a PR if on main/master branch")
		})

		it("should include instructions for existing PRs", () => {
			expect(agentPrInstruction).toContain("PR already exists")
			expect(agentPrInstruction).toContain("gh pr view")
		})

		it("should include instructions about not force pushing", () => {
			expect(agentPrInstruction).toContain("Do NOT use --force")
		})

		it("should include instructions for pre-commit hook failures", () => {
			expect(agentPrInstruction).toContain("--no-verify")
		})

		it("should emphasize completing all steps", () => {
			expect(agentPrInstruction).toContain("MUST complete all 4 steps")
			expect(agentPrInstruction).toContain("do not stop")
		})
	})

	describe("buildPrInstruction", () => {
		it("should include the initial prompt context when provided", () => {
			const instruction = buildPrInstruction("Fix the login bug", false)
			expect(instruction).toContain("Fix the login bug")
			expect(instruction).toContain("user's original task")
		})

		it("should indicate when there are uncommitted changes", () => {
			const instruction = buildPrInstruction("", true)
			expect(instruction).toContain("uncommitted changes that need to be committed")
		})

		it("should indicate when changes are already committed", () => {
			const instruction = buildPrInstruction("", false)
			expect(instruction).toContain("All changes have already been committed")
		})

		it("should work without initial prompt", () => {
			const instruction = buildPrInstruction("", false)
			expect(instruction).toContain("MUST create a pull request")
			expect(instruction).not.toContain("user's original task")
		})
	})

	describe("Timeout Configuration", () => {
		it("should have a 90 second timeout for PR creation", () => {
			expect(prCreationTimeout).toBe(90000)
		})
	})

	describe("finishWithPrCreation", () => {
		it("should skip PR creation when on main branch", async () => {
			const { simpleGit } = await import("simple-git")
			const mockGit = {
				revparse: vi.fn().mockResolvedValue("main"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as ReturnType<typeof simpleGit>)

			const mockCli = {
				getService: vi.fn(),
			} as unknown as CLI

			const beforeExit = await finishWithPrCreation(mockCli, {
				cwd: "/test/workspace",
				initialPrompt: "test prompt",
			})

			// Should return a no-op function
			expect(typeof beforeExit).toBe("function")
			// Service should not be called
			expect(mockCli.getService).not.toHaveBeenCalled()
		})

		it("should skip PR creation when on master branch", async () => {
			const { simpleGit } = await import("simple-git")
			const mockGit = {
				revparse: vi.fn().mockResolvedValue("master"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as ReturnType<typeof simpleGit>)

			const mockCli = {
				getService: vi.fn(),
			} as unknown as CLI

			const beforeExit = await finishWithPrCreation(mockCli, {
				cwd: "/test/workspace",
				initialPrompt: "test prompt",
			})

			expect(typeof beforeExit).toBe("function")
			expect(mockCli.getService).not.toHaveBeenCalled()
		})

		it("should handle missing extension service gracefully", async () => {
			const { simpleGit } = await import("simple-git")
			const mockGit = {
				revparse: vi.fn().mockResolvedValue("feature-branch"),
				status: vi.fn().mockResolvedValue({ isClean: () => true }),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as ReturnType<typeof simpleGit>)

			const mockCli = {
				getService: vi.fn().mockReturnValue(null),
			} as unknown as CLI

			const beforeExit = await finishWithPrCreation(mockCli, {
				cwd: "/test/workspace",
				initialPrompt: "test prompt",
			})

			expect(typeof beforeExit).toBe("function")
		})

		it("should send PR instruction to agent on feature branch", async () => {
			const { simpleGit } = await import("simple-git")
			const mockGit = {
				revparse: vi.fn().mockResolvedValue("feature-branch"),
				status: vi.fn().mockResolvedValue({ isClean: () => true }),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as ReturnType<typeof simpleGit>)

			const mockSendWebviewMessage = vi.fn().mockResolvedValue(undefined)
			const mockService = {
				sendWebviewMessage: mockSendWebviewMessage,
			}
			const mockCli = {
				getService: vi.fn().mockReturnValue(mockService),
			} as unknown as CLI

			// Start the function but don't await it fully since it has a timeout
			const promise = finishWithPrCreation(mockCli, {
				cwd: "/test/workspace",
				initialPrompt: "test prompt",
			})

			// Advance timers to complete the wait
			await vi.advanceTimersByTimeAsync(prCreationTimeout + 10000)

			const beforeExit = await promise

			// Should have sent a message with the instruction
			expect(mockSendWebviewMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "askResponse",
					askResponse: "messageResponse",
				}),
			)
			// The instruction should contain the initial prompt context
			const sentMessage = mockSendWebviewMessage.mock.calls[0][0]
			expect(sentMessage.text).toContain("test prompt")
			expect(typeof beforeExit).toBe("function")
		})

		it("should handle git errors gracefully", async () => {
			const { simpleGit } = await import("simple-git")
			const mockGit = {
				revparse: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as ReturnType<typeof simpleGit>)

			const mockCli = {
				getService: vi.fn(),
			} as unknown as CLI

			// Should not throw
			const beforeExit = await finishWithPrCreation(mockCli, {
				cwd: "/test/workspace",
				initialPrompt: "test prompt",
			})

			expect(typeof beforeExit).toBe("function")
		})
	})
})
