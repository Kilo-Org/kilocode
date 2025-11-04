import { GhostSuggestionsState } from "./GhostSuggestions"

export interface StreamingParseResult {
	suggestions: GhostSuggestionsState
	isComplete: boolean
	hasNewSuggestions: boolean
}

/**
 * Parse the response - only handles responses with <COMPLETION> tags
 */
export function parseGhostResponse(fullResponse: string, prefix: string, suffix: string): StreamingParseResult {
	const suggestions = new GhostSuggestionsState()
	let hasNewSuggestions = false

	let fimText: string = ""
	let isComplete: boolean = true

	// Match content strictly between <COMPLETION> and </COMPLETION> tags
	const completionMatch = fullResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)

	if (completionMatch) {
		// Extract the captured group (content between tags)
		fimText = completionMatch[1] || ""
		isComplete = true
	}
	// Remove any accidentally captured tag remnants
	fimText = fimText.replace(/<\/?COMPLETION>/gi, "")

	// Create suggestion if there's actual content
	if (fimText.length > 0) {
		suggestions.setFillInAtCursor({
			text: fimText,
			prefix,
			suffix,
		})
		hasNewSuggestions = true
	}

	return {
		suggestions,
		isComplete,
		hasNewSuggestions,
	}
}
