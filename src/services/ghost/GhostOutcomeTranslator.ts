import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { AutocompleteOutcome, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { CURSOR_MARKER } from "./ghostConstants"

/**
 * Translates AutocompleteOutcome back to GhostSuggestionsState for UI compatibility
 * This allows us to use CompletionProvider-style output while maintaining the existing UI
 */
export class GhostOutcomeTranslator {
	/**
	 * Convert AutocompleteOutcome to GhostSuggestionsState
	 * @param outcome The autocomplete outcome from the parser
	 * @param document The current document
	 * @param cursorPosition The cursor position where completion should be applied
	 * @returns GhostSuggestionsState for UI rendering
	 */
	public translate(
		outcome: AutocompleteOutcome,
		document: vscode.TextDocument,
		cursorPosition: vscode.Position,
	): GhostSuggestionsState {
		const suggestions = new GhostSuggestionsState()

		if (!outcome.completion) {
			return suggestions
		}

		// Get current document content
		const currentContent = document.getText()

		// Apply completion at cursor position
		const cursorOffset = document.offsetAt(cursorPosition)
		const modifiedContent =
			currentContent.substring(0, cursorOffset) + outcome.completion + currentContent.substring(cursorOffset)

		// Generate diff between original and modified content
		const relativePath = document.uri.fsPath
		const patch = structuredPatch(relativePath, relativePath, currentContent, modifiedContent, "", "")

		// Create a suggestion file
		const suggestionFile = suggestions.addFile(document.uri)

		// Process each hunk in the patch
		for (const hunk of patch.hunks) {
			let currentOldLineNumber = hunk.oldStart
			let currentNewLineNumber = hunk.newStart

			// Iterate over each line within the hunk
			for (const line of hunk.lines) {
				const operationType = line.charAt(0) as GhostSuggestionEditOperationType
				const content = line.substring(1)

				switch (operationType) {
					// Case 1: The line is an addition
					case "+":
						suggestionFile.addOperation({
							type: "+",
							line: currentNewLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						currentNewLineNumber++
						break

					// Case 2: The line is a deletion
					case "-":
						suggestionFile.addOperation({
							type: "-",
							line: currentOldLineNumber - 1,
							oldLine: currentOldLineNumber - 1,
							newLine: currentNewLineNumber - 1,
							content: content,
						})
						currentOldLineNumber++
						break

					// Case 3: The line is unchanged (context)
					default:
						currentOldLineNumber++
						currentNewLineNumber++
						break
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}
}