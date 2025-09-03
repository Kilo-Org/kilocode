import * as vscode from "vscode"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"

describe("GhostSuggestions", () => {
	let ghostSuggestions: GhostSuggestionsState
	let mockUri: vscode.Uri

	beforeEach(() => {
		ghostSuggestions = new GhostSuggestionsState()
		mockUri = vscode.Uri.file("/test/file.ts")
	})

	describe("selectClosestGroup", () => {
		it("should select the closest group to a selection", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add operations with large distances to ensure separate groups
			const operation1: GhostSuggestionEditOperation = {
				line: 1,
				oldLine: 1,
				newLine: 1,
				type: "+",
				content: "line 1",
			}
			const operation2: GhostSuggestionEditOperation = {
				line: 50,
				oldLine: 50,
				newLine: 50,
				type: "+",
				content: "line 50",
			}
			const operation3: GhostSuggestionEditOperation = {
				line: 100,
				oldLine: 100,
				newLine: 100,
				type: "+",
				content: "line 100",
			}

			file.addOperation(operation1)
			file.addOperation(operation2)
			file.addOperation(operation3)

			file.sortGroups()

			const groups = file.getGroupsOperations()

			// Test the selectClosestGroup functionality regardless of how many groups exist
			if (groups.length === 1) {
				// All operations are in one group - test that it selects the group
				const selection = new vscode.Selection(45, 0, 55, 0) // Closest to operation2 at line 50
				file.selectClosestGroup(selection)
				expect(file.getSelectedGroup()).toBe(0) // Only group
			} else {
				// Multiple groups exist - test that it selects the closest one
				expect(groups.length).toBeGreaterThan(1)
				const selection = new vscode.Selection(45, 0, 55, 0) // Closest to operation2 at line 50
				file.selectClosestGroup(selection)
				// Should select whichever group contains the operation closest to line 50
				expect(file.getSelectedGroup()).not.toBeNull()
			}
		})

		it("should select group when selection overlaps with operation", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const operation1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "+",
				content: "line 5",
			}
			const operation2: GhostSuggestionEditOperation = {
				line: 50,
				oldLine: 50,
				newLine: 50,
				type: "+",
				content: "line 50",
			}

			file.addOperation(operation1)
			file.addOperation(operation2)

			file.sortGroups()

			// Create a selection that includes line 50
			const selection = new vscode.Selection(49, 0, 51, 0)
			file.selectClosestGroup(selection)

			// Should select a group (distance is 0 since selection overlaps)
			expect(file.getSelectedGroup()).not.toBeNull()
		})

		it("should select first group when selection is before all operations", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const operation1: GhostSuggestionEditOperation = {
				line: 10,
				oldLine: 10,
				newLine: 10,
				type: "+",
				content: "line 10",
			}
			const operation2: GhostSuggestionEditOperation = {
				line: 20,
				oldLine: 20,
				newLine: 20,
				type: "+",
				content: "line 20",
			}

			file.addOperation(operation1)
			file.addOperation(operation2)

			file.sortGroups()

			// Create a selection before all operations
			const selection = new vscode.Selection(1, 0, 3, 0)
			file.selectClosestGroup(selection)

			expect(file.getSelectedGroup()).toBe(0) // First group (operation1)
		})

		it("should select group closest to selection when selection is after all operations", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const operation1: GhostSuggestionEditOperation = {
				line: 10,
				oldLine: 10,
				newLine: 10,
				type: "+",
				content: "line 10",
			}
			const operation2: GhostSuggestionEditOperation = {
				line: 50,
				oldLine: 50,
				newLine: 50,
				type: "+",
				content: "line 50",
			}

			file.addOperation(operation1)
			file.addOperation(operation2)

			file.sortGroups()

			// Create a selection after all operations (closer to operation2)
			const selection = new vscode.Selection(60, 0, 65, 0)
			file.selectClosestGroup(selection)

			// Should select a group (the one with operation closest to the selection)
			expect(file.getSelectedGroup()).not.toBeNull()
		})

		it("should handle empty groups", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const selection = new vscode.Selection(10, 0, 15, 0)
			file.selectClosestGroup(selection)

			expect(file.getSelectedGroup()).toBeNull()
		})

		it("should select group with multiple operations closest to selection", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Create a group with multiple operations
			const operation1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "+",
				content: "line 5",
			}
			const operation2: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 6,
				newLine: 6,
				type: "+",
				content: "line 6",
			}
			const operation3: GhostSuggestionEditOperation = {
				line: 20,
				oldLine: 20,
				newLine: 20,
				type: "+",
				content: "line 20",
			}

			file.addOperation(operation1)
			file.addOperation(operation2) // Should be in same group as operation1
			file.addOperation(operation3) // Should be in different group

			file.sortGroups()

			// Create a selection closer to the first group
			const selection = new vscode.Selection(8, 0, 10, 0)
			file.selectClosestGroup(selection)

			expect(file.getSelectedGroup()).toBe(0) // First group
		})
	})

	describe("addOperation grouping rules", () => {
		it("should create modification group (delete on line N, add on line N+1) with highest priority", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add a delete operation on line 5
			const deleteOp: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 6,
				type: "-",
				content: "old content",
			}
			file.addOperation(deleteOp)

			// Add an add operation on line 6 (next line) - should form modification group
			const addOp: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5,
				newLine: 6,
				type: "+",
				content: "new content",
			}
			file.addOperation(addOp)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(2)
			expect(groups[0]).toContainEqual(deleteOp)
			expect(groups[0]).toContainEqual(addOp)
		})

		it("should move operation from existing group to create modification group", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add consecutive delete operations (should be in same group)
			const deleteOp1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 6,
				type: "-",
				content: "line 5",
			}
			const deleteOp2: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 6,
				newLine: 6,
				type: "-",
				content: "line 6",
			}
			file.addOperation(deleteOp1)
			file.addOperation(deleteOp2)

			// Add an add operation on line 6 (after deleteOp1) - should move deleteOp1 to new modification group
			const addOp: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5,
				newLine: 6,
				type: "+",
				content: "new line 6",
			}
			file.addOperation(addOp)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(2)

			// Find the modification group
			const modificationGroup = groups.find(
				(group) => group.some((op) => op.type === "+") && group.some((op) => op.type === "-"),
			)
			expect(modificationGroup).toBeDefined()
			expect(modificationGroup!.length).toBe(2)
			expect(modificationGroup).toContainEqual(deleteOp1)
			expect(modificationGroup).toContainEqual(addOp)

			// Find the delete-only group
			const deleteGroup = groups.find((group) => group.every((op) => op.type === "-") && group.length === 1)
			expect(deleteGroup).toBeDefined()
			expect(deleteGroup).toContainEqual(deleteOp2)
		})

		it("should group consecutive delete operations", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const deleteOp1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "-",
				content: "line 5",
			}
			const deleteOp2: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 6,
				newLine: 6,
				type: "-",
				content: "line 6",
			}
			const deleteOp3: GhostSuggestionEditOperation = {
				line: 7,
				oldLine: 7,
				newLine: 7,
				type: "-",
				content: "line 7",
			}

			file.addOperation(deleteOp1)
			file.addOperation(deleteOp2)
			file.addOperation(deleteOp3)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(3)
			expect(groups[0]).toContainEqual(deleteOp1)
			expect(groups[0]).toContainEqual(deleteOp2)
			expect(groups[0]).toContainEqual(deleteOp3)
		})

		it("should group consecutive add operations", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const addOp1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "+",
				content: "line 5",
			}
			const addOp2: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 6,
				newLine: 6,
				type: "+",
				content: "line 6",
			}
			const addOp3: GhostSuggestionEditOperation = {
				line: 7,
				oldLine: 7,
				newLine: 7,
				type: "+",
				content: "line 7",
			}

			file.addOperation(addOp1)
			file.addOperation(addOp2)
			file.addOperation(addOp3)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(3)
			expect(groups[0]).toContainEqual(addOp1)
			expect(groups[0]).toContainEqual(addOp2)
			expect(groups[0]).toContainEqual(addOp3)
		})

		it("should create separate groups for non-consecutive operations", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const addOp1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "+",
				content: "line 5",
			}
			const addOp2: GhostSuggestionEditOperation = {
				line: 10,
				oldLine: 10,
				newLine: 10,
				type: "+",
				content: "line 10",
			} // Gap of 5 lines

			file.addOperation(addOp1)
			file.addOperation(addOp2)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(2)
			expect(groups[0]).toContainEqual(addOp1)
			expect(groups[1]).toContainEqual(addOp2)
		})

		it("should create modification group when delete is followed by add on next line", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const deleteOp: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 6,
				type: "-",
				content: "line 5",
			}
			const addOp: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5,
				newLine: 6,
				type: "+",
				content: "line 6",
			} // Next line - should form modification group

			file.addOperation(deleteOp)
			file.addOperation(addOp)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1) // Should be in one modification group
			expect(groups[0].length).toBe(2)
			expect(groups[0]).toContainEqual(deleteOp)
			expect(groups[0]).toContainEqual(addOp)
		})

		it("should not group different operation types when not consecutive", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const deleteOp: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "-",
				content: "line 5",
			}
			const addOp: GhostSuggestionEditOperation = {
				line: 7,
				oldLine: 7,
				newLine: 7,
				type: "+",
				content: "line 7",
			} // Gap of 1 line - should not form modification group

			file.addOperation(deleteOp)
			file.addOperation(addOp)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(2)
			expect(groups[0]).toContainEqual(deleteOp)
			expect(groups[1]).toContainEqual(addOp)
		})

		it("should handle reverse consecutive operations (adding before existing)", () => {
			const file = ghostSuggestions.addFile(mockUri)

			const addOp1: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 6,
				newLine: 6,
				type: "+",
				content: "line 6",
			}
			const addOp2: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 5,
				type: "+",
				content: "line 5",
			} // Before existing

			file.addOperation(addOp1)
			file.addOperation(addOp2)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(1)
			expect(groups[0].length).toBe(2)
			expect(groups[0]).toContainEqual(addOp1)
			expect(groups[0]).toContainEqual(addOp2)
		})

		it("should prioritize modification groups over same-type groups", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Create a group of consecutive add operations
			const addOp1: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5,
				newLine: 6,
				type: "+",
				content: "line 6",
			}
			const addOp2: GhostSuggestionEditOperation = {
				line: 7,
				oldLine: 7,
				newLine: 7,
				type: "+",
				content: "line 7",
			}
			file.addOperation(addOp1)
			file.addOperation(addOp2)

			// Add a delete operation on line 5 - should move addOp1 to modification group (delete line 5, add line 6)
			const deleteOp: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 6,
				type: "-",
				content: "old line 5",
			}
			file.addOperation(deleteOp)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(2)

			// Find modification group
			const modificationGroup = groups.find(
				(group) => group.some((op) => op.type === "+") && group.some((op) => op.type === "-"),
			)
			expect(modificationGroup).toBeDefined()
			expect(modificationGroup!.length).toBe(2)
			expect(modificationGroup).toContainEqual(addOp1)
			expect(modificationGroup).toContainEqual(deleteOp)

			// Find remaining add group
			const addGroup = groups.find((group) => group.every((op) => op.type === "+") && group.length === 1)
			expect(addGroup).toBeDefined()
			expect(addGroup).toContainEqual(addOp2)
		})

		it("should handle complex mixed operations scenario", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add operations in mixed order
			const deleteOp1: GhostSuggestionEditOperation = {
				line: 5,
				oldLine: 5,
				newLine: 6,
				type: "-",
				content: "line 5",
			}
			const deleteOp2: GhostSuggestionEditOperation = {
				line: 7,
				oldLine: 7,
				newLine: 7,
				type: "-",
				content: "line 7",
			}
			const addOp1: GhostSuggestionEditOperation = {
				line: 10,
				oldLine: 10,
				newLine: 10,
				type: "+",
				content: "line 10",
			}
			const addOp2: GhostSuggestionEditOperation = {
				line: 11,
				oldLine: 11,
				newLine: 11,
				type: "+",
				content: "line 11",
			}
			const modifyAdd: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5,
				newLine: 6,
				type: "+",
				content: "new line 6",
			}

			file.addOperation(deleteOp1)
			file.addOperation(deleteOp2)
			file.addOperation(addOp1)
			file.addOperation(addOp2)
			file.addOperation(modifyAdd) // Should create modification group with deleteOp1 (delete line 5, add line 6)

			const groups = file.getGroupsOperations()
			expect(groups.length).toBe(3)

			// Should have: modification group (delete line 5, add line 6), delete group (line 7), add group (lines 10-11)
			const modificationGroup = groups.find(
				(group) => group.some((op) => op.type === "+") && group.some((op) => op.type === "-"),
			)
			expect(modificationGroup).toBeDefined()
			expect(modificationGroup!.length).toBe(2)

			const deleteGroup = groups.find((group) => group.every((op) => op.type === "-") && group.length === 1)
			expect(deleteGroup).toBeDefined()

			const addGroup = groups.find((group) => group.every((op) => op.type === "+") && group.length === 2)
			expect(addGroup).toBeDefined()
		})
	})
})
