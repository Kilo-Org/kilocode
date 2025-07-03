// npx vitest services/commit-message/__tests__/GitExtensionService.spec.ts
import { spawnSync } from "child_process"
import type { Mock } from "vitest"
import { GitExtensionService } from "../GitExtensionService"

// Mock child_process
vi.mock("child_process", () => ({
	spawnSync: vi.fn(),
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	extensions: {
		getExtension: vi.fn(),
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

	beforeEach(() => {
		service = new GitExtensionService()
		mockSpawnSync.mockClear()
	})

	describe("getStagedDiff", () => {
		it("should generate diffs per file and exclude files properly", () => {
			// Mock the staged files list
			const stagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
			const mockFileListOutput = stagedFiles.join("\n")

			// Mock individual file diffs
			const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
			const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null }) // git diff --name-only --cached
				.mockReturnValueOnce({ status: 0, stdout: testTsDiff, stderr: "", error: null }) // git diff --cached -- src/test.ts
				.mockReturnValueOnce({ status: 0, stdout: utilsTsDiff, stderr: "", error: null }) // git diff --cached -- src/utils.ts

			// Access the private method for testing
			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

			// Should call git diff --name-only --cached first
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

		it("should return empty string when no staged files", () => {
			mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null }) // Empty staged files list

			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

			expect(result).toBe("")
			expect(mockSpawnSync).toHaveBeenCalledTimes(1)
		})

		it("should handle file paths with special characters", () => {
			const stagedFiles = ["src/file with spaces.ts", "src/file'with'quotes.ts"]
			const mockFileListOutput = stagedFiles.join("\n")
			const spaceDiff = "diff --git a/src/file with spaces.ts b/src/file with spaces.ts\n+content"
			const quoteDiff = "diff --git a/src/file'with'quotes.ts b/src/file'with'quotes.ts\n+content"

			mockSpawnSync
				.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: spaceDiff, stderr: "", error: null })
				.mockReturnValueOnce({ status: 0, stdout: quoteDiff, stderr: "", error: null })

			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

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
})
