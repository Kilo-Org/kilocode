/**
 * Drop-in replacement for Fzf library that uses Fuse.js for word boundary matching
 * instead of custom implementation.
 *
 * API-compatible with fzf library:
 * - new Fzf(items, { selector: (item) => string })
 * - fzfInstance.find(searchValue) returns array of { item: original }
 */

import Fuse from "fuse.js"

interface FzfOptions<T> {
	selector: (item: T) => string
}

interface FzfResult<T> {
	item: T
	positions: Set<number>
}

export class Fzf<T> {
	private items: T[]
	private selector: (item: T) => string
	private fuse: Fuse<T>

	constructor(items: T[], options: FzfOptions<T>) {
		this.items = items
		this.selector = options.selector

		// Configure Fuse.js for word boundary matching
		this.fuse = new Fuse(items, {
			keys: [
				{
					name: "searchField",
					getFn: (item) => this.selector(item as T),
				},
			],
			// Threshold controls how fuzzy the match is (0 = exact, 1 = very fuzzy)
			// We use a low threshold to simulate word boundary matching
			threshold: 0.3,
			// Include matches to get position information
			includeMatches: true,
			// Don't sort by score - preserve original order
			shouldSort: false,
			// Tokenize to match on word boundaries
			useExtendedSearch: true,
			// Match all tokens for multi-word queries
			findAllMatches: true,
			// Minimum characters before starting search
			minMatchCharLength: 1,
			// Location and distance help with word boundary preference
			location: 0,
			distance: 100,
			// Don't ignore location - helps with word boundary matching
			ignoreLocation: false,
		})
	}

	/**
	 * Find items that match the search query using Fuse.js.
	 * Returns matches in their original order (no scoring/sorting).
	 *
	 * @param query The search string
	 * @returns Array of results with item and metadata, in original order
	 */
	find(query: string): FzfResult<T>[] {
		if (!query || query.trim() === "") {
			return this.items.map((item) => ({
				item,
				positions: new Set<number>(),
			}))
		}

		const normalizedQuery = query.toLowerCase().trim()

		// For multi-word queries, we need to ensure all words match
		const queryWords = normalizedQuery.split(/\s+/).filter((word) => word.length > 0)

		if (queryWords.length > 1) {
			// For multi-word queries, filter items that contain all words
			const results: FzfResult<T>[] = []

			for (const item of this.items) {
				const text = this.selector(item).toLowerCase()
				const allWordsMatch = queryWords.every((queryWord) => {
					// Check if the word appears at a word boundary
					return this.matchesAtWordBoundary(text, queryWord)
				})

				if (allWordsMatch) {
					// Calculate positions for all matching words
					const positions = new Set<number>()
					queryWords.forEach((queryWord) => {
						const wordPositions = this.getWordBoundaryPositions(text, queryWord)
						wordPositions.forEach((pos) => positions.add(pos))
					})

					results.push({
						item,
						positions,
					})
				}
			}

			return results
		} else {
			// Single word query - use custom word boundary matching
			const results: FzfResult<T>[] = []

			for (const item of this.items) {
				const text = this.selector(item).toLowerCase()

				// Try acronym matching first
				const acronymMatch = this.matchAcronym(text, normalizedQuery)
				if (acronymMatch) {
					results.push({
						item,
						positions: acronymMatch.positions,
					})
					continue
				}

				// Then try word boundary matching
				if (this.matchesAtWordBoundary(text, normalizedQuery)) {
					const positions = this.getWordBoundaryPositions(text, normalizedQuery)
					results.push({
						item,
						positions: new Set(positions),
					})
				}
			}

			return results
		}
	}

	/**
	 * Check if query matches at a word boundary in the text
	 */
	private matchesAtWordBoundary(text: string, query: string): boolean {
		const wordBoundaryRegex = /[\s\-_./\\]+/
		const words = text.split(wordBoundaryRegex).filter((w) => w.length > 0)

		// Check if any word starts with the query
		return words.some((word) => word.toLowerCase().startsWith(query.toLowerCase()))
	}

	/**
	 * Get positions where the query matches at word boundaries
	 */
	private getWordBoundaryPositions(text: string, query: string): number[] {
		const positions: number[] = []
		const wordBoundaryRegex = /[\s\-_./\\]+/
		const words = text.split(wordBoundaryRegex).filter((w) => w.length > 0)

		let currentPos = 0
		for (const word of words) {
			const wordIndex = text.indexOf(word, currentPos)
			if (wordIndex !== -1) {
				currentPos = wordIndex
				if (word.toLowerCase().startsWith(query.toLowerCase())) {
					// Add positions for each character of the match
					for (let i = 0; i < query.length; i++) {
						positions.push(currentPos + i)
					}
				}
				currentPos += word.length
			}
		}

		return positions
	}

	/**
	 * Match query as an acronym against text.
	 * For example, "clso" matches "Claude Sonnet" (Cl + So)
	 * Each character in the query should match the start of a word in the text.
	 */
	private matchAcronym(text: string, query: string): { positions: Set<number> } | null {
		const wordBoundaryRegex = /[\s\-_./\\]+/
		const words = text.split(wordBoundaryRegex).filter((w) => w.length > 0)

		let queryIndex = 0
		let currentPos = 0
		const positions = new Set<number>()

		for (let wordIdx = 0; wordIdx < words.length && queryIndex < query.length; wordIdx++) {
			const word = words[wordIdx]
			const wordStartPos = text.indexOf(word, currentPos)

			if (wordStartPos === -1) continue

			currentPos = wordStartPos

			// Try to match as many consecutive characters as possible from this word
			let matchedInWord = 0
			while (
				queryIndex < query.length &&
				matchedInWord < word.length &&
				word[matchedInWord].toLowerCase() === query[queryIndex].toLowerCase()
			) {
				positions.add(currentPos + matchedInWord)
				queryIndex++
				matchedInWord++
			}

			// Move to next word position
			currentPos += word.length
		}

		// Only match if we consumed the entire query
		if (queryIndex === query.length) {
			return { positions }
		}

		return null
	}
}
