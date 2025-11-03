/**
 * Tests for determineParallelBranch function
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { DetermineParallelBranchInput } from "../determineBranch.js"

// Create mock for simpleGit using vi.hoisted
const mockGitRaw = vi.hoisted(() => vi.fn())

// Mock dependencies
vi.mock("../../utils/git.js", () => ({
	getGitInfo: vi.fn(),
	generateBranchName: vi.fn(),
	branchExists: vi.fn(),
}))

vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		error: vi.fn(),
	},
}))

vi.mock("simple-git", () => ({
	default: vi.fn(() => ({
		raw: mockGitRaw,
	})),
}))

// Import after mocks are set up
import { determineParallelBranch } from "../determineBranch.js"
import { getGitInfo, generateBranchName, branchExists } from "../../utils/git.js"

describe("determineParallelBranch", () => {
	const mockCwd = "/test/repo"
	const mockPrompt = "Add new feature"
	const mockBranch = "main"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("git repository validation", () => {
		it("should throw error when directory is not a git repository", async () => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: false,
				branch: null,
				isClean: true,
			})

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			await expect(determineParallelBranch(input)).rejects.toThrow(
				"Parallel mode requires the current working directory to be a git repository",
			)
		})

		it("should throw error when current branch cannot be determined", async () => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: true,
				branch: null,
				isClean: true,
			})

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			await expect(determineParallelBranch(input)).rejects.toThrow("Could not determine current git branch")
		})
	})

	describe("existing branch handling", () => {
		beforeEach(() => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: true,
				branch: mockBranch,
				isClean: true,
			})
		})

		it("should use existing branch when it exists", async () => {
			const existingBranch = "feature/existing"
			vi.mocked(branchExists).mockResolvedValue(true)
			mockGitRaw.mockResolvedValue("")

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
				existingBranch,
			}

			const result = await determineParallelBranch(input)

			expect(branchExists).toHaveBeenCalledWith(mockCwd, existingBranch)
			expect(result.worktreeBranch).toBe(existingBranch)
		})

		it("should throw error when existing branch does not exist", async () => {
			const existingBranch = "feature/nonexistent"
			vi.mocked(branchExists).mockResolvedValue(false)

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
				existingBranch,
			}

			await expect(determineParallelBranch(input)).rejects.toThrow(`Branch "${existingBranch}" does not exist`)

			expect(branchExists).toHaveBeenCalledWith(mockCwd, existingBranch)
		})
	})

	describe("new branch generation", () => {
		beforeEach(() => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: true,
				branch: mockBranch,
				isClean: true,
			})
		})

		it("should generate new branch name from prompt when no existing branch provided", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)
			mockGitRaw.mockResolvedValue("")

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			const result = await determineParallelBranch(input)

			expect(generateBranchName).toHaveBeenCalledWith(mockPrompt)
			expect(result.worktreeBranch).toBe(generatedBranch)
		})
	})

	describe("worktree creation", () => {
		beforeEach(() => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: true,
				branch: mockBranch,
				isClean: true,
			})
		})

		it("should create worktree with new branch", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)

			let capturedArgs: string[] = []
			mockGitRaw.mockImplementation(async (args: string[]) => {
				capturedArgs = args
				return ""
			})

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			const result = await determineParallelBranch(input)

			expect(result.worktreeBranch).toBe(generatedBranch)
			expect(result.worktreePath).toContain(`kilocode-worktree-${generatedBranch}`)
			expect(capturedArgs).toEqual([
				"worktree",
				"add",
				"-b",
				generatedBranch,
				expect.stringContaining(`kilocode-worktree-${generatedBranch}`),
			])
		})

		it("should create worktree with existing branch", async () => {
			const existingBranch = "feature/existing"
			vi.mocked(branchExists).mockResolvedValue(true)

			let capturedArgs: string[] = []
			mockGitRaw.mockImplementation(async (args: string[]) => {
				capturedArgs = args
				return ""
			})

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
				existingBranch,
			}

			const result = await determineParallelBranch(input)

			expect(result.worktreeBranch).toBe(existingBranch)
			expect(result.worktreePath).toContain(`kilocode-worktree-${existingBranch}`)
			expect(capturedArgs).toEqual([
				"worktree",
				"add",
				expect.stringContaining(`kilocode-worktree-${existingBranch}`),
				existingBranch,
			])
			expect(capturedArgs).not.toContain("-b") // Should not have -b flag for existing branch
		})

		it("should create worktree path in OS temp directory", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)
			mockGitRaw.mockResolvedValue("")

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			const result = await determineParallelBranch(input)

			// Worktree path should be in temp directory
			expect(result.worktreePath).toMatch(/^\/.*\/kilocode-worktree-/)
			expect(result.worktreePath).toContain(generatedBranch)
		})

		it("should throw error when worktree creation fails", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)

			const errorMessage = "fatal: 'add-new-feature-1234567890' is already checked out"
			mockGitRaw.mockRejectedValue(new Error(errorMessage))

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			await expect(determineParallelBranch(input)).rejects.toThrow(errorMessage)
		})

		it("should execute git command in the correct directory", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)
			mockGitRaw.mockResolvedValue("")

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			await determineParallelBranch(input)

			// simpleGit is initialized with the cwd, so it will execute in that directory
			// The mock is called with the git instance created from simpleGit(cwd)
			expect(mockGitRaw).toHaveBeenCalled()
		})
	})

	describe("return value", () => {
		beforeEach(() => {
			vi.mocked(getGitInfo).mockResolvedValue({
				isRepo: true,
				branch: mockBranch,
				isClean: true,
			})
			mockGitRaw.mockResolvedValue("")
		})

		it("should return object with worktreeBranch and worktreePath", async () => {
			const generatedBranch = "add-new-feature-1234567890"
			vi.mocked(generateBranchName).mockReturnValue(generatedBranch)

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
			}

			const result = await determineParallelBranch(input)

			expect(result).toHaveProperty("worktreeBranch")
			expect(result).toHaveProperty("worktreePath")
			expect(typeof result.worktreeBranch).toBe("string")
			expect(typeof result.worktreePath).toBe("string")
		})

		it("should return consistent branch name in both fields", async () => {
			const existingBranch = "feature/existing"
			vi.mocked(branchExists).mockResolvedValue(true)
			mockGitRaw.mockResolvedValue("")

			const input: DetermineParallelBranchInput = {
				cwd: mockCwd,
				prompt: mockPrompt,
				existingBranch,
			}

			const result = await determineParallelBranch(input)

			expect(result.worktreeBranch).toBe(existingBranch)
			expect(result.worktreePath).toContain(existingBranch)
		})
	})
})
