// kilocode_change - new file
// npx vitest services/commit-message/__tests__/GitExtensionService.spec.ts
import { spawnSync } from "child_process"
import * as path from "path"
import type { Mock } from "vitest"
import { GitExtensionService } from "../GitExtensionService"

vi.mock("child_process", () => ({
	spawnSync: vi.fn(),
}))

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	extensions: {
		getExtension: vi.fn(() => ({
			isActive: true,
			exports: {
				getAPI: vi.fn(() => ({
					repositories: [
						{
							rootUri: { fsPath: "/test/workspace" },
							inputBox: { value: "" },
						},
					],
				})),
			},
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
	},
	window: { showInformationMessage: vi.fn() },
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
}))

const mockSpawnSync = spawnSync as Mock

describe("GitExtensionService", () => {
	let service: GitExtensionService
	const mockWorkspaceRoot = "/test/workspace"

	beforeEach(() => {
		service = new GitExtensionService(mockWorkspaceRoot)
		mockSpawnSync.mockClear()
	})

	describe("getDiffForChanges", () => {
		it("should generate diffs per file and exclude files properly for staged changes", async () => {
			const stagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
			const mockFileListOutput = stagedFiles.join("\n")

			const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
			const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: testTsDiff, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: utilsTsDiff, stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				1,
				"git",
				["diff", "--name-only", "--cached"],
				expect.any(Object),
			)

			// Should call git diff for non-excluded files only
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				2,
				"git",
				["diff", "--cached", "--", "src/test.ts"],
				expect.any(Object),
			)
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				3,
				"git",
				["diff", "--cached", "--", "src/utils.ts"],
				expect.any(Object),
			)

			// Should NOT call git diff for package-lock.json (excluded file)
			expect(mockSpawnSync).not.toHaveBeenCalledWith(
				"git",
				["diff", "--cached", "--", "package-lock.json"],
				expect.any(Object),
			)

			// Should return aggregated diffs
			expect(result).toBe(`${testTsDiff}\n${utilsTsDiff}`)
		})

		it("should return empty string when no staged files", async () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			expect(result).toBe("")
			expect(mockSpawnSync).toHaveBeenCalledTimes(1)
		})

		it("should handle file paths with special characters", async () => {
			const stagedFiles = ["src/file with spaces.ts", "src/file'with'quotes.ts"]
			const mockFileListOutput = stagedFiles.join("\n")
			const spaceDiff = "diff --git a/src/file with spaces.ts b/src/file with spaces.ts\n+content"
			const quoteDiff = "diff --git a/src/file'with'quotes.ts b/src/file'with'quotes.ts\n+content"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: spaceDiff, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: quoteDiff, stderr: "", error: null })

			const getDiffForChanges = (service as any).getDiffForChanges
			const result = await getDiffForChanges.call(service, { staged: true })

			// Should handle file paths with special characters without manual escaping
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				2,
				"git",
				["diff", "--cached", "--", "src/file with spaces.ts"],
				expect.any(Object),
			)
			expect(mockSpawnSync).toHaveBeenNthCalledWith(
				3,
				"git",
				["diff", "--cached", "--", "src/file'with'quotes.ts"],
				expect.any(Object),
			)

			expect(result).toBe(`${spaceDiff}\n${quoteDiff}`)
		})
	})

	describe("gatherChanges", () => {
		it("should gather unstaged changes correctly", async () => {
			const mockStatusOutput = " M file1.ts\n A file2.ts\n D file3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["status", "--porcelain"], expect.any(Object))

			expect(result).toEqual([
				{ filePath: path.join("/test/workspace", "file1.ts"), status: "M", staged: false },
				{ filePath: path.join("/test/workspace", "file2.ts"), status: "A", staged: false },
				{ filePath: path.join("/test/workspace", "file3.ts"), status: "D", staged: false },
			])
		})

		it("should gather staged changes correctly", async () => {
			const mockStatusOutput = "M\tfile1.ts\nA\tfile2.ts\nD\tfile3.ts"
			mockSpawnSync.mockReturnValue({ status: 0, stdout: mockStatusOutput, stderr: "", error: null })

			const result = await service.gatherChanges({ staged: true })

			expect(mockSpawnSync).toHaveBeenCalledWith("git", ["diff", "--name-status", "--cached"], expect.any(Object))

			expect(result).toEqual([
				{ filePath: path.join("/test/workspace", "file1.ts"), status: "M", staged: true },
				{ filePath: path.join("/test/workspace", "file2.ts"), status: "A", staged: true },
				{ filePath: path.join("/test/workspace", "file3.ts"), status: "D", staged: true },
			])
		})

		it("should return empty array when no changes", async () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})

		it("should return empty array when git command fails", async () => {
			mockSpawnSync.mockReturnValue({ status: 1, stdout: "", stderr: "error", error: new Error("Git error") })

			const result = await service.gatherChanges({ staged: false })

			expect(result).toEqual([])
		})
	})

	it("should generate diffs per file and exclude files properly for unstaged changes", async () => {
		const unstagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
		const mockFileListOutput = unstagedFiles.join("\n")

		const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
		const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

		mockSpawnSync
			.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: testTsDiff, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: utilsTsDiff, stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		const result = await getDiffForChanges.call(service, { staged: false })

		expect(mockSpawnSync).toHaveBeenNthCalledWith(1, "git", ["diff", "--name-only"], expect.any(Object))

		expect(mockSpawnSync).toHaveBeenNthCalledWith(2, "git", ["diff", "--", "src/test.ts"], expect.any(Object))
		expect(mockSpawnSync).toHaveBeenNthCalledWith(3, "git", ["diff", "--", "src/utils.ts"], expect.any(Object))

		expect(mockSpawnSync).not.toHaveBeenCalledWith("git", ["diff", "--", "package-lock.json"], expect.any(Object))

		expect(result).toBe(`${testTsDiff}\n${utilsTsDiff}`)
	})

	it("should return empty string when no unstaged files", async () => {
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		const result = await getDiffForChanges.call(service, { staged: false })

		expect(result).toBe("")
		expect(mockSpawnSync).toHaveBeenCalledTimes(1)
	})

	describe("getCommitContext", () => {
		it("should generate context for staged changes by default", async () => {
			const mockChanges = [{ filePath: "file1.ts", status: "M" as const, staged: true }]

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: "file1.ts", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "diff content", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "1 file changed", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "main", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "abc123 commit", stderr: "", error: null })

			const result = await service.getCommitContext(mockChanges, { staged: true })

			expect(result).toContain("Full Diff of Staged Changes")
			expect(result).not.toContain("Full Diff of Unstaged Changes")
		})

		it("should generate context for unstaged changes when specified", async () => {
			const mockChanges = [{ filePath: "file1.ts", status: "M" as const, staged: false }]

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: "file1.ts", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "diff content", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "1 file changed", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "main", stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: "abc123 commit", stderr: "", error: null })

			const result = await service.getCommitContext(mockChanges, { staged: false })

			expect(result).toContain("Full Diff of Unstaged Changes")
			expect(result).not.toContain("Full Diff of Staged Changes")
		})
	})
})
