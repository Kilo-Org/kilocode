/**
 * Enhanced Cache Matching for Autocomplete Suggestions
 *
 * This module provides intelligent cache matching with:
 * - Fuzzy prefix matching (tolerates small typos)
 * - Multi-line awareness
 * - Context similarity scoring
 * - Configurable matching strategies
 */

import { FillInAtCursorSuggestion } from "../types"

/**
 * Configuration for the enhanced cache matcher
 */
export interface EnhancedMatcherConfig {
	/** Maximum Levenshtein distance for fuzzy matching (default: 2) */
	maxEditDistance: number
	/** Minimum similarity score to consider a match (0-1, default: 0.7) */
	minSimilarityScore: number
	/** Enable fuzzy matching for prefixes (default: true) */
	enableFuzzyMatching: boolean
	/** Enable multi-line context awareness (default: true) */
	enableMultiLineMatching: boolean
	/** Enable context similarity scoring (default: true) */
	enableContextScoring: boolean
}

/**
 * Result of an enhanced cache match
 */
export interface EnhancedMatchResult {
	/** The suggested text to insert */
	text: string
	/** Type of match found */
	matchType: "exact" | "partial_typing" | "backward_deletion" | "fuzzy" | "multi_line" | "context_similar"
	/** Confidence score (0-1) */
	confidence: number
	/** Additional metadata about the match */
	metadata?: {
		editDistance?: number
		similarityScore?: number
		linesMatched?: number
	}
}

const DEFAULT_CONFIG: EnhancedMatcherConfig = {
	maxEditDistance: 2,
	minSimilarityScore: 0.7,
	enableFuzzyMatching: true,
	enableMultiLineMatching: true,
	enableContextScoring: true,
}

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching to tolerate small typos
 */
function levenshteinDistance(str1: string, str2: string): number {
	const len1 = str1.length
	const len2 = str2.length
	const matrix: number[][] = []

	// Initialize matrix
	for (let i = 0; i <= len1; i++) {
		matrix[i] = [i]
	}
	for (let j = 0; j <= len2; j++) {
		matrix[0][j] = j
	}

	// Fill matrix
	for (let i = 1; i <= len1; i++) {
		for (let j = 1; j <= len2; j++) {
			const cost = str1[i - 1] === str2[j - 1] ? 0 : 1
			matrix[i][j] = Math.min(
				matrix[i - 1][j] + 1, // deletion
				matrix[i][j - 1] + 1, // insertion
				matrix[i - 1][j - 1] + cost, // substitution
			)
		}
	}

	return matrix[len1][len2]
}

/**
 * Calculate similarity score between two strings (0-1)
 * Uses normalized Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
	if (str1 === str2) return 1.0
	if (str1.length === 0 || str2.length === 0) return 0.0

	const distance = levenshteinDistance(str1, str2)
	const maxLength = Math.max(str1.length, str2.length)
	return 1 - distance / maxLength
}

/**
 * Extract the last N lines from a string
 */
function getLastLines(text: string, n: number): string {
	const lines = text.split("\n")
	return lines.slice(-n).join("\n")
}

/**
 * Count the number of lines in a string
 */
function countLines(text: string): number {
	return text.split("\n").length
}

/**
 * Check if prefix ends with common trigger points
 */
function endsWithTriggerPoint(prefix: string): boolean {
	const trimmed = prefix.trimEnd()
	const triggerChars = [".", "(", "{", ",", ":", "=", "["]
	return triggerChars.some((char) => trimmed.endsWith(char))
}

/**
 * Enhanced cache matcher class
 */
export class EnhancedCacheMatcher {
	private config: EnhancedMatcherConfig

