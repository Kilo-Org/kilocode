/**
 * Snippet Ranking System
 * Based on Continue's ranking/index.ts for symbol similarity and snippet ranking
 */

import { GhostCodeSnippet, GhostSnippetType } from "./types"
import { EditorContextSnapshot } from "./EditorContextSnapshot"

// Regular expression for splitting into symbols (same as Continue)
const rx = /[\s.,\/#!$%\^&\*;:{}=\-_`~()\[\]]/g

/**
 * Extract symbols from a snippet for similarity calculation
 */
export function getSymbolsForSnippet(snippet: string): Set<string> {
	const symbols = snippet
		.split(rx)
		.map((s) => s.trim())
		.filter((s) => s !== "")
	return new Set(symbols)
}

/**
 * Calculate Jaccard similarity between two text snippets
 * Returns number of shared symbols divided by total number of unique symbols
 */
function jaccardSimilarity(a: string, b: string): number {
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
 * GhostCodeSnippet with ranking score
 */
export interface RankedGhostSnippet extends GhostCodeSnippet {
	score: number
}

/**
 * Rank and order snippets based on similarity to cursor context
 */
export function rankAndOrderSnippets(
	snippets: GhostCodeSnippet[],
	helper: EditorContextSnapshot,
): RankedGhostSnippet[] {
	// Create window around cursor for similarity comparison
	const windowAroundCursor = helper.textAroundCursor

	// Add scores to snippets
	const rankedSnippets: RankedGhostSnippet[] = snippets.map((snippet) => ({
		...snippet,
		score: jaccardSimilarity(snippet.content, windowAroundCursor),
	}))

	// Deduplicate and sort by score (highest first)
	const uniqueSnippets = deduplicateSnippets(rankedSnippets)
	return uniqueSnippets.sort((a, b) => b.score - a.score)
}

/**
 * Remove duplicate snippets by merging similar content
 */
function deduplicateSnippets(snippets: RankedGhostSnippet[]): RankedGhostSnippet[] {
	// Group by file
	const fileGroups: { [key: string]: RankedGhostSnippet[] } = {}
	for (const snippet of snippets) {
		if (!fileGroups[snippet.filepath]) {
			fileGroups[snippet.filepath] = []
		}
		fileGroups[snippet.filepath].push(snippet)
	}

	// Process each file group
	const allSnippets: RankedGhostSnippet[] = []
	for (const file of Object.keys(fileGroups)) {
		allSnippets.push(...deduplicateFileSnippets(fileGroups[file]))
	}

	return allSnippets
}

/**
 * Deduplicate snippets from the same file
 */
function deduplicateFileSnippets(snippets: RankedGhostSnippet[]): RankedGhostSnippet[] {
	if (snippets.length <= 1) {
		return snippets
	}

	// Sort by content similarity and keep highest scoring unique content
	const seen = new Set<string>()
	const unique: RankedGhostSnippet[] = []

	for (const snippet of snippets.sort((a, b) => b.score - a.score)) {
		// Create a normalized version for comparison
		const normalized = snippet.content.replace(/\s+/g, " ").trim()

		if (!seen.has(normalized)) {
			seen.add(normalized)
			unique.push(snippet)
		}
	}

	return unique
}

/**
 * Fill prompt with snippets up to token limit
 */
export function fillPromptWithSnippets(snippets: RankedGhostSnippet[], maxSnippetTokens: number): RankedGhostSnippet[] {
	let tokensRemaining = maxSnippetTokens
	const keptSnippets: RankedGhostSnippet[] = []

	for (const snippet of snippets) {
		// Rough token estimation (4 chars per token)
		const estimatedTokens = Math.ceil(snippet.content.length / 4)

		if (tokensRemaining - estimatedTokens >= 0) {
			tokensRemaining -= estimatedTokens
			keptSnippets.push(snippet)
		}
	}

	return keptSnippets
}
