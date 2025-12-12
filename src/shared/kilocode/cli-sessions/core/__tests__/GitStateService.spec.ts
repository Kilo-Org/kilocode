import { createHash } from "crypto"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import simpleGit from "simple-git"
import { GitStateService } from "../GitStateService"
import { LOG_SOURCES } from "../../config.js"

// Mock external dependencies
vi.mock("crypto")
vi.mock("fs")
vi.mock("os")
vi.mock("path")
vi.mock("simple-git")

// Mock the logger
const mockLogger = {
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
}

// Mock getWorkspaceDir function
const mockGetWorkspaceDir = vi.fn()

describe("GitStateService", () => {
	let service: GitStateService

	beforeEach(() => {
		vi.clearAllMocks()

		// Reset mocks
		mockGetWorkspaceDir.mockReturnValue("/mock/workspace")

		service = new GitStateService(
			{
				logger: mockLogger,
				getWorkspaceDir: mockGetWorkspaceDir,
			},
			{
				maxPatchSizeBytes: 1024 * 1024, // 1MB for tests
			},
		)
	})

	describe("hashGitState", () => {
		const mockCreateHash = vi.mocked(createHash)

		beforeEach(() => {
			mockCreateHash.mockReturnValue({
				update: vi.fn().mockReturnThis(),
				digest: vi.fn().mockReturnValue("mocked-hash"),
			} as any)
		})

		it("returns consistent hash for same input", () => {
			const gitState = { head: "abc123", patch: "diff content", branch: "main" }

			const hash1 = service.hashGitState(gitState)
			const hash2 = service.hashGitState(gitState)

			expect(hash1).toBe("mocked-hash")
			expect(hash2).toBe("mocked-hash")
			expect(mockCreateHash).toHaveBeenCalledTimes(2)
			expect(mockCreateHash).toHaveBeenCalledWith("sha256")
		})

		it("returns different hash for different input", () => {
			const state1 = { head: "abc123", patch: "diff1", branch: "main" }
			const state2 = { head: "def456", patch: "diff2", branch: "develop" }

			service.hashGitState(state1)
			service.hashGitState(state2)

			expect(mockCreateHash).toHaveBeenCalledTimes(2)
			// Each call should create a new hash instance
		})

		it("handles empty patch", () => {
			const gitState = { head: "abc123", patch: "", branch: "main" }

			service.hashGitState(gitState)

			expect(mockCreateHash).toHaveBeenCalledWith("sha256")
		})

		it("handles undefined branch", () => {
			const gitState = { head: "abc123", patch: "diff content", branch: undefined }

			service.hashGitState(gitState)

			expect(mockCreateHash).toHaveBeenCalledWith("sha256")
		})
	})

	describe("getGitState", () => {
		const mockSimpleGit = vi.mocked(simpleGit)

		beforeEach(() => {
			mockSimpleGit.mockReturnValue({
				getRemotes: vi.fn(),
				revparse: vi.fn(),
				raw: vi.fn(),
				diff: vi.fn(),
				reset: vi.fn(),
			} as any)
		})

		it("returns null when not in git repository", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockRejectedValue(new Error("not a git repository")),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result).toBeNull()
			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to get git state",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("returns git state with repo URL, head, branch, and patch", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: {
							fetch: "https://github.com/user/repo.git",
							push: "https://github.com/user/repo.git",
						},
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi
					.fn()
					.mockResolvedValueOnce("refs/heads/main") // symbolic-ref
					.mockResolvedValueOnce(""), // ls-files
				diff: vi.fn().mockResolvedValue("diff content"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result).toEqual({
				repoUrl: "https://github.com/user/repo.git",
				head: "abc123def",
				branch: "main",
				patch: "diff content",
			})
		})

		it("handles missing remote URL", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("refs/heads/main"),
				diff: vi.fn().mockResolvedValue("diff content"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result?.repoUrl).toBeUndefined()
		})

		it("handles detached HEAD - no branch", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi.fn().mockResolvedValueOnce("").mockRejectedValueOnce(new Error("not a symbolic ref")), // symbolic-ref fails
				diff: vi.fn().mockResolvedValue("diff content"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result?.branch).toBeUndefined()
		})

		it("includes untracked files in patch", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi
					.fn()
					.mockResolvedValueOnce("refs/heads/main") // symbolic-ref
					.mockResolvedValueOnce("file1.txt\nfile2.txt") // ls-files
					.mockResolvedValueOnce(undefined) // add
					.mockResolvedValueOnce(undefined), // reset
				diff: vi.fn().mockResolvedValue("diff content"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockGit.raw).toHaveBeenCalledWith(["add", "--intent-to-add", "--", "file1.txt", "file2.txt"])
		})

		it("resets untracked files after getting patch", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi
					.fn()
					.mockResolvedValueOnce("refs/heads/main") // symbolic-ref
					.mockResolvedValueOnce("file1.txt") // ls-files
					.mockResolvedValueOnce(undefined) // add
					.mockResolvedValueOnce(undefined), // reset
				diff: vi.fn().mockResolvedValue("diff content"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockGit.raw).toHaveBeenCalledWith(["reset", "HEAD", "--", "file1.txt"])
		})

		it("handles first commit - empty tree diff", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi
					.fn()
					.mockResolvedValueOnce("refs/heads/main") // symbolic-ref
					.mockResolvedValueOnce("") // ls-files
					.mockResolvedValueOnce("abc123def ") // rev-list --parents (first commit)
					.mockResolvedValueOnce("4b825dc642cb6eb9a060e54bf8d69288fbee4904"), // hash-object empty tree
				diff: vi
					.fn()
					.mockResolvedValueOnce("") // HEAD diff is empty
					.mockResolvedValueOnce("empty tree diff content"), // empty tree diff
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result?.patch).toBe("empty tree diff content")
		})

		it("returns empty patch when patch exceeds max size", async () => {
			const largePatch = "x".repeat(1024 * 1024 + 1) // Larger than 1MB limit

			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("refs/heads/main"),
				diff: vi.fn().mockResolvedValue(largePatch),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			const result = await service.getGitState()

			expect(result?.patch).toBe("")
			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Git patch too large",
				LOG_SOURCES.GIT_STATE,
				expect.objectContaining({
					patchSize: largePatch.length,
					maxSize: 1024 * 1024,
				}),
			)
		})

		it("logs warning when patch too large", async () => {
			const largePatch = "x".repeat(2000000)

			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([
					{
						name: "origin",
						refs: { fetch: "https://github.com/user/repo.git" },
					},
				]),
				revparse: vi.fn().mockResolvedValue("abc123def"),
				raw: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("refs/heads/main"),
				diff: vi.fn().mockResolvedValue(largePatch),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Git patch too large",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("logs error on failure", async () => {
			const mockGit = {
				getRemotes: vi.fn().mockRejectedValue(new Error("git error")),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockLogger.error).toHaveBeenCalledWith(
				"Failed to get git state",
				LOG_SOURCES.GIT_STATE,
				expect.objectContaining({
					error: "git error",
				}),
			)
		})

		it("uses workspace dir from getWorkspaceDir", async () => {
			mockGetWorkspaceDir.mockReturnValue("/custom/workspace")

			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([]),
				revparse: vi.fn().mockResolvedValue("abc123"),
				raw: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("refs/heads/main"),
				diff: vi.fn().mockResolvedValue("diff"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockSimpleGit).toHaveBeenCalledWith("/custom/workspace")
		})

		it("falls back to process.cwd when no workspace dir", async () => {
			mockGetWorkspaceDir.mockReturnValue(null)

			const mockGit = {
				getRemotes: vi.fn().mockResolvedValue([]),
				revparse: vi.fn().mockResolvedValue("abc123"),
				raw: vi.fn().mockResolvedValueOnce("").mockResolvedValueOnce("refs/heads/main"),
				diff: vi.fn().mockResolvedValue("diff"),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.getGitState()

			expect(mockSimpleGit).toHaveBeenCalledWith(process.cwd())
		})
	})

	describe("executeGitRestore", () => {
		const mockSimpleGit = vi.mocked(simpleGit)
		const mockMkdtempSync = vi.mocked(mkdtempSync)
		const mockWriteFileSync = vi.mocked(writeFileSync)
		const mockRmSync = vi.mocked(rmSync)
		const mockTmpdir = vi.mocked(tmpdir)
		const mockPathJoin = vi.mocked(path.join)

		beforeEach(() => {
			mockTmpdir.mockReturnValue("/tmp")
			mockPathJoin.mockReturnValue("/tmp/kilocode-git-patches/123.patch")
			mockMkdtempSync.mockReturnValue("/tmp/kilocode-git-patches")
		})

		it("stashes current work before restore", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValue({ total: 0 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockStash).toHaveBeenCalledWith()
		})

		it("does not pop stash if nothing was stashed", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi
					.fn()
					.mockResolvedValueOnce({ total: 0 }) // before
					.mockResolvedValueOnce({ total: 0 }), // after
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.stashList).toHaveBeenCalledTimes(2)
			expect(mockStash).not.toHaveBeenCalledWith(["pop"])
		})

		it("checks out to target branch when branch matches head", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValueOnce("current-head").mockResolvedValueOnce("target-head"), // branch commit
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.checkout).toHaveBeenCalledWith("main")
		})

		it("checks out to commit when branch has moved", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValueOnce("current-head").mockResolvedValueOnce("different-head"), // branch points elsewhere
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.checkout).toHaveBeenCalledWith("target-head")
		})

		it("checks out to commit when branch not found", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi
					.fn()
					.mockResolvedValueOnce("current-head")
					.mockRejectedValueOnce(new Error("branch not found")), // revparse fails
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.checkout).toHaveBeenCalledWith("target-head")
		})

		it("skips checkout when already at target commit", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("target-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.checkout).not.toHaveBeenCalled()
			expect(mockLogger.debug).toHaveBeenCalledWith(
				"Already at target commit, skipping checkout",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("applies patch from temp file", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockWriteFileSync).toHaveBeenCalledWith("/tmp/kilocode-git-patches/123.patch", "patch content")
			expect(mockGit.applyPatch).toHaveBeenCalledWith("/tmp/kilocode-git-patches/123.patch")
		})

		it("cleans up temp file after patch", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockRmSync).toHaveBeenCalledWith("/tmp/kilocode-git-patches", {
				recursive: true,
				force: true,
			})
		})

		it("pops stash after restore", async () => {
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: vi
					.fn()
					.mockResolvedValueOnce(undefined) // stash
					.mockResolvedValueOnce(undefined), // pop
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockGit.stash).toHaveBeenCalledWith(["pop"])
		})

		it("logs appropriate messages throughout", async () => {
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined),
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockLogger.debug).toHaveBeenCalledWith("Stashed current work", LOG_SOURCES.GIT_STATE)
			expect(mockLogger.debug).toHaveBeenCalledWith("Applied patch", LOG_SOURCES.GIT_STATE, expect.any(Object))
			expect(mockLogger.debug).toHaveBeenCalledWith("Popped stash", LOG_SOURCES.GIT_STATE)
			expect(mockLogger.info).toHaveBeenCalledWith(
				"Git state restoration finished",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("handles stash failure gracefully", async () => {
			const mockGit = {
				stashList: vi.fn().mockRejectedValue(new Error("stash failed")),
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
				stash: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to stash current work",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("handles checkout failure gracefully", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn().mockRejectedValue(new Error("checkout failed")),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to checkout",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("handles patch failure gracefully", async () => {
			const mockStash = vi.fn().mockResolvedValue(undefined)
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: mockStash,
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn().mockRejectedValue(new Error("patch failed")),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to apply patch",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})

		it("handles stash pop failure gracefully", async () => {
			const mockGit = {
				stashList: vi.fn().mockResolvedValueOnce({ total: 0 }).mockResolvedValueOnce({ total: 1 }),
				stash: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("pop failed")),
				revparse: vi.fn().mockResolvedValue("current-head"),
				checkout: vi.fn(),
				applyPatch: vi.fn(),
			}
			mockSimpleGit.mockReturnValue(mockGit as any)

			await service.executeGitRestore({
				head: "target-head",
				patch: "patch content",
				branch: "main",
			})

			expect(mockLogger.warn).toHaveBeenCalledWith(
				"Failed to pop stash",
				LOG_SOURCES.GIT_STATE,
				expect.any(Object),
			)
		})
	})

	describe("Configuration", () => {
		it("uses default max patch size", () => {
			const defaultService = new GitStateService({
				logger: mockLogger,
				getWorkspaceDir: mockGetWorkspaceDir,
			})

			// Access private property for testing
			expect((defaultService as any).maxPatchSizeBytes).toBe(5 * 1024 * 1024) // 5MB
		})

		it("accepts custom max patch size", () => {
			const customSize = 2 * 1024 * 1024 // 2MB
			const customService = new GitStateService(
				{
					logger: mockLogger,
					getWorkspaceDir: mockGetWorkspaceDir,
				},
				{
					maxPatchSizeBytes: customSize,
				},
			)

			expect((customService as any).maxPatchSizeBytes).toBe(customSize)
		})
	})
})
