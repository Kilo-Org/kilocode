import { FillInAtCursorSuggestion, MatchingSuggestionResult, CacheMatchType } from "../types"

/**
 * Extended match types for enhanced cache matching
 */
export type EnhancedCacheMatchType = CacheMatchType | "fuzzy_prefix" | "context_similarity" | "multi_line_partial"

export interface EnhancedMatchingSuggestionResult {
	text: string
	matchType: EnhancedCacheMatchType
	confidence: number // 0-1 score indicating match quality
}

/**
 * Configuration for enhanced cache matching
 */
export interface EnhancedCacheMatchingConfig {
	/** Enable fuzzy prefix matching (tolerate small typos) */
	enableFuzzyMatching: boolean
	/** Maximum edit distance for fuzzy matching (default: 2) */
	maxEditDistance: number
	/** Enable context similarity scoring */
	enableContextSimilarity: boolean
	/** Minimum similarity score to consider a match (0-1, default: 0.7) */
	minSimilarityScore: number
	/** Enable multi-line awareness */
	enableMultiLineAwareness: boolean
	/** Maximum number of lines to consider for multi-line matching */
	maxMultiLineContext: number
}

const DEFAULT_CONFIG: EnhancedCacheMatchingConfig = {
	enableFuzzyMatching: true,
	maxEditDistance: 2,
	enableContextSimilarity: true,
	minSimilarityScore: 0.7,
	enableMultiLineAwareness: true,
	maxMultiLineContext: 5,
}

/**
 * Calculate Levenshtein edit distance between two strings
 * Used for fuzzy prefix matching
 */
export function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length
	if (b.length === 0) return a.length

	// Use two rows instead of full matrix for memory efficiency
	let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i)
	let currRow = new Array<number>(b.length + 1)

	for (let i = 1; i <= a.length; i++) {
		currRow[0] = i
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1
			currRow[j] = Math.min(
				currRow[j - 1] + 1, // insertion
				prevRow[j] + 1, // deletion
				prevRow[j - 1] + cost, // substitution
			)
		}
		;[prevRow, currRow] = [currRow, prevRow]
	}

	return prevRow[b.length]
}

/**
 * Calculate similarity score between two strings using Jaccard similarity
 * on character n-grams (trigrams)
 */
export function calculateSimilarity(a: string, b: string): number {
	if (a === b) return 1
	if (a.length === 0 || b.length === 0) return 0

	const n = 3 // trigram size
	const getNGrams = (str: string): Set<string> => {
		const grams = new Set<string>()
		// Pad string for edge n-grams
		const padded = `  ${str}  `
		for (let i = 0; i <= padded.length - n; i++) {
			grams.add(padded.substring(i, i + n))
		}
		return grams
	}

	const gramsA = getNGrams(a)
	const gramsB = getNGrams(b)

	let intersection = 0
	for (const gram of gramsA) {
		if (gramsB.has(gram)) {
			intersection++
		}
	}

	const union = gramsA.size + gramsB.size - intersection
	return union === 0 ? 0 : intersection / union
}

/**
 * Extract the last N lines from a string
 */
export function getLastNLines(text: string, n: number): string {
	const lines = text.split("\n")
	return lines.slice(-n).join("\n")
}

/**
 * Extract the first N lines from a string
 */
export function getFirstNLines(text: string, n: number): string {
	const lines = text.split("\n")
	return lines.slice(0, n).join("\n")
}

/**
 * Check if the current context is at a multi-line boundary
 * (e.g., function body, class definition, block statement)
 */
