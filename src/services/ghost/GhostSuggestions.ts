import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationsOffset } from "./types"
import { GhostSuggestionOutcome, PromptMetadata } from "./types/GhostSuggestionOutcome"
import { DiffGroup, groupDiffLines } from "./utils/diffHelpers"
import { DiffLine } from "./utils/myers"

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
				// Original logic: same newLine (replacement on same line)
				const sameLineModification =
					(operation.type === "+" && existingOp.type === "-" && existingOp.newLine === operation.newLine) ||
					(operation.type === "-" && existingOp.type === "+" && operation.newLine === existingOp.newLine)

				// Enhanced logic: delete at line N, add at line N+1 (typical Mercury pattern)
				const adjacentLineModification =
					(operation.type === "+" &&
						existingOp.type === "-" &&
						existingOp.newLine + 1 === operation.newLine) ||
					(operation.type === "-" && existingOp.type === "+" && operation.newLine + 1 === existingOp.newLine)

				const canFormModificationGroup = sameLineModification || adjacentLineModification

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

			// Check modification groups for consecutive ADD operations
			const hasDelete = group.some((op) => op.type === "-")
			const hasAdd = group.some((op) => op.type === "+")

			if (hasDelete && hasAdd && operation.type === "+") {
				// For modification groups, allow consecutive ADD operations to join
				const addOperations = group.filter((op) => op.type === "+")
				const maxAddLine = Math.max(...addOperations.map((op) => op.line))

				if (operation.line === maxAddLine + 1) {
					return i
				}
				continue
			} else if (hasDelete && hasAdd) {
				// Skip modification groups for DELETE operations
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

	public getGroupType = (group: GhostSuggestionEditOperation[]) => {
		const types = group.map((x) => x.type)
		const hasDelete = types.includes("-")
		const hasAdd = types.includes("+")

		// Mixed group (both deletes and adds)
		if (hasDelete && hasAdd) {
			return "/"
		}

		// Pure delete or add group
		return types[0]
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
		this.selectedGroup = this.groups.length > 0 ? 0 : null

		// Groups sorted and ready
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
		}
	}
}

export class GhostSuggestionsState {
	private files = new Map<string, GhostSuggestionFile>()

	// Ghost suggestion outcome support: Store metadata
	private ghostSuggestionOutcome: GhostSuggestionOutcome | null = null
	private promptMetadata: PromptMetadata | null = null
	private cursorPosition: { line: number; character: number } | null = null
	private finalCursorPosition: { line: number; character: number } | null = null

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
		// Clear ghost suggestion metadata as well
		this.ghostSuggestionOutcome = null
		this.promptMetadata = null
		this.cursorPosition = null
		this.finalCursorPosition = null
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

