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

export class AutoCompleteLruCacheInMem {
	private static capacity = 1000
	private cache: LRUCache<string, string>

	private constructor() {
		this.cache = new LRUCache<string, string>({
			max: AutoCompleteLruCacheInMem.capacity,
		})
	}

	static async get(): Promise<AutoCompleteLruCacheInMem> {
		return new AutoCompleteLruCacheInMem()
	}

	async get(prefix: string): Promise<string | undefined> {
		const truncated = truncatePrefix(prefix)
		return this.cache.get(truncated)
	}

	async put(prefix: string, completion: string) {
		const truncated = truncatePrefix(prefix)
		this.cache.set(truncated, completion)
	}
}
