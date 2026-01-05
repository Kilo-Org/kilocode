import { describe, expect, it, vi } from "vitest"
import { getSnippets } from "../filtering"
import { SnippetPayload } from "../../snippets"
import { AutocompleteSnippetType, AutocompleteCodeSnippet, AutocompleteClipboardSnippet } from "../../snippets/types"
import { HelperVars } from "../../util/HelperVars"

// Mock countTokens to return a simple token count based on content length
vi.mock("../../../llm/countTokens", () => ({
	countTokens: (content: string) => Math.ceil(content.length / 4),
}))

describe("getSnippets", () => {
	const createMockHelper = (overrides: Partial<HelperVars> = {}): HelperVars => {
		return {
			fullPrefix: "function calculateSum(a, b) {\n  return a + b;\n}\n\nconst result = calculateSum(",
			fullSuffix: ");\nconsole.log(result);",
			prunedCaretWindow:
				"function calculateSum(a, b) {\n  return a + b;\n}\n\nconst result = calculateSum();\nconsole.log(result);",
			modelName: "codestral",
			options: {
				slidingWindowSize: 500,
				slidingWindowPrefixPercentage: 0.75,
				maxPromptTokens: 1000,
				maxSnippetPercentage: 0.5,
				experimental_includeClipboard: false,
				useRecentlyOpened: false,
				experimental_includeRecentlyVisitedRanges: false,
				experimental_includeRecentlyEditedRanges: false,
				experimental_includeDiff: false,
			},
			...overrides,
		} as unknown as HelperVars
	}

	const createEmptyPayload = (): SnippetPayload => ({
		rootPathSnippets: [],
		importDefinitionSnippets: [],
		ideSnippets: [],
		recentlyEditedRangeSnippets: [],
		recentlyVisitedRangesSnippets: [],
		diffSnippets: [],
		clipboardSnippets: [],
		recentlyOpenedFileSnippets: [],
		staticSnippet: [],
	})

	describe("Jaccard similarity ranking", () => {
		it("should rank snippets by similarity to cursor context (most similar first)", () => {
			const helper = createMockHelper()
			const payload = createEmptyPayload()

			// Create snippets with varying similarity to the cursor context
			// The cursor context contains "calculateSum", "return", "a", "b", etc.
			// The high similarity snippet shares the exact function name "calculateSum"
			const highSimilaritySnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///high.ts",
				content: "const calculateSum = (x, y) => x + y; const result = calculateSum(1, 2);",
			}

			const mediumSimilaritySnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///medium.ts",
				content: "function add(x, y) { return x + y; }",
			}

			const lowSimilaritySnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///low.ts",
				content: "class DatabaseConnection { connect() {} disconnect() {} query() {} }",
			}

			// Add snippets in reverse order of similarity
			payload.rootPathSnippets = [lowSimilaritySnippet, mediumSimilaritySnippet, highSimilaritySnippet]

			const result = getSnippets(helper, payload)

			// The high similarity snippet should come first (shares "calculateSum" and "result")
			expect(result.length).toBeGreaterThan(0)
			expect(result[0].content).toBe(highSimilaritySnippet.content)
		})

		it("should rank clipboard snippets by similarity when enabled", () => {
			const helper = createMockHelper({
				options: {
					slidingWindowSize: 500,
					slidingWindowPrefixPercentage: 0.75,
					maxPromptTokens: 1000,
					maxSnippetPercentage: 0.5,
					experimental_includeClipboard: true,
					useRecentlyOpened: false,
					experimental_includeRecentlyVisitedRanges: false,
					experimental_includeRecentlyEditedRanges: false,
					experimental_includeDiff: false,
				},
			} as Partial<HelperVars>)

			const payload = createEmptyPayload()

			const highSimilarityClipboard: AutocompleteClipboardSnippet = {
				type: AutocompleteSnippetType.Clipboard,
				content: "calculateSum(1, 2)",
				copiedAt: new Date().toISOString(),
			}

			const lowSimilarityClipboard: AutocompleteClipboardSnippet = {
				type: AutocompleteSnippetType.Clipboard,
				content: "unrelated database query",
				copiedAt: new Date().toISOString(),
			}

			// Add in reverse order
			payload.clipboardSnippets = [lowSimilarityClipboard, highSimilarityClipboard]

			const result = getSnippets(helper, payload)

			// Clipboard snippets should be ranked by similarity
			expect(result.length).toBeGreaterThan(0)
			expect(result[0].content).toBe(highSimilarityClipboard.content)
		})

		it("should filter out snippets already in caret window", () => {
			const helper = createMockHelper()
			const payload = createEmptyPayload()

			// This snippet's content is already in the caret window
			const duplicateSnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///duplicate.ts",
				content: "return a + b",
			}

			const uniqueSnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///unique.ts",
				content: "function subtract(x, y) { return x - y; }",
			}

			payload.rootPathSnippets = [duplicateSnippet, uniqueSnippet]

			const result = getSnippets(helper, payload)

			// Only the unique snippet should be included
			expect(result.length).toBe(1)
			expect(result[0].content).toBe(uniqueSnippet.content)
		})

		it("should handle empty snippet arrays", () => {
			const helper = createMockHelper()
			const payload = createEmptyPayload()

			const result = getSnippets(helper, payload)

			expect(result).toEqual([])
		})

		it("should handle single snippet without ranking", () => {
			const helper = createMockHelper()
			const payload = createEmptyPayload()

			const singleSnippet: AutocompleteCodeSnippet = {
				type: AutocompleteSnippetType.Code,
				filepath: "file:///single.ts",
				content: "const x = 1;",
			}

			payload.rootPathSnippets = [singleSnippet]

			const result = getSnippets(helper, payload)

			expect(result.length).toBe(1)
			expect(result[0].content).toBe(singleSnippet.content)
		})

		it("should respect token limits while selecting most similar snippets first", () => {
			const helper = createMockHelper({
				options: {
					slidingWindowSize: 500,
					slidingWindowPrefixPercentage: 0.75,
					maxPromptTokens: 100, // Very limited tokens
					maxSnippetPercentage: 0.5, // Only 50 tokens for snippets
					experimental_includeClipboard: false,
					useRecentlyOpened: false,
					experimental_includeRecentlyVisitedRanges: false,
					experimental_includeRecentlyEditedRanges: false,
					experimental_includeDiff: false,
				},
			} as Partial<HelperVars>)

			const payload = createEmptyPayload()

			// Create multiple snippets - the most similar ones should be selected first
			const snippets: AutocompleteCodeSnippet[] = [
				{
					type: AutocompleteSnippetType.Code,
					filepath: "file:///1.ts",
					content: "unrelated content about databases and queries",
				},
				{
					type: AutocompleteSnippetType.Code,
					filepath: "file:///2.ts",
					content: "function calculateSum(x, y) { return x + y; }",
				},
				{
					type: AutocompleteSnippetType.Code,
					filepath: "file:///3.ts",
					content: "another unrelated piece of code",
				},
			]

			payload.rootPathSnippets = snippets

			const result = getSnippets(helper, payload)

			// Due to token limits, not all snippets may be included
			// But the most similar one should be prioritized
			if (result.length > 0) {
				expect(result[0].content).toContain("calculateSum")
			}
		})
	})
})
