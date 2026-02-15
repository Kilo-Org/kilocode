import { LRUCache } from "lru-cache"

const MAX_PREFIX_LENGTH = 50000

function truncatePrefix(input: string, safety: number = 100): string {
	const maxBytes = MAX_PREFIX_LENGTH - safety
	let bytes = 0
	let startIndex = 0

	// Count bytes from the end, keeping the most recent typing
	for (let i = input.length - 1; i >= 0; i--) {
		bytes += new TextEncoder().encode(input[i]).length
		if (bytes > maxBytes) {
			startIndex = i + 1
			break
		}
	}

	return input.substring(startIndex)
}

export class AutocompleteLruCacheInMem {
	private static capacity = 100
	private cache: LRUCache<string, string>

	private constructor() {
		this.cache = new LRUCache<string, string>({
			max: AutocompleteLruCacheInMem.capacity,
		})
	}

	static async get(): Promise<AutocompleteLruCacheInMem> {
		return new AutocompleteLruCacheInMem()
	}

	async get(prefix: string): Promise<string | undefined> {
		const truncated = truncatePrefix(prefix)

		// First try exact match (faster)
		const exactMatch = this.cache.get(truncated)
		if (exactMatch !== undefined) {
			return exactMatch
		}

		// Then try fuzzy matching - find keys where prefix starts with the key
		// If the query is "co" and we have "c" -> "ontinue" in the cache,
		// we should return "ntinue" as the completion.
		// Have to make sure we take the key with longest length for best match
		let bestMatch: { key: string; value: string } | null = null
		let longestKeyLength = 0

		for (const [key, value] of this.cache.entries()) {
			// Check if truncated prefix starts with this key
			if (truncated.startsWith(key) && key.length > longestKeyLength) {
				bestMatch = { key, value }
				longestKeyLength = key.length
			}
		}

		if (bestMatch) {
			// Validate that the cached completion is a valid completion for the prefix
			if (bestMatch.value.startsWith(truncated.slice(bestMatch.key.length))) {
				// Update LRU timestamp for the matched key by accessing it
				this.cache.get(bestMatch.key)
				// Return the portion of the value that extends beyond the current prefix
				return bestMatch.value.slice(truncated.length - bestMatch.key.length)
			}
		}

		return undefined
	}

	async put(prefix: string, completion: string) {
		const truncated = truncatePrefix(prefix)
		this.cache.set(truncated, completion)
	}
}
