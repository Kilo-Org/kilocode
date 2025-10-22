import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationsOffset } from "./types"

export class GhostSuggestionFile {
	public fileUri: vscode.Uri
	private selectedGroup: number | null = null
	private groups: Array<GhostSuggestionEditOperation[]> = []

	constructor(public uri: vscode.Uri) {
		this.fileUri = uri
	}

	public addOperation(operation: GhostSuggestionEditOperation) {
		// Priority 1: Try to create or join a modification group (delete on line N, add on line N+1)
		const modificationGroupIndex = this.findOrCreateModificationGroup(operation)
		if (modificationGroupIndex !== -1) {
			return
		}

		// Priority 2: Try to join an existing group of same type on subsequent lines
		const sameTypeGroupIndex = this.findSameTypeGroup(operation)
		if (sameTypeGroupIndex !== -1) {
			this.groups[sameTypeGroupIndex].push(operation)
			return
		}

		// Priority 3: Create a new group
		this.groups.push([operation])
	}

	private findOrCreateModificationGroup(operation: GhostSuggestionEditOperation): number {
		// Look for existing operations that can form a modification group
		// Modification group: delete on line N, add on line N+1
		for (let i = 0; i < this.groups.length; i++) {
			const group = this.groups[i]

			for (const existingOp of group) {
				// Check if we can form a modification group
				const canFormModificationGroup =
					(operation.type === "+" && existingOp.type === "-" && existingOp.newLine === operation.newLine) ||
					(operation.type === "-" && existingOp.type === "+" && operation.newLine === existingOp.newLine)

				if (canFormModificationGroup) {
					// Remove the existing operation from its current group
					this.removeOperationFromGroup(i, existingOp)

					// Create new modification group with delete first, then add
					const deleteOp = operation.type === "-" ? operation : existingOp
					const addOp = operation.type === "+" ? operation : existingOp
					this.groups.push([deleteOp, addOp])
					return this.groups.length - 1
				}
			}
		}
		return -1
	}

	private findSameTypeGroup(operation: GhostSuggestionEditOperation): number {
		for (let i = 0; i < this.groups.length; i++) {
			const group = this.groups[i]

			// Skip modification groups (groups with both + and -)
			const hasDelete = group.some((op) => op.type === "-")
			const hasAdd = group.some((op) => op.type === "+")
			if (hasDelete && hasAdd) {
				continue
			}

			// Check if group has same type operations
			if (group.length > 0 && group[0].type === operation.type) {
				// Check if the operation is on a subsequent line
				const maxLine = Math.max(...group.map((op) => op.line))
				const minLine = Math.min(...group.map((op) => op.line))

				if (operation.line === maxLine + 1 || operation.line === minLine - 1) {
					return i
				}
			}
		}
		return -1
	}

	private removeOperationFromGroup(groupIndex: number, operation: GhostSuggestionEditOperation) {
		const group = this.groups[groupIndex]
		const opIndex = group.findIndex(
			(op) => op.line === operation.line && op.type === operation.type && op.content === operation.content,
		)

		if (opIndex !== -1) {
			group.splice(opIndex, 1)

			// Remove empty groups
			if (group.length === 0) {
				this.groups.splice(groupIndex, 1)
			}
		}
	}

	public isEmpty(): boolean {
		return this.groups.length === 0
	}

	public getSelectedGroup(): number | null {
		return this.selectedGroup
	}

	public getGroupType = (group: GhostSuggestionEditOperation[]): "+" | "-" | "/" => {
		if (group.length === 0) {
			return "+" // Default to addition for empty groups
		}

		const hasAdd = group.some((op) => op.type === "+")
		const hasDel = group.some((op) => op.type === "-")

		// Modification: has both additions and deletions
		if (hasAdd && hasDel) {
			return "/"
		}

		// Pure addition or deletion
		return group[0].type
	}

	public getSelectedGroupPreviousOperations(): GhostSuggestionEditOperation[] {
		if (this.selectedGroup === null || this.selectedGroup <= 0) {
			return []
		}
		const previousGroups = this.groups.slice(0, this.selectedGroup)
		return previousGroups.flat()
	}

	public getSelectedGroupOperations(): GhostSuggestionEditOperation[] {
		if (this.selectedGroup === null || this.selectedGroup >= this.groups.length) {
			return []
		}
		return this.groups[this.selectedGroup]
	}

	public getPlaceholderOffsetSelectedGroupOperations(): GhostSuggestionEditOperationsOffset {
		const operations = this.getSelectedGroupPreviousOperations()
		const { added, removed } = operations.reduce(
			(acc, op) => {
				if (op.type === "+") {
					return { added: acc.added + 1, removed: acc.removed }
				} else if (op.type === "-") {
					return { added: acc.added, removed: acc.removed + 1 }
				}
				return acc
			},
			{ added: 0, removed: 0 },
		)
		return { added, removed, offset: added - removed }
	}

	public getGroupsOperations(): GhostSuggestionEditOperation[][] {
		return this.groups
	}

	public getAllOperations(): GhostSuggestionEditOperation[] {
		return this.groups.flat().sort((a, b) => a.line - b.line)
	}

