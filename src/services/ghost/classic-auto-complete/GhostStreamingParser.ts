import { FillInAtCursorSuggestion } from "./GhostSuggestions"

/**
 * Parse the response - only handles responses with <COMPLETION> tags
 * Returns a FillInAtCursorSuggestion with the extracted text, or an empty string if nothing found
 */
export function parseGhostResponse(fullResponse: string, prefix: string, suffix: string): FillInAtCursorSuggestion {
	let fimText: string = ""

	// Match content strictly between <COMPLETION> and </COMPLETION> tags
	const completionMatch = fullResponse.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)

	if (completionMatch) {
		// Extract the captured group (content between tags)
		fimText = completionMatch[1] || ""
	}
	// Remove any accidentally captured tag remnants
	fimText = fimText.replace(/<\/?COMPLETION>/gi, "")

	// Return FillInAtCursorSuggestion with the text (empty string if nothing found)
	return {
		text: fimText,
		prefix,
		suffix,
	}
}
