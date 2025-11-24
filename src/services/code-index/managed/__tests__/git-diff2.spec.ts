// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGitDiff2 } from "../git-utils"
import { GitDiffFile } from "../types"
import * as exec from "../../../../shared/utils/exec"

vi.mock("../../../../shared/utils/exec")

describe("getGitDiff2", () => {
	const mockExecGetLines = vi.mocked(exec.execGetLines)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should stream git diff output as GitDiffFile objects", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123def456"
		})

		// Mock diff command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "A\tsrc/new-file.ts"
			yield "M\tsrc/existing-file.ts"
			yield "D\tsrc/old-file.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature-branch", "main", "/test/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([
			{ type: "added", filePath: "src/new-file.ts" },
			{ type: "modified", filePath: "src/existing-file.ts" },
			{ type: "deleted", filePath: "src/old-file.ts" },
		])

		// Verify commands were called correctly
		expect(mockExecGetLines).toHaveBeenCalledTimes(2)
		expect(mockExecGetLines).toHaveBeenNthCalledWith(1, {
			cmd: "git merge-base main feature-branch",
			cwd: "/test/workspace",
			context: "getting merge base",
		})
		expect(mockExecGetLines).toHaveBeenNthCalledWith(2, {
			cmd: "git diff --name-status abc123def456..feature-branch",
			cwd: "/test/workspace",
			context: "getting git diff",
		})
	})

	it("should filter out empty lines", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123"
		})

		// Mock diff command with empty lines
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "A\tfile1.ts"
			yield ""
			yield "   "
			yield "M\tfile2.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([
			{ type: "added", filePath: "file1.ts" },
			{ type: "modified", filePath: "file2.ts" },
		])
	})

	it("should handle renamed files as delete + add", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "base123"
		})

		// Mock diff command with rename
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "R100\told-name.ts\tnew-name.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([
			{ type: "deleted", filePath: "old-name.ts" },
			{ type: "added", filePath: "new-name.ts" },
		])
	})

	it("should handle copied files as add", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "base456"
		})

		// Mock diff command with copy
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "C100\toriginal.ts\tcopy.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([{ type: "added", filePath: "copy.ts" }])
	})

	it("should throw error if merge-base fails", async () => {
		// eslint-disable-next-line require-yield
		mockExecGetLines.mockImplementationOnce(async function* (): AsyncGenerator<string> {
			throw new Error("Not a git repository")
		})

		await expect(async () => {
			for await (const _line of getGitDiff2("feature", "main", "/workspace")) {
				// Should not reach here
			}
		}).rejects.toThrow("Failed to get git diff between feature and main")
	})

	it("should throw error if diff command fails", async () => {
		// Mock successful merge-base
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123"
		})

		// Mock failing diff command
		// eslint-disable-next-line require-yield
		mockExecGetLines.mockImplementationOnce(async function* (): AsyncGenerator<string> {
			throw new Error("Invalid branch name")
		})

		await expect(async () => {
			for await (const _line of getGitDiff2("feature", "main", "/workspace")) {
				// Should not reach here
			}
		}).rejects.toThrow("Failed to get git diff between feature and main")
	})

	it("should handle empty diff output", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123"
		})

		// Mock empty diff (no changes)
		mockExecGetLines.mockImplementationOnce(async function* () {
			// No lines yielded
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([])
	})

	it("should stream large diffs efficiently", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "base789"
		})

		// Mock large diff output
		const largeFileCount = 1000
		mockExecGetLines.mockImplementationOnce(async function* () {
			for (let i = 0; i < largeFileCount; i++) {
				yield `M\tfile${i}.ts`
			}
		})

		let count = 0
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			expect(file.type).toBe("modified")
			expect(file.filePath).toMatch(/^file\d+\.ts$/)
			count++
		}

		expect(count).toBe(largeFileCount)
	})

	it("should handle file paths with tabs", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123"
		})

		// Mock diff with file path containing tabs
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "M\tpath\twith\ttabs.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([{ type: "modified", filePath: "path\twith\ttabs.ts" }])
	})

	it("should ignore unknown status codes", async () => {
		// Mock merge-base command
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "abc123"
		})

		// Mock diff with unknown status codes
		mockExecGetLines.mockImplementationOnce(async function* () {
			yield "A\tfile1.ts"
			yield "T\ttype-changed.ts" // Type change - should be ignored
			yield "U\tunmerged.ts" // Unmerged - should be ignored
			yield "M\tfile2.ts"
		})

		const files: GitDiffFile[] = []
		for await (const file of getGitDiff2("feature", "main", "/workspace")) {
			files.push(file)
		}

		expect(files).toEqual([
			{ type: "added", filePath: "file1.ts" },
			{ type: "modified", filePath: "file2.ts" },
		])
	})
})
