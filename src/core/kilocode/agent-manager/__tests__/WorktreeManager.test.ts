import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"
import * as fs from "fs"

// Helper to check paths cross-platform (handles both / and \ separators)
const containsPathSegments = (fullPath: string, ...segments: string[]): boolean => {
	const normalized = fullPath.replace(/\\/g, "/")
	return segments.every((seg) => normalized.includes(seg))
}

// Mock simple-git
const mockGit = {
	checkIsRepo: vi.fn(),
	raw: vi.fn(),
	revparse: vi.fn(),
	branch: vi.fn(),
	status: vi.fn(),
	add: vi.fn(),
	commit: vi.fn(),
	diff: vi.fn(),
}

vi.mock("simple-git", () => ({
	default: vi.fn(() => mockGit),
}))

// Mock fs using importOriginal
vi.mock("fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("fs")>()
	return {
		...actual,
		default: {
			...actual,
			existsSync: vi.fn(),
			promises: {
				...actual.promises,
				mkdir: vi.fn(),
				readFile: vi.fn(),
				writeFile: vi.fn(),
				appendFile: vi.fn(),
				rm: vi.fn(),
				readdir: vi.fn(),
				stat: vi.fn(),
				unlink: vi.fn(),
			},
		},
		existsSync: vi.fn(),
		promises: {
			mkdir: vi.fn(),
			readFile: vi.fn(),
			writeFile: vi.fn(),
			appendFile: vi.fn(),
			rm: vi.fn(),
			readdir: vi.fn(),
			stat: vi.fn(),
			unlink: vi.fn(),
		},
	}
})

// Mock vscode
vi.mock("vscode", () => ({
	default: {},
}))

import { WorktreeManager, WorktreeError, generateBranchName } from "../WorktreeManager"

