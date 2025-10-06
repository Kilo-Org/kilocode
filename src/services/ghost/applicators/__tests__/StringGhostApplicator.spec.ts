import { describe, it, expect, beforeEach } from "vitest"
import { StringGhostApplicator } from "../StringGhostApplicator"
import { GhostSuggestionsState } from "../../GhostSuggestions"
import { MockTextDocument } from "../../../mocking/MockTextDocument"
import * as vscode from "vscode"

/**
 * Tests for StringGhostApplicator - the test-friendly implementation of IGhostApplicator
 * This validates that the platform-independent application logic works correctly
 */
describe("StringGhostApplicator", () => {
	let applicator: StringGhostApplicator
	let mockDocument: MockTextDocument
	let suggestions: GhostSuggestionsState

	beforeEach(() => {
		applicator = new StringGhostApplicator()
		mockDocument = new MockTextDocument(vscode.Uri.file("/test.js"), "")
		suggestions = new GhostSuggestionsState()
	})

	describe("Basic Operations", () => {
		it("should require original content to be set before applying", async () => {
			const fileUri = mockDocument.uri.toString()

			await expect(applicator.applyAll(suggestions, fileUri)).rejects.toThrow(
				`No original content set for ${fileUri}. Call setOriginalContent() first.`,
			)
		})

		it("should store and retrieve original content", () => {
			const fileUri = mockDocument.uri.toString()
			const content = "console.log('hello');"

			applicator.setOriginalContent(fileUri, content)

			// Should not throw when applying after setting content
			expect(() => applicator.setOriginalContent(fileUri, content)).not.toThrow()
		})

		it("should track locked state", () => {
			expect(applicator.isLocked()).toBe(false)
		})

		it("should clear all stored content", () => {
			const fileUri = mockDocument.uri.toString()
			const content = "test content"

			applicator.setOriginalContent(fileUri, content)
			applicator.clear()

			// Should throw after clearing
			expect(applicator.applyAll(suggestions, fileUri)).rejects.toThrow()
		})
	})

	describe("Application Logic", () => {
		it("should apply simple addition operations", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `function test() {
    console.log('start');
    console.log('end');
}`

			applicator.setOriginalContent(fileUri, originalContent)

			// Add a line in the middle
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 2,
				content: "    console.log('middle');",
				oldLine: 2,
				newLine: 2,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe(`function test() {
    console.log('start');
    console.log('middle');
    console.log('end');
}`)
		})

		it("should apply deletion operations", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `function test() {
    console.log('start');
    console.log('middle');
    console.log('end');
}`

			applicator.setOriginalContent(fileUri, originalContent)

			// Delete the middle line
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "-",
				line: 2,
				content: "",
				oldLine: 2,
				newLine: 2,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe(`function test() {
    console.log('start');
    console.log('end');
}`)
		})

		it("should apply multiple operations in correct order", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `function test() {
    console.log('line1');
    console.log('line3');
}`

			applicator.setOriginalContent(fileUri, originalContent)

			// Add line2 and line4
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 2,
				content: "    console.log('line2');",
				oldLine: 2,
				newLine: 2,
			})
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 3,
				content: "    console.log('line4');",
				oldLine: 3,
				newLine: 3,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe(`function test() {
    console.log('line1');
    console.log('line2');
    console.log('line3');
    console.log('line4');
}`)
		})

		it("should handle operations at document boundaries", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `line1
line2`

			applicator.setOriginalContent(fileUri, originalContent)

			// Add at beginning and end
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 0,
				content: "line0",
				oldLine: 0,
				newLine: 0,
			})
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 3,
				content: "line3",
				oldLine: 3,
				newLine: 3,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe(`line0
line1
line2
line3`)
		})

		it("should handle empty content", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = ""

			applicator.setOriginalContent(fileUri, originalContent)

			// Add first line
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 0,
				content: "first line",
				oldLine: 0,
				newLine: 0,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe("first line")
		})
	})

	describe("Selected vs All Application", () => {
		it("should apply only first group with applySelected", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `line1
line2
line3`

			applicator.setOriginalContent(fileUri, originalContent)

			// Create two groups of operations
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 1,
				content: "group1-line1",
				oldLine: 1,
				newLine: 1,
			})
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 2,
				content: "group1-line2",
				oldLine: 2,
				newLine: 2,
			})

			// Force a new group by adding non-consecutive operation
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 5,
				content: "group2-line",
				oldLine: 5,
				newLine: 5,
			})

			await applicator.applySelected(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			// Should only apply first group
			expect(result).toBe(`line1
group1-line1
group1-line2
line2
line3`)
		})

		it("should apply all groups with applyAll", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `line1
line2
line3
line4
line5`

			applicator.setOriginalContent(fileUri, originalContent)

			// Create two separate groups with non-consecutive operations
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 1,
				content: "group1-line",
				oldLine: 1,
				newLine: 1,
			})
			// Skip line 2 to force a new group
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 4,
				content: "group2-line",
				oldLine: 4,
				newLine: 4,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			// Should apply both groups
			expect(result).toBe(`line1
group1-line
line2
line3
line4
group2-line
line5`)
		})
	})

	describe("Error Handling", () => {
		it("should handle invalid line numbers gracefully", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `line1
line2`

			applicator.setOriginalContent(fileUri, originalContent)

			// Add operation with invalid line number
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: 10, // Beyond document end
				content: "invalid line",
				oldLine: 10,
				newLine: 10,
			})

			// Should not throw, but should handle gracefully
			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			// Original content should be preserved
			expect(result).toBe(originalContent)
		})

		it("should handle negative line numbers", async () => {
			const fileUri = mockDocument.uri.toString()
			const originalContent = `line1
line2`

			applicator.setOriginalContent(fileUri, originalContent)

			// Add operation with negative line number
			suggestions.addFile(mockDocument.uri).addOperation({
				type: "+",
				line: -1,
				content: "negative line",
				oldLine: -1,
				newLine: -1,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			// Should handle gracefully
			expect(result).toBe(originalContent)
		})
	})

	describe("Platform Independence", () => {
		it("should work with string URIs", async () => {
			const fileUri = "file:///test/example.js"
			const originalContent = "const x = 1;"

			applicator.setOriginalContent(fileUri, originalContent)

			// Create a URI object for the same file
			const testUri = vscode.Uri.parse(fileUri)
			suggestions.addFile(testUri).addOperation({
				type: "+",
				line: 1,
				content: "const y = 2;",
				oldLine: 1,
				newLine: 1,
			})

			await applicator.applyAll(suggestions, fileUri)
			const result = applicator.getResult(fileUri)

			expect(result).toBe(`const x = 1;
const y = 2;`)
		})

		it("should handle multiple files independently", async () => {
			const fileUri1 = "file:///test1.js"
			const fileUri2 = "file:///test2.js"
			const content1 = "file1 content"
			const content2 = "file2 content"

			applicator.setOriginalContent(fileUri1, content1)
			applicator.setOriginalContent(fileUri2, content2)

			// Apply different operations to each file
			const suggestions1 = new GhostSuggestionsState()
			const testUri1 = vscode.Uri.parse(fileUri1)
			suggestions1.addFile(testUri1).addOperation({
				type: "+",
				line: 1,
				content: "file1 addition",
				oldLine: 1,
				newLine: 1,
			})

			const suggestions2 = new GhostSuggestionsState()
			const testUri2 = vscode.Uri.parse(fileUri2)
			suggestions2.addFile(testUri2).addOperation({
				type: "+",
				line: 1,
				content: "file2 addition",
				oldLine: 1,
				newLine: 1,
			})

			await applicator.applyAll(suggestions1, fileUri1)
			await applicator.applyAll(suggestions2, fileUri2)

			expect(applicator.getResult(fileUri1)).toBe(`file1 content
file1 addition`)
			expect(applicator.getResult(fileUri2)).toBe(`file2 content
file2 addition`)
		})
	})
})
