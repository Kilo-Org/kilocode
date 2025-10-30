import { describe, it, expect, vi, beforeEach, Mock } from "vitest"
import * as path from "path"
import { spawnSync } from "child_process"
import { GitExtensionService } from "../GitExtensionService"

vi.mock("child_process")
vi.mock("vscode", () => ({
	window: { showInformationMessage: vi.fn() },
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
}))

vi.mock("../../core/ignore/RooIgnoreController", () => {
	const mockInstance = {
		initialize: vi.fn(),
		dispose: vi.fn(),
		validateAccess: vi.fn().mockReturnValue(true),
	}
	return {
		RooIgnoreController: vi.fn().mockImplementation(() => mockInstance),
	}
})

const mockSpawnSync = spawnSync as Mock

describe("GitExtensionService", () => {
	let service: GitExtensionService
	const mockWorkspaceRoot = "/test/workspace"

	beforeEach(() => {
		service = new GitExtensionService(mockWorkspaceRoot)
		mockSpawnSync.mockClear()
	})

	describe("gatherChanges", () => {
		it("should gather unstaged changes correctly", async () => {
			const mockStatusOutput = " M file1.ts\n A file2.ts\n D file3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["status", "--porcelain"], expect.any(Object))
			expect(result).toEqual([
				{ filePath: path.join(mockWorkspaceRoot, "file1.ts"), status: "M", staged: false },
				{ filePath: path.join(mockWorkspaceRoot, "file2.ts"), status: "A", staged: false },
				{ filePath: path.join(mockWorkspaceRoot, "file3.ts"), status: "D", staged: false },
			])
		})

		it("should gather staged changes correctly", async () => {
			const mockStatusOutput = "M\tfile1.ts\nA\tfile2.ts\nD\tfile3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: true })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["diff", "--name-status", "--cached"], expect.any(Object))
			expect(result).toEqual([
				{ filePath: path.join(mockWorkspaceRoot, "file1.ts"), status: "M", staged: true },
				{ filePath: path.join(mockWorkspaceRoot, "file2.ts"), status: "A", staged: true },
				{ filePath: path.join(mockWorkspaceRoot, "file3.ts"), status: "D", staged: true },
			])
		})

		it("should return empty array when no changes", async () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})

		it("should return empty array when git command fails", async () => {
			mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "error", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})

		it("should handle untracked files correctly", async () => {
			const mockStatusOutput = "?? newfile.ts\n M existingfile.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([
				{ filePath: path.join(mockWorkspaceRoot, "newfile.ts"), status: "?", staged: false },
				{ filePath: path.join(mockWorkspaceRoot, "existingfile.ts"), status: "M", staged: false },
			])
		})
	})

	describe("spawnGitWithArgs", () => {
		it("should execute git command successfully", () => {
			const mockOutput = "git output"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockOutput, stderr: "", error: null })

			const result = service.spawnGitWithArgs(["status"])

			expect(mockSpawnSync).toHaveBeenCalledWith(
				"git",
				["status"],
				expect.objectContaining({
					cwd: mockWorkspaceRoot,
					encoding: "utf8",
					stdio: ["ignore", "pipe", "pipe"],
				}),
			)
			expect(result).toBe(mockOutput)
		})

		it("should throw error when git command fails", () => {
			mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "error", error: null })

			expect(() => {
				service.spawnGitWithArgs(["status"])
			}).toThrow("Git command failed with status 1: error")
		})

		it("should throw error when spawn fails", () => {
			const spawnError = new Error("spawn failed")
			mockSpawnSync.mockReturnValue({ status: null, stdout: "", stderr: "", error: spawnError })

			expect(() => {
				service.spawnGitWithArgs(["status"])
			}).toThrow(spawnError)
		})
	})

	describe("getCommitContext", () => {
		it("should generate basic context structure", async () => {
			const mockChanges = [
				{ filePath: path.join(mockWorkspaceRoot, "file1.ts"), status: "M" as const, staged: true },
			]

			const result = await service.getCommitContext(mockChanges, { staged: true, includeRepoContext: false })

			expect(result).toContain("## Git Context for Commit Message Generation")
			expect(result).toContain("### Change Summary")
			expect(result).toContain("Modified (staged): file1.ts")
		})

		it("should handle empty changes gracefully", async () => {
			const result = await service.getCommitContext([], { staged: true, includeRepoContext: false })

			expect(result).toContain("## Git Context for Commit Message Generation")
			expect(result).toContain("(No changes matched selection)")
		})
	})
})
