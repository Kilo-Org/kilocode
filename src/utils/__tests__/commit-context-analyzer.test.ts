import { describe, it, expect, vi, beforeEach } from "vitest"
import {
	estimateTokenCount,
	analyzeGitContext,
	chunkGitDiffByFiles,
	type ContextAnalysisOptions,
} from "../commit-context-analyzer"
import * as countTokensModule from "../countTokens"
import * as apiModule from "../../api"
import { ContextProxy } from "../../core/config/ContextProxy"

// Mock dependencies
vi.mock("../countTokens")
vi.mock("../../api")
vi.mock("../../core/config/ContextProxy", () => ({
	ContextProxy: {
		instance: {
			getProviderSettings: vi.fn().mockReturnValue({}),
		},
	},
}))

const mockCountTokens = vi.mocked(countTokensModule.countTokens)
const mockBuildApiHandler = vi.mocked(apiModule.buildApiHandler)

describe("commit-context-analyzer", () => {
	const mockApiHandler = {
		getModel: vi.fn().mockReturnValue({
			info: { contextWindow: 200000 },
		}),
		countTokens: vi.fn(),
		createMessage: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		mockBuildApiHandler.mockReturnValue(mockApiHandler as any)
	})

	describe("estimateTokenCount", () => {
		it("should return 0 for empty or whitespace-only text", async () => {
			expect(await estimateTokenCount("")).toBe(0)
			expect(await estimateTokenCount("   ")).toBe(0)
			expect(await estimateTokenCount("\n\t")).toBe(0)
		})

		it("should call countTokens with correct parameters", async () => {
			mockCountTokens.mockResolvedValue(42)
			const text = "Hello world"

			const result = await estimateTokenCount(text)

			expect(mockCountTokens).toHaveBeenCalledWith([{ type: "text", text }], { useWorker: false })
			expect(result).toBe(42)
		})

		it("should handle text with special characters", async () => {
			mockCountTokens.mockResolvedValue(15)
			const text = "Hello 世界! 🌍"

			const result = await estimateTokenCount(text)

			expect(result).toBe(15)
			expect(mockCountTokens).toHaveBeenCalledWith([{ type: "text", text }], { useWorker: false })
		})
	})

	describe("analyzeGitContext", () => {
		it("should analyze context and determine no chunking needed", async () => {
			mockCountTokens.mockResolvedValue(1000)
			const gitContext = "Small diff content"

			const result = await analyzeGitContext(gitContext)

			expect(result).toEqual({
				tokenCount: 1000,
				contextWindow: 200000,
				requiresChunking: false,
				maxTokensAllowed: 190000, // 95% of 200000
			})
		})

		it("should analyze context and determine chunking is needed", async () => {
			mockCountTokens.mockResolvedValue(195000)
			const gitContext = "Very large diff content"

			const result = await analyzeGitContext(gitContext)

			expect(result).toEqual({
				tokenCount: 195000,
				contextWindow: 200000,
				requiresChunking: true,
				maxTokensAllowed: 190000,
			})
		})

		it("should use custom threshold", async () => {
			mockCountTokens.mockResolvedValue(150000)
			const gitContext = "Medium diff content"
			const options: ContextAnalysisOptions = { contextWindowThreshold: 0.7 }

			const result = await analyzeGitContext(gitContext, options)

			expect(result).toEqual({
				tokenCount: 150000,
				contextWindow: 200000,
				requiresChunking: true,
				maxTokensAllowed: 140000, // 70% of 200000
			})
		})

		it("should handle missing context window gracefully", async () => {
			mockCountTokens.mockResolvedValue(1000)
			mockApiHandler.getModel.mockReturnValue({ info: {} })

			const result = await analyzeGitContext("test")

			expect(result.contextWindow).toBe(200000) // fallback value
		})
	})

	describe("chunkGitDiffByFiles", () => {
		const mockSingleFileDiff = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 function test() {
+  console.log("hello");
   return true;
 }`

		const mockMultiFileDiff = `diff --git a/file1.ts b/file1.ts
index 1234567..abcdefg 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 function test() {
+  console.log("hello");
   return true;
 }

diff --git a/file2.ts b/file2.ts
index 2345678..bcdefgh 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,3 @@
 export const value = 42;
+export const newValue = 24;`

		it("should not chunk single file diff", async () => {
			mockCountTokens.mockResolvedValue(1000)

			const result = await chunkGitDiffByFiles(mockSingleFileDiff)

			expect(result.wasChunked).toBe(false)
			expect(result.chunks).toHaveLength(1)
			expect(result.chunks[0].files).toEqual(["file1.ts"])
			expect(result.chunks[0].diff).toBe(mockSingleFileDiff)
		})

		it("should not chunk small multi-file diff", async () => {
			mockCountTokens
				.mockResolvedValueOnce(5000) // total tokens (small enough to fit in target)
				.mockResolvedValueOnce(2500) // file1 tokens
				.mockResolvedValueOnce(2500) // file2 tokens

			const result = await chunkGitDiffByFiles(mockMultiFileDiff, {
				targetChunkRatio: 0.5, // Large target chunk size (100k tokens)
			})

			expect(result.wasChunked).toBe(false)
			expect(result.chunks).toHaveLength(1)
			expect(result.chunks[0].files).toEqual(["file1.ts", "file2.ts"])
		})

		it("should chunk large multi-file diff", async () => {
			// Mock large total size that exceeds target chunk size
			mockCountTokens
				.mockResolvedValueOnce(100000) // total tokens (large)
				.mockResolvedValueOnce(30000) // file1 tokens
				.mockResolvedValueOnce(25000) // file2 tokens (would exceed 40000 target)

			const result = await chunkGitDiffByFiles(mockMultiFileDiff, {
				targetChunkRatio: 0.2, // 40000 tokens max per chunk
			})

			console.log("Debug chunking test:")
			console.log("- Total tokens:", 100000)
			console.log("- Target chunk size:", 200000 * 0.2, "=", 40000)
			console.log("- Was chunked:", result.wasChunked)
			console.log("- Chunks length:", result.chunks.length)
			console.log(
				"- Files in chunks:",
				result.chunks.map((c) => c.files),
			)

			expect(result.wasChunked).toBe(true)
			expect(result.chunks).toHaveLength(2)
			expect(result.chunks[0].files).toEqual(["file1.ts"])
			expect(result.chunks[1].files).toEqual(["file2.ts"])
		})

		it("should handle empty diff", async () => {
			mockCountTokens.mockResolvedValue(0)

			const result = await chunkGitDiffByFiles("")

			expect(result.wasChunked).toBe(false)
			expect(result.chunks).toHaveLength(0)
			expect(result.totalOriginalTokens).toBe(0)
		})

		it("should respect maxChunks limit", async () => {
			const largeDiff = Array(15)
				.fill(0)
				.map(
					(_, i) =>
						`diff --git a/file${i}.ts b/file${i}.ts
index 1234567..abcdefg 100644
--- a/file${i}.ts
+++ b/file${i}.ts
@@ -1,1 +1,2 @@
 const value${i} = ${i};
+const newValue${i} = ${i * 2};`,
				)
				.join("\n\n")

			// Mock each file as having significant tokens
			mockCountTokens.mockResolvedValueOnce(500000) // total tokens

			// Mock individual file token counts
			for (let i = 0; i < 15; i++) {
				mockCountTokens.mockResolvedValueOnce(30000)
			}

			const result = await chunkGitDiffByFiles(largeDiff, {
				maxChunks: 5,
				targetChunkRatio: 0.1, // Small chunks to force splitting
			})

			expect(result.chunks.length).toBeLessThanOrEqual(5)
		})

		it("should use custom options", async () => {
			mockCountTokens
				.mockResolvedValueOnce(80000) // total tokens
				.mockResolvedValueOnce(40000) // file1 tokens
				.mockResolvedValueOnce(40000) // file2 tokens

			const options: ContextAnalysisOptions = {
				targetChunkRatio: 0.3, // 60000 tokens max per chunk
				maxChunks: 3,
			}

			const result = await chunkGitDiffByFiles(mockMultiFileDiff, options)

			expect(result.wasChunked).toBe(false) // Both files fit in one chunk
			expect(result.chunks).toHaveLength(1)
		})
	})

	describe("file diff extraction", () => {
		it("should extract multiple files correctly", async () => {
			const multiFileDiff = `diff --git a/src/file1.ts b/src/file1.ts
index abc123..def456 100644
--- a/src/file1.ts
+++ b/src/file1.ts
@@ -1,2 +1,3 @@
	export const a = 1;
+export const b = 2;

diff --git a/src/file2.js b/src/file2.js
index 789abc..012def 100644
--- a/src/file2.js
+++ b/src/file2.js
@@ -1,1 +1,2 @@
	console.log("hello");
+console.log("world");`

			mockCountTokens
				.mockResolvedValueOnce(1000) // total tokens (small)
				.mockResolvedValueOnce(500) // file1 tokens
				.mockResolvedValueOnce(500) // file2 tokens

			const result = await chunkGitDiffByFiles(multiFileDiff)

			// With default settings, multiple files get chunked separately
			expect(result.wasChunked).toBe(true)
			expect(result.chunks).toHaveLength(2)
			expect(result.chunks[0].files).toEqual(["src/file1.ts"])
			expect(result.chunks[1].files).toEqual(["src/file2.js"])
		})

		it("should handle malformed diff gracefully", async () => {
			const malformedDiff = `not a real diff
some random content
diff --git a/valid.ts b/valid.ts
+++ b/valid.ts
@@ -1,1 +1,2 @@
 const x = 1;
+const y = 2;`

			mockCountTokens.mockResolvedValue(500)

			const result = await chunkGitDiffByFiles(malformedDiff)

			expect(result.chunks).toHaveLength(1)
			expect(result.chunks[0].files).toEqual(["valid.ts"])
		})
	})
})
