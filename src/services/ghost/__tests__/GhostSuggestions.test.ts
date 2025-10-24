import { GhostSuggestionsState } from "../GhostSuggestions"
import * as vscode from "vscode"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		file: (path: string) => ({
			toString: () => path,
			fsPath: path,
		}),
	},
}))

describe("GhostSuggestionsState", () => {
	let suggestions: GhostSuggestionsState
	let mockUri: vscode.Uri

	beforeEach(() => {
		suggestions = new GhostSuggestionsState()
		mockUri = vscode.Uri.file("/test/file.ts")
	})

	describe("sortGroups", () => {
		it("should filter out deletion operations with empty content", () => {
			const file = suggestions.addFile(mockUri)

			// Add operations that simulate the user's scenario
			// Group 1: deletion of empty string + addition
			file.addOperation({
				type: "-",
				line: 33,
				oldLine: 33,
				newLine: 33,
				content: "",
			})
			file.addOperation({
				type: "+",
				line: 33,
				oldLine: 35,
				newLine: 33,
				content: "// implement function to divide two numbers",
			})

			// Group 2: only deletion of empty string
			file.addOperation({
				type: "-",
				line: 34,
				oldLine: 34,
				newLine: 33,
				content: "",
			})

			// Group 3: multiple additions
			file.addOperation({
				type: "+",
				line: 34,
				oldLine: 35,
				newLine: 34,
				content: "function divideNumbers(a: number, b: number): number {",
			})
			file.addOperation({
				type: "+",
				line: 35,
				oldLine: 35,
				newLine: 35,
				content: "    if (b === 0) {",
			})

			// Before sorting and filtering
			const groupsBefore = file.getGroupsOperations()
			expect(groupsBefore.length).toBe(3)

			// Sort and filter
			suggestions.sortGroups()

			// After sorting and filtering
			const groupsAfter = file.getGroupsOperations()

			// Group 2 (only empty deletion) should be removed entirely
			expect(groupsAfter.length).toBe(2)

			// Group 1 should only have the addition (empty deletion filtered out)
			const group1 = groupsAfter[0]
			expect(group1.length).toBe(1)
			expect(group1[0].type).toBe("+")
			expect(group1[0].content).toBe("// implement function to divide two numbers")

			// Group 3 should have all additions
			const group2 = groupsAfter[1]
			expect(group2.length).toBe(2)
			expect(group2.every((op) => op.type === "+")).toBe(true)
		})

		it("should not filter out deletions with non-empty content", () => {
			const file = suggestions.addFile(mockUri)

			// Add a deletion with actual content
			file.addOperation({
				type: "-",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "const x = 1;",
			})

			// Add an addition
			file.addOperation({
				type: "+",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "const x = 2;",
			})

			suggestions.sortGroups()

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(2)

			// Both operations should still be present
			const hasDeletion = groups[0].some((op) => op.type === "-" && op.content === "const x = 1;")
			const hasAddition = groups[0].some((op) => op.type === "+" && op.content === "const x = 2;")
			expect(hasDeletion).toBe(true)
			expect(hasAddition).toBe(true)
		})

		it("should handle multiple groups with mixed empty and non-empty deletions", () => {
			const file = suggestions.addFile(mockUri)

			// Group 1: Empty deletion only (should be removed)
			file.addOperation({
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "",
			})

			// Group 2: Non-empty deletion and addition (should be kept)
			file.addOperation({
				type: "-",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "old code",
			})
			file.addOperation({
				type: "+",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "new code",
			})

			// Group 3: Empty deletion + addition (deletion filtered, group kept)
			file.addOperation({
				type: "-",
				line: 15,
				oldLine: 15,
				newLine: 15,
				content: "",
			})
			file.addOperation({
				type: "+",
				line: 15,
				oldLine: 15,
				newLine: 15,
				content: "added line",
			})

			suggestions.sortGroups()

			const groups = file.getGroupsOperations()

			// Should have 2 groups (group 1 removed entirely)
			expect(groups.length).toBe(2)

			// First group should have both operations (non-empty deletion)
			expect(groups[0].length).toBe(2)
			expect(groups[0].some((op) => op.type === "-" && op.content === "old code")).toBe(true)

			// Second group should only have the addition (empty deletion filtered)
			expect(groups[1].length).toBe(1)
			expect(groups[1][0].type).toBe("+")
			expect(groups[1][0].content).toBe("added line")
		})

		it("should filter out addition operations with empty content", () => {
			const file = suggestions.addFile(mockUri)

			// Add operations with empty additions
			file.addOperation({
				type: "+",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "",
			})
			file.addOperation({
				type: "+",
				line: 11,
				oldLine: 11,
				newLine: 11,
				content: "actual content",
			})

			// Group with only empty addition (should be removed)
			file.addOperation({
				type: "+",
				line: 20,
				oldLine: 20,
				newLine: 20,
				content: "",
			})

			suggestions.sortGroups()

			const groups = file.getGroupsOperations()

			// Should only have 1 group (second group removed, first group filtered)
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(1)
			expect(groups[0][0].content).toBe("actual content")
		})

		it("should filter out both empty additions and empty deletions", () => {
			const file = suggestions.addFile(mockUri)

			// Group 1: Empty deletion + empty addition (should be removed entirely)
			file.addOperation({
				type: "-",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "",
			})
			file.addOperation({
				type: "+",
				line: 5,
				oldLine: 5,
				newLine: 5,
				content: "",
			})

			// Group 2: Empty deletion + non-empty addition (deletion filtered, group kept)
			file.addOperation({
				type: "-",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "",
			})
			file.addOperation({
				type: "+",
				line: 10,
				oldLine: 10,
				newLine: 10,
				content: "valid addition",
			})

			// Group 3: Non-empty deletion + empty addition (addition filtered, group kept)
			file.addOperation({
				type: "-",
				line: 15,
				oldLine: 15,
				newLine: 15,
				content: "valid deletion",
			})
			file.addOperation({
				type: "+",
				line: 15,
				oldLine: 15,
				newLine: 15,
				content: "",
			})

			// Group 4: Both non-empty (should be kept as is)
			file.addOperation({
				type: "-",
				line: 20,
				oldLine: 20,
				newLine: 20,
				content: "old code",
			})
			file.addOperation({
				type: "+",
				line: 20,
				oldLine: 20,
				newLine: 20,
				content: "new code",
			})

			suggestions.sortGroups()

			const groups = file.getGroupsOperations()

			// Should have 3 groups (group 1 removed entirely)
			expect(groups.length).toBe(3)

			// Group 1 (originally group 2): Only addition
			expect(groups[0].length).toBe(1)
			expect(groups[0][0].type).toBe("+")
			expect(groups[0][0].content).toBe("valid addition")

			// Group 2 (originally group 3): Only deletion
			expect(groups[1].length).toBe(1)
			expect(groups[1][0].type).toBe("-")
			expect(groups[1][0].content).toBe("valid deletion")

			// Group 3 (originally group 4): Both operations
			expect(groups[2].length).toBe(2)
			expect(groups[2].some((op) => op.type === "-" && op.content === "old code")).toBe(true)
			expect(groups[2].some((op) => op.type === "+" && op.content === "new code")).toBe(true)
		})
	})
})