	constructor(config: Partial<EnhancedMatcherConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config }
	}

	/**
	 * Find the best matching suggestion from history
	 */
	public findBestMatch(
		prefix: string,
		suffix: string,
		suggestionsHistory: FillInAtCursorSuggestion[],
	): EnhancedMatchResult | null {
		let bestMatch: EnhancedMatchResult | null = null
		let bestScore = 0

		// Search from most recent to least recent
		for (let i = suggestionsHistory.length - 1; i >= 0; i--) {
			const suggestion = suggestionsHistory[i]

			// Try different matching strategies
			const matches = [
				this.tryExactMatch(prefix, suffix, suggestion),
				this.tryPartialTypingMatch(prefix, suffix, suggestion),
				this.tryBackwardDeletionMatch(prefix, suffix, suggestion),
				this.config.enableFuzzyMatching ? this.tryFuzzyMatch(prefix, suffix, suggestion) : null,
				this.config.enableMultiLineMatching ? this.tryMultiLineMatch(prefix, suffix, suggestion) : null,
				this.config.enableContextScoring ? this.tryContextSimilarMatch(prefix, suffix, suggestion) : null,
			].filter((match): match is EnhancedMatchResult => match !== null)

			// Find the best match from this suggestion
			for (const match of matches) {
				if (match.confidence > bestScore) {
					bestScore = match.confidence
					bestMatch = match
				}
			}

			// If we found a perfect match, stop searching
			if (bestScore >= 1.0) {
				break
			}
		}

		// Only return matches above the minimum similarity threshold
		if (bestMatch && bestMatch.confidence >= this.config.minSimilarityScore) {
			return bestMatch
		}

		return null
	}

	/**
	 * Try exact prefix/suffix match
	 */
	private tryExactMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		if (prefix === suggestion.prefix && suffix === suggestion.suffix) {
			return {
				text: suggestion.text,
				matchType: "exact",
				confidence: 1.0,
			}
		}
		return null
	}

	/**
	 * Try partial typing match (user started typing the suggestion)
	 */
	private tryPartialTypingMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		if (suggestion.text !== "" && prefix.startsWith(suggestion.prefix) && suffix === suggestion.suffix) {
			const typedContent = prefix.substring(suggestion.prefix.length)

			if (suggestion.text.startsWith(typedContent)) {
				const remainingText = suggestion.text.substring(typedContent.length)
				const confidence = 0.95 // High confidence for partial typing

				return {
					text: remainingText,
					matchType: "partial_typing",
					confidence,
				}
			}
		}
		return null
	}

	/**
	 * Try backward deletion match (user deleted characters)
	 */
	private tryBackwardDeletionMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		if (suggestion.text !== "" && suggestion.prefix.startsWith(prefix) && suffix === suggestion.suffix) {
			const deletedContent = suggestion.prefix.substring(prefix.length)
			const confidence = 0.9 // High confidence for backward deletion

			return {
				text: deletedContent + suggestion.text,
				matchType: "backward_deletion",
				confidence,
			}
		}
		return null
	}

	/**
	 * Try fuzzy match (tolerates small typos in prefix)
	 */
	private tryFuzzyMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		// Only try fuzzy matching if suffixes match exactly
		if (suffix !== suggestion.suffix || suggestion.text === "") {
			return null
		}

		// Calculate edit distance between prefixes
		const editDistance = levenshteinDistance(prefix, suggestion.prefix)

		// Check if within acceptable edit distance
		if (editDistance > 0 && editDistance <= this.config.maxEditDistance) {
			// Calculate confidence based on edit distance
			const maxLength = Math.max(prefix.length, suggestion.prefix.length)
			const confidence = Math.max(0.7, 1 - editDistance / maxLength)

			return {
				text: suggestion.text,
				matchType: "fuzzy",
				confidence,
				metadata: {
					editDistance,
				},
			}
		}

		return null
	}

	/**
	 * Try multi-line match (considers multiple lines of context)
	 */
	private tryMultiLineMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		// Only consider multi-line if both prefix and suggestion have multiple lines
		const prefixLines = countLines(prefix)
		const suggestionPrefixLines = countLines(suggestion.prefix)

		if (prefixLines < 2 || suggestionPrefixLines < 2 || suggestion.text === "") {
			return null
		}

		// Compare last 3 lines of prefix
		const lastPrefixLines = getLastLines(prefix, 3)
		const lastSuggestionLines = getLastLines(suggestion.prefix, 3)

		// Calculate similarity of the last few lines
		const similarity = calculateSimilarity(lastPrefixLines, lastSuggestionLines)

		// If suffixes match and multi-line context is similar
		if (suffix === suggestion.suffix && similarity >= 0.8) {
			return {
				text: suggestion.text,
				matchType: "multi_line",
				confidence: similarity * 0.85, // Slightly lower confidence for multi-line
				metadata: {
					similarityScore: similarity,
					linesMatched: Math.min(3, prefixLines),
				},
			}
		}

		return null
	}

	/**
	 * Try context-similar match (semantic similarity in context)
	 */
	private tryContextSimilarMatch(
		prefix: string,
		suffix: string,
		suggestion: FillInAtCursorSuggestion,
	): EnhancedMatchResult | null {
		if (suggestion.text === "") {
			return null
		}

		// Extract last 50 characters of prefix for context comparison
		const contextLength = 50
		const currentContext = prefix.slice(-contextLength)
		const suggestionContext = suggestion.prefix.slice(-contextLength)

		// Calculate context similarity
		const contextSimilarity = calculateSimilarity(currentContext, suggestionContext)

		// Check if suffix is similar (allow small differences)
		const suffixSimilarity = calculateSimilarity(suffix, suggestion.suffix)

		// Require high similarity for both context and suffix
		// This prevents false positives from matching unrelated code
		if (contextSimilarity < 0.85 || suffixSimilarity < 0.85) {
			return null
		}

		// Combine scores with weights
		const combinedScore = contextSimilarity * 0.7 + suffixSimilarity * 0.3

		// Boost confidence if prefix ends with trigger point
		const triggerBoost = endsWithTriggerPoint(prefix) ? 0.05 : 0

		const confidence = Math.min(0.95, combinedScore + triggerBoost)

		// Only return if above threshold
		if (confidence >= this.config.minSimilarityScore) {
			return {
				text: suggestion.text,
				matchType: "context_similar",
				confidence,
				metadata: {
					similarityScore: combinedScore,
				},
			}
		}

		return null
	}

	/**
	 * Update configuration
	 */
	public updateConfig(config: Partial<EnhancedMatcherConfig>): void {
		this.config = { ...this.config, ...config }
	}

	/**
	 * Get current configuration
	 */
	public getConfig(): EnhancedMatcherConfig {
		return { ...this.config }
	}
}

/**
 * Create a default enhanced cache matcher instance
 */
export function createEnhancedCacheMatcher(config?: Partial<EnhancedMatcherConfig>): EnhancedCacheMatcher {
	return new EnhancedCacheMatcher(config)
}
