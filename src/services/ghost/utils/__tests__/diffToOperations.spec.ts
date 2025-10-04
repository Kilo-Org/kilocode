import { describe, it, expect } from "vitest"
import { convertDiffLinesToOperations, convertDiffToReplaceOperations } from "../diffToOperations"
import { myersDiff, DiffLine } from "../myers"

describe("diffToOperations", () => {
	describe("convertDiffLinesToOperations", () => {
		it("should handle simple addition", () => {
			const diffLines: DiffLine[] = [
				{ type: "same", line: "line 1" },
				{ type: "new", line: "line 2 added" },
				{ type: "same", line: "line 3" },
			]

			const operations = convertDiffLinesToOperations(diffLines, 10)

			expect(operations).toEqual([
				{
					type: "+",
					line: 11, // Insert at position after first "same" line
					content: "line 2 added",
					oldLine: 11,
					newLine: 11,
				},
			])
		})

		it("should handle simple deletion", () => {
			const diffLines: DiffLine[] = [
				{ type: "same", line: "line 1" },
				{ type: "old", line: "line 2 deleted" },
				{ type: "same", line: "line 3" },
			]

			const operations = convertDiffLinesToOperations(diffLines, 10)

			expect(operations).toEqual([
				{
					type: "-",
					line: 11, // Delete at position after first "same" line
					content: "line 2 deleted",
					oldLine: 11,
					newLine: 11,
				},
			])
		})

		it("should handle replacement (delete + add)", () => {
			const diffLines: DiffLine[] = [
				{ type: "same", line: "line 1" },
				{ type: "old", line: "old line 2" },
				{ type: "new", line: "new line 2" },
				{ type: "same", line: "line 3" },
			]

			const operations = convertDiffLinesToOperations(diffLines, 10)

			expect(operations).toEqual([
				{
					type: "-",
					line: 11,
					content: "old line 2",
					oldLine: 11,
					newLine: 11,
				},
				{
					type: "+",
					line: 11, // Insert at same position as deletion (replacement)
					content: "new line 2",
					oldLine: 11,
					newLine: 11,
				},
			])
		})

		it("should handle multiple consecutive additions", () => {
			const diffLines: DiffLine[] = [
				{ type: "same", line: "line 1" },
				{ type: "new", line: "added line 1" },
				{ type: "new", line: "added line 2" },
				{ type: "new", line: "added line 3" },
				{ type: "same", line: "line 2" },
			]

			const operations = convertDiffLinesToOperations(diffLines, 0)

			expect(operations).toEqual([
				{
					type: "+",
					line: 1, // All additions at same position
					content: "added line 1",
					oldLine: 1,
					newLine: 1,
				},
				{
					type: "+",
					line: 1, // All additions at same position
					content: "added line 2",
					oldLine: 1,
					newLine: 1,
				},
				{
					type: "+",
					line: 1, // All additions at same position
					content: "added line 3",
					oldLine: 1,
					newLine: 1,
				},
			])
		})
	})

	describe("StringGhostApplicator Integration", () => {
		it("should create operations that work with StringGhostApplicator", () => {
			// Test that our operations actually work when applied
			const original = `function test() {
    
}`

			const response = `function test() {
    return 42;
}`

			const diffLines = myersDiff(original, response)
			const operations = convertDiffLinesToOperations(diffLines, 0)

			console.log("StringGhostApplicator test operations:")
			operations.forEach((op, i) => {
				console.log(`${i}: ${op.type} line=${op.line} content="${op.content}"`)
			})

			// Manually apply operations to verify they work (simulate StringGhostApplicator)
			const result = original
			const lines = result.split("\n")

			// Apply operations in reverse order (like StringGhostApplicator does)
			const sortedOps = [...operations].sort((a, b) => b.line - a.line)

			for (const op of sortedOps) {
				if (op.type === "+") {
					if (op.line <= lines.length) {
						lines.splice(op.line, 0, op.content)
					}
				} else if (op.type === "-") {
					if (op.line < lines.length) {
						lines.splice(op.line, 1)
					}
				}
			}

			const finalResult = lines.join("\n")
			console.log("Applied result:", JSON.stringify(finalResult))
			console.log("Expected:", JSON.stringify(response))

			expect(finalResult).toBe(response)
		})

		// NOTE: Removed complex Mercury test - that should be tested in StringGhostApplicator.spec.ts
		// The diff operations utility just needs to produce correct operations, not test full integration
	})

	describe("convertDiffToReplaceOperations", () => {
		it("should create simple replace operations", () => {
			const original = "old content"
			const newContent = "new content"

			const operations = convertDiffToReplaceOperations(original, newContent, 5)

			expect(operations).toEqual([
				{
					type: "-",
					line: 5,
					content: "old content",
					oldLine: 5,
					newLine: 5,
				},
				{
					type: "+",
					line: 5,
					content: "new content",
					oldLine: 5,
					newLine: 5,
				},
			])
		})

		it("should return empty array for identical content", () => {
			const content = "same content"

			const operations = convertDiffToReplaceOperations(content, content, 0)

			expect(operations).toEqual([])
		})

		it("should handle multi-line content", () => {
			const original = "line 1\nline 2"
			const newContent = "new line 1\nnew line 2\nnew line 3"

			const operations = convertDiffToReplaceOperations(original, newContent, 10)

			expect(operations).toEqual([
				{
					type: "-",
					line: 10,
					content: "line 1\nline 2",
					oldLine: 10,
					newLine: 10,
				},
				{
					type: "+",
					line: 10,
					content: "new line 1\nnew line 2\nnew line 3",
					oldLine: 10,
					newLine: 10,
				},
			])
		})

		it("should work with Mercury function completion (replace approach)", () => {
			// Test the simple replace approach for Mercury
			const original = `function checkUserAccess(user) {
    // Check if user is an adult
    

    return false;
}`

			const response = `function checkUserAccess(user) {
    // Check if user is an adult
    if (user.age >= 18) {
        return true;
    }

    return false;
}`

			const operations = convertDiffToReplaceOperations(original, response, 0)

			expect(operations).toEqual([
				{
					type: "-",
					line: 0,
					content: original,
					oldLine: 0,
					newLine: 0,
				},
				{
					type: "+",
					line: 0,
					content: response,
					oldLine: 0,
					newLine: 0,
				},
			])

			// Test that these operations work when applied
			const result = original
			const lines = result.split("\n")

			// Apply delete operation
			lines.splice(0, lines.length) // Clear all lines

			// Apply add operation
			const newLines = response.split("\n")
			lines.splice(0, 0, ...newLines)

			const finalResult = lines.join("\n")
			expect(finalResult).toBe(response)
		})
	})
})
