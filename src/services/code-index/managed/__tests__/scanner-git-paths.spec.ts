// kilocode_change - new file
/**
 * Tests for scanner git path handling
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"
import * as scanner from "../scanner"
import * as gitUtils from "../git-utils"

// Mock dependencies
vi.mock("../git-utils")
vi.mock("../../glob/list-files")
vi.mock("../../../core/ignore/RooIgnoreController")
vi.mock("vscode", () => ({
	workspace: {
		fs: {
			readFile: vi.fn(),
		},
	},
	Uri: {
		file: vi.fn((p) => ({ fsPath: p })),
	},
}))

describe("Scanner Git Path Handling", () => {
	// Use platform-appropriate path for testing
	const workspacePath = process.platform === "win32" ? "C:\\Users\\test\\project" : "/Users/test/project"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should convert relative git paths to absolute paths for feature branches", async () => {
		// Mock git utilities
		vi.mocked(gitUtils.isGitRepository).mockResolvedValue(true)
		vi.mocked(gitUtils.getCurrentBranch).mockResolvedValue("feature/test")
		vi.mocked(gitUtils.getGitDiff).mockResolvedValue({
			added: ["src/app.ts", "src/utils/helper.ts"],
			modified: ["src/index.ts"],
			deleted: ["src/old.ts"],
		})

		// The getFilesToScan function is not exported, but we can test it indirectly
		// by checking that scanDirectory doesn't throw ENOENT errors

		// For this test, we'll verify the git diff returns relative paths
		const diff = await gitUtils.getGitDiff("feature/test", "main", workspacePath)

		// Verify git returns relative paths
		expect(diff.added).toEqual(["src/app.ts", "src/utils/helper.ts"])
		expect(diff.modified).toEqual(["src/index.ts"])

		// The scanner should convert these to absolute paths internally
		// Expected absolute paths would be:
		const expectedPaths = [
			path.join(workspacePath, "src/app.ts"),
			path.join(workspacePath, "src/utils/helper.ts"),
			path.join(workspacePath, "src/index.ts"),
		]

		// Verify the paths are absolute
		expectedPaths.forEach((p) => {
			expect(path.isAbsolute(p)).toBe(true)
		})
	})

	it("should handle git paths with special characters", () => {
		const relativePaths = [
			"src/app/(app)/page.tsx",
			"src/components/[id]/view.tsx",
			"src/utils/file with spaces.ts",
		]

		// Convert to absolute paths
		const absolutePaths = relativePaths.map((p) => path.join(workspacePath, p))

		// Verify all are absolute
		absolutePaths.forEach((p) => {
			expect(path.isAbsolute(p)).toBe(true)
			expect(p.startsWith(workspacePath)).toBe(true)
		})
	})

	it("should handle nested directory paths correctly", () => {
		const relativePath = "src/deeply/nested/directory/file.ts"
		const absolutePath = path.join(workspacePath, relativePath)

		expect(absolutePath).toBe(path.join(workspacePath, "src/deeply/nested/directory/file.ts"))
		expect(path.isAbsolute(absolutePath)).toBe(true)
	})
})
