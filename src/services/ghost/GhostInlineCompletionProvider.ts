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

		// Only provide inline completions for pure additions near the cursor
		// Deletions and modifications are handled with SVG decorations
		if (groupType === "-" || groupType === "/") {
			return undefined
		}

		// Check if suggestion is near cursor - if too far, let decorations handle it
		const offset = file.getPlaceholderOffsetSelectedGroupOperations()
		const firstOp = selectedGroup[0]
		const targetLine = firstOp.line + offset.removed

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
	 * Shows ghost text at the target line for pure additions.
	 */
	private createInlineCompletionItem(
		document: vscode.TextDocument,
		position: vscode.Position,
		group: GhostSuggestionEditOperation[],
		groupType: "+" | "/" | "-",
		targetLine: number,
	): vscode.InlineCompletionItem | undefined {
		// Build the completion text for pure additions
		let completionText = group
			.sort((a, b) => a.line - b.line)
			.map((op) => op.content)
			.join("\n")

		// Determine the insertion position and range
		let insertPosition: vscode.Position
		let range: vscode.Range

		if (targetLine === position.line) {
			// Addition on current line - use cursor position
			insertPosition = position
		} else if (targetLine === position.line + 1) {
			// Addition on next line (e.g., after a comment)
			// Check if current line has content (likely a comment)
			const currentLineText = document.lineAt(position.line).text
			const trimmedLine = currentLineText.trim()

			if (trimmedLine.length > 0) {
				// Current line has content, insert at start of next line with newline prefix
				insertPosition = new vscode.Position(position.line, currentLineText.length)
				completionText = "\n" + completionText
			} else {
				// Current line is empty, insert at cursor position
				insertPosition = position
			}
		} else {
			// Addition is far from cursor - insert at column 0 of target line
			insertPosition = new vscode.Position(targetLine, 0)
		}
		range = new vscode.Range(insertPosition, insertPosition)

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
