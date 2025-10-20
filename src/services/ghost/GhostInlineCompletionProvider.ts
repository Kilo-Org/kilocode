import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"

/**
 * Inline Completion Provider for Ghost Code Suggestions
 *
 * Provides ghost text completions at the cursor position based on
 * the currently selected suggestion group using VS Code's native
 * inline completion API.
 */
export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestions: GhostSuggestionsState

	constructor(suggestions: GhostSuggestionsState) {
		this.suggestions = suggestions
	}

	/**
	 * Update the suggestions reference
	 */
	public updateSuggestions(suggestions: GhostSuggestionsState): void {
		this.suggestions = suggestions
	}

	/**
	 * Find common prefix between two strings
	 */
	private findCommonPrefix(str1: string, str2: string): string {
		let i = 0
		while (i < str1.length && i < str2.length && str1[i] === str2[i]) {
			i++
		}
		return str1.substring(0, i)
	}

	/**
	 * Get effective group for inline completion (handles separated deletion+addition groups)
	 */
	private getEffectiveGroup(
		file: any,
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "+" | "/" | "-" } | null {
		if (selectedGroupIndex >= groups.length) return null

		const selectedGroup = groups[selectedGroupIndex]
		const selectedGroupType = file.getGroupType(selectedGroup)

		// If selected group is deletion, check if we should use associated addition
		if (selectedGroupType === "-") {
			const deleteOps = selectedGroup.filter((op) => op.type === "-")
			const deletedContent = deleteOps
				.map((op) => op.content)
				.join("\n")
				.trim()

			// Case 1: Placeholder-only deletion
			if (deletedContent === "<<<AUTOCOMPLETE_HERE>>>") {
				return this.getNextAdditionGroup(file, groups, selectedGroupIndex)
			}

			// Case 2: Deletion followed by addition - check what type of handling it needs
			if (selectedGroupIndex + 1 < groups.length) {
				const nextGroup = groups[selectedGroupIndex + 1]
				const nextGroupType = file.getGroupType(nextGroup)

				if (nextGroupType === "+") {
					const addOps = nextGroup.filter((op) => op.type === "+")
					const addedContent = addOps
						.sort((a, b) => a.line - b.line)
						.map((op) => op.content)
						.join("\n")

					// Check if added content starts with deleted content (common prefix scenario)
					if (addedContent.startsWith(deletedContent)) {
						console.log("[InlineCompletion] Common prefix detected, creating synthetic modification group")
						console.log("[InlineCompletion] Deleted:", deletedContent.substring(0, 50))
						console.log("[InlineCompletion] Added:", addedContent.substring(0, 50))
						// Create synthetic modification group for proper common prefix handling
						const syntheticGroup = [...selectedGroup, ...nextGroup]
						return { group: syntheticGroup, type: "/" }
					}

					// Check if this should be treated as addition after existing content
					if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
						return { group: nextGroup, type: "+" }
					}
				}
			}

			return null // Regular deletions use SVG decorations
		}

		return { group: selectedGroup, type: selectedGroupType }
	}

	/**
	 * Get the next addition group if it exists
	 */
	private getNextAdditionGroup(
		file: any,
		groups: GhostSuggestionEditOperation[][],
		currentIndex: number,
	): { group: GhostSuggestionEditOperation[]; type: "+" } | null {
		if (currentIndex + 1 < groups.length) {
			const nextGroup = groups[currentIndex + 1]
			const nextGroupType = file.getGroupType(nextGroup)

			if (nextGroupType === "+") {
				return { group: nextGroup, type: "+" }
			}
		}
		return null
	}

	/**
	 * Check if deletion+addition should be treated as pure addition
	 */
	private shouldTreatAsAddition(deletedContent: string, addedContent: string): boolean {
		// Case 1: Added content starts with deleted content
		if (addedContent.startsWith(deletedContent)) {
			// Always return false - let common prefix logic handle this
			// This ensures proper inline completion with suffix only
			return false
		}

		// Case 2: Added content starts with newline - indicates LLM wants to add content after current line
		return addedContent.startsWith("\n") || addedContent.startsWith("\r\n")
	}

	/**
	 * Calculate completion text for different scenarios
	 */
	private getCompletionText(
		groupType: "+" | "/" | "-",
		group: GhostSuggestionEditOperation[],
		file: any,
		groups: GhostSuggestionEditOperation[][],
		selectedGroupIndex: number,
	): { text: string; isAddition: boolean } {
		if (groupType === "+") {
			// Pure addition - but check if it's really part of a modification (deletion + addition)
			// This happens when onlyAdditions mode skips the deletion group
			const text = group
				.sort((a, b) => a.line - b.line)
				.map((op) => op.content)
				.join("\n")

			// Check if there's a previous deletion group
			if (selectedGroupIndex > 0) {
				const previousGroup = groups[selectedGroupIndex - 1]
				const previousGroupType = file.getGroupType(previousGroup)

				if (previousGroupType === "-") {
					const deleteOps = previousGroup.filter((op: GhostSuggestionEditOperation) => op.type === "-")
					const deletedContent = deleteOps
						.sort((a: GhostSuggestionEditOperation, b: GhostSuggestionEditOperation) => a.line - b.line)
						.map((op: GhostSuggestionEditOperation) => op.content)
						.join("\n")

					// If the addition starts with the deletion, strip the common prefix
					if (text.startsWith(deletedContent)) {
						const suffix = text.substring(deletedContent.length)
						// Return the suffix, treating it as a modification
						return { text: suffix, isAddition: false }
					}
				}
			}

			return { text, isAddition: true }
		}

		// Modification - determine what to show
		const deleteOps = group.filter((op) => op.type === "-")
		const addOps = group.filter((op) => op.type === "+")

		if (deleteOps.length === 0 || addOps.length === 0) {
			return { text: "", isAddition: false }
		}

		const deletedContent = deleteOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")
		const addedContent = addOps
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// Check different scenarios for what to show
		const trimmedDeleted = deletedContent.trim()

		if (trimmedDeleted.length === 0 || trimmedDeleted === "<<<AUTOCOMPLETE_HERE>>>") {
			// Empty or placeholder deletion - show all added content
			return { text: addedContent, isAddition: true }
		}

		if (this.shouldTreatAsAddition(deletedContent, addedContent)) {
			// Should be treated as addition - show appropriate part
			if (addedContent.startsWith(deletedContent)) {
				// Show only new part after existing content
				return { text: addedContent.substring(deletedContent.length), isAddition: false }
			} else if (addedContent.startsWith("\n") || addedContent.startsWith("\r\n")) {
				// Remove leading newline and show rest
				return { text: addedContent.replace(/^\r?\n/, ""), isAddition: true }
			}
		}

		// Regular modification - show suffix after common prefix
		const commonPrefix = this.findCommonPrefix(deletedContent, addedContent)
		if (commonPrefix.length === 0) {
			return { text: "", isAddition: false } // No common prefix - use SVG decoration
		}

		return { text: addedContent.substring(commonPrefix.length), isAddition: false }
	}

	/**
	 * Calculate insertion position and range
	 */
	private getInsertionRange(
		document: vscode.TextDocument,
		position: vscode.Position,
		targetLine: number,
		isAddition: boolean,
		completionText: string,
	): vscode.Range {
		// For pure additions, position at the end of the current line
		// (newline prefix will be added later for multi-line content)
		if (isAddition) {
			const currentLineText = document.lineAt(position.line).text
			const insertPosition = new vscode.Position(position.line, currentLineText.length)
			return new vscode.Range(insertPosition, insertPosition)
		}

		// For modifications (common prefix), check if suffix is multi-line
		if (targetLine === position.line) {
			// If completion text is multi-line, start on next line
			if (completionText.includes("\n")) {
				const nextLine = Math.min(position.line + 1, document.lineCount)
				const insertPosition = new vscode.Position(nextLine, 0)
				return new vscode.Range(insertPosition, insertPosition)
			} else {
				// Single-line completion can continue on same line
				return new vscode.Range(position, position)
			}
		}

		// For different lines
		if (targetLine >= document.lineCount) {
			const lastLineIndex = Math.max(0, document.lineCount - 1)
			const lastLineText = document.lineAt(lastLineIndex).text
			const insertPosition = new vscode.Position(lastLineIndex, lastLineText.length)
			return new vscode.Range(insertPosition, insertPosition)
		}

		const insertPosition = new vscode.Position(targetLine, 0)
		return new vscode.Range(insertPosition, insertPosition)
	}

	/**
	 * Provide inline completion items at the given position
	 */
	public async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | undefined> {
		if (token.isCancellationRequested) {
			return undefined
		}

		// Get file suggestions
		const file = this.suggestions.getFile(document.uri)
		if (!file) {
			return undefined
		}

		// Get effective group (handles separation of deletion+addition)
		const groups = file.getGroupsOperations()
		const selectedGroupIndex = file.getSelectedGroup()

		if (selectedGroupIndex === null) {
			return undefined
		}

		const effectiveGroup = this.getEffectiveGroup(file, groups, selectedGroupIndex)
		if (!effectiveGroup) {
			return undefined
		}

		// Check distance from cursor
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const firstOp = effectiveGroup.group[0]
		const targetLine =
			effectiveGroup.type === "+"
				? firstOp.line + offset.removed
				: (effectiveGroup.group.find((op) => op.type === "-")?.line || firstOp.line) + offset.added

		if (Math.abs(position.line - targetLine) > 5) {
			return undefined // Too far - let decorations handle it
		}

		// Get completion text
		const { text: completionText, isAddition } = this.getCompletionText(
			effectiveGroup.type,
			effectiveGroup.group,
			file,
			groups,
			selectedGroupIndex,
		)
		if (!completionText.trim()) {
			return undefined
		}

		// Calculate insertion range
		let range = this.getInsertionRange(document, position, targetLine, isAddition, completionText)
		let finalCompletionText = completionText

		// For pure additions, add newline prefix if content is multi-line AND doesn't already start with newline
		if (isAddition && completionText.includes("\n") && !completionText.startsWith("\n")) {
			finalCompletionText = "\n" + completionText
		}
		// For modifications with multi-line suffix, add newline if needed and not already present
		else if (
			!isAddition &&
			completionText.includes("\n") &&
			range.start.line === position.line &&
			!completionText.startsWith("\n")
		) {
			finalCompletionText = "\n" + completionText
		}

		// Create completion item
		const item: vscode.InlineCompletionItem = {
			insertText: finalCompletionText,
			range,
			command: {
				command: "kilo-code.ghost.applyCurrentSuggestions",
				title: "Accept suggestion",
			},
		}

		return [item]
	}

	public dispose(): void {
		// Cleanup if needed
	}
}
