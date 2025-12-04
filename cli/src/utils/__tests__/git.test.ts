/**
 * Tests for git utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGitInfo, getGitBranch, branchExists, generateBranchName, isGitWorktree } from "../git.js"
import simpleGit, { SimpleGit } from "simple-git"

// Mock simple-git
vi.mock("simple-git")

describe("git utilities", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getGitInfo", () => {
		it("should return default info for empty cwd", async () => {
			const result = await getGitInfo("")
			expect(result).toEqual({
				branch: null,
				isClean: true,
				isRepo: false,
			})
		})

		it("should return default info for non-git directory", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitInfo("/some/path")
			expect(result).toEqual({
				branch: null,
				isClean: true,
				isRepo: false,
			})
		})

		it("should return git info for clean repository", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("main\n"),
				status: vi.fn().mockResolvedValue({ files: [] }),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitInfo("/git/repo")
			expect(result).toEqual({
				branch: "main",
				isClean: true,
				isRepo: true,
			})
		})

		it("should return git info for dirty repository", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("feature-branch\n"),
				status: vi.fn().mockResolvedValue({
					files: [{ path: "file.txt", working_dir: "M" }],
				}),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitInfo("/git/repo")
			expect(result).toEqual({
				branch: "feature-branch",
				isClean: false,
				isRepo: true,
			})
		})

		it("should handle errors gracefully", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitInfo("/git/repo")
			expect(result).toEqual({
				branch: null,
				isClean: true,
				isRepo: false,
			})
		})
	})

	describe("getGitBranch", () => {
		it("should return null for empty cwd", async () => {
			const result = await getGitBranch("")
			expect(result).toBeNull()
		})

		it("should return null for non-git directory", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitBranch("/some/path")
			expect(result).toBeNull()
		})

		it("should return branch name", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("develop\n"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitBranch("/git/repo")
			expect(result).toBe("develop")
		})

		it("should handle errors gracefully", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await getGitBranch("/git/repo")
			expect(result).toBeNull()
		})
	})

	describe("branchExists", () => {
		it("should return false for empty cwd", async () => {
			const result = await branchExists("", "main")
			expect(result).toBe(false)
		})

		it("should return false for empty branchName", async () => {
			const result = await branchExists("/git/repo", "")
			expect(result).toBe(false)
		})

		it("should return false for non-git directory", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await branchExists("/some/path", "main")
			expect(result).toBe(false)
		})

		it("should return true when local branch exists", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				branch: vi.fn().mockResolvedValue({
					all: ["main", "develop", "feature-branch"],
				}),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await branchExists("/git/repo", "feature-branch")
			expect(result).toBe(true)
		})

		it("should return true when remote branch exists", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				branch: vi.fn().mockResolvedValue({
					all: ["main", "remotes/origin/feature-branch"],
				}),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await branchExists("/git/repo", "feature-branch")
			expect(result).toBe(true)
		})

		it("should return false when branch does not exist", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				branch: vi.fn().mockResolvedValue({
					all: ["main", "develop"],
				}),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await branchExists("/git/repo", "nonexistent")
			expect(result).toBe(false)
		})

		it("should handle errors gracefully", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await branchExists("/git/repo", "main")
			expect(result).toBe(false)
		})
	})

	describe("generateBranchName", () => {
		it("should generate branch name with lowercase and hyphens", () => {
			const result = generateBranchName("Fix Bug in Auth")
			expect(result).toMatch(/^fix-bug-in-auth-\d+$/)
		})

		it("should replace special characters with hyphens", () => {
			const result = generateBranchName("Feature: Add @user support!")
			expect(result).toMatch(/^feature-add-user-support-\d+$/)
		})

		it("should remove leading and trailing hyphens", () => {
			const result = generateBranchName("---test---")
			expect(result).toMatch(/^test-\d+$/)
		})

		it("should collapse multiple hyphens into one", () => {
			const result = generateBranchName("fix   multiple   spaces")
			expect(result).toMatch(/^fix-multiple-spaces-\d+$/)
		})

		it("should truncate to 50 characters", () => {
			const longPrompt = "a".repeat(100)
			const result = generateBranchName(longPrompt)
			const withoutTimestamp = result.split("-").slice(0, -1).join("-")
			expect(withoutTimestamp.length).toBeLessThanOrEqual(50)
		})

		it("should add timestamp for uniqueness", async () => {
			const prompt = "test feature"
			const result1 = generateBranchName(prompt)

			await new Promise((resolve) => setTimeout(resolve, 5))

			const result2 = generateBranchName(prompt)

			expect(result1).not.toBe(result2)
			expect(result1).toMatch(/^test-feature-\d+$/)
			expect(result2).toMatch(/^test-feature-\d+$/)
		})

		it("should handle empty string", () => {
			const result = generateBranchName("")
			expect(result).toMatch(/^kilo-\d+$/)
		})

		it("should handle only special characters", () => {
			const result = generateBranchName("!@#$%^&*()")
			expect(result).toMatch(/^kilo-\d+$/)
		})

		it("should handle unicode characters", () => {
			const result = generateBranchName("Add 日本語 support")
			expect(result).toMatch(/^add-support-\d+$/)
		})

		it("should handle mixed case properly", () => {
			const result = generateBranchName("FixBugInAuthSystem")
			expect(result).toMatch(/^fixbuginauthsystem-\d+$/)
		})
	})

	describe("isGitWorktree", () => {
		it("should return false for empty cwd", async () => {
			const result = await isGitWorktree("")
			expect(result).toBe(false)
		})

		it("should return false for non-git directory", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await isGitWorktree("/some/path")
			expect(result).toBe(false)
		})

		it("should return false for regular git repository", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue(".git\n"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await isGitWorktree("/git/repo")
			expect(result).toBe(false)
		})

		it("should return true for git worktree", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("/path/to/.git/worktrees/feature-branch\n"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await isGitWorktree("/git/worktree")
			expect(result).toBe(true)
		})

		it("should handle errors gracefully", async () => {
			const mockGit: Partial<SimpleGit> = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as SimpleGit)

			const result = await isGitWorktree("/git/repo")
			expect(result).toBe(false)
		})
	})
})
