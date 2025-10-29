import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { CURSOR_MARKER } from "./ghostConstants"

export interface StreamingParseResult {
	suggestions: GhostSuggestionsState
	isComplete: boolean
	hasNewSuggestions: boolean
}

function removeCursorMarker(content: string): string {
	return content.replaceAll(CURSOR_MARKER, "")
}

/**
 * Conservative XML sanitization for hole-filling format
 */
export function sanitizeXMLConservative(buffer: string): string {
	let sanitized = buffer

	// Check if we have an incomplete </HOLE> tag (like "</HOLE" without the final ">")
	// Use case-insensitive regex
	const incompleteHoleCloseMatch = /<\/HOLE(?!>)/i.test(sanitized)

	if (incompleteHoleCloseMatch) {
		// Fix incomplete </HOLE tag by adding the missing ">"
		sanitized = sanitized.replace(/<\/HOLE(?!>)/i, "</HOLE>")
	} else {
		// Check if we have an opening <HOLE> but no closing </HOLE>
		const hasOpeningHole = /<HOLE>/i.test(sanitized)
		const hasClosingHole = /<\/HOLE>/i.test(sanitized)

		if (hasOpeningHole && !hasClosingHole) {
			// Only add closing tag if we're not in the middle of streaming
			const trimmed = sanitized.trim()
			if (!trimmed.endsWith("<")) {
				sanitized += "</HOLE>"
			}
		}
	}

	return sanitized
}

/**
 * Check if the response appears to be complete
 */
function isResponseComplete(buffer: string): boolean {
	// Check for incomplete <HOLE> tag
	const incompleteHoleMatch = /<HOLE>(?:(?!<\/HOLE>)[\s\S])*$/i.test(buffer)

	return !incompleteHoleMatch
}

/**
 * Extract content from <HOLE>...</HOLE> tags
 */
export function extractHoleContent(response: string): string | undefined {
	// Match <HOLE>content</HOLE> pattern
	const holeRegex = /<HOLE>([\s\S]*?)<\/HOLE>/i
	const match = response.match(holeRegex)

	if (match && match[1] !== undefined) {
		return match[1]
	}

	return undefined
}

/**
 * Sanitize response if needed and return sanitized response with completion status
 */
function sanitizeResponseIfNeeded(response: string): { sanitizedResponse: string; isComplete: boolean } {
	let sanitizedResponse = response
	let isComplete = isResponseComplete(sanitizedResponse)

	if (!isComplete) {
		sanitizedResponse = sanitizeXMLConservative(sanitizedResponse)
		isComplete = isResponseComplete(sanitizedResponse) // Re-check completion after sanitization
	}

	return { sanitizedResponse, isComplete }
}

/**
 * Parse the response
 */
export function parseGhostResponse(fullResponse: string, prefix: string, suffix: string): StreamingParseResult {
	const { sanitizedResponse, isComplete } = sanitizeResponseIfNeeded(fullResponse)

	const holeContent = extractHoleContent(sanitizedResponse)
	const hasNewSuggestions = holeContent !== undefined && holeContent !== ""

	const suggestions = new GhostSuggestionsState()

	if (hasNewSuggestions && holeContent) {
		// Construct the modified content by inserting hole content at cursor position
		const modifiedContent = prefix + holeContent + suffix

		// Verify the structure is correct
		const modifiedContent_has_prefix_and_suffix =
			modifiedContent.startsWith(prefix) && modifiedContent.endsWith(suffix)

		if (modifiedContent_has_prefix_and_suffix) {
			// Mark as FIM option
			const middle = modifiedContent.slice(prefix.length, modifiedContent.length - suffix.length)
			suggestions.setFillInAtCursor({
				text: middle,
				prefix,
				suffix,
			})
		}
	}

	return {
		suggestions,
		isComplete,
		hasNewSuggestions,
	}
}
