import { describe, it, expect, beforeEach } from "vitest"
import { AutocompleteLruCacheInMem } from "./AutocompleteLruCacheInMem"

describe("AutoCompleteLruCacheInMem", () => {
	let cache: AutocompleteLruCacheInMem

	beforeEach(async () => {
		cache = await AutocompleteLruCacheInMem.get()
	})

	describe("basic operations", () => {
		it("should store and retrieve a value", async () => {
			await cache.put("hello", "world")
			const result = await cache.get("hello")
			expect(result).toBe("world")
		})

		it("should return undefined for non-existent key", async () => {
			const result = await cache.get("nonexistent")
			expect(result).toBeUndefined()
		})

		it("should update existing value", async () => {
			await cache.put("key", "value1")
			await cache.put("key", "value2")
			const result = await cache.get("key")
			expect(result).toBe("value2")
		})
	})

	describe("exact key matching", () => {
		it("should match exact key and return value", async () => {
			await cache.put("hello", "world")
			const result = await cache.get("hello")
			expect(result).toBe("world")
		})

		it("should return undefined when key doesn't match exactly", async () => {
			await cache.put("hello", "world")
			const result = await cache.get("goodbye")
			expect(result).toBeUndefined()
		})

		it("should return undefined for partial key match", async () => {
			await cache.put("hello", "world")
			const result = await cache.get("hel")
			expect(result).toBeUndefined()
		})

		it("should be case sensitive", async () => {
			await cache.put("Hello", "World")
			const result1 = await cache.get("Hello")
			const result2 = await cache.get("hello")
			expect(result1).toBe("World")
			expect(result2).toBeUndefined()
		})
	})

	describe("fuzzy matching", () => {
		it("should return completion when prefix extends a cached key", async () => {
			// Cache "c" -> "ontinue"
			await cache.put("c", "ontinue")
			// Query "co" should return "ntinue" (completion minus what we already have)
			const result = await cache.get("co")
			expect(result).toBe("ntinue")
		})

		it("should prefer longest matching key", async () => {
			// Cache multiple overlapping keys
			await cache.put("h", "ello world")
			await cache.put("he", "llo world")
			await cache.put("hel", "lo world")

			// Query "hello" should match "hel" (longest key)
			// User typed "hello" = "hel" + "lo", cached completion is "lo world"
			// So return " world" (the part not yet typed)
			const result = await cache.get("hello")
			expect(result).toBe(" world")
		})

		it("should validate cached completion starts correctly", async () => {
			// Cache "c" -> "ontinue"
			await cache.put("c", "ontinue")
			// Query "cx" doesn't match the completion pattern, should return undefined
			const result = await cache.get("cx")
			expect(result).toBeUndefined()
		})

		it("should return exact match if available", async () => {
			// Cache both exact and partial keys
			await cache.put("co", "mplete")
			await cache.put("c", "ontinue")

			// Exact match should be preferred
			const result = await cache.get("co")
			expect(result).toBe("mplete")
		})

		it("should handle multiple partial matches correctly", async () => {
			// Cache overlapping prefixes
			await cache.put("fun", "ction")
			await cache.put("f", "unction")

			// Query "func" should match "fun" (longest) and return "ction"
			const result = await cache.get("func")
			expect(result).toBe("tion")
		})

		it("should return undefined when no fuzzy match exists", async () => {
			await cache.put("hello", "world")
			// "goodbye" doesn't start with "hello"
			const result = await cache.get("goodbye")
			expect(result).toBeUndefined()
		})

		it("should handle empty cache for fuzzy matching", async () => {
			const result = await cache.get("anyprefix")
			expect(result).toBeUndefined()
		})
	})

	describe("LRU eviction", () => {
		it("should evict oldest entry when capacity is reached", async () => {
			// Create a fresh cache for this test
			const testCache = await AutocompleteLruCacheInMem.get()

			// Fill cache to capacity (100 entries)
			for (let i = 0; i < 100; i++) {
				await testCache.put(`key${i}`, `value${i}`)
			}

			// Add one more entry to trigger eviction
			await testCache.put("newkey", "newvalue")

			// First entry should be evicted (oldest timestamp)
			const result = await testCache.get("key0")
			expect(result).toBeUndefined()

			// New entry should exist
			const newResult = await testCache.get("newkey")
			expect(newResult).toBe("newvalue")
		})

		it("should update timestamp on cache hit", async () => {
			// Create a fresh cache for this test
			const testCache = await AutocompleteLruCacheInMem.get()

			// Fill to capacity
			for (let i = 0; i < 100; i++) {
				await testCache.put(`key${i}`, `value${i}`)
			}

			// Access an early entry to refresh its timestamp
			const refreshedValue = await testCache.get("key5")
			expect(refreshedValue).toBe("value5")

			// Add new entries to trigger evictions
			await testCache.put("new1", "newvalue1")
			await testCache.put("new2", "newvalue2")

			// key5 should still exist (refreshed timestamp)
			const key5Result = await testCache.get("key5")
			expect(key5Result).toBe("value5")

			// key0 should be evicted (oldest timestamp, never accessed)
			const key0Result = await testCache.get("key0")
			expect(key0Result).toBeUndefined()
		})
	})

	describe("edge cases", () => {
		it("should handle empty strings", async () => {
			const testCache = await AutocompleteLruCacheInMem.get()
			await testCache.put("", "empty")
			const result = await testCache.get("")
			expect(result).toBe("empty")
		})

		it("should handle very long strings", async () => {
			const testCache = await AutocompleteLruCacheInMem.get()
			const longString = "a".repeat(10000)
			await testCache.put(longString, "completion")
			const result = await testCache.get(longString)
			expect(result).toBe("completion")
		})

		it("should handle special characters", async () => {
			await cache.put("const x = {", "foo: 'bar'}")
			const result = await cache.get("const x = {")
			expect(result).toBe("foo: 'bar'}")
		})

		it("should handle unicode characters", async () => {
			await cache.put("emoji 🚀", "rocket")
			const result = await cache.get("emoji 🚀")
			expect(result).toBe("rocket")
		})
	})

	describe("concurrent operations", () => {
		it("should handle concurrent put operations", async () => {
			const promises = []
			for (let i = 0; i < 10; i++) {
				promises.push(cache.put(`concurrent${i}`, `value${i}`))
			}
			await Promise.all(promises)

			// All values should be stored
			for (let i = 0; i < 10; i++) {
				const result = await cache.get(`concurrent${i}`)
				expect(result).toBe(`value${i}`)
			}
		})

		it("should handle concurrent get operations", async () => {
			await cache.put("shared", "value")

			const promises = []
			for (let i = 0; i < 10; i++) {
				promises.push(cache.get("shared"))
			}
			const results = await Promise.all(promises)

			// All gets should return the same value
			results.forEach((result) => {
				expect(result).toBe("value")
			})
		})
	})

	describe("multiple cache instances", () => {
		it("should create separate cache instances", async () => {
			const cache1 = await AutocompleteLruCacheInMem.get()
			const cache2 = await AutocompleteLruCacheInMem.get()

			await cache1.put("test", "value1")
			await cache2.put("test", "value2")

			const result1 = await cache1.get("test")
			const result2 = await cache2.get("test")

			// Each instance should have its own data
			expect(result1).toBe("value1")
			expect(result2).toBe("value2")
		})
	})
})
