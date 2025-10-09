/**
 * Context ranking utilities for autocomplete
 * Based on Continue's ranking approach using Jaccard similarity
 */

export interface RankedSnippet {
	content: string
	filepath: string
	score: number
}

const SYMBOL_REGEX = /[\s.,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g

/**
 * Extract symbols from a code snippet by splitting on common delimiters
 */
export function getSymbolsForSnippet(snippet: string): Set<string> {
	const symbols = snippet
		.split(SYMBOL_REGEX)
		.map((s) => s.trim())
		.filter((s) => s !== "")
	return new Set(symbols)
}

/**
 * Calculate Jaccard similarity between two strings
 * Returns a value between 0 and 1, where:
 * - 0 means no common symbols
 * - 1 means identical symbol sets
 *
 * Formula: |A ∩ B| / |A ∪ B|
 * Where A and B are sets of symbols from each string
 */
export function jaccardSimilarity(a: string, b: string): number {
	const aSet = getSymbolsForSnippet(a)
	const bSet = getSymbolsForSnippet(b)
	const union = new Set([...aSet, ...bSet]).size

	// Avoid division by zero
	if (union === 0) {
		return 0
	}

	let intersection = 0
	for (const symbol of aSet) {
		if (bSet.has(symbol)) {
			intersection++
		}
	}

	return intersection / union
}

/**
 * Rank code snippets based on their similarity to the window around the cursor
 *
 * @param snippets - Array of code snippets to rank
 * @param windowAroundCursor - Code context around the cursor position
 * @returns Sorted array of snippets with scores (highest score first)
 */
export function rankSnippets(
	snippets: Array<{ content: string; filepath: string }>,
	windowAroundCursor: string,
): RankedSnippet[] {
	const rankedSnippets: RankedSnippet[] = snippets.map((snippet) => ({
		...snippet,
		score: jaccardSimilarity(snippet.content, windowAroundCursor),
	}))

	// Sort by score descending (highest score first)
	return rankedSnippets.sort((a, b) => b.score - a.score)
}

/**
 * Deduplicate snippets from the same file by merging overlapping content
 */
export function deduplicateSnippets(snippets: RankedSnippet[]): RankedSnippet[] {
	// Group by file
	const fileGroups: { [key: string]: RankedSnippet[] } = {}
	for (const snippet of snippets) {
		if (!fileGroups[snippet.filepath]) {
			fileGroups[snippet.filepath] = []
		}
		fileGroups[snippet.filepath].push(snippet)
	}

	// For each file, keep only the highest scored snippet
	const deduplicated: RankedSnippet[] = []
	for (const file of Object.keys(fileGroups)) {
		const snippetsInFile = fileGroups[file]
		if (snippetsInFile.length === 0) continue

		// Sort by score and take the best one
		snippetsInFile.sort((a, b) => b.score - a.score)
		deduplicated.push(snippetsInFile[0])
	}

	return deduplicated
}

/**
 * Filter snippets to fit within a token budget
 *
 * @param snippets - Ranked snippets (should be sorted by score)
 * @param maxTokens - Maximum number of tokens to use
 * @param estimateTokens - Function to estimate token count for a string
 * @returns Array of snippets that fit within the budget
 */
export function fillPromptWithSnippets(
	snippets: RankedSnippet[],
	maxTokens: number,
	estimateTokens: (text: string) => number,
): RankedSnippet[] {
	let tokensRemaining = maxTokens
	const keptSnippets: RankedSnippet[] = []

	for (const snippet of snippets) {
		const tokenCount = estimateTokens(snippet.content)
		if (tokensRemaining - tokenCount >= 0) {
			tokensRemaining -= tokenCount
			keptSnippets.push(snippet)
		}
	}

	return keptSnippets
}

/**
 * Simple token estimation (roughly 4 characters per token)
 * For more accurate estimation, use a proper tokenizer
 */
export function estimateTokenCount(text: string): number {
	return Math.ceil(text.length / 4)
}