	// Ghost Support: Create suggestions from GhostSuggestionOutcome and DiffLines
	public static fromGhostSuggestionOutcome(
		outcome: GhostSuggestionOutcome,
		document: vscode.TextDocument,
	): GhostSuggestionsState {
		const suggestions = new GhostSuggestionsState()
		const suggestionFile = suggestions.addFile(document.uri)

		// Store ghost suggestion metadata
		suggestions.ghostSuggestionOutcome = outcome
		suggestions.cursorPosition = outcome.cursorPosition
		suggestions.finalCursorPosition = outcome.finalCursorPosition

		// Group diff lines using Continue's logic
		const diffGroups = groupDiffLines(outcome.diffLines, outcome.editableRegionStartLine)

		// Convert Continue's DiffGroups to our GhostSuggestionEditOperations
		for (const group of diffGroups) {
			for (const diffLine of group.lines) {
				if (diffLine.type !== "same") {
					suggestionFile!.addOperation({
						type: diffLine.type === "new" ? "+" : "-",
						line: group.startLine,
						content: diffLine.line,
						oldLine: group.startLine,
						newLine: group.startLine,
					})
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}

	// Ghost Support: Create suggestions from DiffLines array (direct conversion)
	public static fromDiffLines(
		diffLines: DiffLine[],
		document: vscode.TextDocument,
		editableRegionStartLine: number = 0,
	): GhostSuggestionsState {
		const suggestions = new GhostSuggestionsState()
		const suggestionFile = suggestions.addFile(document.uri)

		// Convert DiffLines to our format - track line numbers manually
		let currentLineNumber = editableRegionStartLine
		for (const diffLine of diffLines) {
			if (diffLine.type !== "same") {
				suggestionFile!.addOperation({
					type: diffLine.type === "new" ? "+" : "-",
					line: currentLineNumber,
					content: diffLine.line,
					oldLine: currentLineNumber,
					newLine: currentLineNumber,
				})
			}
			// Only increment line number for old/same lines (lines that exist in original)
			if (diffLine.type !== "new") {
				currentLineNumber++
			}
		}

		suggestions.sortGroups()
		return suggestions
	}

	// Ghost Support: Set metadata from suggestion outcomes
	public setGhostSuggestionMetadata(outcome: GhostSuggestionOutcome | null, metadata: PromptMetadata | null = null) {
		this.ghostSuggestionOutcome = outcome
		this.promptMetadata = metadata
		if (outcome) {
			this.cursorPosition = outcome.cursorPosition
			this.finalCursorPosition = outcome.finalCursorPosition
		}
	}

	// Ghost Support: Get stored ghost suggestion metadata
	public getGhostSuggestionOutcome(): GhostSuggestionOutcome | null {
		return this.ghostSuggestionOutcome
	}

	public getPromptMetadata(): PromptMetadata | null {
		return this.promptMetadata
	}

	public getCursorPosition(): { line: number; character: number } | null {
		return this.cursorPosition
	}

	public getFinalCursorPosition(): { line: number; character: number } | null {
		return this.finalCursorPosition
	}

	/**
	 * Get all files with suggestions for external access (e.g., inline completion provider)
	 */
	public getFiles(): GhostSuggestionFile[] {
		return Array.from(this.files.values())
	}

	/**
	 * Get the primary file (first file with suggestions) - useful for single-file scenarios
	 */
	public getPrimaryFile(): GhostSuggestionFile | null {
		const files = this.getFiles()
		return files.length > 0 ? files[0] : null
	}

	/**
	 * Apply all suggestions to content (for string-based application)
	 * Used by StringGhostApplicator for tests/benchmarks
	 *
	 * NOTE: This is for string-based testing only. Production uses
	 * VSCodeGhostApplicator which calls VSCode WorkspaceEdit APIs.
	 */
	public applyToContent(originalContent: string, fileUri: string): string {
		return this.applyAllGroups(originalContent, fileUri)
	}

	/**
	 * Apply only the first group (for inline completions)
	 */
	public applyFirstGroup(originalContent: string, fileUri: string): string {
		const file = this.getFileByUriString(fileUri)
		if (!file) return originalContent

		const groups = file.getGroupsOperations()
		if (groups.length === 0) return originalContent

		return this.applyOperationsInGroup(originalContent, groups[0])
	}

	/**
	 * Apply all groups (for full autocomplete)
	 */
	public applyAllGroups(originalContent: string, fileUri: string): string {
		const file = this.getFileByUriString(fileUri)
		if (!file) return originalContent

		const allOperations = file.getAllOperations()
		if (allOperations.length === 0) return originalContent

		// For multiple groups, use the traditional reverse-order approach
		return this.applyOperations(originalContent, allOperations)
	}

	/**
	 * Apply operations within a single group (forward order for consecutive operations)
	 */
	private applyOperationsInGroup(originalContent: string, operations: GhostSuggestionEditOperation[]): string {
		if (operations.length === 0) {
			return originalContent
		}

		// Handle empty content case
		if (originalContent === "") {
			const addOps = operations.filter((op) => op.type === "+" && op.line === 0)
			return addOps.map((op) => op.content).join("\n")
		}

		const lines = originalContent.split("\n")

		// For operations within the same group, apply in forward order with line offset tracking
		const sortedOps = [...operations].sort((a, b) => a.line - b.line)
		const lineOffset = 0

		// Group consecutive operations and apply them as blocks
		const operationBlocks: GhostSuggestionEditOperation[][] = []
		let currentBlock: GhostSuggestionEditOperation[] = []

		for (let i = 0; i < sortedOps.length; i++) {
			const op = sortedOps[i]

			if (currentBlock.length === 0) {
				// Start new block
				currentBlock = [op]
			} else {
				const lastOp = currentBlock[currentBlock.length - 1]
				if (op.line === lastOp.line + 1 && op.type === lastOp.type) {
					// Consecutive operation of same type - add to current block
					currentBlock.push(op)
				} else {
					// Non-consecutive or different type - finish current block and start new one
					operationBlocks.push(currentBlock)
					currentBlock = [op]
				}
			}
		}

		// Add the last block
		if (currentBlock.length > 0) {
			operationBlocks.push(currentBlock)
		}

		// Apply blocks in reverse order to maintain line numbers
		const reversedBlocks = [...operationBlocks].reverse()

		for (const block of reversedBlocks) {
			const firstOp = block[0]

			if (firstOp.type === "+") {
				// Insert all operations in the block consecutively at the same position
				const insertionPoint = Math.min(firstOp.line, lines.length)
				const contentToInsert = block.map((op) => op.content)

				lines.splice(insertionPoint, 0, ...contentToInsert)
			} else if (firstOp.type === "-") {
				// Delete operations - apply in reverse order within the block
				const reversedBlock = [...block].reverse()
				for (const op of reversedBlock) {
					if (op.line < lines.length) {
						lines.splice(op.line, 1)
					}
				}
			}
		}

		console.log(`DEBUG: Final result:`, lines.join("\\n"))
		return lines.join("\n")
	}

	/**
	 * Core application logic (private helper)
	 * NOTE: For string-based application only (tests/benchmarks)
	 * Production uses VSCode WorkspaceEdit APIs via VSCodeGhostApplicator
	 */
	private applyOperations(originalContent: string, operations: GhostSuggestionEditOperation[]): string {
		if (operations.length === 0) {
			return originalContent
		}

		// Handle empty content case
		if (originalContent === "") {
			const addOps = operations.filter((op) => op.type === "+" && op.line === 0)
			return addOps.map((op) => op.content).join("\n")
		}

		const lines = originalContent.split("\n")

		// Sort in reverse order to maintain line numbers during modification
		const sortedOps = [...operations].sort((a, b) => b.line - a.line)

		for (const op of sortedOps) {
			if (op.line < 0) {
				console.warn(`Invalid negative line number ${op.line} for operation ${op.type}`)
				continue
			}

			if (op.type === "+") {
				if (op.line < lines.length) {
					lines.splice(op.line, 0, op.content)
				} else if (op.line <= lines.length + 1) {
					lines.push(op.content)
				} else {
					console.warn(`Invalid line number ${op.line} for insertion (max: ${lines.length + 1})`)
				}
			} else if (op.type === "-") {
				if (op.line < lines.length) {
					lines.splice(op.line, 1)
				} else {
					console.warn(`Invalid line number ${op.line} for deletion (max: ${lines.length - 1})`)
				}
			}
		}

		return lines.join("\n")
	}

	/**
	 * Helper to get file by URI string (platform-independent)
	 * Handles both vscode.Uri.toString() and plain string URIs
	 */
	private getFileByUriString(uriString: string): GhostSuggestionFile | null {
		// Direct lookup by string key
		const file = this.files.get(uriString)
		if (file) return file

		// Fallback: try matching against file.fileUri.fsPath for compatibility
		for (const file of this.files.values()) {
			if (file.fileUri.fsPath === uriString) {
				return file
			}
		}
		return null
	}
}
