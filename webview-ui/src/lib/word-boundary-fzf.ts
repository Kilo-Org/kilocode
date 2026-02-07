// kilocode_change - new file

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
}

// Single source of truth for word boundary characters
// - Split at positions before uppercase letters (camelCase/PascalCase: gitRebase → git, Rebase)
// - Split at existing delimiters: hyphen, underscore, dot, colon, whitespace, forward/back slash, brackets/parentheses
const WORD_BOUNDARY_REGEX = /(?=[A-Z])|[[\]_.:\s/\\(){}-]+/

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
			return this.items.map((item) => ({ item }))
		}

		const normalizedQuery = query.toLowerCase().trim()

		// Split query into words using the same word boundary regex as text
		// This ensures "gpt-5" becomes ["gpt", "5"] just like in the text
		const queryWords = normalizedQuery.split(WORD_BOUNDARY_REGEX).filter((word) => word.length > 0)

		const results: FzfResult<T>[] = []

		// If no words after splitting (e.g., query was just punctuation), return all items
		if (queryWords.length === 0) {
			return this.items.map((item) => ({ item }))
		}

		for (const item of this.items) {
			const text = this.selector(item)

			// For multi-word queries, all words must match
			if (queryWords.length > 1) {
				const allMatch = queryWords.every((word) => this.matchAcronym(text, word))

				if (allMatch) {
					results.push({ item })
				}
			} else {
				// Single word query - use the filtered word, not the original query
				// This handles cases like "gpt-" which becomes ["gpt"]
				if (this.matchAcronym(text, queryWords[0])) {
					results.push({ item })
				}
			}
		}

		return results
	}

	/**
	 * Match query as an acronym against text.
	 * For example, "clso" matches "Claude Sonnet" (Cl + So)
	 * Each character in the query should match the start of a word in the text.
	 */
	private matchAcronym(text: string, query: string): boolean {
		// Split original text to find word boundaries (including camelCase transitions)
		// Then lowercase the words for case-insensitive matching
		const words = text
			.split(WORD_BOUNDARY_REGEX)
			.filter((w) => w.length > 0)
			.map((w) => w.toLowerCase())

		// Recursive helper function to try matching from a given word index
		const tryMatch = (wordIdx: number, queryIdx: number): boolean => {
			// Base case: we've consumed the entire query
			if (queryIdx === query.length) {
				return true
			}

			// Base case: no more words to try
			if (wordIdx >= words.length) {
				return false
			}

			const word = words[wordIdx]

			// Try to match as many consecutive characters as possible from this word
			let matchedInWord = 0

			while (
				queryIdx + matchedInWord < query.length &&
				matchedInWord < word.length &&
				word[matchedInWord] === query[queryIdx + matchedInWord]
			) {
				matchedInWord++
			}

			// If we matched something, try to continue from the next word
			if (matchedInWord > 0) {
				if (tryMatch(wordIdx + 1, queryIdx + matchedInWord)) {
					return true
				}
				// If continuing didn't work, fall through to try skipping this word
			}

			// Try skipping this word and continuing with the next
			// This allows backtracking when a partial match doesn't lead to a full match
			return tryMatch(wordIdx + 1, queryIdx)
		}

		return tryMatch(0, 0)
	}
}
