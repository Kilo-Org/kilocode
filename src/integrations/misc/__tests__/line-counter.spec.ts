import { describe, it, expect, vi, beforeEach } from "vitest"
import { countFileLines, countFileLinesAndTokens } from "../line-counter"
import { countTokens } from "../../../utils/countTokens"
import { Readable } from "stream"

// Mock dependencies
vi.mock("fs", () => ({
	default: {
		promises: {
			access: vi.fn(),
		},
		constants: {
			F_OK: 0,
		},
		createReadStream: vi.fn(),
	},
	createReadStream: vi.fn(),
}))

vi.mock("../../../utils/countTokens", () => ({
	countTokens: vi.fn(),
}))

const mockCountTokens = vi.mocked(countTokens)

// Get the mocked fs module
const fs = await import("fs")
const mockCreateReadStream = vi.mocked(fs.createReadStream)
const mockFsAccess = vi.mocked(fs.default.promises.access)

describe("line-counter", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("countFileLinesAndTokens", () => {
		it("should count lines and tokens without budget limit", async () => {
			// Create a proper readable stream
			const mockStream = new Readable({
				read() {
					this.push("line1\n")
					this.push("line2\n")
					this.push("line3\n")
					this.push(null) // End of stream
				},
			})

			mockCreateReadStream.mockReturnValue(mockStream as any)
			mockFsAccess.mockResolvedValue(undefined)

			// Mock token counting - simulate ~10 tokens per chunk
			mockCountTokens.mockResolvedValue(30)

			const result = await countFileLinesAndTokens("/test/file.txt")

			expect(result.lineCount).toBe(3)
			expect(result.tokenEstimate).toBe(30)
			expect(result.complete).toBe(true)
		})

		it("should handle tokenizer errors with conservative estimate", async () => {
			// Create a proper readable stream
			const mockStream = new Readable({
				read() {
					this.push("line1\n")
					this.push(null)
				},
			})

			mockCreateReadStream.mockReturnValue(mockStream as any)
			mockFsAccess.mockResolvedValue(undefined)

			// Simulate tokenizer error
			mockCountTokens.mockRejectedValue(new Error("unreachable"))

			const result = await countFileLinesAndTokens("/test/file.txt")

			// Should still complete with conservative token estimate (content.length)
			expect(result.lineCount).toBe(1)
			expect(result.tokenEstimate).toBeGreaterThan(0)
			expect(result.complete).toBe(true)
		})

		it("should throw error for non-existent files", async () => {
			mockFsAccess.mockRejectedValue(new Error("ENOENT"))

			await expect(countFileLinesAndTokens("/nonexistent/file.txt")).rejects.toThrow("File not found")
		})
	})

	describe("countFileLines", () => {
		it("should throw error for non-existent files", async () => {
			mockFsAccess.mockRejectedValue(new Error("ENOENT"))

			await expect(countFileLines("/nonexistent/file.txt")).rejects.toThrow("File not found")
		})
	})
})
