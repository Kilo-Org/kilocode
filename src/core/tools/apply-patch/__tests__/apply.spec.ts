import { applyChunksToContent, ApplyPatchError } from "../apply"
import type { UpdateFileChunk } from "../parser"

describe("apply-patch apply", () => {
	describe("applyChunksToContent", () => {
		it("should apply simple replacement", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["foo", "bar"],
					newLines: ["foo", "baz"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\nbaz\n")
		})

		it("should apply insertion", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["foo"],
					newLines: ["foo", "inserted"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\ninserted\nbar\n")
		})

		it("should apply deletion", () => {
			const original = "foo\nbar\nbaz\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["foo", "bar"],
					newLines: ["foo"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\nbaz\n")
		})

		it("should apply multiple chunks", () => {
			const original = "foo\nbar\nbaz\nqux\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["foo", "bar"],
					newLines: ["foo", "BAR"],
					isEndOfFile: false,
				},
				{
					changeContext: null,
					oldLines: ["baz", "qux"],
					newLines: ["baz", "QUX"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\nBAR\nbaz\nQUX\n")
		})

		it("should use context to find location", () => {
			const original = "class Foo:\n    def bar(self):\n        pass\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: "def bar(self):",
					oldLines: ["        pass"],
					newLines: ["        return 123"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.py", chunks)
			expect(result).toBe("class Foo:\n    def bar(self):\n        return 123\n")
		})

		it("should throw when context not found", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: "nonexistent",
					oldLines: ["foo"],
					newLines: ["baz"],
					isEndOfFile: false,
				},
			]
			expect(() => applyChunksToContent(original, "test.txt", chunks)).toThrow(ApplyPatchError)
			expect(() => applyChunksToContent(original, "test.txt", chunks)).toThrow("Failed to find context")
		})

		it("should throw when old lines not found", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["nonexistent"],
					newLines: ["baz"],
					isEndOfFile: false,
				},
			]
			expect(() => applyChunksToContent(original, "test.txt", chunks)).toThrow(ApplyPatchError)
			expect(() => applyChunksToContent(original, "test.txt", chunks)).toThrow("Failed to find expected lines")
		})

		it("should handle pure addition (empty oldLines)", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: [],
					newLines: ["added"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			// Pure addition goes at the end
			expect(result).toBe("foo\nbar\nadded\n")
		})

		it("should handle isEndOfFile flag", () => {
			const original = "foo\nbar\nbaz\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["baz"],
					newLines: ["BAZ", "qux"],
					isEndOfFile: true,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\nbar\nBAZ\nqux\n")
		})

		it("should handle interleaved changes", () => {
			const original = "a\nb\nc\nd\ne\nf\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["a", "b"],
					newLines: ["a", "B"],
					isEndOfFile: false,
				},
				{
					changeContext: null,
					oldLines: ["d", "e"],
					newLines: ["d", "E"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("a\nB\nc\nd\nE\nf\n")
		})

		it("should preserve trailing newline in result", () => {
			const original = "foo\nbar"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["bar"],
					newLines: ["baz"],
					isEndOfFile: false,
				},
			]
			const result = applyChunksToContent(original, "test.txt", chunks)
			// Should add trailing newline
			expect(result).toBe("foo\nbaz\n")
		})

		it("should handle trailing empty line in pattern", () => {
			const original = "foo\nbar\n"
			const chunks: UpdateFileChunk[] = [
				{
					changeContext: null,
					oldLines: ["foo", "bar", ""],
					newLines: ["foo", "baz", ""],
					isEndOfFile: false,
				},
			]
			// Should still work by stripping trailing empty
			const result = applyChunksToContent(original, "test.txt", chunks)
			expect(result).toBe("foo\nbaz\n")
		})
	})
})