describe("WorktreeManager", () => {
	const projectRoot = "/test/project"
	const mockOutputChannel = {
		appendLine: vi.fn(),
	}

	let manager: WorktreeManager

	beforeEach(() => {
		vi.clearAllMocks()
		manager = new WorktreeManager(projectRoot, mockOutputChannel as any)
	})

	describe("createWorktree", () => {
		it("throws if workspace is not a git repo", async () => {
			mockGit.checkIsRepo.mockResolvedValue(false)

			await expect(manager.createWorktree({ prompt: "test" })).rejects.toThrow(WorktreeError)
			await expect(manager.createWorktree({ prompt: "test" })).rejects.toThrow("not a git repository")
		})

		it("creates worktree with generated branch name from prompt", async () => {
			mockGit.checkIsRepo.mockResolvedValue(true)
			mockGit.revparse.mockResolvedValue("main")
			mockGit.raw.mockResolvedValue("")
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				// .git directory exists
				return normalized.endsWith(".git")
			})
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			const result = await manager.createWorktree({ prompt: "Add authentication" })

			expect(result.branch).toMatch(/^add-authentication-\d+$/)
			expect(containsPathSegments(result.path, ".kilocode", "worktrees")).toBe(true)
			expect(result.parentBranch).toBe("main")
		})

		it("uses existing branch when provided", async () => {
			mockGit.checkIsRepo.mockResolvedValue(true)
			mockGit.revparse.mockResolvedValue("main")
			mockGit.branch.mockResolvedValue({ all: ["feature/existing-branch"] })
			mockGit.raw.mockResolvedValue("")
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				return normalized.endsWith(".git")
			})
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			const result = await manager.createWorktree({ existingBranch: "feature/existing-branch" })

			expect(result.branch).toBe("feature/existing-branch")
			// Check the git raw call - path may use / or \ depending on OS
			expect(mockGit.raw).toHaveBeenCalledWith(
				expect.arrayContaining(["worktree", "add", "feature/existing-branch"]),
			)
		})

		it("throws if existing branch does not exist", async () => {
			mockGit.checkIsRepo.mockResolvedValue(true)
			mockGit.revparse.mockResolvedValue("main")
			mockGit.branch.mockResolvedValue({ all: [] })
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				return normalized.endsWith(".git")
			})
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("")

			await expect(manager.createWorktree({ existingBranch: "nonexistent" })).rejects.toThrow(WorktreeError)
			await expect(manager.createWorktree({ existingBranch: "nonexistent" })).rejects.toThrow("does not exist")
		})

		it("removes existing worktree directory before creating", async () => {
			mockGit.checkIsRepo.mockResolvedValue(true)
			mockGit.revparse.mockResolvedValue("main")
			mockGit.raw.mockResolvedValue("")
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				// .git exists, worktree path exists
				return normalized.endsWith(".git") || normalized.includes(".kilocode/worktrees")
			})
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.rm).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue(".kilocode/worktrees/")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.createWorktree({ prompt: "test" })

			// Verify rm was called - path separators vary by OS
			expect(fs.promises.rm).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ recursive: true, force: true }),
			)
			// Verify the path contains the expected segments
			const rmCall = vi.mocked(fs.promises.rm).mock.calls[0]
			expect(containsPathSegments(String(rmCall[0]), ".kilocode", "worktrees")).toBe(true)
		})
	})

	describe("stageAllChanges", () => {
		it("returns false when no changes", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => true })

			const result = await manager.stageAllChanges("/worktree/path")

			expect(result).toBe(false)
		})

		it("stages changes and returns true", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => false })
			mockGit.add.mockResolvedValue(undefined)
			mockGit.diff.mockResolvedValue("some diff content")

			const result = await manager.stageAllChanges("/worktree/path")

			expect(result).toBe(true)
			expect(mockGit.add).toHaveBeenCalledWith("-A")
		})
	})

	describe("commitChanges", () => {
		it("skips commit when no changes", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => true })

			const result = await manager.commitChanges("/worktree/path")

			expect(result.success).toBe(true)
			expect(result.skipped).toBe(true)
			expect(result.reason).toBe("no_changes")
		})

		it("commits all changes with default message", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => false })
			mockGit.add.mockResolvedValue(undefined)
			mockGit.diff.mockResolvedValue("some diff content")
			mockGit.commit.mockResolvedValue(undefined)

			const result = await manager.commitChanges("/worktree/path")

			expect(result.success).toBe(true)
			expect(result.skipped).toBe(false)
			expect(mockGit.add).toHaveBeenCalledWith("-A")
			expect(mockGit.commit).toHaveBeenCalledWith("chore: parallel mode task completion")
		})

		it("uses custom commit message when provided", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => false })
			mockGit.add.mockResolvedValue(undefined)
			mockGit.diff.mockResolvedValue("some diff content")
			mockGit.commit.mockResolvedValue(undefined)

			await manager.commitChanges("/worktree/path", "feat: add auth")

			expect(mockGit.commit).toHaveBeenCalledWith("feat: add auth")
		})

		it("returns error on commit failure", async () => {
			mockGit.status.mockResolvedValue({ isClean: () => false })
			mockGit.add.mockResolvedValue(undefined)
			mockGit.diff.mockResolvedValue("some diff content")
			mockGit.commit.mockRejectedValue(new Error("commit failed"))

			const result = await manager.commitChanges("/worktree/path")

			expect(result.success).toBe(false)
			expect(result.error).toBe("commit failed")
		})
	})

	describe("removeWorktree", () => {
		it("removes worktree normally", async () => {
			mockGit.raw.mockResolvedValue("")

			await manager.removeWorktree("/worktree/path")

			expect(mockGit.raw).toHaveBeenCalledWith(["worktree", "remove", "/worktree/path"])
		})

		it("force removes worktree on failure", async () => {
			mockGit.raw.mockRejectedValueOnce(new Error("worktree has changes")).mockResolvedValueOnce("")

			await manager.removeWorktree("/worktree/path")

			expect(mockGit.raw).toHaveBeenCalledWith(["worktree", "remove", "--force", "/worktree/path"])
		})
	})

	describe("discoverWorktrees", () => {
		it("returns empty array when worktrees dir does not exist", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const result = await manager.discoverWorktrees()

			expect(result).toEqual([])
		})

		it("discovers valid worktrees", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "feature-branch", isDirectory: () => true },
			] as any)
			vi.mocked(fs.promises.stat).mockResolvedValue({
				isFile: () => true,
				birthtimeMs: 1234567890,
			} as any)
			mockGit.revparse.mockResolvedValue("feature-branch\n")
			mockGit.branch.mockResolvedValue({ all: ["main"] })

			const result = await manager.discoverWorktrees()

			expect(result).toHaveLength(1)
			expect(result[0].branch).toBe("feature-branch")
		})
	})

	describe("ensureGitExclude", () => {
		it("adds exclude entry when not present", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.readFile).mockResolvedValue("# existing excludes\n")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.ensureGitExclude()

			expect(fs.promises.appendFile).toHaveBeenCalledWith(
				path.join(projectRoot, ".git", "info", "exclude"),
				expect.stringContaining(".kilocode/worktrees/"),
			)
		})

		it("skips adding entry when already present", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.readFile).mockResolvedValue(".kilocode/worktrees/\n")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.ensureGitExclude()

			expect(fs.promises.appendFile).not.toHaveBeenCalled()
		})

		it("creates info directory if it does not exist", async () => {
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				// .git exists, but info directory does not
				return normalized.endsWith(".git")
			})
			vi.mocked(fs.promises.stat).mockResolvedValue({ isDirectory: () => true, isFile: () => false } as any)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.ensureGitExclude()

			expect(fs.promises.mkdir).toHaveBeenCalledWith(
				path.join(projectRoot, ".git", "info"),
				expect.objectContaining({ recursive: true }),
			)
		})

		it("resolves main .git directory when in a worktree", async () => {
			const mainRepoGitDir = "/main/repo/.git"
			const worktreeGitDir = `${mainRepoGitDir}/worktrees/my-worktree`

			vi.mocked(fs.existsSync).mockReturnValue(true)
			// .git is a file (worktree marker)
			vi.mocked(fs.promises.stat).mockResolvedValueOnce({ isDirectory: () => false, isFile: () => true } as any)
			// Return gitdir content for worktree
			vi.mocked(fs.promises.readFile).mockResolvedValueOnce(`gitdir: ${worktreeGitDir}\n`)
			// Return existing exclude content
			vi.mocked(fs.promises.readFile).mockResolvedValueOnce("")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.ensureGitExclude()

			// Should write to main repo's .git/info/exclude, not the worktree's
			expect(fs.promises.appendFile).toHaveBeenCalledWith(
				expect.stringContaining(path.join(mainRepoGitDir, "info", "exclude")),
				expect.stringContaining(".kilocode/worktrees/"),
			)
		})
	})

	describe("writeSessionId", () => {
		it("creates .kilocode directory and writes session ID file", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("gitdir: /main/.git/worktrees/test\n")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.writeSessionId("/worktree/path", "session-123")

			expect(fs.promises.mkdir).toHaveBeenCalledWith(
				path.join("/worktree/path", ".kilocode"),
				expect.objectContaining({ recursive: true }),
			)
			expect(fs.promises.writeFile).toHaveBeenCalledWith(
				path.join("/worktree/path", ".kilocode", "session-id"),
				"session-123",
				"utf-8",
			)
		})

		it("skips mkdir for .kilocode if directory already exists", async () => {
			vi.mocked(fs.existsSync).mockImplementation((p) => {
				const normalized = String(p).replace(/\\/g, "/")
				// .kilocode exists, but git info dir doesn't
				return normalized.endsWith(".kilocode")
			})
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("gitdir: /main/.git/worktrees/test\n")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)

			await manager.writeSessionId("/worktree/path", "session-456")

			// mkdir should only be called for git info dir, not for .kilocode
			const mkdirCalls = vi.mocked(fs.promises.mkdir).mock.calls
			const kilocodeMkdirCalls = mkdirCalls.filter(
				(call) =>
					String(call[0]).replace(/\\/g, "/").includes(".kilocode") &&
					!String(call[0]).replace(/\\/g, "/").includes(".git"),
			)
			expect(kilocodeMkdirCalls).toHaveLength(0)

			expect(fs.promises.writeFile).toHaveBeenCalledWith(
				path.join("/worktree/path", ".kilocode", "session-id"),
				"session-456",
				"utf-8",
			)
		})

		it("ensures .kilocode/ is excluded from git in the worktree", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined)
			vi.mocked(fs.promises.readFile).mockResolvedValue("gitdir: /main/.git/worktrees/test\n")
			vi.mocked(fs.promises.appendFile).mockResolvedValue(undefined)

			await manager.writeSessionId("/worktree/path", "session-789")

			// Should have appended .kilocode/ to the worktree's git exclude
			expect(fs.promises.appendFile).toHaveBeenCalledWith(
				expect.stringContaining("exclude"),
				expect.stringContaining(".kilocode/"),
			)
		})
	})

	describe("readSessionId", () => {
		it("returns session ID when file exists", async () => {
			vi.mocked(fs.promises.readFile).mockResolvedValue("session-123\n")

			const result = await manager.readSessionId("/worktree/path")

			expect(result).toBe("session-123")
			expect(fs.promises.readFile).toHaveBeenCalledWith(
				path.join("/worktree/path", ".kilocode", "session-id"),
				"utf-8",
			)
		})

		it("returns undefined when file does not exist", async () => {
			vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("ENOENT"))

			const result = await manager.readSessionId("/worktree/path")

			expect(result).toBeUndefined()
		})

		it("trims whitespace from session ID", async () => {
			vi.mocked(fs.promises.readFile).mockResolvedValue("  session-456  \n")

			const result = await manager.readSessionId("/worktree/path")

			expect(result).toBe("session-456")
		})
	})

	describe("removeSessionId", () => {
		it("removes session ID file when it exists", async () => {
			vi.mocked(fs.promises.unlink).mockResolvedValue(undefined)

			await manager.removeSessionId("/worktree/path")

			expect(fs.promises.unlink).toHaveBeenCalledWith(path.join("/worktree/path", ".kilocode", "session-id"))
		})

		it("does not throw when file does not exist", async () => {
			vi.mocked(fs.promises.unlink).mockRejectedValue(new Error("ENOENT"))

			await expect(manager.removeSessionId("/worktree/path")).resolves.not.toThrow()
		})
	})

	describe("discoverWorktrees with sessionId", () => {
		it("includes sessionId in discovered worktree info", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "feature-branch", isDirectory: () => true },
			] as any)
			vi.mocked(fs.promises.stat).mockResolvedValue({
				isFile: () => true,
				birthtimeMs: 1234567890,
			} as any)
			vi.mocked(fs.promises.readFile).mockResolvedValue("session-abc-123")
			mockGit.revparse.mockResolvedValue("feature-branch\n")
			mockGit.branch.mockResolvedValue({ all: ["main"] })

			const result = await manager.discoverWorktrees()

			expect(result).toHaveLength(1)
			expect(result[0].sessionId).toBe("session-abc-123")
		})

		it("returns undefined sessionId when session-id file does not exist", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.promises.readdir).mockResolvedValue([
				{ name: "feature-branch", isDirectory: () => true },
			] as any)
			vi.mocked(fs.promises.stat).mockResolvedValue({
				isFile: () => true,
				birthtimeMs: 1234567890,
			} as any)
			// First call for .git file check, second for session-id (fails)
			vi.mocked(fs.promises.readFile).mockRejectedValue(new Error("ENOENT"))
			mockGit.revparse.mockResolvedValue("feature-branch\n")
			mockGit.branch.mockResolvedValue({ all: ["main"] })

			const result = await manager.discoverWorktrees()

			expect(result).toHaveLength(1)
			expect(result[0].sessionId).toBeUndefined()
		})
	})
})

describe("generateBranchName", () => {
	it("sanitizes prompt to valid branch name", () => {
		const result = generateBranchName("Add User Authentication!!")
		expect(result).toMatch(/^add-user-authentication-\d+$/)
	})

	it("truncates long prompts", () => {
		const longPrompt = "A".repeat(100)
		const result = generateBranchName(longPrompt)
		// Branch name should be truncated (50 chars max from prompt)
		expect(result.length).toBeLessThan(70)
	})

	it("handles special characters", () => {
		const result = generateBranchName("Fix bug #123 & add feature!")
		expect(result).toMatch(/^fix-bug-123-add-feature-\d+$/)
	})

	it("handles empty prompt", () => {
		const result = generateBranchName("")
		expect(result).toMatch(/^kilo-\d+$/)
	})
})
