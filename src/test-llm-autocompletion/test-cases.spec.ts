import { describe, expect, it } from "vitest"
import { categories, testCases, getTestCasesByCategory, getCategories } from "./test-cases.js"

describe("test-cases", () => {
	describe("Category structure", () => {
		it("should have valid category names (no spaces, only letters, dashes, underscores)", () => {
			const validNamePattern = /^[a-zA-Z_-]+$/
			categories.forEach((category) => {
				expect(category.name).toMatch(validNamePattern)
			})
		})

		it("should have test cases in each category", () => {
			categories.forEach((category) => {
				expect(category.testCases.length).toBeGreaterThan(0)
			})
		})

		it("should have unique category names", () => {
			const names = categories.map((c) => c.name)
			const uniqueNames = [...new Set(names)]
			expect(names.length).toBe(uniqueNames.length)
		})
	})

	describe("testCases array", () => {
		it("should flatten all test cases from categories", () => {
			const expectedCount = categories.reduce((sum, cat) => sum + cat.testCases.length, 0)
			expect(testCases.length).toBe(expectedCount)
		})

		it("should include category name in each test case", () => {
			testCases.forEach((testCase) => {
				expect(testCase.category).toBeDefined()
				expect(typeof testCase.category).toBe("string")
			})
		})

		it("should have unique test case names within categories", () => {
			categories.forEach((category) => {
				const names = category.testCases.map((tc) => tc.name)
				const uniqueNames = [...new Set(names)]
				expect(names.length).toBe(uniqueNames.length)
			})
		})
	})

	describe("getTestCasesByCategory", () => {
		it("should return test cases for valid category", () => {
			const categoryName = categories[0].name
			const result = getTestCasesByCategory(categoryName)
			expect(result.length).toBeGreaterThan(0)
			result.forEach((tc) => {
				expect(tc.category).toBe(categoryName)
			})
		})

		it("should return empty array for invalid category", () => {
			const result = getTestCasesByCategory("non-existent-category")
			expect(result).toEqual([])
		})

		it("should include category in returned test cases", () => {
			const categoryName = categories[0].name
			const result = getTestCasesByCategory(categoryName)
			result.forEach((tc) => {
				expect(tc).toHaveProperty("category", categoryName)
			})
		})
	})

	describe("getCategories", () => {
		it("should return all category names", () => {
			const result = getCategories()
			expect(result.length).toBe(categories.length)
		})

		it("should return category names in correct order", () => {
			const result = getCategories()
			const expected = categories.map((c) => c.name)
			expect(result).toEqual(expected)
		})
	})

	describe("Test case structure", () => {
		it("should have required properties in all test cases", () => {
			testCases.forEach((tc) => {
				expect(tc).toHaveProperty("name")
				expect(tc).toHaveProperty("category")
				expect(tc).toHaveProperty("input")
				expect(tc).toHaveProperty("description")
			})
		})
	})
})
