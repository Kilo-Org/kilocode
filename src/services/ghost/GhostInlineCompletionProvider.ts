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
		// Deletions are handled with decorations
		if (groupType === "-") {
			return undefined
		}

		// Check if suggestion is near cursor - if too far, let decorations handle it
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const firstOp = selectedGroup[0]
		let targetLine: number

		if (groupType === "+") {
			targetLine = firstOp.line + offset.removed
		} else {
			const deleteOp = selectedGroup.find((op) => op.type === "-")
			if (!deleteOp) {
				return undefined
			}
			targetLine = deleteOp.line + offset.added
		}

		// If suggestion is more than 5 lines away from cursor, don't show inline completion
		// This allows decorations to handle it instead
		const distanceFromCursor = Math.abs(position.line - targetLine)
		if (distanceFromCursor > 5) {
			return undefined
		}

		// Convert the selected group to an inline completion item
		const completionItem = this.createInlineCompletionItem(document, position, selectedGroup, groupType, targetLine)

		if (!completionItem) {
			return undefined
		}

		return [completionItem]
	}

	/**
	 * Create an inline completion item from a group of operations.
	 * Shows ghost text at the target line.
	 */
	private createInlineCompletionItem(
		document: vscode.TextDocument,
		position: vscode.Position,
		group: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		targetLine: number,
	): vscode.InlineCompletionItem | undefined {
		// Build the completion text
		// Note: We don't strictly check cursor position here because:
		// 1. The cursor might have moved slightly after the LLM response
		// 2. VSCode's inline completion API will handle positioning
		// 3. We want to show the suggestion as long as it's for this document
		let completionText: string

		if (groupType === "/") {
			// For modifications, show the new content (additions)
			const addOps = group.filter((op) => op.type === "+")
			completionText = addOps
				.sort((a, b) => a.line - b.line)
				.map((op) => op.content)
				.join("\n")
		} else {
			// For pure additions, show all new lines
			completionText = group
				.sort((a, b) => a.line - b.line)
				.map((op) => op.content)
				.join("\n")
		}

		// Create a range at the target line where the suggestion should be inserted
		// Use the current character position to maintain cursor placement
		const targetPosition = new vscode.Position(targetLine, position.character)
		const range = new vscode.Range(targetPosition, targetPosition)

		// Create inline completion item using VS Code's InlineCompletionItem interface
		const item: vscode.InlineCompletionItem = {
			insertText: completionText,
			range,
			command: {
				command: "kilo-code.ghost.applyCurrentSuggestions",
				title: "Accept suggestion",
			},
		}

		return item
	}

	public dispose(): void {
		// Cleanup if needed
	}
}
