import * as vscode from "vscode"
import { AutocompleteInput, AutocompleteOutcome } from "./types"
import { CURSOR_MARKER } from "./ghostConstants"

export interface StreamingParseResult {
	outcome: AutocompleteOutcome | undefined
	isComplete: boolean
	hasNewContent: boolean
}

export interface ParsedChange {
	search: string
	replace: string
	cursorPosition?: number // Offset within replace content where cursor should be positioned
}

function extractCursorPosition(content: string): number | undefined {
	const markerIndex = content.indexOf(CURSOR_MARKER)
	return markerIndex !== -1 ? markerIndex : undefined
}

function removeCursorMarker(content: string): string {
	return content.replaceAll(CURSOR_MARKER, "")
}

/**
 * Conservative XML sanitization - only fixes the specific case from user feedback
 */
function sanitizeXMLConservative(buffer: string): string {
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
function isResponseComplete(buffer: string, completedChangesCount: number): boolean {
	// Simple heuristic: if the buffer doesn't end with an incomplete tag,
	// consider it complete
	const trimmedBuffer = buffer.trim()

	// If the buffer is empty or only whitespace, consider it complete
	if (trimmedBuffer.length === 0) {
		return true
	}

	const incompleteChangeMatch = /<change(?:\s[^>]*)?>(?:(?!<\/change>)[\s\S])*$/i.test(trimmedBuffer)
	const incompleteSearchMatch = /<search(?:\s[^>]*)?>(?:(?!<\/search>)[\s\S])*$/i.test(trimmedBuffer)
	const incompleteReplaceMatch = /<replace(?:\s[^>]*)?>(?:(?!<\/replace>)[\s\S])*$/i.test(trimmedBuffer)
	const incompleteCDataMatch = /<!\[CDATA\[(?:(?!\]\]>)[\s\S])*$/i.test(trimmedBuffer)

	// If we have incomplete tags, the response is not complete
	if (incompleteChangeMatch || incompleteSearchMatch || incompleteReplaceMatch || incompleteCDataMatch) {
		return false
	}

	// If we have at least one complete change and no incomplete tags, likely complete
	return completedChangesCount > 0
}

/**
 * Find the best match for search content in the document, handling whitespace differences and cursor markers
 * This is a simplified version of the method from GhostStrategy
 */
export function findBestMatch(content: string, searchPattern: string): number {
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
		return mapNormalizedToOriginalIndex(content, normalizedContent, index)
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
function mapNormalizedToOriginalIndex(
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
 * Streaming XML parser for Ghost suggestions that can process incomplete responses
 * and emit AutocompleteOutcome as soon as complete <change> blocks are available
 */
export class GhostStreamingParser {
	public buffer: string = ""
	private completedChanges: ParsedChange[] = []
	private lastProcessedIndex: number = 0
	private input: AutocompleteInput | null = null
	private prefix: string = ""
	private suffix: string = ""
	private streamFinished: boolean = false
	private startTime: number = 0

	constructor() {}

	/**
	 * Initialize the parser with autocomplete input and prefix/suffix
	 */
	public initialize(input: AutocompleteInput, prefix: string, suffix: string): void {
		this.input = input
		this.prefix = prefix
		this.suffix = suffix
		this.startTime = Date.now()
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
	 * Process a new chunk of text and return AutocompleteOutcome if available
	 */
	public processChunk(chunk: string): StreamingParseResult {
		if (!this.input) {
			throw new Error("Parser not initialized. Call initialize() first.")
		}

		// Add chunk to buffer
		this.buffer += chunk

		// Extract any newly completed changes from the current buffer
		const newChanges = this.extractCompletedChanges()

		let hasNewContent = newChanges.length > 0

		// Add new changes to our completed list
		this.completedChanges.push(...newChanges)

		// Check if the response appears complete
		let isComplete = isResponseComplete(this.buffer, this.completedChanges.length)

		// Apply very conservative sanitization only when the stream is finished
		// and we still have no completed changes but have content in the buffer
		if (this.completedChanges.length === 0 && this.buffer.trim().length > 0 && this.streamFinished) {
			const sanitizedBuffer = sanitizeXMLConservative(this.buffer)
			if (sanitizedBuffer !== this.buffer) {
				// Re-process with sanitized buffer
				this.buffer = sanitizedBuffer
				const sanitizedChanges = this.extractCompletedChanges()
				if (sanitizedChanges.length > 0) {
					this.completedChanges.push(...sanitizedChanges)
					hasNewContent = true
					isComplete = isResponseComplete(this.buffer, this.completedChanges.length)
				}
			}
		}

		// Generate AutocompleteOutcome from completed changes
		const outcome = this.generateOutcome()

		return {
			outcome,
			isComplete,
			hasNewContent,
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
			const cursorPosition = extractCursorPosition(replaceContent)

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
	 * Generate AutocompleteOutcome from completed changes
	 */
	private generateOutcome(): AutocompleteOutcome | undefined {
		if (!this.input || this.completedChanges.length === 0) {
			return undefined
		}

		// Generate completion string from the parsed changes
		const completion = this.generateCompletionString()

		// Create AutocompleteOutcome
		const outcome: AutocompleteOutcome = {
			time: Date.now() - this.startTime,
			completion,
			prefix: this.prefix,
			suffix: this.suffix,
			prompt: "", // Will be set by caller
			modelProvider: "", // Will be set by caller
			modelName: "", // Will be set by caller
			completionOptions: {},
			cacheHit: false,
			numLines: completion.split("\n").length,
			filepath: this.input.filepath,
			completionId: this.input.completionId,
			uniqueId: "", // Will be set by caller
			timestamp: new Date().toISOString(),
			disable: false,
			maxPromptTokens: 0,
			debounceDelay: 0,
			modelTimeout: 0,
			maxSuffixPercentage: 0,
			prefixPercentage: 0,
			multilineCompletions: "auto",
			slidingWindowPrefixPercentage: 0,
			slidingWindowSize: 0,
		}

		return outcome
	}

	/**
	 * Generate completion string from parsed changes
	 * This converts the search/replace operations into a simple completion string
	 */
	private generateCompletionString(): string {
		if (this.completedChanges.length === 0) {
			return ""
		}

		// For now, we'll use a simple approach: concatenate all replace content
		// In the future, this could be more sophisticated
		let completion = ""

		for (const change of this.completedChanges) {
			// Remove cursor marker from replace content
			const cleanReplace = removeCursorMarker(change.replace)
			
			// If the search content contains the cursor marker, we're replacing at cursor position
			if (change.search.includes(CURSOR_MARKER)) {
				// Extract just the new content (what comes after the cursor marker in replace)
				const searchParts = change.search.split(CURSOR_MARKER)
				const beforeCursor = searchParts[0] || ""
				
				// The completion is what we're adding after the cursor
				// We need to remove the "before cursor" part from the replace content
				if (cleanReplace.startsWith(beforeCursor)) {
					completion += cleanReplace.substring(beforeCursor.length)
				} else {
					completion += cleanReplace
				}
			} else {
				// If no cursor marker, just use the replace content
				completion += cleanReplace
			}
		}

		return completion
	}

	/**
	 * Get completed changes (for debugging)
	 */
	public getCompletedChanges(): ParsedChange[] {
		return [...this.completedChanges]
	}
}
