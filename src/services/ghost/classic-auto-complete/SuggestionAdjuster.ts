import { FillInAtCursorSuggestion } from "./HoleFiller"

/**
 * Utility class for adjusting suggestions based on user typing.
 * Handles both exact matches and "typed ahead" scenarios where
 * the user has started typing the suggested text.
 */
export class SuggestionAdjuster {
	/**
	 * Adjust a suggestion based on the current cursor context.
	 * Returns the adjusted suggestion text, or null if the suggestion doesn't match.
	 *
	 * @param suggestion - The original suggestion to adjust
	 * @param currentPrefix - The current text before the cursor
	 * @param currentSuffix - The current text after the cursor
	 * @returns The adjusted suggestion text, or null if no match
	 */
	static adjust(suggestion: FillInAtCursorSuggestion, currentPrefix: string, currentSuffix: string): string | null {
		// Exact match - return the suggestion as-is
		if (currentPrefix === suggestion.prefix && currentSuffix === suggestion.suffix) {
			return suggestion.text
		}

		// Typing ahead scenario - user has typed part of the suggestion
		if (
			suggestion.text !== "" &&
			currentSuffix === suggestion.suffix &&
			currentPrefix.startsWith(suggestion.prefix)
		) {
			const typedAhead = currentPrefix.substring(suggestion.prefix.length)

			if (suggestion.text.startsWith(typedAhead)) {
				// Return the remaining part of the suggestion
				return suggestion.text.substring(typedAhead.length)
			}
		}

		return null
	}

	/**
	 * Create an adjusted FillInAtCursorSuggestion with updated prefix/suffix.
	 *
	 * @param suggestion - The original suggestion
	 * @param currentPrefix - The current text before the cursor
	 * @param currentSuffix - The current text after the cursor
	 * @returns The adjusted suggestion, or null if no match
	 */
	static adjustSuggestion(
		suggestion: FillInAtCursorSuggestion,
		currentPrefix: string,
		currentSuffix: string,
	): FillInAtCursorSuggestion | null {
		const adjustedText = this.adjust(suggestion, currentPrefix, currentSuffix)

		if (adjustedText === null) {
			return null
		}

		return {
			text: adjustedText,
			prefix: currentPrefix,
			suffix: currentSuffix,
		}
	}

	/**
	 * Find a matching suggestion from history based on current prefix and suffix.
	 *
	 * @param prefix - The text before the cursor position
	 * @param suffix - The text after the cursor position
	 * @param suggestionsHistory - Array of previous suggestions (most recent last)
	 * @returns The matching suggestion text, or null if no match found
	 */
	static findInHistory(
		prefix: string,
		suffix: string,
		suggestionsHistory: FillInAtCursorSuggestion[],
	): string | null {
		// Search from most recent to least recent
		for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
			const adjusted = this.adjust(suggestionsHistory[i], prefix, suffix)
			if (adjusted !== null) {
				return adjusted
			}
		}

		return null
	}
}
