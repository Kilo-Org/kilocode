export class LRUCache<K, V> {
	private cache: Map<K, { value: V; expiry: number }>
	private maxSize: number
	private ttl: number // Time to live in milliseconds

	constructor(maxSize: number = 100, ttl: number = 3600000) {
		// Default TTL is 1 hour
		this.cache = new Map()
		this.maxSize = maxSize
		this.ttl = ttl
	}

	get(key: K): V | undefined {
		const item = this.cache.get(key)
		if (!item) {
			return undefined
		}

		// Check for expiry
		if (Date.now() > item.expiry) {
			this.cache.delete(key)
			return undefined
		}

		// Refresh entry on access (move to end of map)
		this.cache.delete(key)
		this.cache.set(key, item)

		return item.value
	}

	set(key: K, value: V): void {
		// Refresh entry if it already exists
		if (this.cache.has(key)) {
			this.cache.delete(key)
		}
		// Evict if cache is full
		else if (this.cache.size >= this.maxSize) {
			const oldestKey = this.cache.keys().next().value
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey)
			}
		}

		const expiry = Date.now() + this.ttl
		this.cache.set(key, { value, expiry })
	}

	clear(): void {
		this.cache.clear()
	}

	get size(): number {
		return this.cache.size
	}
}
