/**
 * Tests for git-tracked files functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { execSync } from "child_process"
import { getGitTrackedFilesSync } from "../git-utils"

// Mock child_process
vi.mock("child_process", () => ({
	execSync: vi.fn(),
}))

describe("Git Tracked Files", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getGitTrackedFilesSync", () => {
		it("should return list of git-tracked files", () => {
			const mockOutput = `src/app.ts
src/utils/helper.ts
src/index.ts
README.md
package.json`

			vi.mocked(execSync).mockReturnValue(mockOutput)

			const files = getGitTrackedFilesSync(workspacePath)

			expect(files).toEqual(["src/app.ts", "src/utils/helper.ts", "src/index.ts", "README.md", "package.json"])

			expect(execSync).toHaveBeenCalledWith("git ls-files", {
				cwd: workspacePath,
				encoding: "utf8",
				maxBuffer: 50 * 1024 * 1024,
			})
		})

		it("should filter out empty lines", () => {
			const mockOutput = `src/app.ts

src/utils/helper.ts

`

			vi.mocked(execSync).mockReturnValue(mockOutput)

			const files = getGitTrackedFilesSync(workspacePath)

			expect(files).toEqual(["src/app.ts", "src/utils/helper.ts"])
		})

		it("should handle files with special characters", () => {
			const mockOutput = `src/app/(app)/page.tsx
src/components/[id]/view.tsx
src/utils/file with spaces.ts`

			vi.mocked(execSync).mockReturnValue(mockOutput)

			const files = getGitTrackedFilesSync(workspacePath)

			expect(files).toEqual([
				"src/app/(app)/page.tsx",
				"src/components/[id]/view.tsx",
				"src/utils/file with spaces.ts",
			])
		})

		it("should throw error if git command fails", () => {
			vi.mocked(execSync).mockImplementation(() => {
				throw new Error("Not a git repository")
			})

			expect(() => getGitTrackedFilesSync(workspacePath)).toThrow("Failed to get git tracked files")
		})

		it("should handle empty repository", () => {
			vi.mocked(execSync).mockReturnValue("")

			const files = getGitTrackedFilesSync(workspacePath)

			expect(files).toEqual([])
		})

		it("should handle large number of files", () => {
			// Generate 10000 file paths
			const mockFiles = Array.from({ length: 10000 }, (_, i) => `src/file${i}.ts`)
			const mockOutput = mockFiles.join("\n")

			vi.mocked(execSync).mockReturnValue(mockOutput)

			const files = getGitTrackedFilesSync(workspacePath)

			expect(files).toHaveLength(10000)
			expect(files[0]).toBe("src/file0.ts")
			expect(files[9999]).toBe("src/file9999.ts")
		})
	})
})
