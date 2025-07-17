import * as vscode from "vscode"
import { GhostSuggestionEditOperation, GhostSuggestionEditOperationsOffset } from "./types"

class GhostSuggestionFile {
	public fileUri: vscode.Uri
	private selectedGroup: number | null = null
	private groups: Array<GhostSuggestionEditOperation[]> = []
	private rangeMatch = 1

	constructor(public uri: vscode.Uri) {
		this.fileUri = uri
	}

	public addOperation(operation: GhostSuggestionEditOperation) {
		for (let groupIndex = 0; groupIndex < this.groups.length; groupIndex++) {
			for (let opIndex = 0; opIndex < this.groups[groupIndex].length; opIndex++) {
				const diffLine = this.groups[groupIndex][opIndex].line - operation.line
				if (Math.abs(diffLine) <= this.rangeMatch) {
					this.groups[groupIndex].push(operation)
					return
				}
			}
		}
		this.groups.push([operation])
	}

	public isEmpty(): boolean {
		return this.groups.length === 0
	}

	public getSelectedGroup(): number | null {
		return this.selectedGroup
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
				}
			}
			// reset selected group
			if (this.groups.length === 0) {
				this.selectedGroup = null
			} else if (this.selectedGroup >= this.groups.length) {
				this.selectedGroup = this.groups.length - 1
			}
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
