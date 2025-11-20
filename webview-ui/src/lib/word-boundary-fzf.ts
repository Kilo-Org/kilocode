//kilocode_change new file

/**
 * Drop-in replacement for Fzf library that uses word boundary matching
 * instead of fuzzy matching.
 *
 * API-compatible with fzf library:
 * - new Fzf(items, { selector: (item) => string })
 * - fzfInstance.find(searchValue) returns array of { item: original }
 */

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

	constructor(items: T[], options: FzfOptions<T>) {
		this.items = items
		this.selector = options.selector
	}

	/**
	 * Find items that match the search query using word boundary matching.
	 * Returns matches in their original order (no scoring/sorting).
	 *
	 * Word boundary matching means:
	 * - "foo" matches "fool org" (starts with "foo")
	 * - "foo" matches "the fool" (word starts with "foo")
	 * - "foo" does NOT match "faoboc" (no word boundary)
	 * - "foo bar" matches items containing both "foo" and "bar" as separate words
	 * - "clso" matches "Claude Sonnet" (first letters of words: Cl + So)
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

		// Split query into words for multi-word matching
		const queryWords = normalizedQuery.split(/\s+/).filter((word) => word.length > 0)

		const results: FzfResult<T>[] = []

		for (const item of this.items) {
			const text = this.selector(item).toLowerCase()

			// For multi-word queries, all words must match
			if (queryWords.length > 1) {
				const matches = queryWords.map((word) => this.matchAcronym(text, word))

				// All query words must match
				if (matches.every((match) => match !== null)) {
					// Combine positions from all matches
					const allPositions = new Set<number>()
					matches.forEach((match) => {
						if (match) {
							match.positions.forEach((pos) => allPositions.add(pos))
						}
					})

					results.push({
						item,
						positions: allPositions,
					})
				}
			} else {
				// Single word query - use acronym matching
				const match = this.matchAcronym(text, normalizedQuery)

				if (match) {
					results.push({
						item,
						positions: match.positions,
					})
				}
			}
		}

		return results
	}

	/**
	 * Match query as an acronym against text.
	 * For example, "clso" matches "Claude Sonnet" (Cl + So)
	 * Each character in the query should match the start of a word in the text.
	 * Supports backtracking to find matches that don't start at the beginning.
	 */
	private matchAcronym(text: string, query: string): { positions: Set<number> } | null {
		const wordBoundaryRegex = /[\s\-_./\\]+/
		const words = text.split(wordBoundaryRegex).filter((w) => w.length > 0)

		// Build word start positions in the original text
		const wordStartPositions: number[] = []
		let searchPos = 0
		for (const word of words) {
			const wordPos = text.indexOf(word, searchPos)
			wordStartPositions.push(wordPos)
			searchPos = wordPos + word.length
		}

		// Try starting the match from each word
		for (let startWordIdx = 0; startWordIdx < words.length; startWordIdx++) {
			let queryIndex = 0
			const positions = new Set<number>()

			// Try to match starting from this word
			for (let wordIdx = startWordIdx; wordIdx < words.length && queryIndex < query.length; wordIdx++) {
				const word = words[wordIdx]
				const wordStartPos = wordStartPositions[wordIdx]

				// Try to match as many consecutive characters as possible from this word
				let matchedInWord = 0
				while (
					queryIndex < query.length &&
					matchedInWord < word.length &&
					word[matchedInWord] === query[queryIndex]
				) {
					positions.add(wordStartPos + matchedInWord)
					queryIndex++
					matchedInWord++
				}

				// If we matched something from this word, continue to next word
				// If we didn't match anything, this starting position won't work
				if (matchedInWord === 0 && wordIdx === startWordIdx) {
					break
				}
			}

			// If we consumed the entire query, we found a match
			if (queryIndex === query.length) {
				return { positions }
			}
		}

		return null
	}
}
