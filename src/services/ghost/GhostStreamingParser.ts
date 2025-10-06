import * as vscode from "vscode"
import { structuredPatch } from "diff"
import { GhostSuggestionContext, GhostSuggestionEditOperationType } from "./types"
import { GhostSuggestionsState } from "./GhostSuggestions"
import { CURSOR_MARKER } from "./utils/ghostConstants"

export interface StreamingParseResult {
	suggestions: GhostSuggestionsState
	isComplete: boolean
	hasNewSuggestions: boolean
}

export interface ParsedChange {
	search: string
	replace: string
	cursorPosition?: number // Offset within replace content where cursor should be positioned
}

/**
 * Streaming XML parser for Ghost suggestions that can process incomplete responses
 * and emit suggestions as soon as complete <change> blocks are available
 */
export class GhostStreamingParser {
	private buffer: string = ""
	private completedChanges: ParsedChange[] = []
	private lastProcessedIndex: number = 0
	private context: GhostSuggestionContext | null = null
	private streamFinished: boolean = false

	constructor() {}

	/**
	 * Initialize the parser with context
	 */
	public initialize(context: GhostSuggestionContext): void {
		this.context = context
		this.reset()
	}

	/**
	 * Reset parser state for a new parsing session
	 */
	public reset(): void {
		this.buffer = ""
		this.completedChanges = []
		this.lastProcessedIndex = 0
		this.streamFinished = false
	}

	/**
	 * Process a new chunk of text and return any newly completed suggestions
	 */
	public processChunk(chunk: string): StreamingParseResult {
		if (!this.context) {
			throw new Error("Parser not initialized. Call initialize() first.")
		}

		// Add chunk to buffer
		this.buffer += chunk

		// Extract any newly completed changes from the current buffer
		const newChanges = this.extractCompletedChanges()

		let hasNewSuggestions = newChanges.length > 0

		// Add new changes to our completed list
		this.completedChanges.push(...newChanges)

		// Check if the response appears complete
		let isComplete = this.isResponseComplete()

		// Apply very conservative sanitization only when the stream is finished
		// and we still have no completed changes but have content in the buffer
		if (this.completedChanges.length === 0 && this.buffer.trim().length > 0 && this.streamFinished) {
			const sanitizedBuffer = this.sanitizeXMLConservative(this.buffer)
			if (sanitizedBuffer !== this.buffer) {
				// Re-process with sanitized buffer
				this.buffer = sanitizedBuffer
				const sanitizedChanges = this.extractCompletedChanges()
				if (sanitizedChanges.length > 0) {
					this.completedChanges.push(...sanitizedChanges)
					hasNewSuggestions = true
					isComplete = this.isResponseComplete() // Re-check completion after sanitization
				}
			}
		}

		// Generate suggestions from all completed changes
		const suggestions = this.generateSuggestions(this.completedChanges)

		return {
			suggestions,
			isComplete,
			hasNewSuggestions,
		}
	}

	/**
	 * Mark the stream as finished and process any remaining content with sanitization
	 */
	public finishStream(): StreamingParseResult {
		this.streamFinished = true
		return this.processChunk("")
	}

	/**
	 * Extract completed <change> blocks from the buffer
	 */
	private extractCompletedChanges(): ParsedChange[] {
		const newChanges: ParsedChange[] = []

		// Look for complete <change> blocks starting from where we left off
		const searchText = this.buffer.substring(this.lastProcessedIndex)

		// Updated regex to handle both single-line XML format and traditional format with whitespace
		const changeRegex =
			/<change>\s*<search>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/search>\s*<replace>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/replace>\s*<\/change>/g

		let match
		let lastMatchEnd = 0

		while ((match = changeRegex.exec(searchText)) !== null) {
			// Preserve cursor marker in search content (LLM includes it when it sees it in document)
			const searchContent = match[1]
			// Extract cursor position from replace content
			const replaceContent = match[2]
			const cursorPosition = this.extractCursorPosition(replaceContent)

			newChanges.push({
				search: searchContent,
				replace: replaceContent,
				cursorPosition,
			})

			lastMatchEnd = match.index + match[0].length
		}

		// Update our processed index to avoid re-processing the same content
		if (lastMatchEnd > 0) {
			this.lastProcessedIndex += lastMatchEnd
		}

		return newChanges
	}

