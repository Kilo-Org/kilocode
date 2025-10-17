/**
 * Tests for git utilities
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGitInfo, getGitBranch } from "../git.js"
import simpleGit from "simple-git"

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
			const mockGit = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitInfo("/some/path")
			expect(result).toEqual({
				branch: null,
				isClean: true,
				isRepo: false,
			})
		})

		it("should return git info for clean repository", async () => {
			const mockGit = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("main\n"),
				status: vi.fn().mockResolvedValue({ files: [] }),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitInfo("/git/repo")
			expect(result).toEqual({
				branch: "main",
				isClean: true,
				isRepo: true,
			})
		})

		it("should return git info for dirty repository", async () => {
			const mockGit = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("feature-branch\n"),
				status: vi.fn().mockResolvedValue({
					files: [{ path: "file.txt", working_dir: "M" }],
				}),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitInfo("/git/repo")
			expect(result).toEqual({
				branch: "feature-branch",
				isClean: false,
				isRepo: true,
			})
		})

		it("should handle errors gracefully", async () => {
			const mockGit = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

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
			const mockGit = {
				checkIsRepo: vi.fn().mockResolvedValue(false),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitBranch("/some/path")
			expect(result).toBeNull()
		})

		it("should return branch name", async () => {
			const mockGit = {
				checkIsRepo: vi.fn().mockResolvedValue(true),
				revparse: vi.fn().mockResolvedValue("develop\n"),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitBranch("/git/repo")
			expect(result).toBe("develop")
		})

		it("should handle errors gracefully", async () => {
			const mockGit = {
				checkIsRepo: vi.fn().mockRejectedValue(new Error("Git error")),
			}
			vi.mocked(simpleGit).mockReturnValue(mockGit as any)

			const result = await getGitBranch("/git/repo")
			expect(result).toBeNull()
		})
	})
})
