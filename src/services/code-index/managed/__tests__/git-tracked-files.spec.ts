// kilocode_change - new file
/**
 * Tests for git-tracked files functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { getGitTrackedFiles } from "../git-utils"

// Mock exec utils
vi.mock("../../../../shared/utils/exec", () => ({
	execGetLines: vi.fn(),
}))

import { execGetLines } from "../../../../shared/utils/exec"

describe("Git Tracked Files", () => {
	const workspacePath = "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getGitTrackedFiles", () => {
		it("should yield list of git-tracked files", async () => {
			const mockFiles = ["src/app.ts", "src/utils/helper.ts", "src/index.ts", "README.md", "package.json"]

			vi.mocked(execGetLines).mockImplementation(async function* () {
				for (const file of mockFiles) {
					yield file
				}
			})

			const files: string[] = []
			for await (const file of getGitTrackedFiles(workspacePath)) {
				files.push(file)
			}

			expect(files).toEqual(mockFiles)
		})

		it("should filter out empty lines", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "src/app.ts"
				yield ""
				yield "src/utils/helper.ts"
				yield ""
			})

			const files: string[] = []
			for await (const file of getGitTrackedFiles(workspacePath)) {
				files.push(file)
			}

			expect(files).toEqual(["src/app.ts", "src/utils/helper.ts"])
		})

		it("should handle files with special characters", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				yield "src/app/(app)/page.tsx"
				yield "src/components/[id]/view.tsx"
				yield "src/utils/file with spaces.ts"
			})

			const files: string[] = []
			for await (const file of getGitTrackedFiles(workspacePath)) {
				files.push(file)
			}

			expect(files).toEqual([
				"src/app/(app)/page.tsx",
				"src/components/[id]/view.tsx",
				"src/utils/file with spaces.ts",
			])
		})

		it("should throw error if git command fails", async () => {
			// eslint-disable-next-line require-yield
			vi.mocked(execGetLines).mockImplementation(async function* (): AsyncGenerator<string> {
				throw new Error("Not a git repository")
			})

			await expect(async () => {
				for await (const file of getGitTrackedFiles(workspacePath)) {
					// Should throw before yielding anything
				}
			}).rejects.toThrow("Failed to get git tracked files")
		})

		it("should handle empty repository", async () => {
			vi.mocked(execGetLines).mockImplementation(async function* () {
				// Yield nothing
			})

			const files: string[] = []
			for await (const file of getGitTrackedFiles(workspacePath)) {
				files.push(file)
			}

			expect(files).toEqual([])
		})

		it("should handle large number of files", async () => {
			// Generate 10000 file paths
			const mockFiles = Array.from({ length: 10000 }, (_, i) => `src/file${i}.ts`)

			vi.mocked(execGetLines).mockImplementation(async function* () {
				for (const file of mockFiles) {
					yield file
				}
			})

			const files: string[] = []
			for await (const file of getGitTrackedFiles(workspacePath)) {
				files.push(file)
			}

			expect(files).toHaveLength(10000)
			expect(files[0]).toBe("src/file0.ts")
			expect(files[9999]).toBe("src/file9999.ts")
		})
	})
})
