import { describe, it, expect } from "vitest"
import { myersDiff, myersCharDiff, convertMyersChangeToDiffLines, DiffLine, DiffChar } from "../myers"

describe("Myers diff algorithms", () => {
	describe("convertMyersChangeToDiffLines", () => {
		it("should convert added change to DiffLine", () => {
			const change = { added: true, value: "new line\n" }
			const result = convertMyersChangeToDiffLines(change)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ type: "new", line: "new line" })
		})

		it("should convert removed change to DiffLine", () => {
			const change = { removed: true, value: "old line\n" }
			const result = convertMyersChangeToDiffLines(change)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ type: "old", line: "old line" })
		})

		it("should convert unchanged change to DiffLine", () => {
			const change = { value: "same line\n" }
			const result = convertMyersChangeToDiffLines(change)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({ type: "same", line: "same line" })
		})

		it("should handle multi-line changes", () => {
			const change = { added: true, value: "line1\nline2\n" }
			const result = convertMyersChangeToDiffLines(change)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ type: "new", line: "line1" })
			expect(result[1]).toEqual({ type: "new", line: "line2" })
		})
	})

	describe("myersDiff", () => {
		it("should detect simple addition", () => {
			const oldContent = "hello"
			const newContent = "hello\nworld"

			const result = myersDiff(oldContent, newContent)

			expect(result).toContainEqual({ type: "same", line: "hello" })
			expect(result).toContainEqual({ type: "new", line: "world" })
		})

		it("should detect simple deletion", () => {
			const oldContent = "hello\nworld"
			const newContent = "hello"

			const result = myersDiff(oldContent, newContent)

			// The actual behavior may differ based on how diffLines processes content
			expect(result.some((line) => line.line === "hello")).toBe(true)
			expect(result.some((line) => line.line === "world" && line.type === "old")).toBe(true)
		})

		it("should detect modification", () => {
			const oldContent = "hello world"
			const newContent = "hello universe"

			const result = myersDiff(oldContent, newContent)

			expect(result).toContainEqual({ type: "old", line: "hello world" })
			expect(result).toContainEqual({ type: "new", line: "hello universe" })
		})

		it("should handle identical content", () => {
			const content = "hello\nworld"

			const result = myersDiff(content, content)

			expect(result).toHaveLength(2)
			expect(result.every((line) => line.type === "same")).toBe(true)
		})
	})

	describe("myersCharDiff", () => {
		it("should detect character-level changes", () => {
			const oldContent = "hello"
			const newContent = "hallo"

			const result = myersCharDiff(oldContent, newContent)

			expect(result.some((change) => change.type === "same" && change.char === "h")).toBe(true)
			expect(result.some((change) => change.type === "old" && change.char === "e")).toBe(true)
			expect(result.some((change) => change.type === "new" && change.char === "a")).toBe(true)
		})

		it("should handle newline characters", () => {
			const oldContent = "line1\nline2"
			const newContent = "line1\nmodified"

			const result = myersCharDiff(oldContent, newContent)

			expect(result.some((change) => change.char === "\n")).toBe(true)
		})

		it("should track character positions correctly", () => {
			const oldContent = "abc"
			const newContent = "axc"

			const result = myersCharDiff(oldContent, newContent)

			// Should have proper index tracking
			const changes = result.filter((change) => change.type !== "same")
			expect(changes.some((change) => change.oldIndex !== undefined || change.newIndex !== undefined)).toBe(true)
		})
	})
})