	/**
	 * Check if the response appears to be complete
	 */
	private isResponseComplete(): boolean {
		// Simple heuristic: if we haven't seen new content for a while and
		// the buffer doesn't end with an incomplete tag, consider it complete
		const trimmedBuffer = this.buffer.trim()

		// Check if we have any incomplete <change> tags
		const incompleteChangeMatch = /<change(?:\s[^>]*)?>(?:(?!<\/change>)[\s\S])*$/i.test(trimmedBuffer)
		const incompleteSearchMatch = /<search(?:\s[^>]*)?>(?:(?!<\/search>)[\s\S])*$/i.test(trimmedBuffer)
		const incompleteReplaceMatch = /<replace(?:\s[^>]*)?>(?:(?!<\/replace>)[\s\S])*$/i.test(trimmedBuffer)
		const incompleteCDataMatch = /<!\[CDATA\[(?:(?!\]\]>)[\s\S])*$/i.test(trimmedBuffer)

		// If we have incomplete tags, the response is not complete
		if (incompleteChangeMatch || incompleteSearchMatch || incompleteReplaceMatch || incompleteCDataMatch) {
			return false
		}

		// If the buffer is empty or only whitespace, consider it complete
		if (trimmedBuffer.length === 0) {
			return true
		}

		// If we have at least one complete change and no incomplete tags, likely complete
		return this.completedChanges.length > 0
	}

	/**
	 * Generate suggestions from completed changes
	 */
	private generateSuggestions(changes: ParsedChange[]): GhostSuggestionsState {
		const suggestions = new GhostSuggestionsState()

		if (!this.context?.document || changes.length === 0) {
			return suggestions
		}

		const document = this.context.document
		const currentContent = document.getText()

		// Add cursor marker to document content if it's not already there
		// This ensures that when LLM searches for <<<AUTOCOMPLETE_HERE>>>, it can find it
		let modifiedContent = currentContent
		const needsCursorMarker =
			changes.some((change) => change.search.includes(CURSOR_MARKER)) && !currentContent.includes(CURSOR_MARKER)
		if (needsCursorMarker && this.context.range) {
			// Add cursor marker at the specified range position
			const cursorOffset = document.offsetAt(this.context.range.start)
			modifiedContent =
				currentContent.substring(0, cursorOffset) + CURSOR_MARKER + currentContent.substring(cursorOffset)
		}

		// Process changes: preserve search content as-is, clean replace content for application
		const filteredChanges = changes.map((change) => ({
			search: change.search, // Keep cursor markers for matching against document
			replace: this.removeCursorMarker(change.replace), // Clean for content application
			cursorPosition: change.cursorPosition,
		}))

		// Apply changes in reverse order to maintain line numbers
		const appliedChanges: Array<{
			searchContent: string
			replaceContent: string
			startIndex: number
			endIndex: number
			cursorPosition?: number
		}> = []

		for (const change of filteredChanges) {
			const searchIndex = this.findBestMatch(modifiedContent, change.search)

			if (searchIndex !== -1) {
				// Check for overlapping changes before applying
				const endIndex = searchIndex + change.search.length
				const hasOverlap = appliedChanges.some((existingChange) => {
					// Check if ranges overlap
					const existingStart = existingChange.startIndex
					const existingEnd = existingChange.endIndex
					return searchIndex < existingEnd && endIndex > existingStart
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
					startIndex: searchIndex,
					endIndex: endIndex,
					cursorPosition: change.cursorPosition, // Preserve cursor position info
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
			modifiedContent = this.removeCursorMarker(modifiedContent)
		}

		// Generate diff between original and modified content
		const relativePath = vscode.workspace?.asRelativePath?.(document.uri, false) || document.uri.fsPath
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
						// Only increment the new line counter for additions and context lines
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
						// Only increment the old line counter for deletions and context lines
						currentOldLineNumber++
						break

					// Case 3: The line is unchanged (context)
					default:
						// For context lines, we increment both counters
						currentOldLineNumber++
						currentNewLineNumber++
						break
				}
			}
		}

		suggestions.sortGroups()
		return suggestions
	}