	public sortGroups() {
		this.groups
			.sort((a, b) => {
				const aLine = a[0].line
				const bLine = b[0].line
				return aLine - bLine
			})
			.forEach((group) => {
				group.sort((a, b) => a.line - b.line)
			})

		// Filter out empty operations after sorting
		this.removeOperationsWithEmptyContent()

		this.selectedGroup = this.groups.length > 0 ? 0 : null
	}

	/**
	 * Remove operations with empty content and clean up empty groups
	 *
	 * This filters out operations that have no actual content (empty strings),
	 * which can occur when the LLM generates malformed diffs or placeholder operations.
	 * After filtering operations, any groups that become empty are also removed.
	 *
	 * Example:
	 * Before: [
	 *   [{ type: '+', content: 'function foo() {', line: 1 }],
	 *   [{ type: '-', content: '', line: 2 }],  // Empty deletion - will be removed
	 *   [{ type: '+', content: 'return 42;', line: 3 }]
	 * ]
	 * After: [
	 *   [{ type: '+', content: 'function foo() {', line: 1 }],
	 *   [{ type: '+', content: 'return 42;', line: 3 }]
	 * ]
	 */
	private removeOperationsWithEmptyContent() {
		// Filter each group to remove operations (additions and deletions) with empty content
		this.groups = this.groups
			.map((group) => {
				return group.filter((op) => {
					if (op.type === "-" || op.type === "+") {
						// Only keep deletions and additions that have non-empty content
						return op.content !== ""
					} else {
						return true
					}
				})
			})
			.filter((group) => group.length > 0) // Remove empty groups
	}

	private computeOperationsOffset(group: GhostSuggestionEditOperation[]): GhostSuggestionEditOperationsOffset {
		const { added, removed } = group.reduce(
			(acc, op) => {
				if (op.type === "+") {
					return { added: acc.added + 1, removed: acc.removed }
				} else if (op.type === "-") {
					return { added: acc.added, removed: acc.removed + 1 }
				}
				return acc
			},
			{ added: 0, removed: 0 },
		)
		return { added, removed, offset: added - removed }
	}

	public deleteSelectedGroup() {
		if (this.selectedGroup !== null && this.selectedGroup < this.groups.length) {
			const deletedGroup = this.groups.splice(this.selectedGroup, 1)
			const { offset } = this.computeOperationsOffset(deletedGroup[0])
			// update deleted operations in the next groups
			for (let i = this.selectedGroup; i < this.groups.length; i++) {
				for (let j = 0; j < this.groups[i].length; j++) {
					const op = this.groups[i][j]
					if (op.type === "-") {
						op.line = op.line + offset
					}
					op.oldLine = op.oldLine + offset
				}
			}
			// reset selected group
			this.selectedGroup = null
		}
	}

	public selectNextGroup() {
		if (this.selectedGroup === null) {
			this.selectedGroup = 0
		} else {
			this.selectedGroup = (this.selectedGroup + 1) % this.groups.length
		}
	}

	public selectPreviousGroup() {
		if (this.selectedGroup === null) {
			this.selectedGroup = this.groups.length - 1
		} else {
			this.selectedGroup = (this.selectedGroup - 1 + this.groups.length) % this.groups.length
		}
	}

	public selectClosestGroup(selection: vscode.Selection) {
		if (this.groups.length === 0) {
			this.selectedGroup = null
			return
		}

		console.log("GROUPS", this.groups)

		let bestGroup: { groupIndex: number; distance: number } | null = null
		const selectionStartLine = selection.start.line
		const selectionEndLine = selection.end.line

		// Find the group with minimum distance to the selection
		for (let groupIndex = 0; groupIndex < this.groups.length; groupIndex++) {
			const group = this.groups[groupIndex]
			const groupLine = Math.min(...group.map((x) => x.oldLine))

			// Calculate minimum distance from selection to any operation in this group
			let distance = Infinity
			if (groupLine < selectionStartLine) {
				distance = selectionStartLine - groupLine
			} else if (groupLine > selectionEndLine) {
				distance = groupLine - selectionEndLine
			} else {
				distance = 0
			}

			// Check if this group is better than current best
			if (bestGroup === null || distance < bestGroup.distance) {
				bestGroup = { groupIndex, distance }
			}
			if (distance === 0) {
				break
			}
		}

		// Set the closest group as selected
		if (bestGroup !== null) {
			this.selectedGroup = bestGroup.groupIndex
			console.log("BEST GROUP", this.groups[bestGroup.groupIndex])
		}
	}
}

export class GhostSuggestionsState {
	private files = new Map<string, GhostSuggestionFile>()

	constructor() {}

	public addFile(fileUri: vscode.Uri) {
		const key = fileUri.toString()
		if (!this.files.has(key)) {
			this.files.set(key, new GhostSuggestionFile(fileUri))
		}
		return this.files.get(key)!
	}

	public getFile(fileUri: vscode.Uri): GhostSuggestionFile | undefined {
		return this.files.get(fileUri.toString())
	}

	public clear() {
		this.files.clear()
	}

	public hasSuggestions(): boolean {
		return this.files.size > 0
	}

	public validateFiles() {
		for (const file of this.files.values()) {
			if (file.isEmpty()) {
				this.files.delete(file.fileUri.toString())
			}
		}
	}

	public sortGroups() {
		this.validateFiles()
		for (const file of this.files.values()) {
			file.sortGroups()
		}
	}
}
