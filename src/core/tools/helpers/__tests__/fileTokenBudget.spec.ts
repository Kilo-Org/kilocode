import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	validateFileTokenBudget,
	truncateFileContent,
	FILE_SIZE_THRESHOLD,
	MAX_FILE_SIZE_FOR_TOKENIZATION,
	PREVIEW_SIZE_FOR_LARGE_FILES,
} from "../fileTokenBudget"

// Mock dependencies
vi.mock("fs/promises", () => ({
	stat: vi.fn(),
	readFile: vi.fn(),
	open: vi.fn(),
}))

vi.mock("../../../../utils/countTokens", () => ({
	countTokens: vi.fn(),
}))

// Import after mocking
const fs = await import("fs/promises")
const { countTokens } = await import("../../../../utils/countTokens")

const mockStat = vi.mocked(fs.stat)
const mockReadFile = vi.mocked(fs.readFile)
const mockOpen = vi.mocked(fs.open)
const mockCountTokens = vi.mocked(countTokens)

describe("fileTokenBudget", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockOpen.mockReset()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("validateFileTokenBudget", () => {
		it("should not truncate files smaller than FILE_SIZE_THRESHOLD", async () => {
			const filePath = "/test/small-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000

			// Mock file stats - small file (50KB)
			mockStat.mockResolvedValue({
				size: 50000,
			} as any)

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(false)
			expect(mockReadFile).not.toHaveBeenCalled()
			expect(mockCountTokens).not.toHaveBeenCalled()
		})

		it("should validate and not truncate large files that fit within budget", async () => {
			const filePath = "/test/large-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "x".repeat(150000) // 150KB file

			// Mock file stats - large file (150KB)
			mockStat.mockResolvedValue({
				size: 150000,
			} as any)

			// Mock file read
			mockReadFile.mockResolvedValue(fileContent)

			// Mock token counting - file uses 30k tokens (within 60% of 190k remaining = 114k budget)
			mockCountTokens.mockResolvedValue(30000)

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(false)
			expect(mockReadFile).toHaveBeenCalledWith(filePath, "utf-8")
			expect(mockCountTokens).toHaveBeenCalled()
		})

		it("should truncate large files that exceed token budget", async () => {
			const filePath = "/test/huge-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "x".repeat(500000) // 500KB file

			// Mock file stats - huge file (500KB)
			mockStat.mockResolvedValue({
				size: 500000,
			} as any)

			// Mock file read
			mockReadFile.mockResolvedValue(fileContent)

			// Mock token counting - file uses 150k tokens (exceeds 60% of 190k remaining = 114k budget)
			mockCountTokens.mockResolvedValue(150000)

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(true)
			expect(result.maxChars).toBeDefined()
			expect(result.maxChars).toBeGreaterThan(0)
			expect(result.reason).toContain("150000 tokens")
			expect(result.reason).toContain("114000 tokens available")
		})

		it("should handle case where no budget is available", async () => {
			const filePath = "/test/file.txt"
			const contextWindow = 200000
			const currentTokens = 200000 // Context is full

			// Mock file stats - large file
			mockStat.mockResolvedValue({
				size: 150000,
			} as any)

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(true)
			expect(result.maxChars).toBe(0)
			expect(result.reason).toContain("No available context budget")
		})

		it("should handle errors gracefully and not truncate", async () => {
			const filePath = "/test/error-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000

			// Mock file stats to throw an error
			mockStat.mockRejectedValue(new Error("File not found"))

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(false)
		})

		it("should calculate correct token budget with 60/40 split", async () => {
			const filePath = "/test/file.txt"
			const contextWindow = 100000
			const currentTokens = 20000 // 80k remaining
			const fileContent = "test content"

			mockStat.mockResolvedValue({ size: 150000 } as any)
			mockReadFile.mockResolvedValue(fileContent)

			// Available budget should be: (100000 - 20000) * 0.6 = 48000
			// File uses 50k tokens, should be truncated
			mockCountTokens.mockResolvedValue(50000)

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(true)
			// maxChars should be approximately 48000 * 3 = 144000
			expect(result.maxChars).toBe(144000)
		})

		it("should validate files at the FILE_SIZE_THRESHOLD boundary", async () => {
			const filePath = "/test/boundary-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "x".repeat(1000)

			// Mock file stats - exactly at threshold (should trigger validation)
			mockStat.mockResolvedValue({
				size: FILE_SIZE_THRESHOLD,
			} as any)

			mockReadFile.mockResolvedValue(fileContent)
			mockCountTokens.mockResolvedValue(30000) // Within budget

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			// At exactly the threshold, it should validate
			expect(mockReadFile).toHaveBeenCalled()
			expect(mockCountTokens).toHaveBeenCalled()
			expect(result.shouldTruncate).toBe(false)
		})

		it("should provide preview for files exceeding MAX_FILE_SIZE_FOR_TOKENIZATION", async () => {
			const filePath = "/test/huge-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const previewContent = "x".repeat(PREVIEW_SIZE_FOR_LARGE_FILES)

			// Mock file stats - file exceeds max tokenization size (e.g., 10MB when max is 5MB)
			mockStat.mockResolvedValue({
				size: MAX_FILE_SIZE_FOR_TOKENIZATION + 1000000, // 1MB over the limit
			} as any)

			// Mock file.open and read for preview
			const mockRead = vi.fn().mockResolvedValue({
				bytesRead: PREVIEW_SIZE_FOR_LARGE_FILES,
			})
			const mockClose = vi.fn().mockResolvedValue(undefined)
			mockOpen.mockResolvedValue({
				read: mockRead,
				close: mockClose,
			} as any)

			// Mock token counting for the preview
			mockCountTokens.mockResolvedValue(30000) // Preview fits within budget

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			expect(result.shouldTruncate).toBe(true)
			expect(result.isPreview).toBe(true)
			expect(result.reason).toContain("too large")
			expect(result.reason).toContain("preview")
			// Should read preview and count tokens
			expect(mockOpen).toHaveBeenCalled()
			expect(mockCountTokens).toHaveBeenCalled()
		})

		it("should handle files exactly at MAX_FILE_SIZE_FOR_TOKENIZATION boundary", async () => {
			const filePath = "/test/boundary-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "x".repeat(1000)

			// Mock file stats - exactly at max size
			mockStat.mockResolvedValue({
				size: MAX_FILE_SIZE_FOR_TOKENIZATION,
			} as any)

			mockReadFile.mockResolvedValue(fileContent)
			mockCountTokens.mockResolvedValue(30000) // Within budget

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			// At exactly the limit, should still attempt to tokenize
			expect(mockReadFile).toHaveBeenCalled()
			expect(mockCountTokens).toHaveBeenCalled()
		})

		it("should handle tokenizer unreachable errors gracefully", async () => {
			const filePath = "/test/problematic-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "x".repeat(200000) // Content that might cause issues

			// Mock file stats - within size limits but content causes tokenizer crash
			mockStat.mockResolvedValue({
				size: 200000,
			} as any)

			mockReadFile.mockResolvedValue(fileContent)
			// Simulate tokenizer "unreachable" error
			mockCountTokens.mockRejectedValue(new Error("unreachable"))

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			// Should fallback with conservative estimation
			const remainingTokens = contextWindow - currentTokens
			const safeReadBudget = Math.floor(remainingTokens * 0.6) // 114000

			expect(result.shouldTruncate).toBe(true)
			expect(result.isPreview).toBe(true)
			expect(result.reason).toContain("tokenizer error")

			// The actual maxChars depends on conservative estimation
			// content.length (200000) is used as estimate since tokenizer failed
			expect(result.maxChars).toBeDefined()
			expect(typeof result.maxChars).toBe("number")
		})

		it("should handle other tokenizer errors conservatively", async () => {
			const filePath = "/test/error-file.txt"
			const contextWindow = 200000
			const currentTokens = 10000
			const fileContent = "test content"

			mockStat.mockResolvedValue({ size: 150000 } as any)
			mockReadFile.mockResolvedValue(fileContent)
			// Simulate a different error
			mockCountTokens.mockRejectedValue(new Error("Network error"))

			const result = await validateFileTokenBudget(filePath, contextWindow, currentTokens)

			// Should return safe fallback (don't truncate, let normal error handling take over)
			expect(result.shouldTruncate).toBe(false)
		})
	})

	describe("truncateFileContent", () => {
		it("should truncate content to specified character limit", () => {
			const content = "a".repeat(1000)
			const maxChars = 500
			const totalChars = 1000

			const result = truncateFileContent(content, maxChars, totalChars, false)

			expect(result.content).toHaveLength(500)
			expect(result.content).toBe("a".repeat(500))
			expect(result.notice).toContain("500 of 1000 characters")
			expect(result.notice).toContain("context limitations")
		})

		it("should show preview message for large files", () => {
			const content = "x".repeat(10000000) // ~10MB (9.54MB in binary)
			const maxChars = 100000 // 100KB preview
			const totalChars = 10000000

			const result = truncateFileContent(content, maxChars, totalChars, true)

			expect(result.content).toHaveLength(maxChars)
			expect(result.notice).toContain("Preview")
			expect(result.notice).toContain("0.1MB") // 100KB = 0.1MB
			expect(result.notice).toContain("9.54MB") // Binary MB calculation
			expect(result.notice).toContain("line_range")
		})

		it("should include helpful notice about using line_range", () => {
			const content = "test content that is very long"
			const maxChars = 10
			const totalChars = 31

			const result = truncateFileContent(content, maxChars, totalChars)

			expect(result.notice).toContain("line_range")
			expect(result.notice).toContain("specific sections")
		})

		it("should handle empty content", () => {
			const content = ""
			const maxChars = 100
			const totalChars = 0

			const result = truncateFileContent(content, maxChars, totalChars)

			expect(result.content).toBe("")
			expect(result.notice).toContain("0 of 0 characters")
		})

		it("should truncate multi-line content correctly", () => {
			const content = "line1\nline2\nline3\nline4\nline5"
			const maxChars = 15
			const totalChars = content.length

			const result = truncateFileContent(content, maxChars, totalChars)

			expect(result.content).toBe("line1\nline2\nlin")
			expect(result.content).toHaveLength(15)
		})

		it("should work with unicode characters", () => {
			const content = "Hello 😀 World 🌍 Test 🎉"
			const maxChars = 10
			const totalChars = content.length

			const result = truncateFileContent(content, maxChars, totalChars)

			expect(result.content).toHaveLength(10)
			expect(result.notice).toBeDefined()
		})
	})
})