export function isMultiLineContext(prefix: string, suffix: string): boolean {
	const prefixTrimmed = prefix.trimEnd()
	const suffixTrimmed = suffix.trimStart()

	// Check for common multi-line context indicators
	const multiLineIndicators = [
		// Opening braces/brackets at end of prefix
		/[{(\[]\s*$/,
		// Function/class/block keywords at end of prefix
		/\b(function|class|if|else|for|while|switch|try|catch|finally|do|with)\s*[^;]*$/i,
		// Arrow function body
		/=>\s*$/,
		// Object/array literal start
		/[=:]\s*[{(\[]\s*$/,
	]

	const closingIndicators = [
		// Closing braces/brackets at start of suffix
		/^\s*[})\]]/,
	]

	const hasOpeningIndicator = multiLineIndicators.some((pattern) => pattern.test(prefixTrimmed))
	const hasClosingIndicator = closingIndicators.some((pattern) => pattern.test(suffixTrimmed))

	return hasOpeningIndicator || hasClosingIndicator
}

/**
 * Try to find a fuzzy prefix match
 * Returns the suggestion with adjusted text if a fuzzy match is found
 */
function tryFuzzyPrefixMatch(
	prefix: string,
	suffix: string,
	suggestion: FillInAtCursorSuggestion,
	config: EnhancedCacheMatchingConfig,
): EnhancedMatchingSuggestionResult | null {
	// Only try fuzzy matching if prefixes are similar in length
	const lengthDiff = Math.abs(prefix.length - suggestion.prefix.length)
	if (lengthDiff > config.maxEditDistance * 2) {
		return null
	}

	// Suffix must match exactly for fuzzy prefix matching
	if (suffix !== suggestion.suffix) {
		return null
	}

	// Calculate edit distance for the last portion of the prefix
	// (we care more about recent typing than the whole document)
	const compareLength = Math.min(50, Math.max(prefix.length, suggestion.prefix.length))
	const prefixEnd = prefix.slice(-compareLength)
	const suggestionPrefixEnd = suggestion.prefix.slice(-compareLength)

	const distance = levenshteinDistance(prefixEnd, suggestionPrefixEnd)

	if (distance <= config.maxEditDistance && distance > 0) {
		// Calculate confidence based on edit distance
		const confidence = 1 - distance / Math.max(prefixEnd.length, suggestionPrefixEnd.length)

		// For fuzzy matches, we need to adjust the suggestion text
		// If the user made a typo, we still want to show the full suggestion
		return {
			text: suggestion.text,
			matchType: "fuzzy_prefix",
			confidence,
		}
	}

	return null
}

/**
 * Try to find a context similarity match
 * Uses n-gram similarity to find suggestions with similar context
 */
function tryContextSimilarityMatch(
	prefix: string,
	suffix: string,
	suggestion: FillInAtCursorSuggestion,
	config: EnhancedCacheMatchingConfig,
): EnhancedMatchingSuggestionResult | null {
	// Get the last few lines of context for comparison
	const contextLines = config.maxMultiLineContext
	const prefixContext = getLastNLines(prefix, contextLines)
	const suggestionPrefixContext = getLastNLines(suggestion.prefix, contextLines)

	const suffixContext = getFirstNLines(suffix, contextLines)
	const suggestionSuffixContext = getFirstNLines(suggestion.suffix, contextLines)

	// Calculate similarity scores
	const prefixSimilarity = calculateSimilarity(prefixContext, suggestionPrefixContext)
	const suffixSimilarity = calculateSimilarity(suffixContext, suggestionSuffixContext)

	// Combined similarity (weighted average, prefix is more important)
	const combinedSimilarity = prefixSimilarity * 0.6 + suffixSimilarity * 0.4

	if (combinedSimilarity >= config.minSimilarityScore) {
		return {
			text: suggestion.text,
			matchType: "context_similarity",
			confidence: combinedSimilarity,
		}
	}

	return null
}

/**
 * Try to find a multi-line partial match
 * Handles cases where the user is typing within a multi-line suggestion
 */
function tryMultiLinePartialMatch(
	prefix: string,
	suffix: string,
	suggestion: FillInAtCursorSuggestion,
	_config: EnhancedCacheMatchingConfig,
): EnhancedMatchingSuggestionResult | null {
	// Check if the suggestion contains multiple lines
	if (!suggestion.text.includes("\n")) {
		return null
	}

	// Check if we're in a multi-line context
	if (!isMultiLineContext(suggestion.prefix, suggestion.suffix)) {
		return null
	}

	// Check if the current prefix extends the suggestion prefix
	if (!prefix.startsWith(suggestion.prefix)) {
		return null
	}

	// Check if suffix matches (allowing for some flexibility)
	if (suffix !== suggestion.suffix) {
		return null
	}

	// Extract what the user has typed
	const typedContent = prefix.substring(suggestion.prefix.length)

	// Check if the typed content matches the beginning of any line in the suggestion
	const suggestionLines = suggestion.text.split("\n")

	for (let i = 0; i < suggestionLines.length; i++) {
		const lineStart = suggestionLines.slice(0, i).join("\n") + (i > 0 ? "\n" : "")

		if (lineStart.startsWith(typedContent)) {
			// User is typing along with the suggestion
			const remainingText = suggestion.text.substring(typedContent.length)
			return {
				text: remainingText,
				matchType: "multi_line_partial",
				confidence: 0.9,
			}
		}

		if (typedContent.startsWith(lineStart)) {
			// User has typed past some lines, check if they're still on track
			const remainingTyped = typedContent.substring(lineStart.length)
			const currentLine = suggestionLines[i]

			if (currentLine.startsWith(remainingTyped)) {
				const remainingText =
					currentLine.substring(remainingTyped.length) + "\n" + suggestionLines.slice(i + 1).join("\n")
				return {
					text: remainingText,
					matchType: "multi_line_partial",
					confidence: 0.85,
				}
			}
		}
	}

	return null
}

/**
 * Enhanced version of findMatchingSuggestion with fuzzy matching,
 * multi-line awareness, and context similarity scoring
 *
 * @param prefix - The text before the cursor position
 * @param suffix - The text after the cursor position
 * @param suggestionsHistory - Array of previous suggestions (most recent last)
 * @param config - Configuration for enhanced matching (optional)
 * @returns The matching suggestion with match type and confidence, or null if no match found
 */
export function findEnhancedMatchingSuggestion(
	prefix: string,
	suffix: string,
	suggestionsHistory: FillInAtCursorSuggestion[],
	config: Partial<EnhancedCacheMatchingConfig> = {},
): EnhancedMatchingSuggestionResult | null {
	const fullConfig: EnhancedCacheMatchingConfig = { ...DEFAULT_CONFIG, ...config }

	// Collect all potential matches with their confidence scores
	const matches: EnhancedMatchingSuggestionResult[] = []

	// Search from most recent to least recent
	for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
		const suggestion = suggestionsHistory[i]

		// 1. Try exact prefix/suffix match (highest priority)
		if (prefix === suggestion.prefix && suffix === suggestion.suffix) {
			return { text: suggestion.text, matchType: "exact", confidence: 1.0 }
		}

		// 2. Try partial typing match (user typed part of suggestion)
		if (suggestion.text !== "" && prefix.startsWith(suggestion.prefix) && suffix === suggestion.suffix) {
			const typedContent = prefix.substring(suggestion.prefix.length)
			if (suggestion.text.startsWith(typedContent)) {
				return {
					text: suggestion.text.substring(typedContent.length),
					matchType: "partial_typing",
					confidence: 0.95,
				}
			}
		}

		// 3. Try backward deletion match
		if (suggestion.text !== "" && suggestion.prefix.startsWith(prefix) && suffix === suggestion.suffix) {
			const deletedContent = suggestion.prefix.substring(prefix.length)
			return {
				text: deletedContent + suggestion.text,
				matchType: "backward_deletion",
				confidence: 0.9,
			}
		}

		// 4. Try multi-line partial match (if enabled)
		if (fullConfig.enableMultiLineAwareness) {
			const multiLineMatch = tryMultiLinePartialMatch(prefix, suffix, suggestion, fullConfig)
			if (multiLineMatch) {
				matches.push(multiLineMatch)
			}
		}

		// 5. Try fuzzy prefix match (if enabled)
		if (fullConfig.enableFuzzyMatching) {
			const fuzzyMatch = tryFuzzyPrefixMatch(prefix, suffix, suggestion, fullConfig)
			if (fuzzyMatch) {
				matches.push(fuzzyMatch)
			}
		}

		// 6. Try context similarity match (if enabled)
		if (fullConfig.enableContextSimilarity) {
			const similarityMatch = tryContextSimilarityMatch(prefix, suffix, suggestion, fullConfig)
			if (similarityMatch) {
				matches.push(similarityMatch)
			}
		}
	}

	// Return the best match based on confidence score
	if (matches.length > 0) {
		matches.sort((a, b) => b.confidence - a.confidence)
		return matches[0]
	}

	return null
}

/**
 * Convert enhanced match result to standard match result
 * (for backward compatibility)
 */
export function toStandardMatchResult(
	enhanced: EnhancedMatchingSuggestionResult | null,
): MatchingSuggestionResult | null {
	if (!enhanced) {
		return null
	}

	// Map enhanced match types to standard types
	const typeMapping: Record<EnhancedCacheMatchType, CacheMatchType> = {
		exact: "exact",
		partial_typing: "partial_typing",
		backward_deletion: "backward_deletion",
		fuzzy_prefix: "exact", // Treat fuzzy as exact for compatibility
		context_similarity: "exact", // Treat similarity as exact for compatibility
		multi_line_partial: "partial_typing", // Treat multi-line as partial typing
	}

	return {
		text: enhanced.text,
		matchType: typeMapping[enhanced.matchType],
	}
}