	/**
	 * Find the best match for search content in the document, handling whitespace differences and cursor markers
	 * This is a simplified version of the method from GhostStrategy
	 */
	private findBestMatch(content: string, searchPattern: string): number {
		// Validate inputs
		if (!content || !searchPattern) {
			return -1
		}

		// First try exact match
		let index = content.indexOf(searchPattern)
		if (index !== -1) {
			return index
		}

		// Handle the case where search pattern has trailing whitespace that might not match exactly
		if (searchPattern.endsWith("\n")) {
			// Try matching without the trailing newline, then check if we can find it in context
			const searchWithoutTrailingNewline = searchPattern.slice(0, -1)
			index = content.indexOf(searchWithoutTrailingNewline)
			if (index !== -1) {
				// Check if the character after the match is a newline or end of string
				const afterMatchIndex = index + searchWithoutTrailingNewline.length
				if (afterMatchIndex >= content.length || content[afterMatchIndex] === "\n") {
					return index
				}
			}
		}

		// Normalize whitespace for both content and search pattern
		const normalizeWhitespace = (text: string): string => {
			return text
				.replace(/\r\n/g, "\n") // Normalize line endings
				.replace(/\r/g, "\n") // Handle old Mac line endings
				.replace(/\t/g, "    ") // Convert tabs to spaces
				.replace(/[ \t]+$/gm, "") // Remove trailing whitespace from each line
		}

		const normalizedContent = normalizeWhitespace(content)
		const normalizedSearch = normalizeWhitespace(searchPattern)

		// Try normalized match
		index = normalizedContent.indexOf(normalizedSearch)
		if (index !== -1) {
			// Map back to original content position
			return this.mapNormalizedToOriginalIndex(content, normalizedContent, index)
		}

		// Try trimmed search (remove leading/trailing whitespace)
		const trimmedSearch = searchPattern.trim()
		if (trimmedSearch !== searchPattern) {
			index = content.indexOf(trimmedSearch)
			if (index !== -1) {
				return index
			}
		}

		return -1 // No match found
	}

	/**
	 * Map an index from normalized content back to the original content
	 */
	private mapNormalizedToOriginalIndex(
		originalContent: string,
		normalizedContent: string,
		normalizedIndex: number,
	): number {
		let originalIndex = 0
		let normalizedPos = 0

		while (normalizedPos < normalizedIndex && originalIndex < originalContent.length) {
			const originalChar = originalContent[originalIndex]
			const normalizedChar = normalizedContent[normalizedPos]

			if (originalChar === normalizedChar) {
				originalIndex++
				normalizedPos++
			} else {
				// Handle whitespace normalization differences
				if (/\s/.test(originalChar)) {
					originalIndex++
					// Skip ahead in original until we find non-whitespace or match normalized
					while (originalIndex < originalContent.length && /\s/.test(originalContent[originalIndex])) {
						originalIndex++
					}
					if (normalizedPos < normalizedContent.length && /\s/.test(normalizedChar)) {
						normalizedPos++
					}
				} else {
					// Characters don't match, this shouldn't happen with proper normalization
					originalIndex++
					normalizedPos++
				}
			}
		}

		return originalIndex
	}

	/**
	 * Extract cursor position from content containing cursor marker
	 */
	private extractCursorPosition(content: string): number | undefined {
		const markerIndex = content.indexOf(CURSOR_MARKER)
		return markerIndex !== -1 ? markerIndex : undefined
	}

	/**
	 * Remove cursor marker from content and return clean content
	 */
	private removeCursorMarker(content: string): string {
		return content.replaceAll(CURSOR_MARKER, "")
	}

	/**
	 * Get the current buffer content (for debugging)
	 */
	public getBuffer(): string {
		return this.buffer
	}

	/**
	 * Get completed changes (for debugging)
	 */
	public getCompletedChanges(): ParsedChange[] {
		return [...this.completedChanges]
	}

	/**
	 * Conservative XML sanitization - only fixes the specific case from user feedback
	 */
	private sanitizeXMLConservative(buffer: string): string {
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
}
