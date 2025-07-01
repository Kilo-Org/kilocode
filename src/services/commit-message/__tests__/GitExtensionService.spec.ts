// npx vitest services/commit-message/__tests__/GitExtensionService.spec.ts

import type { Mock } from "vitest"
import { GitExtensionService } from "../GitExtensionService"
import { shouldExcludeFromGitDiff } from "../exclusionUtils"

// Mock child_process
vi.mock("child_process", () => ({
	execSync: vi.fn(),
}))

// Mock vscode
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
	},
	extensions: {
		getExtension: vi.fn(),
	},
	env: {
		clipboard: { writeText: vi.fn() },
	},
	window: { showInformationMessage: vi.fn() },
}))

import { execSync } from "child_process"

const mockExecSync = execSync as Mock

describe("GitExtensionService", () => {
	let service: GitExtensionService

	beforeEach(() => {
		service = new GitExtensionService()
		mockExecSync.mockClear()
	})

	describe("getStagedDiff", () => {
		it("should generate diffs per file and exclude files using shouldExcludeFromGitDiff", () => {
			// Mock the staged files list
			const stagedFiles = ["src/test.ts", "package-lock.json", "src/utils.ts"]
			const mockFileListOutput = stagedFiles.join("\n")

			// Mock individual file diffs
			const testTsDiff = "diff --git a/src/test.ts b/src/test.ts\n+added line"
			const utilsTsDiff = "diff --git a/src/utils.ts b/src/utils.ts\n+added util"

			mockExecSync
				.mockReturnValueOnce(mockFileListOutput) // git diff --name-only --cached
				.mockReturnValueOnce(testTsDiff) // git diff --cached -- 'src/test.ts'
				.mockReturnValueOnce(utilsTsDiff) // git diff --cached -- 'src/utils.ts'

			// Access the private method for testing
			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

			// Should call git diff --name-only --cached first
			expect(mockExecSync).toHaveBeenNthCalledWith(1, "git diff --name-only --cached", expect.any(Object))

			// Should call git diff for non-excluded files only
			expect(mockExecSync).toHaveBeenNthCalledWith(2, "git diff --cached -- 'src/test.ts'", expect.any(Object))
			expect(mockExecSync).toHaveBeenNthCalledWith(3, "git diff --cached -- 'src/utils.ts'", expect.any(Object))

			// Should NOT call git diff for package-lock.json (excluded file)
			expect(mockExecSync).not.toHaveBeenCalledWith(
				"git diff --cached -- 'package-lock.json'",
				expect.any(Object),
			)

			// Should return aggregated diffs
			expect(result).toBe(`${testTsDiff}\n${utilsTsDiff}`)
		})

		it("should return empty string when no staged files", () => {
			mockExecSync.mockReturnValue("") // Empty staged files list

			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

			expect(result).toBe("")
			expect(mockExecSync).toHaveBeenCalledTimes(1)
		})

		it("should handle file paths with special characters", () => {
			const stagedFiles = ["src/file with spaces.ts", "src/file'with'quotes.ts"]
			const mockFileListOutput = stagedFiles.join("\n")
			const spaceDiff = "diff --git a/src/file with spaces.ts b/src/file with spaces.ts\n+content"
			const quoteDiff = "diff --git a/src/file'with'quotes.ts b/src/file'with'quotes.ts\n+content"

			mockExecSync
				.mockReturnValueOnce(mockFileListOutput)
				.mockReturnValueOnce(spaceDiff)
				.mockReturnValueOnce(quoteDiff)

			const getStagedDiff = (service as any).getStagedDiff
			const result = getStagedDiff.call(service)

			// Should properly quote file paths
			expect(mockExecSync).toHaveBeenNthCalledWith(
				2,
				"git diff --cached -- 'src/file with spaces.ts'",
				expect.any(Object),
			)
			expect(mockExecSync).toHaveBeenNthCalledWith(
				3,
				"git diff --cached -- 'src/file'\"'\"'with'\"'\"'quotes.ts'",
				expect.any(Object),
			)

			expect(result).toBe(`${spaceDiff}\n${quoteDiff}`)
		})
	})
})
