/**
 * Consolidated text utilities for autocomplete functionality.
 * This module provides text comparison, similarity detection, and string manipulation
 * functions used across the ghost autocomplete and continuedev services.
 */

import { distance } from "fastest-levenshtein"

// ============================================================================
// String Similarity Functions
// ============================================================================

/**
 * Determine if two lines are effectively the same/repetition using Levenshtein distance.
 * Short lines (<=4 chars) are never considered repeated.
 */
export function lineIsRepeated(a: string, b: string): boolean {
	if (a.length <= 4 || b.length <= 4) {
		return false
	}
	const aTrim = a.trim()
	const bTrim = b.trim()
	return distance(aTrim, bTrim) / bTrim.length < 0.1
}

/**
 * Check if two lines match perfectly (exact match, non-empty).
 */
export function linesMatchPerfectly(lineA: string, lineB: string): boolean {
	return lineA === lineB && lineA !== ""
}

const END_BRACKETS = ["}", "});", "})"]
const BRACKET_CHARS_FOR_MATCH = ["}", "*", "});", "})"]

/**
 * Check if two lines match using fuzzy comparison with Levenshtein distance.
 * Special handling for bracket-only lines which require exact trimmed matches.
 *
 * @param lineA - First line to compare
 * @param lineB - Second line to compare
 * @param linesBetween - Number of lines between them (affects threshold)
 */
export function linesMatch(lineA: string, lineB: string, linesBetween = 0): boolean {
	// Require a perfect (without padding) match for these lines
	// Otherwise they are edit distance 1 from empty lines and other single char lines
	if (BRACKET_CHARS_FOR_MATCH.includes(lineA.trim())) {
		return lineA.trim() === lineB.trim()
	}

	const d = distance(lineA, lineB)

	return (
		// Should be more unlikely for lines to fuzzy match if they are further away
		(d / Math.max(lineA.length, lineB.length) <= Math.max(0, 0.48 - linesBetween * 0.06) ||
			lineA.trim() === lineB.trim()) &&
		lineA.trim() !== ""
	)
}

// ============================================================================
// Longest Common Subsequence
// ============================================================================

/**
 * Compute the longest common subsequence of two strings.
 * Uses dynamic programming approach.
 */
export function longestCommonSubsequence(a: string, b: string): string {
	const lengths: number[][] = []
	for (let i = 0; i <= a.length; i++) {
		lengths[i] = []
		for (let j = 0; j <= b.length; j++) {
			if (i === 0 || j === 0) {
				lengths[i][j] = 0
			} else if (a[i - 1] === b[j - 1]) {
				lengths[i][j] = lengths[i - 1][j - 1] + 1
			} else {
				lengths[i][j] = Math.max(lengths[i - 1][j], lengths[i][j - 1])
			}
		}
	}
	let result = ""
	let x = a.length
	let y = b.length
	while (x !== 0 && y !== 0) {
		if (lengths[x][y] === lengths[x - 1][y]) {
			x--
		} else if (lengths[x][y] === lengths[x][y - 1]) {
			y--
		} else {
			result = a[x - 1] + result
			x--
			y--
		}
	}
	return result
}

// ============================================================================
// Line Matching
// ============================================================================

type MatchLineResult = {
	/**
	 * -1 if it's a new line, otherwise the index of the first match
	 * in the old lines.
	 */
	matchIndex: number
	isPerfectMatch: boolean
	newLine: string
}

/**
 * Find a match for a new line in an array of old lines.
 *
 * @param newLine - The line to find a match for
 * @param oldLines - Array of lines to search in
 * @param permissiveAboutIndentation - If true, be more lenient about indentation differences
 * @returns Match result with index, perfect match flag, and potentially corrected line
 */
export function matchLine(newLine: string, oldLines: string[], permissiveAboutIndentation = false): MatchLineResult {
	// Only match empty lines if it's the next one:
	if (newLine.trim() === "" && oldLines[0]?.trim() === "") {
		return {
			matchIndex: 0,
			isPerfectMatch: true,
			newLine: newLine.trim(),
		}
	}

	const isEndBracket = END_BRACKETS.includes(newLine.trim())

	for (let i = 0; i < oldLines.length; i++) {
		// trims trailing whitespaces from the lines before comparison
		// this ensures trailing spaces don't affect matching.
		const oldLineTrimmed = oldLines[i].trimEnd()
		const newLineTrimmed = newLine.trimEnd()

		// Don't match end bracket lines if too far away
		if (i > 4 && isEndBracket) {
			return { matchIndex: -1, isPerfectMatch: false, newLine }
		}

		if (linesMatchPerfectly(newLineTrimmed, oldLineTrimmed)) {
			return { matchIndex: i, isPerfectMatch: true, newLine }
		}
		if (linesMatch(newLineTrimmed, oldLineTrimmed, i)) {
			// This is a way to fix indentation, but only for sufficiently long lines
			// to avoid matching whitespace or short lines
			if (
				newLineTrimmed.trimStart() === oldLineTrimmed.trimStart() &&
				(permissiveAboutIndentation || newLine.trim().length > 8)
			) {
				return {
					matchIndex: i,
					isPerfectMatch: true,
					newLine: oldLines[i],
				}
			}
			return { matchIndex: i, isPerfectMatch: false, newLine }
		}
	}

	return { matchIndex: -1, isPerfectMatch: false, newLine }
}

