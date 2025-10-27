import * as vscode from "vscode"
import { FillInAtCursorSuggestion, GhostSuggestionsState } from "./GhostSuggestions"
import { extractPrefixSuffix } from "../types"

const MAX_SUGGESTIONS_HISTORY = 20

/**
 * Find a matching suggestion from the history based on current prefix and suffix
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @returns The matching suggestion text, or null if no match found
 */
export function findMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
): string | null {
	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const fillInAtCursor = suggestionsHistory[i]

		// First, try exact prefix/suffix match
		if (prefix === fillInAtCursor.prefix && suffix === fillInAtCursor.suffix) {
			return fillInAtCursor.text
		}

		// If no exact match, check for partial typing
		// The user may have started typing the suggested text
		if (prefix.startsWith(fillInAtCursor.prefix) && suffix === fillInAtCursor.suffix) {
			// Extract what the user has typed between the original prefix and current position
			const typedContent = prefix.substring(fillInAtCursor.prefix.length)

			// Check if the typed content matches the beginning of the suggestion
			if (fillInAtCursor.text.startsWith(typedContent)) {
				// Return the remaining part of the suggestion (with already-typed portion removed)
				return fillInAtCursor.text.substring(typedContent.length)
			}
		}
	}

	return null
}

export class GhostInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
	private suggestionsHistory: FillInAtCursorSuggestion[] = []

	/**
	 * Check if a cached suggestion is available for the given prefix and suffix
	 * @param prefix - The text before the cursor position
	 * @param suffix - The text after the cursor position
	 * @returns True if a matching suggestion exists, false otherwise
	 */
	public cachedSuggestionAvailable(prefix: string, suffix: string): boolean {
		return findMatchingSuggestion(prefix, suffix, this.suggestionsHistory) !== null
	}

	public updateSuggestions(suggestions: GhostSuggestionsState): void {
		const fillInAtCursor = suggestions.getFillInAtCursor()

		if (!fillInAtCursor) {
			return
		}

		const isDuplicate = this.suggestionsHistory.some(
			(existing) =>
				existing.text === fillInAtCursor.text &&
				existing.prefix === fillInAtCursor.prefix &&
				existing.suffix === fillInAtCursor.suffix,
		)

		if (isDuplicate) {
			return
		}

		// Add to the end of the array (most recent)
		this.suggestionsHistory.push(fillInAtCursor)

		// Remove oldest if we exceed the limit
		if (this.suggestionsHistory.length > MAX_SUGGESTIONS_HISTORY) {
			this.suggestionsHistory.shift()
		}
	}

	public provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		_context: vscode.InlineCompletionContext,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.InlineCompletionItem[] | vscode.InlineCompletionList> {
		const { prefix, suffix } = extractPrefixSuffix(document, position)

		const matchingText = findMatchingSuggestion(prefix, suffix, this.suggestionsHistory)

		if (matchingText !== null) {
			const item: vscode.InlineCompletionItem = {
				insertText: matchingText,
				range: new vscode.Range(position, position),
			}
			return [item]
		}

		return []
	}
}
