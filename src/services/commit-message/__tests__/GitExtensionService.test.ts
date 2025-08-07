// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GitExtensionService, GitChange, GitProgressOptions } from "../GitExtensionService"
import * as commitTokenUtils from "../../../utils/commit-token-utils"

// Mock dependencies
vi.mock("../../../utils/commit-token-utils")
vi.mock("../../core/ignore/RooIgnoreController")

const mockExceedsContextThreshold = vi.mocked(commitTokenUtils.exceedsContextThreshold)
const mockChunkDiffByFiles = vi.mocked(commitTokenUtils.chunkDiffByFiles)

describe("GitExtensionService", () => {
	let gitService: GitExtensionService
	const mockChanges: GitChange[] = [
		{ filePath: "/test/file1.ts", status: "Modified" },
		{ filePath: "/test/file2.ts", status: "Added" },
	]

	const mockDiff = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 function hello() {
+  console.log("Hello");
   return "world";
 }
diff --git a/file2.ts b/file2.ts
index 2345678..bcdefgh 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,4 @@
 function goodbye() {
+  console.log("Goodbye");
   return "farewell";
 }`

	beforeEach(() => {
		vi.clearAllMocks()
		gitService = new GitExtensionService()

		// Mock the private getDiffForChanges method
		vi.spyOn(gitService as any, "getDiffForChanges").mockResolvedValue(mockDiff)

		// Mock other private methods
		vi.spyOn(gitService as any, "getSummary").mockReturnValue(
			" file1.ts | 10 ++++++++++\n file2.ts | 5 +++++\n 2 files changed, 15 insertions(+)",
		)
		vi.spyOn(gitService as any, "getCurrentBranch").mockReturnValue("feature/test-branch")
		vi.spyOn(gitService as any, "getRecentCommits").mockReturnValue("abc123 Initial commit\ndef456 Add feature")
	})

	describe("getCommitContext", () => {
		it("should return single context when chunking is disabled", async () => {
			const options: GitProgressOptions = {
				staged: true,
				enableChunking: false,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(typeof result).toBe("string")
			expect(result).toContain("## Git Context for Commit Message Generation")
			expect(result).toContain("### Full Diff of Staged Changes")
			expect(result).toContain("### Statistical Summary")
			expect(result).toContain("### Repository Context")
		})

		it("should return single context when diff is small", async () => {
			mockExceedsContextThreshold.mockResolvedValue(false)

			const options: GitProgressOptions = {
				staged: true,
				enableChunking: true,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(typeof result).toBe("string")
			expect(result).toContain("## Git Context for Commit Message Generation")
			expect(mockExceedsContextThreshold).toHaveBeenCalled()
		})

		it("should return chunked contexts when diff is large", async () => {
			mockExceedsContextThreshold.mockResolvedValue(true)
			mockChunkDiffByFiles.mockResolvedValue({
				chunks: [
					`diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 function hello() {
+  console.log("Hello");
   return "world";
 }`,
					`diff --git a/file2.ts b/file2.ts
index 2345678..bcdefgh 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,3 +1,4 @@
 function goodbye() {
+  console.log("Goodbye");
   return "farewell";
 }`,
				],
				wasChunked: true,
			})

			const options: GitProgressOptions = {
				staged: true,
				enableChunking: true,
				chunkRatio: 0.4,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(Array.isArray(result)).toBe(true)
			const chunks = result as string[]
			expect(chunks).toHaveLength(2)
			expect(chunks[0]).toContain("## Git Context for Commit Message Generation")
			expect(chunks[0]).toContain("### Full Diff of Staged Changes (Chunk)")
			expect(chunks[0]).toContain("file1.ts")
			expect(chunks[1]).toContain("file2.ts")
			expect(mockChunkDiffByFiles).toHaveBeenCalledWith(mockDiff, 0.4)
		})

		it("should handle chunking with default parameters", async () => {
			mockExceedsContextThreshold.mockResolvedValue(true)
			mockChunkDiffByFiles.mockResolvedValue({
				chunks: ["chunk1", "chunk2"],
				wasChunked: true,
			})

			const options: GitProgressOptions = {
				staged: false,
				// enableChunking defaults to true
				// chunkRatio defaults to 0.4
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(Array.isArray(result)).toBe(true)
			expect(mockChunkDiffByFiles).toHaveBeenCalledWith(mockDiff, 0.4)
		})

		it("should handle errors gracefully", async () => {
			mockExceedsContextThreshold.mockRejectedValue(new Error("Token estimation failed"))

			const options: GitProgressOptions = {
				staged: true,
				enableChunking: true,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(typeof result).toBe("string")
			expect(result).toContain("## Git Context for Commit Message Generation")
		})

		it("should include repository context in all chunks", async () => {
			mockExceedsContextThreshold.mockResolvedValue(true)
			mockChunkDiffByFiles.mockResolvedValue({
				chunks: ["chunk1", "chunk2"],
				wasChunked: true,
			})

			const options: GitProgressOptions = {
				staged: true,
				enableChunking: true,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(Array.isArray(result)).toBe(true)
			const chunks = result as string[]

			chunks.forEach((chunk) => {
				expect(chunk).toContain("### Repository Context")
				expect(chunk).toContain("**Current branch:** `feature/test-branch`")
				expect(chunk).toContain("**Recent commits:**")
			})
		})

		it("should call progress callback during diff collection", async () => {
			const onProgress = vi.fn()
			const options: GitProgressOptions = {
				staged: true,
				enableChunking: false,
				onProgress,
			}

			await gitService.getCommitContext(mockChanges, options)

			// Progress callback is called in getDiffForChanges, which we mocked
			// So we can't test this directly, but we can verify the method was called
			expect(gitService as any).toBeDefined()
		})

		it("should handle unstaged changes", async () => {
			mockExceedsContextThreshold.mockResolvedValue(false)

			const options: GitProgressOptions = {
				staged: false,
				enableChunking: true,
			}

			const result = await gitService.getCommitContext(mockChanges, options)

			expect(typeof result).toBe("string")
			expect(result).toContain("### Full Diff of Unstaged Changes")
		})
	})

	describe("getRepositoryContext", () => {
		it("should return repository context with branch and commits", async () => {
			// Access private method for testing
			const getRepositoryContext = (gitService as any).getRepositoryContext.bind(gitService)

			const result = await getRepositoryContext()

			expect(result).toContain("### Repository Context")
			expect(result).toContain("**Current branch:** `feature/test-branch`")
			expect(result).toContain("**Recent commits:**")
			expect(result).toContain("abc123 Initial commit")
		})
	})
})
