/**
 * Filters out useless autocomplete suggestions that don't provide value to the user
 *
 * @param suggestion - The suggested text to insert
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @returns true if the suggestion should be refused (is useless), false if it should be kept
 */
export function refuseUselessSuggestion(suggestion: string, prefix: string, suffix: string): boolean {
	const trimmedSuggestion = suggestion.trim()

	if (!trimmedSuggestion) {
		return true
	}

	const trimmedPrefixEnd = prefix.trimEnd()
	if (trimmedPrefixEnd.endsWith(trimmedSuggestion)) {
		return true
	}

	const trimmedSuffix = suffix.trimStart()
	if (trimmedSuffix.startsWith(trimmedSuggestion)) {
		return true
	}

	// The suggestion appears to be useful
	return false
}