// ============================================================================
// Whitespace and Blank Detection
// ============================================================================

/**
 * Check if a string contains only whitespace characters.
 */
export function isOnlyWhitespace(text: string): boolean {
	return /^[\s]+$/.test(text)
}

/**
 * Check if a string is blank (empty or only whitespace after trimming).
 */
export function isBlank(text: string): boolean {
	return text.trim().length === 0
}

// ============================================================================
// Repetition Detection
// ============================================================================

const MAX_REPETITION_FREQ_TO_CHECK = 3

/**
 * Detect extreme repetition patterns in text (e.g., same line repeated many times).
 * Uses LCS to find common patterns across lines.
 */
export function isExtremeRepetition(completion: string): boolean {
	const lines = completion.split("\n")
	if (lines.length < 6) {
		return false
	}
	for (let freq = 1; freq < MAX_REPETITION_FREQ_TO_CHECK; freq++) {
		const lcs = longestCommonSubsequence(lines[0], lines[freq])
		if (lcs.length > 5 || lcs.length > lines[0].length * 0.5) {
			let matchCount = 0
			for (let i = 0; i < lines.length; i += freq) {
				if (lines[i].includes(lcs)) {
					matchCount++
				}
			}
			if (matchCount * freq > 8 || (matchCount * freq) / lines.length > 0.8) {
				return true
			}
		}
	}
	return false
}

/**
 * Detects when a suggestion's tail is repeating itself - a common LLM failure mode.
 * For example: "the beginning. We are going to start from the beginning. We are going to start from the beginning..."
 *
 * @param suggestion - The suggestion text to check
 * @param phraseLength - Length of phrase to check for repetition (default: 30)
 * @param minRepetitions - Minimum number of repetitions to consider it repetitive (default: 3)
 */
export function containsRepetitivePhrase(suggestion: string, phraseLength = 30, minRepetitions = 3): boolean {
	// Only check suggestions that are long enough to contain repetition
	if (suggestion.length < phraseLength * minRepetitions) {
		return false
	}

	// Strip non-word characters from the right before selecting the tail
	// This handles cases like "...the beginning..." where trailing punctuation would break detection
	const strippedSuggestion = suggestion.replace(/\W+$/, "")

	if (strippedSuggestion.length < phraseLength) {
		return false
	}

	// Extract a phrase from the end of the stripped suggestion
	const phrase = strippedSuggestion.slice(-phraseLength)

	// Count how many times this phrase appears in the original suggestion
	let count = 0
	let pos = 0
	while ((pos = suggestion.indexOf(phrase, pos)) !== -1) {
		count++
		pos += phrase.length
	}

	return count >= minRepetitions
}

// ============================================================================
// Prefix/Suffix Overlap Handling
// ============================================================================

/**
 * Remove overlapping prefix from completion text.
 * Handles cases where the model repeats part of the prefix in its completion.
 */
export function removePrefixOverlap(completion: string, prefix: string): string {
	const prefixEnd = prefix.split("\n").pop()
	if (prefixEnd) {
		if (completion.startsWith(prefixEnd)) {
			completion = completion.slice(prefixEnd.length)
		} else {
			const trimmedPrefix = prefixEnd.trim()
			const lastWord = trimmedPrefix.split(/\s+/).pop()
			if (lastWord && completion.startsWith(lastWord)) {
				completion = completion.slice(lastWord.length)
			} else if (completion.startsWith(trimmedPrefix)) {
				completion = completion.slice(trimmedPrefix.length)
			}
		}
	}
	return completion
}

/**
 * Check if completion rewrites the line above (first line of completion matches last line of prefix).
 */
export function rewritesLineAbove(completion: string, prefix: string): boolean {
	const lineAbove = prefix
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.slice(-1)[0]
	if (!lineAbove) {
		return false
	}

	const firstLineOfCompletion = completion.split("\n").find((line) => line.trim().length > 0)
	if (!firstLineOfCompletion) {
		return false
	}
	return lineIsRepeated(lineAbove, firstLineOfCompletion)
}

// ============================================================================
// Markdown Processing
// ============================================================================

/**
 * Removes markdown code block delimiters from completion.
 * Removes the first line if it starts with backticks (with optional language name).
 * Removes the last line if it contains only backticks.
 */
export function removeBackticks(completion: string): string {
	const lines = completion.split("\n")

	if (lines.length === 0) {
		return completion
	}

	let startIdx = 0
	let endIdx = lines.length

	// Remove first line if it starts with backticks (``` or ```language)
	const firstLineTrimmed = lines[0].trim()
	if (firstLineTrimmed.startsWith("```")) {
		startIdx = 1
	}

	// Remove last line if it contains only backticks (one or more)
	if (lines.length > startIdx) {
		const lastLineTrimmed = lines[lines.length - 1].trim()
		if (lastLineTrimmed.length > 0 && /^`+$/.test(lastLineTrimmed)) {
			endIdx = lines.length - 1
		}
	}

	// If we removed lines, return the modified completion
	if (startIdx > 0 || endIdx < lines.length) {
		return lines.slice(startIdx, endIdx).join("\n")
	}

	return completion
}
