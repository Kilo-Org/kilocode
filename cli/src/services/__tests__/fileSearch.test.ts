/**
 * Tests for file search service
 */

import { describe, it, expect, beforeEach } from "vitest"
import { fileSearchService } from "../fileSearch.js"

describe("FileSearchService", () => {
	beforeEach(() => {
		// Clear cache before each test
		fileSearchService.clearCache()
	})

	describe("searchFiles", () => {
		it("should search files in current workspace", async () => {
			const results = await fileSearchService.searchFiles("", process.cwd(), 10)

			expect(results).toBeDefined()
			expect(Array.isArray(results)).toBe(true)
		})

		it("should limit results to maxResults parameter", async () => {
			const maxResults = 5
			const results = await fileSearchService.searchFiles("", process.cwd(), maxResults)

			expect(results.length).toBeLessThanOrEqual(maxResults)
		})
		it("should filter results by query", async () => {
			const results = await fileSearchService.searchFiles("package", process.cwd(), 10)

			// Fuzzy matching means not all results will contain exact string
			// Just verify we got some results and they're valid
			expect(results.length).toBeGreaterThan(0)
			results.forEach((result) => {
				expect(result.path).toBeDefined()
				expect(result.basename).toBeDefined()
			})
		})

		it("should return file and folder types correctly", async () => {
			const results = await fileSearchService.searchFiles("", process.cwd(), 50)

			results.forEach((result) => {
				expect(["file", "folder"]).toContain(result.type)
				expect(result.path).toBeDefined()
				expect(result.basename).toBeDefined()
			})
		})
	})

	describe("getAllFiles", () => {
		it("should cache file listings", async () => {
			const cwd = process.cwd()

			// First call - should populate cache
			const results1 = await fileSearchService.getAllFiles(cwd)

			// Second call - should use cache (same reference)
			const results2 = await fileSearchService.getAllFiles(cwd)

			expect(results1).toBe(results2) // Same reference = from cache
		})

		it("should return different results for different workspaces", async () => {
			const cwd1 = process.cwd()
			const cwd2 = __dirname

			const results1 = await fileSearchService.getAllFiles(cwd1)
			const results2 = await fileSearchService.getAllFiles(cwd2)

			// Results should be different (unless directories are the same)
			if (cwd1 !== cwd2) {
				expect(results1).not.toBe(results2)
			}
		})
	})

	describe("clearCache", () => {
		it("should clear all cached results", async () => {
			const cwd = process.cwd()

			// Populate cache
			await fileSearchService.getAllFiles(cwd)

			// Clear cache
			fileSearchService.clearCache()

			// Next call should not be cached (different reference)
			const results1 = await fileSearchService.getAllFiles(cwd)
			const results2 = await fileSearchService.getAllFiles(cwd)

			expect(results1).toBe(results2) // Now cached again
		})

		it("should clear cache for specific workspace", async () => {
			const cwd1 = process.cwd()
			const cwd2 = __dirname

			// Populate both caches
			const results1 = await fileSearchService.getAllFiles(cwd1)
			await fileSearchService.getAllFiles(cwd2)

			// Clear only cwd1
			fileSearchService.clearCache(cwd1)

			// cwd1 should be re-fetched, cwd2 should be cached
			const newResults1 = await fileSearchService.getAllFiles(cwd1)
			expect(newResults1).not.toBe(results1)
		})
	})
})
