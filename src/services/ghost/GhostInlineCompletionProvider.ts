import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { GhostSuggestionEditOperation } from "./types"

/**
 * Inline Completion Provider for Ghost Code Suggestions
 *
 * Provides ghost text completions at the cursor position based on
 * the currently selected suggestion group.
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

		// Check if we have suggestions for this document
		const file = this.suggestions.getFile(document.uri)
		if (!file) {
			return undefined
		}

		const selectedGroup = file.getSelectedGroupOperations()
		if (selectedGroup.length === 0) {
			return undefined
		}

		// Get the type of the selected group
		const groupType = file.getGroupType(selectedGroup)

		// Only provide inline completions for additions and modifications
		// Deletions are better handled with decorations
		if (groupType === "-") {
			return undefined
		}

		// Convert the selected group to an inline completion item
		const completionItem = this.createInlineCompletionItem(document, position, selectedGroup, groupType)

		if (!completionItem) {
			return undefined
		}

		return [completionItem]
	}

	/**
	 * Create an inline completion item from a group of operations
	 */
	private createInlineCompletionItem(
		document: vscode.TextDocument,
		position: vscode.Position,
		group: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
	): vscode.InlineCompletionItem | undefined {
		// Get the operations offset to calculate correct line numbers
		const file = this.suggestions.getFile(document.uri)
		if (!file) {
			return undefined
		}

		const offset = file.getPlaceholderOffsetSelectedGroupOperations()

		// Find the target line for the completion
		const firstOp = group[0]
		let targetLine: number

		if (groupType === "+") {
			// For pure additions, use the line from the operation plus offset
			targetLine = firstOp.line + offset.removed
		} else if (groupType === "/") {
			// For modifications (delete + add), use the delete line
			const deleteOp = group.find((op) => op.type === "-")
			if (!deleteOp) {
				return undefined
			}
			targetLine = deleteOp.line + offset.added
		} else {
			return undefined
		}

		// Check if the cursor is near the target line (within 5 lines)
		const cursorLine = position.line
		const distance = Math.abs(cursorLine - targetLine)

		if (distance > 5) {
			// Don't show inline completion if cursor is too far from suggestion
			return undefined
		}

		// Build the completion text
		let completionText: string
		let insertText: string
		let range: vscode.Range

		if (groupType === "/") {
			// For modifications, show the new content (additions)
			const addOps = group.filter((op) => op.type === "+")
			completionText = addOps
				.sort((a, b) => a.line - b.line)
				.map((op) => op.content)
				.join("\n")

			// Replace the entire line
			if (targetLine < document.lineCount) {
				const line = document.lineAt(targetLine)
				range = line.range
				insertText = completionText
			} else {
				// Line doesn't exist yet, append at end
				const lastLine = document.lineAt(document.lineCount - 1)
				range = new vscode.Range(lastLine.range.end, lastLine.range.end)
				insertText = "\n" + completionText
			}
		} else {
			// For pure additions, insert new lines
			completionText = group
				.sort((a, b) => a.line - b.line)
				.map((op) => op.content)
				.join("\n")

			// Determine insertion point
			if (targetLine < document.lineCount) {
				// Insert at the beginning of target line
				const line = document.lineAt(targetLine)
				range = new vscode.Range(line.range.start, line.range.start)
				insertText = completionText + "\n"
			} else {
				// Append at end of document
				const lastLine = document.lineAt(document.lineCount - 1)
				range = new vscode.Range(lastLine.range.end, lastLine.range.end)
				insertText = "\n" + completionText
			}
		}

		// If cursor is on the target line, show inline at cursor
		// Otherwise, don't show (user will need to navigate)
		if (cursorLine === targetLine) {
			// Create inline completion item as plain object for better testability
			const item: vscode.InlineCompletionItem = {
				insertText,
				range,
				command: {
					command: "kilocode.ghost.showNavigationHint",
					title: "Navigate suggestions",
				},
			}

			return item
		}

		return undefined
	}

	public dispose(): void {
		// Cleanup if needed
	}
}
