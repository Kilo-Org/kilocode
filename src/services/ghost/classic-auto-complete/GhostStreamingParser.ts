import * as vscode from "vscode"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { CURSOR_MARKER } from "./ghostConstants"

export interface StreamingParseResult {
	suggestions: GhostSuggestionsState
	isComplete: boolean
	hasNewSuggestions: boolean
}

export interface ParsedChange {
	search: string
	replace: string
}

function removeCursorMarker(content: string): string {
	return content.replaceAll(CURSOR_MARKER, "")
}

/**
 * Conservative XML sanitization - only fixes the specific case from user feedback
 */
export function sanitizeXMLConservative(buffer: string): string {
	let sanitized = buffer

	// Fix malformed CDATA sections first - this is the main bug from user logs
	// Replace </![CDATA[ with ]]> to fix malformed CDATA closures
	sanitized = sanitized.replace(/<\/!\[CDATA\[/g, "]]>")

	// Only fix the specific case: missing </change> tag when we have complete search/replace pairs
	const changeOpenCount = (sanitized.match(/<change>/g) || []).length
	const changeCloseCount = (sanitized.match(/<\/change>/g) || []).length

	// Check if we have an incomplete </change> tag (like "</change" without the final ">")
	const incompleteChangeClose = sanitized.includes("</change") && !sanitized.includes("</change>")

	// Handle two cases:
	// 1. Missing </change> tag entirely (changeCloseCount === 0 && !incompleteChangeClose)
	// 2. Incomplete </change> tag (incompleteChangeClose)
	if (changeOpenCount === 1 && changeCloseCount === 0) {
		const searchCloseCount = (sanitized.match(/<\/search>/g) || []).length
		const replaceCloseCount = (sanitized.match(/<\/replace>/g) || []).length

		// Only fix if we have complete search/replace pairs
		if (searchCloseCount === 1 && replaceCloseCount === 1) {
			if (incompleteChangeClose) {
				// Fix incomplete </change tag by adding the missing ">"
				sanitized = sanitized.replace("</change", "</change>")
			} else {
				// Add missing </change> tag entirely
				const trimmed = sanitized.trim()
				// Make sure we're not in the middle of streaming an incomplete tag
				if (!trimmed.endsWith("<")) {
					sanitized += "</change>"
				}
			}
		}
	}

	return sanitized
}

/**
 * Check if the response appears to be complete
 */
function isResponseComplete(buffer: string): boolean {
	const incompleteChangeMatch = /<change(?:\s[^>]*)?>(?:(?!<\/change>)[\s\S])*$/i.test(buffer)
	const incompleteSearchMatch = /<search(?:\s[^>]*)?>(?:(?!<\/search>)[\s\S])*$/i.test(buffer)
	const incompleteReplaceMatch = /<replace(?:\s[^>]*)?>(?:(?!<\/replace>)[\s\S])*$/i.test(buffer)
	const incompleteCDataMatch = /<!\[CDATA\[(?:(?!\]\]>)[\s\S])*$/i.test(buffer)

	return !(incompleteChangeMatch || incompleteSearchMatch || incompleteReplaceMatch || incompleteCDataMatch)
}

export interface MatchResult {
	startIndex: number
	matchLength: number
}

/**
 * Find the best match for search content in the document, handling whitespace differences and cursor markers
 * Returns both the start index and the actual length of the matched content
 */
export function findBestMatch(content: string, searchPattern: string): MatchResult {
	// Validate inputs
	if (!content || !searchPattern) {
		return { startIndex: -1, matchLength: 0 }
	}

	// Strategy 1: Try exact match (fastest path)
	let index = content.indexOf(searchPattern)
	if (index !== -1) {
		return { startIndex: index, matchLength: searchPattern.length }
	}

	// Strategy 2: Fuzzy match with whitespace normalization
	const contentLen = content.length
	const patternLen = searchPattern.length

	// Try starting the match at each position in content
	for (let contentStart = 0; contentStart < contentLen; contentStart++) {
		let contentPos = contentStart
		let patternPos = 0

		// Try to match the entire pattern starting from contentStart
		while (patternPos < patternLen && contentPos < contentLen) {
			const contentChar = content[contentPos]
			const patternChar = searchPattern[patternPos]

			const contentIsNewline = isNewline(contentChar)
			const patternIsNewline = isNewline(patternChar)

			// Special case: pattern has newline but content has non-newline whitespace
			// Skip trailing whitespace in content before newline
			if (patternIsNewline && isNonNewlineWhitespace(contentChar)) {
				const savedContentPos = contentPos
				contentPos = skipChars(content, contentPos, isNonNewlineWhitespace)

				if (contentPos < contentLen && isNewline(content[contentPos])) {
					continue
				}

				contentPos = savedContentPos
				break
			}

			if (contentIsNewline !== patternIsNewline) {
				break
			}

			if (contentIsNewline && patternIsNewline) {
				contentPos = skipChars(content, contentPos, isNewline)
				patternPos = skipChars(searchPattern, patternPos, isNewline)
				continue
			}

			const contentIsWhitespace = isNonNewlineWhitespace(contentChar)
			const patternIsWhitespace = isNonNewlineWhitespace(patternChar)

			if (contentIsWhitespace && patternIsWhitespace) {
				contentPos = skipChars(content, contentPos, isNonNewlineWhitespace)
				patternPos = skipChars(searchPattern, patternPos, isNonNewlineWhitespace)
				continue
			}

			if (contentChar === patternChar) {
				contentPos++
				patternPos++
				continue
			}

			// Characters don't match and can't be normalized - this starting position fails
			break
		}

		// Check if we matched the entire pattern, or if we only have trailing whitespace left in pattern
		if (patternPos === patternLen) {
			return { startIndex: contentStart, matchLength: contentPos - contentStart }
		}

		// Allow trailing whitespace/newlines in the pattern
		if (patternPos < patternLen) {
			patternPos = skipChars(searchPattern, patternPos, (c) => isNewline(c) || isNonNewlineWhitespace(c))
			if (patternPos === patternLen) {
				return { startIndex: contentStart, matchLength: contentPos - contentStart }
			}
		}
	}

	return { startIndex: -1, matchLength: 0 } // No match found
}

/**
 * Check if a character is a newline (\n, \r, or part of \r\n)
 */
function isNewline(char: string): boolean {
	return char === "\n" || char === "\r"
}

/**
 * Check if a character is non-newline whitespace (space or tab)
 */
function isNonNewlineWhitespace(char: string): boolean {
	return char === " " || char === "\t"
}

/**
 * Skip consecutive characters that match the predicate and return the next position
 */
function skipChars(text: string, startPos: number, predicate: (char: string) => boolean): number {
	let pos = startPos
	while (pos < text.length && predicate(text[pos])) {
		pos++
	}
	return pos
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

	const newChanges = extractCompletedChanges(sanitizedResponse)
	let hasNewSuggestions = newChanges.length > 0

	// Generate suggestions from all completed changes
	const modifiedContent = generateModifiedContent(newChanges, prefix, suffix, prefix + suffix)

	const modifiedContent_has_prefix_and_suffix =
		modifiedContent?.startsWith(prefix) && modifiedContent.endsWith(suffix)

	const suggestions = new GhostSuggestionsState()

	if (modifiedContent_has_prefix_and_suffix && modifiedContent) {
		// Mark as FIM option
		const middle = modifiedContent.slice(prefix.length, modifiedContent.length - suffix.length)
		suggestions.setFillInAtCursor({
			text: middle,
			prefix,
			suffix,
		})
	}

	return {
		suggestions,
		isComplete,
		hasNewSuggestions,
	}
}

/**
 * Extract completed <change> blocks from the buffer
 */
function extractCompletedChanges(searchText: string): ParsedChange[] {
	const changeRegex =
		/<change>\s*<search>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/search>\s*<replace>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/replace>\s*<\/change>/g

	return Array.from(searchText.matchAll(changeRegex), (match) => ({
		search: match[1],
		replace: match[2],
	}))
}

/**
 * Generate modified content by applying changes to the document
 */
function generateModifiedContent(
	changes: ParsedChange[],
	prefix: string,
	suffix: string,
	currentContent: string,
): string | undefined {
	if (changes.length === 0) {
		return undefined
	}

	// Add cursor marker to document content if it's not already there
	// This ensures that when LLM searches for <<<AUTOCOMPLETE_HERE>>>, it can find it
	let modifiedContent = currentContent
	const needsCursorMarker =
		changes.some((change) => change.search.includes(CURSOR_MARKER)) && !currentContent.includes(CURSOR_MARKER)
	if (needsCursorMarker) {
		// Construct content with cursor marker at the position between prefix and suffix
		modifiedContent = prefix + CURSOR_MARKER + suffix
	}

	// Process changes: preserve search content as-is, clean replace content for application
	const filteredChanges = changes.map((change) => ({
		search: change.search, // Keep cursor markers for matching against document
		replace: removeCursorMarker(change.replace), // Clean for content application
	}))

	// Apply changes in reverse order to maintain line numbers
	const appliedChanges: Array<{
		searchContent: string
		replaceContent: string
		startIndex: number
		endIndex: number
	}> = []

	for (const change of filteredChanges) {
		const matchResult = findBestMatch(modifiedContent, change.search)

		if (matchResult.startIndex !== -1) {
			// Check for overlapping changes before applying
			const endIndex = matchResult.startIndex + matchResult.matchLength
			const hasOverlap = appliedChanges.some((existingChange) => {
				// Check if ranges overlap
				const existingStart = existingChange.startIndex
				const existingEnd = existingChange.endIndex
				return matchResult.startIndex < existingEnd && endIndex > existingStart
			})

			if (hasOverlap) {
				console.warn("Skipping overlapping change:", change.search.substring(0, 50))
				continue // Skip this change to avoid duplicates
			}

			// Handle the case where search pattern ends with newline but we need to preserve additional whitespace
			let adjustedReplaceContent = change.replace

			// If the search pattern ends with a newline, check if there are additional empty lines after it
			if (change.search.endsWith("\n")) {
				let nextCharIndex = endIndex
				let extraNewlines = ""

				// Count consecutive newlines after the search pattern
				while (nextCharIndex < modifiedContent.length && modifiedContent[nextCharIndex] === "\n") {
					extraNewlines += "\n"
					nextCharIndex++
				}

				// If we found extra newlines, preserve them by adding them to the replacement
				if (extraNewlines.length > 0) {
					// Only add the extra newlines if the replacement doesn't already end with enough newlines
					if (!adjustedReplaceContent.endsWith("\n" + extraNewlines)) {
						adjustedReplaceContent = adjustedReplaceContent.trimEnd() + "\n" + extraNewlines
					}
				}
			}

			appliedChanges.push({
				searchContent: change.search,
				replaceContent: adjustedReplaceContent,
				startIndex: matchResult.startIndex,
				endIndex: endIndex,
			})
		}
	}

	// Sort by start index in descending order to apply changes from end to beginning
	appliedChanges.sort((a, b) => b.startIndex - a.startIndex)

	// Apply the changes
	for (const change of appliedChanges) {
		modifiedContent =
			modifiedContent.substring(0, change.startIndex) +
			change.replaceContent +
			modifiedContent.substring(change.endIndex)
	}

	// Remove cursor marker from the final content if we added it
	if (needsCursorMarker) {
		modifiedContent = removeCursorMarker(modifiedContent)
	}

	return modifiedContent
}
