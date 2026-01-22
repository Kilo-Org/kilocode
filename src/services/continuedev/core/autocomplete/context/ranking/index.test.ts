import { describe, expect, it } from "vitest"
import { rankAndOrderSnippets, fillPromptWithSnippets } from "./index"
import { RankedSnippet } from "../../types"

// vibecoded
describe("rankAndOrderSnippets", () => {
	it("should rank and order snippets by similarity to cursor context", () => {
		// Create a simple mock HelperVars with only the required properties
		const mockHelper = {
			fullPrefix: "function calculateTotal(items) {\n  const total = items.reduce(",
			fullSuffix: ", 0);\n  return total;\n}",
			options: {
				slidingWindowSize: 50,
				slidingWindowPrefixPercentage: 0.5,
			},
		} as any

		// Create test snippets with different levels of similarity to the cursor context
		const snippets: RankedSnippet[] = [
			{
				filepath: "utils.ts",
				range: {
					start: { line: 10, character: 0 },
					end: { line: 12, character: 0 },
				},
				contents: "// Helper function for database queries\nfunction queryDb() {}",
			},
			{
				filepath: "math.ts",
				range: {
					start: { line: 5, character: 0 },
					end: { line: 7, character: 0 },
				},
				contents: "// Array reduce function\nconst sum = items.reduce((acc, item) => acc + item, 0);",
			},
			{
				filepath: "helpers.ts",
				range: {
					start: { line: 20, character: 0 },
					end: { line: 22, character: 0 },
				},
				contents:
					"// Calculate total with reduce\nfunction calculateSum(items) {\n  return items.reduce((a, b) => a + b);\n}",
			},
		]

		const result = rankAndOrderSnippets(snippets, mockHelper)

		// Verify the result has the expected structure
		expect(result).toHaveLength(3)

		// All snippets should have scores assigned
		expect(result.every((s) => typeof s.score === "number")).toBe(true)

		// All snippets should have required properties
		result.forEach((snippet) => {
			expect(snippet.filepath).toBeDefined()
			expect(snippet.range).toBeDefined()
			expect(snippet.contents).toBeDefined()
			expect(snippet.score).toBeGreaterThanOrEqual(0)
		})

		// Scores should be in ascending order (lower scores = better matches)
		for (let i = 0; i < result.length - 1; i++) {
			expect(result[i].score).toBeLessThanOrEqual(result[i + 1].score)
		}
	})
})
// vibecoded

describe("fillPromptWithSnippets", () => {
	it("should fill token budget with snippets until limit is reached", () => {
		// Create snippets with required properties (including score)
		const snippets: Required<RankedSnippet>[] = [
			{
				filepath: "math.ts",
				range: {
					start: { line: 1, character: 0 },
					end: { line: 3, character: 0 },
				},
				contents: "function add(a, b) { return a + b; }",
				score: 0.1,
			},
			{
				filepath: "utils.ts",
				range: {
					start: { line: 5, character: 0 },
					end: { line: 7, character: 0 },
				},
				contents: "function multiply(x, y) { return x * y; }",
				score: 0.2,
			},
			{
				filepath: "helpers.ts",
				range: {
					start: { line: 10, character: 0 },
					end: { line: 15, character: 0 },
				},
				contents: "function calculateSum(items) {\n  return items.reduce((acc, item) => acc + item, 0);\n}",
				score: 0.3,
			},
		]

		// Set token limit to include first 2 snippets but not the third
		// Using a model name and a reasonable token limit
		const maxSnippetTokens = 25
		const modelName = "gpt-3.5-turbo"

		const result = fillPromptWithSnippets(snippets, maxSnippetTokens, modelName)

		// Verify that we got fewer snippets than we started with
		expect(result.length).toBeLessThan(snippets.length)
		expect(result.length).toBeGreaterThan(0)

		// Verify all returned snippets are from the original list
		result.forEach((snippet) => {
			expect(snippets).toContainEqual(snippet)
		})

		// Verify snippets maintain their order (first snippets are kept)
		for (let i = 0; i < result.length; i++) {
			expect(result[i]).toBe(snippets[i])
		}
	})
})
